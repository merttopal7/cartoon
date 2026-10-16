import * as THREE from 'three';

/** LOD1, LOD2… seviyelerinin başladığı kamera uzaklıkları (m). */
const LOD_DISTANCES = [35, 80];
const LOD_SUFFIX = /_LOD(\d+)$/;

/**
 * Modelde "<ad>_LOD1", "<ad>_LOD2" adlı alt nesneleri olan düğümleri THREE.LOD'a çevirir
 * (tools/blender/pine_lods.py üretir). Düğümün kendi mesh'leri LOD0 olur; düğümün adı ve dönüşümü
 * korunur, böylece ağaç devirme gibi düğümü hareket ettiren kodlar aynen çalışır.
 * Seviye yalnızca o karedeki kamera uzaklığına bağlıdır (histerezis yok), kareler deterministik kalır.
 */
export function setupLods(root: THREE.Object3D): number {
  const owners = new Map<THREE.Object3D, THREE.Object3D[]>();
  root.traverse((o) => {
    const m = LOD_SUFFIX.exec(o.name);
    if (m && o.parent && o.name === `${o.parent.name}${m[0]}`) {
      const list = owners.get(o.parent) ?? [];
      list[Number(m[1])] = o;
      owners.set(o.parent, list);
    }
  });

  for (const [owner, levels] of owners) {
    const lod = new THREE.LOD();
    lod.name = `${owner.name}_lod`;
    const base = new THREE.Group();
    base.name = `${owner.name}_LOD0`;
    for (const child of [...owner.children]) if (!levels.includes(child)) base.add(child);
    lod.addLevel(base, 0);
    levels.forEach((level, i) => {
      if (i > 0 && level) lod.addLevel(level, LOD_DISTANCES[i - 1] ?? LOD_DISTANCES[LOD_DISTANCES.length - 1] * i);
    });
    owner.add(lod);
  }
  return owners.size;
}
