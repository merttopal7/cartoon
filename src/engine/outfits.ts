import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * Kadın karakterlerin (Defne ve Meşe) ortak giyebileceği kostüm kimlikleri.
 * Yeni Silkroad (.bsr) kostümleri `public/models/outfits/female/<id>.fbx` altına eklendiğinde
 * yalnızca bu tabloya bir satır eklenmesi yeterlidir; her iki karakter de anında giyebilir.
 */
export type FemaleOutfitId = 'varsayilan' | 'beyaz_kislik' | 'ninja';

export type FemaleCharacterId = 'defne' | 'mese';

export interface FemaleOutfitMeta {
  id: FemaleOutfitId;
  label: string;
  /** Ortak kostüm FBX yolu (`varsayilan` ise karakterin kendi element kıyafeti korunur). */
  src?: string;
  /** Bacaklar pantolon/çizme olarak ayrık mı (`true`), yoksa tek parça uzun etek mi (`false`)? */
  isPants?: boolean;
  /** Başlık/maske/taç parçası Meşe'nin sırt saçıyla çakışmasın diye arka kurdele kırpılsın mı? */
  hasBackHairRibbon?: boolean;
  /** Başlık saçı tamamen içine alıyor mu (ör. duvak)? `true` ise Meşe'nin saçı çizilmez. */
  hidesBackHair?: boolean;
  /**
   * Defne bu kostümü giyerken kendi gövde atlası yerine kullanılacak doku (ör. beresi kostüm rengine boyanmış;
   * tools/customize_defne_ninja.py üretir). Kostümün başlığı berenin tamamını örtmüyor.
   */
  defneTexture?: string;
  /** Sırt aksesuarının (kanat/silah) kendi merkezi çevresinde ölçeği; silueti çok aşan parçalar küçültülür. */
  backScale?: number;
  /**
   * Kostüm dokusunda yeniden boyamadan kalmış turuncu ten parçaları (doygun turuncu pikseller) karakterin ten rengine
   * çevrilsin mi? Doku yüklenirken uygulanır; kostüm yeniden dışa aktarılsa da geçerli kalır.
   */
  skinFix?: string;
}

export const FEMALE_OUTFITS: readonly FemaleOutfitMeta[] = [
  {
    id: 'beyaz_kislik',
    label: 'Beyaz Kış Elbisesi (Taç & Kanat)',
    src: '/models/outfits/female/beyaz_kislik.fbx',
    isPants: false,
    hidesBackHair: true,
  },
  {
    id: 'ninja',
    label: 'Ninja Kostümü (Maske & Şuriken)',
    src: '/models/outfits/female/ninja.fbx',
    isPants: true,
    hasBackHairRibbon: true,
    defneTexture: '/models/characters/Jackie/Ch29_1001_Diffuse_ninja.jpg',
    // Sırttaki çapraz bıçaklar ±45 cm genişliğindeydi: omuzlardan iğne gibi taşıyorlardı
    backScale: 0.55,
    skinFix: '#f1cfc2',
  },
  {
    id: 'varsayilan',
    label: 'Varsayılan Element Kıyafeti',
  },
] as const;

const STORAGE_KEYS: Record<FemaleCharacterId, string> = {
  defne: 'cartoon-engine.outfit.defne',
  mese: 'cartoon-engine.outfit.mese',
};

function readStoredOutfit(charId: FemaleCharacterId, fallback: FemaleOutfitId): FemaleOutfitId {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(STORAGE_KEYS[charId]);
    if (raw === 'varsayilan' || raw === 'beyaz_kislik' || raw === 'ninja') return raw;
    // Eski anahtar uyumluluğu
    if (charId === 'defne') {
      const legacy = localStorage.getItem('cartoon-engine.defne_outfit');
      if (legacy === 'beyaz') return 'beyaz_kislik';
      if (legacy === 'ninja') return 'ninja';
      if (legacy === 'hava') return 'varsayilan';
    }
  } catch {}
  return fallback;
}

const activeOutfits: Record<FemaleCharacterId, FemaleOutfitId> = {
  defne: readStoredOutfit('defne', 'ninja'),
  mese: readStoredOutfit('mese', 'beyaz_kislik'),
};

export function getCharacterOutfit(charId: FemaleCharacterId): FemaleOutfitId {
  return activeOutfits[charId];
}

export function setCharacterOutfit(charId: FemaleCharacterId, outfitId: FemaleOutfitId): void {
  activeOutfits[charId] = outfitId;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEYS[charId], outfitId);
    }
  } catch {}
}

export function getOutfitMeta(outfitId: FemaleOutfitId): FemaleOutfitMeta {
  return FEMALE_OUTFITS.find((o) => o.id === outfitId) ?? FEMALE_OUTFITS[0];
}

const textureCache = new Map<string, Promise<THREE.Texture>>();

/** Karakter gövde atlası varyantı (bir kez yüklenir; FBX dokuları gibi flipY açık). */
function loadBodyTexture(src: string): Promise<THREE.Texture> {
  let p = textureCache.get(src);
  if (!p) {
    p = new THREE.TextureLoader().loadAsync(src).then((t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    });
    textureCache.set(src, p);
  }
  return p;
}

const skinFixCache = new WeakMap<THREE.Texture, Map<string, THREE.Texture>>();

/**
 * Dokudaki doygun turuncu pikselleri (yeniden boyamadan kalmış ten parçaları) verilen ten rengine çevirir; gölge ve
 * doku parlaklık oranıyla korunur. Aynı doku ve renk için bir kez hesaplanır.
 */
function skinFixedTexture(tex: THREE.Texture, skin: string): THREE.Texture {
  let byColor = skinFixCache.get(tex);
  const hit = byColor?.get(skin);
  if (hit) return hit;
  const img = tex.image as CanvasImageSource & { width: number; height: number };
  if (!img?.width) return tex;
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const g = canvas.getContext('2d')!;
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  const target = new THREE.Color(skin);
  const tr = target.r * 255;
  const tg = target.g * 255;
  const tb = target.b * 255;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i];
    const gg = px[i + 1];
    const b = px[i + 2];
    const mx = Math.max(r, gg, b);
    const mn = Math.min(r, gg, b);
    if (mx < 110 || mx !== r) continue;
    const sat = (mx - mn) / mx;
    if (sat < 0.45) continue;
    const hue = (60 * (gg - b)) / Math.max(1, mx - mn);
    if (hue < 12 || hue > 42) continue;
    // Turuncu tonun parlaklığı ten rengine oranlanır (orta ton ≈ 165)
    const k = Math.min(1.15, Math.max(0.55, (0.299 * r + 0.587 * gg + 0.114 * b) / 165));
    px[i] = Math.min(255, tr * k);
    px[i + 1] = Math.min(255, tg * k);
    px[i + 2] = Math.min(255, tb * k);
  }
  g.putImageData(data, 0, 0);
  const out = new THREE.CanvasTexture(canvas);
  out.colorSpace = tex.colorSpace;
  out.flipY = tex.flipY;
  out.wrapS = tex.wrapS;
  out.wrapT = tex.wrapT;
  out.minFilter = tex.minFilter;
  out.magFilter = tex.magFilter;
  out.anisotropy = tex.anisotropy;
  if (!byColor) {
    byColor = new Map();
    skinFixCache.set(tex, byColor);
  }
  byColor.set(skin, out);
  return out;
}

/** Ortak kostüm FBX önbelleği (bir kez yüklenir, her karakter için klonlanıp kendi iskeletine uyarlanır). */
const outfitCache = new Map<string, Promise<THREE.Group>>();
const fbxLoader = new FBXLoader();

function loadOutfitTemplate(src: string): Promise<THREE.Group> {
  let p = outfitCache.get(src);
  if (!p) {
    p = fbxLoader.loadAsync(src);
    outfitCache.set(src, p);
  }
  return p;
}

const normBone = (name: string) =>
  name
    .toLowerCase()
    .replace(/[\s_.\-:]/g, '')
    .replace(/^mixamorig\d*/, '');

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function piecewise(x: number, pts: [number, number][]): number {
  if (x <= pts[0][0]) {
    const [x0, y0] = pts[0];
    const [x1, y1] = pts[1];
    return y0 + ((x - x0) * (y1 - y0)) / Math.max(1e-5, x1 - x0);
  }
  const last = pts.length - 1;
  if (x >= pts[last][0]) {
    const [x0, y0] = pts[last - 1];
    const [x1, y1] = pts[last];
    return y1 + ((x - x1) * (y1 - y0)) / Math.max(1e-5, x1 - x0);
  }
  for (let i = 0; i < last; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    if (x >= x0 && x <= x1) {
      const t = (x - x0) / Math.max(1e-5, x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return pts[last][1];
}

interface BodyLandmarks {
  ankleY: number;
  kneeY: number;
  hipY: number;
  spine1Y: number;
  spine2Y: number;
  armY: number;
  neckY: number;
  headY: number;
  headTopY: number;
  shoulderX: number;
  elbowX: number;
  wristX: number;
  tipX: number;
  hipLegX: number;
  kneeLegX: number;
  ankleLegX: number;
  ankleZ: number;
  kneeZ: number;
  hipZ: number;
  torsoZ: number;
  armZ: number;
  headZ: number;
}

/** İskeletin bağlama pozundaki kemik konumlarından anatomik referans noktalarını çıkarır. */
function measureLandmarks(bones: THREE.Bone[], root: THREE.Object3D): BodyLandmarks {
  root.updateMatrixWorld(true);
  const byName = new Map<string, THREE.Vector3>();
  for (const b of bones) {
    const key = normBone(b.name);
    if (!byName.has(key)) {
      const p = new THREE.Vector3();
      b.getWorldPosition(p);
      byName.set(key, p);
    }
  }
  const get = (k: string, fb: [number, number, number]) => byName.get(k) ?? new THREE.Vector3(...fb);

  const hips = get('hips', [0, 96.65, 4.44]);
  const spine1 = get('spine1', [0, 110.97, 4.16]);
  const spine2 = get('spine2', [0, 119.79, 3.98]);
  const neck = get('neck', [0, 129.7, 3.78]);
  const head = get('head', [0, 135.92, 3.49]);
  const lEye = byName.get('lefteye');
  const lArm = get('leftarm', [10.87, 125.52, 3.74]);
  const lForeArm = get('leftforearm', [33.08, 124.48, 3.49]);
  const lHand = get('lefthand', [55.97, 124.45, 3.53]);
  const lUpLeg = get('leftupleg', [5.97, 85.11, 4.32]);
  const lLeg = get('leftleg', [7.32, 53.67, 4.15]);
  const lFoot = get('leftfoot', [8.8, 7.82, -1.29]);

  // Alın/kaş hizası (headY), kafatası tepe noktası (headTopY) ve boyun tabanı (neckY)
  const isMeseRig = neck.y > 140;
  const browY = lEye ? lEye.y - 1.5 : isMeseRig ? 164.8 : 143.5;
  const skullTopY = isMeseRig ? 177.6 : 159.8;
  const headCenterZ = isMeseRig ? 2.2 : head.z;
  // Erika'da mixamorigNeck kemiği çeneye çok yakındır (149.5 cm); yaka/atkı parçalarının çeneyi örtmemesi için boyun tabanı (145.2 cm) referans alınır
  const neckBaseY = isMeseRig ? 145.2 : neck.y;

  const handLen = (lHand.x - lForeArm.x) * 0.62;
  return {
    ankleY: lFoot.y,
    kneeY: lLeg.y,
    hipY: hips.y,
    spine1Y: spine1.y,
    spine2Y: spine2.y,
    armY: (lArm.y + lForeArm.y) * 0.5,
    neckY: neckBaseY,
    headY: browY,
    headTopY: skullTopY,
    shoulderX: Math.abs(lArm.x),
    elbowX: Math.abs(lForeArm.x),
    wristX: Math.abs(lHand.x),
    tipX: Math.abs(lHand.x) + Math.abs(handLen),
    hipLegX: Math.abs(lUpLeg.x),
    kneeLegX: Math.abs(lLeg.x),
    ankleLegX: Math.abs(lFoot.x),
    ankleZ: lFoot.z,
    kneeZ: lLeg.z,
    hipZ: hips.z,
    torsoZ: spine2.z,
    armZ: (lArm.z + lForeArm.z) * 0.5,
    headZ: headCenterZ,
  };
}

function legCenterX(L: BodyLandmarks, y: number): number {
  return piecewise(y, [
    [0, L.ankleLegX],
    [L.ankleY, L.ankleLegX],
    [L.kneeY, L.kneeLegX],
    [L.hipY * 0.88, L.hipLegX],
  ]);
}

function centerZ(L: BodyLandmarks, y: number, ax: number): number {
  const spineZ = piecewise(y, [
    [0, L.ankleZ],
    [L.ankleY, L.ankleZ],
    [L.kneeY, L.kneeZ],
    [L.hipY, L.hipZ],
    [L.spine2Y, L.torsoZ],
    [L.headY, L.headZ],
  ]);
  if (y > L.spine1Y && y < L.neckY + 3 && ax > L.shoulderX * 0.9) {
    const kArm = smoothstep(L.shoulderX * 0.9, L.shoulderX * 1.45, ax) * smoothstep(L.spine1Y, L.spine2Y, y);
    return lerp(spineZ, L.armZ, kArm);
  }
  return spineZ;
}

/**
 * Ortak kadın kostümünü (`outfit_mesh`) hedef karakterin (`defne` veya `mese`) kendi kemik ölçülerine
 * ve iskeletine (`targetSkeleton`) uyarlar, karakterin boyun altındaki eski kıyafet/gövde üçgenlerini gizler.
 */
export async function applySharedFemaleOutfit(
  root: THREE.Object3D,
  charId: FemaleCharacterId,
  outfitId?: FemaleOutfitId,
): Promise<void> {
  const activeId = outfitId ?? getCharacterOutfit(charId);
  const meta = getOutfitMeta(activeId);
  if (!meta.src || activeId === 'varsayilan') return;

  // 1. Hedef karakterin ana SkinnedMesh'ini ve tam vücut iskeletini bul
  let targetBody: THREE.SkinnedMesh | undefined;
  let erikaClothes: THREE.SkinnedMesh | undefined;
  let erikaHair: THREE.SkinnedMesh | undefined;
  root.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (!sm.isSkinnedMesh) return;
    if (charId === 'defne' && /ch29/i.test(sm.name)) targetBody = sm;
    else if (charId === 'mese') {
      if (/body_mesh/i.test(sm.name)) targetBody = sm;
      else if (/clothes_mesh/i.test(sm.name)) erikaClothes = sm;
      else if (/erika_sac/i.test(sm.name)) erikaHair = sm;
    }
  });
  // Meşe'de tüm vücut kemikleri (Hips, bacaklar, omurga, kollar, baş) Clothes_Mesh iskeletindedir
  const fullSkinSource = charId === 'mese' ? (erikaClothes ?? targetBody) : targetBody;
  if (!targetBody || !fullSkinSource || !fullSkinSource.skeleton) return;
  const targetSkeleton = fullSkinSource.skeleton;
  const targetBindMatrix = fullSkinSource.bindMatrix.clone();

  // 2. Ortak kostüm şablonunu yükle ve klonla
  const templateGroup = await loadOutfitTemplate(meta.src);
  const clonedGroup = cloneSkinned(templateGroup);
  clonedGroup.updateMatrixWorld(true);
  let outfitMesh: THREE.SkinnedMesh | undefined;
  clonedGroup.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) outfitMesh = o as THREE.SkinnedMesh;
  });
  if (!outfitMesh || !outfitMesh.skeleton) return;

  // Kostüm geometrisini Blender yerel uzayından (metre, Z-up) kanonik bağlama uzayına (cm, Y-up) dönüştür
  let geom = outfitMesh.geometry.clone();
  geom.applyMatrix4(outfitMesh.bindMatrix);

  // Kostüm materyal gruplarını adlarına göre sınıflandır (0: gövde, 1: başlık/taç/maske, 2: kanat/sırt aksesuarı, 3: Defne çıplak kolları)
  const rawMats = Array.isArray(outfitMesh.material) ? outfitMesh.material : [outfitMesh.material];
  const matRoles = rawMats.map((m) => {
    const n = (m?.name ?? '').toLowerCase();
    if (/ch29_body|eller/.test(n)) return 'bare_arms' as const;
    if (/tac|sapka|hat|helm|mask|cap|crown/.test(n)) return 'head' as const;
    if (/kanat|silah|wing|back|acc|weapon/.test(n)) return 'back' as const;
    return 'body' as const;
  });

  // Kostümün gövde grubundaki (role === 'body') maksimum kol açıklığını ölç:
  // Kısa kollu elbiselerde (< 48 cm, ör. beyaz_kislik) karakterin kendi çıplak kolları korunur.
  const rawPos = geom.attributes.position as THREE.BufferAttribute;
  let srcArmMaxX = 0;
  if (geom.groups.length > 0) {
    for (const grp of geom.groups) {
      if (matRoles[grp.materialIndex ?? 0] !== 'body') continue;
      const end = Math.min(rawPos.count, grp.start + grp.count);
      for (let i = grp.start; i < end; i++) {
        const ax = Math.abs(rawPos.getX(i));
        if (ax > srcArmMaxX) srcArmMaxX = ax;
      }
    }
  } else {
    for (let i = 0; i < rawPos.count; i++) {
      const ax = Math.abs(rawPos.getX(i));
      if (ax > srcArmMaxX) srcArmMaxX = ax;
    }
  }
  const hasShortSleeves = srcArmMaxX < 48.0;

  // Defne'nin gövde atlası kostüme özel varyantıyla değişir (ör. beresi kostüm renginde). Malzeme önbellekteki
  // modelin klonlarıyla paylaşıldığı için kopyalanır; başka kostümdeki Defne etkilenmez.
  if (charId === 'defne' && meta.defneTexture) {
    try {
      const tex = await loadBodyTexture(meta.defneTexture);
      const swap = (m: THREE.Material) => {
        const std = m as THREE.MeshStandardMaterial;
        if (!std.map || !/ch29_body/i.test(std.name)) return m;
        const c = std.clone();
        tex.wrapS = std.map.wrapS;
        tex.wrapT = std.map.wrapT;
        tex.flipY = std.map.flipY;
        c.map = tex;
        return c;
      };
      targetBody.material = Array.isArray(targetBody.material) ? targetBody.material.map(swap) : swap(targetBody.material);
    } catch (err) {
      console.warn(`Defne kostüm dokusu yüklenemedi (${meta.defneTexture}):`, err);
    }
  }

  // 3. Karakterin boyun altındaki eski kıyafetini / gövdesini maskele (kısa kollu kostümlerde çıplak kollar korunur)
  if (charId === 'defne') {
    maskMeshTriangles(
      targetBody,
      (cx, cy, _cz) =>
        (cy >= 131.5 && Math.abs(cx) < 22.0) ||
        (hasShortSleeves && cy >= 115.0 && Math.abs(cx) >= 34.0),
    );
  } else if (charId === 'mese') {
    if (erikaClothes) {
      erikaClothes.visible = false;
      erikaClothes.parent?.remove(erikaClothes);
    }
    maskMeshTriangles(
      targetBody,
      (cx, cy, _cz) =>
        (cy >= 149.2 && Math.abs(cx) < 20.0) ||
        (hasShortSleeves && cy >= 134.0 && Math.abs(cx) >= 25.0),
    );
    // Başlık saçı tamamen örtüyorsa (ör. beyaz kışlık duvağı) saç hiç çizilmez (kalan tutamlar zaten görünmüyordu)
    if (erikaHair && meta.hidesBackHair) {
      erikaHair.visible = false;
      erikaHair.parent?.remove(erikaHair);
    }
  }

  // 4. Kaynak (kanonik) ve hedef karakter kemik referans noktalarını ölç
  const srcL = measureLandmarks(outfitMesh.skeleton.bones, clonedGroup);
  const dstL = measureLandmarks(targetSkeleton.bones, root);

  // Meşe'de:
  // - Şablondaki Defne ten dokulu çıplak kol grubunu ('bare_arms') kaldır (Meşe kendi açık tenli kollarını kullanır)
  // - Ninja başlığındaki arka kurdele/at kuyruğunu gizle (Meşe'nin kendi sırt saçı erika_sac görünür)
  if (charId === 'mese') {
    geom = filterGeometryTriangles(geom, (_cx, cy, cz, matIdx) => {
      const role = matRoles[matIdx] ?? 'body';
      if (role === 'bare_arms') return false;
      if (meta.hasBackHairRibbon && role === 'head') {
        return cy >= 139.0 && cz >= -3.5;
      }
      return true;
    });
  }

  const pos = geom.attributes.position as THREE.BufferAttribute;

  // Hedef karakter kanonik ölçüden farklıysa (ör. Meşe 172 cm vs Defne 168 cm) köşeleri anatomik olarak uyarla
  const needsRetarget =
    Math.abs(srcL.hipY - dstL.hipY) > 0.5 ||
    Math.abs(srcL.armY - dstL.armY) > 0.5 ||
    Math.abs(srcL.wristX - dstL.wristX) > 0.5;

  if (needsRetarget) {
    // Göğüs/büst yüksekliğinin aşağı çekilmemesi için kalçadan (hipY) doğrudan omuz/kol (armY) ve boyun (neckY) hizasına geçilir
    const yPts: [number, number][] = [
      [0, 0],
      [srcL.ankleY, dstL.ankleY],
      [srcL.kneeY, dstL.kneeY],
      [srcL.hipY, dstL.hipY],
      [srcL.armY, dstL.armY],
      [srcL.neckY, dstL.neckY],
      [srcL.headY, dstL.headY],
      [srcL.headTopY, dstL.headTopY],
    ];
    // Gövde/bel/göğüs genişliği zarif kadın silüetinde (1.03x) tutulur; yalnızca kollar kendi kemik uzunluğuna uzanır
    const torsoWidthScale = 1.03;
    const feminineShoulderX = Math.min(dstL.shoulderX * 0.92, srcL.shoulderX * 1.24);
    const xArmPts: [number, number][] = [
      [0, 0],
      [srcL.shoulderX, feminineShoulderX],
      [srcL.elbowX, dstL.elbowX],
      [srcL.wristX, dstL.wristX],
      [srcL.tipX, dstL.tipX],
    ];
    const headScale = (dstL.headTopY - dstL.headY) / Math.max(1e-4, srcL.headTopY - srcL.headY);
    const torsoScale = (dstL.neckY - dstL.hipY) / Math.max(1e-4, srcL.neckY - srcL.hipY);

    // Her tepe noktasının materyal rolünü belirle
    const vMatIdx = new Uint8Array(pos.count);
    for (const grp of geom.groups) {
      const mIdx = grp.materialIndex ?? 0;
      const end = Math.min(pos.count, grp.start + grp.count);
      for (let i = grp.start; i < end; i++) vMatIdx[i] = mIdx;
    }

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const role = matRoles[vMatIdx[i]] ?? 'body';

      // Başlık / Taç / Maske / Boyunluk (role === 'head'):
      // Yükseklik (ny) boyun ile tepe noktası arasında kesintisiz eşlenir; böylece taç kafaya, tüy yaka boyun tabanına oturur
      if (role === 'head') {
        const kHead = smoothstep(srcL.neckY, srcL.headY, y);
        const wScale = lerp(torsoWidthScale, headScale, kHead);
        const nx = x * wScale;
        const ny = piecewise(y, yPts);
        const sZ = lerp(srcL.torsoZ, srcL.headZ, kHead);
        const dZ = lerp(dstL.torsoZ, dstL.headZ, kHead);
        const nz = dZ + (z - sZ) * wScale;
        pos.setXYZ(i, nx, ny, nz);
        continue;
      }

      // Sırt Aksesuarı / Kanat / Şuriken (role === 'back'): şekli bozulmadan üst sırt referansına taşınır
      if (role === 'back') {
        const backScale = lerp(1.0, torsoScale, 0.5);
        const srcBackY = srcL.armY - 4.0;
        const dstBackY = dstL.armY - 4.5;
        const nx = x * backScale;
        const ny = dstBackY + (y - srcBackY) * backScale;
        const nz = dstL.torsoZ + (z - srcL.torsoZ) * backScale;
        pos.setXYZ(i, nx, ny, nz);
        continue;
      }

      const ax = Math.abs(x);
      const sgn = x >= 0 ? 1 : -1;
      const ny = piecewise(y, yPts);

      // Kol geçiş ağırlığı: yalnızca omuz/kol yüksekliğinde (y >= armY - 8.5) ve omuz dışına çıkarken kol kemiklerine uzanır
      const kArmZone =
        smoothstep(srcL.armY - 8.5, srcL.armY - 2.5, y) *
        smoothstep(srcL.shoulderX * 0.82, srcL.shoulderX * 1.25, ax);
      const slimTorsoX = x * torsoWidthScale;
      const armMappedX = sgn * piecewise(ax, xArmPts);
      const upperX = lerp(slimTorsoX, armMappedX, kArmZone);

      let nx: number;
      if (y < srcL.hipY) {
        const kLeg = 1 - smoothstep(srcL.hipY - 10, srcL.hipY, y);
        let lowerX: number;
        if (meta.isPants) {
          const sCx = legCenterX(srcL, y);
          // Pantolon bacaklarını da daraltılmış feminen bacak eksenine hizala
          const dCx = legCenterX(dstL, ny) * 0.78;
          lowerX = sgn * Math.max(0.6, dCx + (ax - sCx) * torsoWidthScale);
        } else {
          lowerX = x * torsoWidthScale;
        }
        nx = lerp(upperX, lowerX, kLeg);
      } else {
        nx = upperX;
      }

      const sZ = centerZ(srcL, y, ax);
      const dZ = centerZ(dstL, ny, Math.abs(nx));
      const nz = dZ + (z - sZ) * lerp(1.0, torsoScale, 0.35);

      pos.setXYZ(i, nx, ny, nz);
    }
    pos.needsUpdate = true;
    geom.computeVertexNormals();
  }

  // Sırt aksesuarı (kanat/silah) kendi merkezi çevresinde küçültülür (derinlik korunur: sırta yapışık kalır)
  if (meta.backScale !== undefined && meta.backScale !== 1) {
    const bPos = geom.attributes.position as THREE.BufferAttribute;
    const isBack = new Uint8Array(bPos.count);
    for (const grp of geom.groups) {
      if (matRoles[grp.materialIndex ?? 0] !== 'back') continue;
      const end = Math.min(bPos.count, grp.start + grp.count);
      for (let i = grp.start; i < end; i++) isBack[i] = 1;
    }
    let y0 = Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < bPos.count; i++) {
      if (!isBack[i]) continue;
      y0 = Math.min(y0, bPos.getY(i));
      y1 = Math.max(y1, bPos.getY(i));
    }
    if (y1 > y0) {
      const cy = (y0 + y1) / 2;
      const k = meta.backScale;
      for (let i = 0; i < bPos.count; i++) {
        if (!isBack[i]) continue;
        bPos.setXY(i, bPos.getX(i) * k, cy + (bPos.getY(i) - cy) * k);
      }
      bPos.needsUpdate = true;
    }
  }

  // 5. Kemik indekslerini (skinIndex) hedef karakterin tam iskeletindeki kemik sıralamasına eşle
  const dstBoneMap = new Map<string, number>();
  targetSkeleton.bones.forEach((b, idx) => {
    const k = normBone(b.name);
    if (!dstBoneMap.has(k)) dstBoneMap.set(k, idx);
  });
  const fallbackBoneIdx = dstBoneMap.get('hips') ?? 0;
  const srcToDstIdx = outfitMesh.skeleton.bones.map((b) => {
    // Parmak kemikleri karakterler arası duruş farkı yaratmasın diye el kemiğine (lefthand/righthand) birleştirilir
    const k = normBone(b.name).replace(/^(left|right)hand(thumb|index|middle|ring|pinky).*$/, '$1hand');
    return dstBoneMap.get(k) ?? fallbackBoneIdx;
  });

  const skinIdx = geom.attributes.skinIndex as THREE.BufferAttribute;
  if (skinIdx) {
    for (let i = 0; i < skinIdx.count; i++) {
      skinIdx.setXYZW(
        i,
        srcToDstIdx[skinIdx.getX(i)] ?? fallbackBoneIdx,
        srcToDstIdx[skinIdx.getY(i)] ?? fallbackBoneIdx,
        srcToDstIdx[skinIdx.getZ(i)] ?? fallbackBoneIdx,
        srcToDstIdx[skinIdx.getW(i)] ?? fallbackBoneIdx,
      );
    }
    skinIdx.needsUpdate = true;
  }

  // 6. Kostüm materyal parlaklığını hedef karakterin gövde materyaliyle eşitle ve iskelete bağla
  const bodyMat = (Array.isArray(targetBody.material) ? targetBody.material[0] : targetBody.material) as THREE.MeshStandardMaterial | undefined;
  const bodyCol = bodyMat?.color;
  if (bodyCol) {
    const lum = Math.max(bodyCol.r, bodyCol.g, bodyCol.b);
    const mats = (Array.isArray(outfitMesh.material) ? outfitMesh.material : [outfitMesh.material]).map((m, i) => {
      const c = m.clone() as THREE.MeshStandardMaterial;
      if (c.color) c.color.setScalar(lum);
      if (meta.skinFix && c.map && matRoles[i] === 'body') c.map = skinFixedTexture(c.map, meta.skinFix);
      return c;
    });
    outfitMesh.material = Array.isArray(outfitMesh.material) ? mats : mats[0];
  }
  // Eski geometri önbellekteki şablonla paylaşılır; dispose edilmez
  outfitMesh.geometry = geom;
  outfitMesh.position.set(0, 0, 0);
  outfitMesh.rotation.set(0, 0, 0);
  outfitMesh.scale.set(1, 1, 1);
  outfitMesh.updateMatrix();
  outfitMesh.name = `${charId}_outfit_${activeId}`;
  outfitMesh.frustumCulled = false;
  outfitMesh.bind(targetSkeleton, targetBindMatrix);
  (targetBody.parent ?? root).add(outfitMesh);
}

/** Bir niteliğin seçilen üçgenlerini (köşe sırasıyla, üçer köşe) aynı dizi türünde yeni bir niteliğe kopyalar. */
function pickTriangles(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, tris: Uint32Array): THREE.BufferAttribute {
  const n = attr.itemSize;
  const Arr = attr.array.constructor as new (len: number) => THREE.TypedArray;
  const out = new Arr(tris.length * 3 * n);
  if (!(attr as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) {
    const src = attr.array as THREE.TypedArray;
    const stride = 3 * n;
    for (let k = 0; k < tris.length; k++) {
      const s = tris[k] * stride;
      out.set(src.subarray(s, s + stride), k * stride);
    }
  } else {
    for (let k = 0; k < tris.length; k++) {
      for (let v = 0; v < 3; v++) {
        for (let c = 0; c < n; c++) out[(k * 3 + v) * n + c] = attr.getComponent(tris[k] * 3 + v, c);
      }
    }
  }
  return new THREE.BufferAttribute(out, n, attr.normalized);
}

/**
 * Bir BufferGeometry içinde yalnızca `keep(cx, cy, cz, materialIndex)` koşulunu sağlayan üçgenleri tutar.
 * Tüm nitelikler (renk, ikinci UV, tanjant…), morph hedefleri ve grup (multi-material) aralıkları korunur;
 * indeksli geometri önce indekssize açılır. Girdi geometriye dokunulmaz (önbellekteki şablonla paylaşılıyor olabilir).
 */
function filterGeometryTriangles(
  geom: THREE.BufferGeometry,
  keep: (cx: number, cy: number, cz: number, materialIndex: number) => boolean,
): THREE.BufferGeometry {
  const src = geom.index ? geom.toNonIndexed() : geom;
  const pos = src.attributes.position;
  if (!pos) return geom;
  const groups = src.groups.length > 0 ? src.groups : [{ start: 0, count: pos.count, materialIndex: 0 }];

  const kept = new Uint32Array(Math.floor(pos.count / 3));
  let nKept = 0;
  const newGroups: { start: number; count: number; materialIndex: number }[] = [];
  for (const grp of groups) {
    const matIdx = grp.materialIndex ?? 0;
    const first = nKept;
    const triEnd = Math.min(kept.length, Math.floor((grp.start + grp.count) / 3));
    for (let t = Math.floor(grp.start / 3); t < triEnd; t++) {
      const i = t * 3;
      const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
      const cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
      const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
      if (keep(cx, cy, cz, matIdx)) kept[nKept++] = t;
    }
    if (nKept > first) newGroups.push({ start: first * 3, count: (nKept - first) * 3, materialIndex: matIdx });
  }
  // Hiçbir üçgen elenmediyse aynı geometri kullanılmaya devam edilir (yeniden GPU yüklemesi olmaz)
  if (nKept === kept.length && src === geom) return geom;

  const tris = kept.subarray(0, nKept);
  const next = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(src.attributes)) next.setAttribute(name, pickTriangles(attr, tris));
  for (const [name, list] of Object.entries(src.morphAttributes)) {
    next.morphAttributes[name] = list.map((a) => pickTriangles(a, tris));
  }
  next.morphTargetsRelative = src.morphTargetsRelative;
  for (const g of newGroups) next.addGroup(g.start, g.count, g.materialIndex);
  if (src !== geom) src.dispose();
  return next;
}

/** Mesh'in yalnızca `keep` koşulunu sağlayan üçgenlerini bırakır (paylaşılan şablon geometrisi dispose edilmez). */
function maskMeshTriangles(
  mesh: THREE.SkinnedMesh,
  keep: (cx: number, cy: number, cz: number, materialIndex: number) => boolean,
): void {
  mesh.geometry = filterGeometryTriangles(mesh.geometry, keep);
}
