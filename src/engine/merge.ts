import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Statik (kemiksiz) bir modeldeki tüm mesh'leri dünya dönüşümleri uygulanmış halde
 * malzemeye göre birleştirir.
 * 
 * NOT: Zaten geometri paylaşan kopya/örnek ağaçlar (Realistic_Pine) birleştirilmez,
 * doğrudan ayrı çizim olarak korunur. Böylece yüz binlerce köşeli ağaçların hafızada
 * gigabaytlarca çoğaltılarak tarayıcıyı kilitlemesi ("sayfa yanıt vermiyor") önlenir.
 */
export function mergeStatic(root: THREE.Object3D): THREE.Group {
  root.updateMatrixWorld(true);
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const out = new THREE.Group();
  out.name = root.name || 'merged';

  const instanced: THREE.Mesh[] = [];

  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh) return;

    // Tekrarlanan çam ağaçları GPU instancing/bellek paylaşımı için tekil bırakılır
    if (mesh.name.includes('Pine') || mesh.name.includes('Realistic')) {
      instanced.push(mesh);
      return;
    }

    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const geo = mesh.geometry;
    
    // Çok malzemeli geometriyi gruplarına böl; tek malzemeli olanları doğrudan klonla.
    const parts: [THREE.Material, THREE.BufferGeometry][] =
      Array.isArray(mesh.material) && geo.groups.length
        ? geo.groups.map((g) => [mats[g.materialIndex ?? 0], extractRange(geo, g.start, g.count)])
        : [[mats[0], geo.clone()]];

    for (const [mat, part] of parts) {
      const g = normalizeAttributes(part);
      g.applyMatrix4(mesh.matrixWorld);
      const list = buckets.get(mat) ?? [];
      list.push(g);
      buckets.set(mat, list);
    }
  });

  // Ağaçları geometriyi çoğaltmadan, dünya koordinatlarıyla ekle
  for (const m of instanced) {
    const tree = new THREE.Mesh(m.geometry, m.material);
    tree.name = m.name;
    tree.matrix.copy(m.matrixWorld);
    tree.matrix.decompose(tree.position, tree.quaternion, tree.scale);
    tree.castShadow = true;
    tree.receiveShadow = true;
    out.add(tree);
  }

  // Zemin, kayalar ve ufak çevre elemanlarını birleştir
  for (const [mat, geos] of buckets) {
    if (!geos.length) continue;
    
    const hasIndex = geos.some((g) => !!g.index);
    const preparedGeos = geos.map((g) => {
      if (hasIndex && !g.index) {
        const count = g.attributes.position.count;
        const indices = new Uint32Array(count);
        for (let i = 0; i < count; i++) indices[i] = i;
        g.setIndex(new THREE.BufferAttribute(indices, 1));
      }
      return g;
    });

    const joined = mergeGeometries(preparedGeos, false);
    geos.forEach((g) => g.dispose());
    if (!joined) continue;

    let finalGeo = joined;
    if (!joined.index && joined.attributes.position.count < 25_000) {
      finalGeo = mergeVertices(joined);
      joined.dispose();
    }

    const mesh = new THREE.Mesh(finalGeo, mat);
    mesh.name = mat.name || 'part';
    mesh.castShadow = mesh.receiveShadow = true;
    out.add(mesh);
  }
  return out;
}

/** İndeks aralığını (veya indekssiz köşe aralığını) ayrı, indekssiz bir geometriye kopyalar. */
function extractRange(geo: THREE.BufferGeometry, start: number, count: number): THREE.BufferGeometry {
  const src = geo.index ? geo.toNonIndexed() : geo;
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(src.attributes)) {
    const a = attr as THREE.BufferAttribute;
    const end = Math.min(a.count, start + count);
    out.setAttribute(name, new THREE.BufferAttribute(a.array.slice(start * a.itemSize, end * a.itemSize), a.itemSize, a.normalized));
  }
  return out;
}

/** Birleştirme için her parçada aynı öznitelikler olsun: position, normal, uv. */
function normalizeAttributes(g: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  g.morphAttributes = {};
  g.clearGroups();
  return g;
}
