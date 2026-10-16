import * as THREE from 'three';

/**
 * Ters-kabuk kontur kalınlıkları: kapalı (kalınlık ekranda sabitti, uzaktaki karakter kontura boğuluyordu).
 * Kontur artık son işlemde çizilir: src/render/post.ts.
 */
export const OUTLINE = { character: false, prop: false } as const;
const OUTLINE_COLOR: [number, number, number] = [0.09, 0.06, 0.06];

let gradient: THREE.DataTexture | null = null;

/** Cel-shade için 3 kademeli ışık rampası (gölge / ara ton / ışık). */
export function toonGradient(): THREE.DataTexture {
  if (!gradient) {
    const data = new Uint8Array([95, 175, 255]);
    gradient = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
    gradient.minFilter = THREE.NearestFilter;
    gradient.magFilter = THREE.NearestFilter;
    gradient.generateMipmaps = false;
    gradient.needsUpdate = true;
  }
  return gradient;
}

export function setOutline(material: THREE.Material, thickness: number | false) {
  material.userData.outlineParameters =
    thickness === false ? { visible: false } : { thickness, color: OUTLINE_COLOR, alpha: 1, visible: true };
}

export function toonMaterial(
  color: THREE.ColorRepresentation,
  opts: { outline?: number | false; flat?: boolean; map?: THREE.Texture | null } = {},
): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({
    color,
    map: opts.map ?? null,
    gradientMap: toonGradient(),
  });
  // Toon shader düz gölgelendirmeyi destekliyor ama tip tanımında alan yok.
  (m as unknown as { flatShading: boolean }).flatShading = opts.flat ?? false;
  setOutline(m, opts.outline ?? OUTLINE.character);
  return m;
}

const MAP_PALETTE: Record<string, string> = {
  dirt_road: '#baa892',
  dirt_road_bare: '#b2a08a',
  dirt_road_trails: '#a89680',
  road_edge: '#a49581',
  gravel: '#9c8e7c',
  ground_dirt: '#988368',
  grass_close: '#7c945b',
  aerial_grass: '#738d54',
  grass_vegetation_green: '#789157',
  grass_vegetation_dry: '#9a9565',
  broken_rock: '#88847e',
  mud_pile: '#8e7960',
  tall_cliff: '#8e8a83',
  sloped_rock: '#8a8781',
  cobblestone: '#8c8a84',
  pine_v2: '#4a5b3a',
  bark: '#6d533f',
  wood_fence: '#786048',
  wood_log: '#735b44',
};

/**
 * Ağır 2K/4K foto dokuları çizgi film tarzı için yumuşatıp çözünürlüğünü azaltır.
 * Pikselli gürültüyü, kum/çakıl noktacıklarını ve kontrast sertliğini yok eder.
 */
export function reduceTextureDetail(tex: THREE.Texture, maxDim = 512): THREE.Texture {
  if (!tex || !tex.image || tex.userData.__reduced) return tex;
  try {
    const img = tex.image;
    const w = img.width || 0;
    const h = img.height || 0;
    if (w <= 0 || h <= 0) return tex;

    const aspect = w / h;
    let targetW = Math.min(w, maxDim);
    let targetH = Math.round(targetW / aspect);
    if (targetH > maxDim) {
      targetH = maxDim;
      targetW = Math.round(targetH * aspect);
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return tex;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const newTex = new THREE.CanvasTexture(canvas);
    newTex.wrapS = tex.wrapS;
    newTex.wrapT = tex.wrapT;
    newTex.repeat.copy(tex.repeat);
    newTex.offset.copy(tex.offset);
    newTex.anisotropy = 1;
    newTex.generateMipmaps = true;
    newTex.minFilter = THREE.LinearMipmapLinearFilter;
    newTex.magFilter = THREE.LinearFilter;
    newTex.colorSpace = tex.colorSpace;
    newTex.userData.__reduced = true;
    return newTex;
  } catch {
    tex.anisotropy = 1;
    return tex;
  }
}

/** Dışarıdan gelen bir modelin (GLB) tüm malzemelerini cel-shade malzemeye çevirir. */
export function toonify(root: THREE.Object3D, outline: number | false) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const convert = (src: THREE.Material) => {
      const s = src as THREE.MeshStandardMaterial;

      // Gerçekçi ağaçların (Realistic Pine / Bark / Needles) dokularını çizgi film tarzına uyarla
      const isTree = /pine|bark|needle/i.test(s.name) || /pine|realistic/i.test(mesh.name);
      if (isTree) {
        const isFoliage = /pine|leaf|needle/i.test(s.name) || /needle/i.test(mesh.name);
        const smoothMap = s.map ? reduceTextureDetail(s.map, 512) : null;
        const col = isFoliage ? '#4e623d' : '#6b533e';
        const m = toonMaterial(col, { outline: false, map: smoothMap });
        m.name = s.name;
        if (isFoliage) {
          m.transparent = false;
          m.alphaTest = 0.20;
          m.side = THREE.DoubleSide;
          m.shadowSide = THREE.DoubleSide;
        }
        m.userData.outlineParameters = { visible: false };
        return m;
      }

      // Fazladan ufuk çizgisini kapatan çalıları gizle
      const isBush = /forest_bush/i.test(s.name) || /forest_bush/i.test(mesh.name);
      if (isBush) {
        mesh.visible = false;
        mesh.userData.origVisible = false;
        const m = toonMaterial(0x3a4f2e, { outline: false });
        m.visible = false;
        return m;
      }

      // Gözlük camı veya şeffaf cam parçaları (Jackie'nin gözlüğü vb.)
      const isGlass = /glass|lens/i.test(s.name) || /glass|lens/i.test(mesh.name);
      if (isGlass) {
        const m = toonMaterial(s.color ?? 0xc8e6ff, { outline: false, map: s.map ?? null });
        m.name = s.name;
        m.transparent = true;
        m.opacity = (s.opacity !== undefined && s.opacity < 1) ? s.opacity : 0.30;
        m.depthWrite = false;
        m.userData.outlineParameters = { visible: false };
        return m;
      }

      // Ağız içi boşluğu (Amy Material.006 vb.): kontur olmamalı ve koyu sıcak ağız tonu almalı
      const isMouthInside = /material\.006|mouth_in|oral|throat/i.test(s.name);
      if (isMouthInside) {
        const m = toonMaterial(0x381218, { outline: false, map: s.map ?? null });
        m.name = s.name;
        m.userData.outlineParameters = { visible: false };
        return m;
      }

      // Harita zemin, yol, kaya ve çit materyallerini sadeleştir (fotoğraf gürültüsünü gider)
      const isMapTerrain = /road|ground|dirt|cliff|rock|stone|terrain|cobble|fence|log|grass|mud|puddle/i.test(s.name) ||
                           /road|ground|dirt|cliff|rock|stone|terrain|cobble|fence|log|grass|mud|puddle/i.test(mesh.name);

      const smoothMap = s.map ? (isMapTerrain ? reduceTextureDetail(s.map, 512) : s.map) : null;
      if (smoothMap) smoothMap.anisotropy = 1;

      // Çizgi film renk uyumu
      let baseColor: THREE.ColorRepresentation = s.color ?? 0xffffff;
      if (isMapTerrain) {
        const lower = (s.name + ' ' + mesh.name).toLowerCase();
        for (const [key, hex] of Object.entries(MAP_PALETTE)) {
          if (lower.includes(key)) {
            baseColor = hex;
            break;
          }
        }
      }

      // Saydam işaretli parçalar (kaş, göz, ağız gibi kesik dokular) alpha-cutout olarak çizilir:
      const cutout = (s.transparent && s.opacity >= 1 && !!smoothMap) || s.alphaTest > 0;
      const m = toonMaterial(baseColor, { outline: cutout || isMapTerrain ? false : outline, map: smoothMap });
      m.name = s.name;
      m.transparent = s.transparent && s.opacity < 1;
      m.opacity = s.opacity;

      // Harita ve arazide normal haritalarını kaldırarak pürüzsüz çizgi film zemin elde et
      if (s.normalMap && !isMapTerrain && !isTree) {
        s.normalMap.anisotropy = 1;
        m.normalMap = s.normalMap;
        m.normalScale.copy(s.normalScale);
      }

      const isFoliage = /leaf|bush/i.test(s.name) || /leaf|bush/i.test(mesh.name);
      const alphaCut = isFoliage ? 0.20 : 0.5;
      m.alphaTest = cutout ? (s.alphaTest > 0 ? Math.min(s.alphaTest, alphaCut) : alphaCut) : s.alphaTest;
      m.side = isFoliage ? THREE.DoubleSide : s.side;
      m.shadowSide = isFoliage ? THREE.DoubleSide : THREE.FrontSide;
      return m;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(convert) : convert(mesh.material);
    const isTreeOrFoliage = /pine|realistic|leaf|needle/i.test(mesh.name);
    mesh.castShadow = !isTreeOrFoliage;
    mesh.receiveShadow = true;
  });
}

/** Bir nesne ağacının GPU kaynaklarını serbest bırakır (paylaşılan rampa hariç). */
export function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const map = (m as THREE.MeshToonMaterial).map;
      if (map && map !== gradient) map.dispose();
      m.dispose();
    }
  });
}
