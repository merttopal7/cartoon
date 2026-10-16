import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AssetDef } from '../schema';
import type { Rig } from './pose';
import { buildProp, type PropKind } from './props';
import { ModelRig } from './rigs/model';
import { PlaceholderRig, type CharacterKind } from './rigs/placeholder';
import { ROOT_SPEED, SOURCE_HIPS_HEIGHT, SOURCE_SKELETON } from './clips';
import { mergeStatic } from './merge';
import { OUTLINE, toonify } from './toon';

type ModelAsset = Extract<AssetDef, { src: string }>;

/** Yüklenmiş bir model dosyası, biçimden bağımsız. */
interface LoadedModel {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
  isFbx: boolean;
}

/**
 * three.js'in ortak yükleme yöneticisindeki (FBX/GLB ve içlerindeki dokular) devam eden yüklemeler.
 * FBX dokuları model döndükten sonra arka planda iner; beklenmezse ilk kareler dokusuz ya da kapalı göz
 * malzemesi kurulmadan çizilir ve aynı senaryo farklı çalıştırmalarda farklı kare verir.
 */
let pendingLoads = 0;
let loadWaiters: (() => void)[] = [];
{
  const mgr = THREE.DefaultLoadingManager;
  const itemStart = mgr.itemStart.bind(mgr);
  const itemEnd = mgr.itemEnd.bind(mgr);
  mgr.itemStart = (url: string) => {
    pendingLoads++;
    itemStart(url);
  };
  // Hata veren yüklemeler de itemEnd çağırır; kırık bir doku yolu beklemeyi takmaz
  mgr.itemEnd = (url: string) => {
    pendingLoads = Math.max(0, pendingLoads - 1);
    itemEnd(url);
    if (pendingLoads === 0) {
      const waiters = loadWaiters;
      loadWaiters = [];
      waiters.forEach((w) => w());
    }
  };
}

/** Devam eden tüm model ve doku yüklemeleri bitene kadar (en çok `timeoutMs`) bekler. */
export function waitForPendingLoads(timeoutMs = 10000): Promise<void> {
  if (pendingLoads === 0) return Promise.resolve();
  return new Promise((resolve) => {
    loadWaiters.push(resolve);
    setTimeout(resolve, timeoutMs);
  });
}

const isFbx = (src: string) => /\.fbx$/i.test(src.split('?')[0]);

/** Model dosyalarını (GLB/GLTF/FBX) bir kez yükler, her kullanımda klonlar. */
export class AssetLibrary {
  private readonly gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private readonly fbx = new FBXLoader();
  private readonly cache = new Map<string, Promise<LoadedModel>>();
  private readonly propTemplates = new Map<string, THREE.Object3D>();

  constructor() {
    const origParse = this.fbx.parse.bind(this.fbx);
    this.fbx.parse = (buf: ArrayBuffer | string, path: string) => {
      if (buf instanceof ArrayBuffer && buf.byteLength > 28) {
        const u8 = new Uint8Array(buf);
        if (u8[u8.length - 1] === 0x0a && u8[u8.length - 2] === 0x0b) {
          buf = buf.slice(0, buf.byteLength - 1);
        }
      }
      return origParse(buf, path);
    };
  }

  private load(src: string): Promise<LoadedModel> {
    let p = this.cache.get(src);
    if (!p) {
      const fbx = isFbx(src);
      const loading: Promise<LoadedModel> = fbx
        ? this.fbx.loadAsync(src).then((group) => ({ scene: group, animations: group.animations, isFbx: true }))
        : this.gltf.loadAsync(src).then((g) => ({ scene: g.scene, animations: g.animations, isFbx: false }));
      p = loading.then(
        async (m) => {
          // FBX'ler çoğu zaman boş bir "Take 001" klibi taşır.
          m.animations = m.animations.filter((c) => c.duration > 0 && c.tracks.length > 0);
          m.animations.forEach(stripRootMotion);

          // Erika (Meşe) karakterinin Blender'da güncellenen yeşil kostüm dokusunu uygula ve şapkasını (kapüşonunu) kaldır
          if (/erika\/character\.fbx/i.test(src)) {
            await customizeErikaModel(m.scene);
          }

          return m;
        },
        (e) => {
          this.cache.delete(src);
          throw new Error(`Model yüklenemedi: ${src} (${e instanceof Error ? e.message : e})`);
        },
      );
      this.cache.set(src, p);
    }
    return p;
  }

  /** Senaryodaki tüm modelleri ve animasyonları paralel olarak önceden yükler (kasmayı önler). */
  async preloadAssets(assets: Record<string, AssetDef>, onProgress?: (ratio: number) => void): Promise<void> {
    const urls = new Set<string>();
    for (const def of Object.values(assets)) {
      if ('src' in def && def.src) {
        urls.add(def.src);
        if (def.animations) {
          for (const animUrl of Object.values(def.animations)) {
            if (animUrl) urls.add(animUrl);
          }
        }
      }
    }
    const urlList = Array.from(urls);
    if (urlList.length === 0) {
      onProgress?.(1);
      return;
    }
    let loaded = 0;
    await Promise.all(
      urlList.map(async (u) => {
        try {
          await this.load(u);
        } catch (e) {
          console.warn(`Önyükleme uyarısı: ${u}`, e);
        }
        loaded++;
        onProgress?.(loaded / urlList.length);
      }),
    );
  }

  async character(def: AssetDef): Promise<Rig> {
    if ('placeholder' in def) return new PlaceholderRig(def.placeholder as CharacterKind, def.color);
    const [model, extra] = await Promise.all([this.load(def.src), this.loadAnimations(def)]);
    const scene = cloneSkinned(model.scene);
    const size = prepareModel(scene, def, model.isFbx, OUTLINE.character);
    return new ModelRig(scene, size, [...model.animations, ...extra], def.clips, def.eyelids, def.mouth);
  }

  async prop(def: AssetDef): Promise<THREE.Object3D> {
    if ('placeholder' in def) return buildProp(def.placeholder as PropKind, def.color);
    
    const key = `${def.src}:${def.scale ?? ''}:${def.height ?? ''}:${def.align ?? ''}`;
    const cached = this.propTemplates.get(key);
    if (cached) {
      return cloneSkinned(cached);
    }

    const model = await this.load(def.src);
    let scene = cloneSkinned(model.scene);
    // Kemiksiz modelleri malzemeye göre tek parçada topla (haritalar hariç - haritanın hiyerarşisi korunur).
    let skinned = false;
    scene.traverse((o) => (skinned ||= !!(o as THREE.SkinnedMesh).isSkinnedMesh));
    if (!skinned && def.align !== 'none') scene = mergeStatic(scene);
    prepareModel(scene, def, model.isFbx, OUTLINE.prop);

    if (!skinned) {
      this.propTemplates.set(key, scene);
      return cloneSkinned(scene);
    }
    return scene;
  }

  /** Ayrı dosyalardaki animasyonları yükler; her dosyanın ilk klibi verilen adla yeniden adlandırılır. */
  private async loadAnimations(def: ModelAsset): Promise<THREE.AnimationClip[]> {
    const entries = Object.entries(def.animations ?? {});
    return Promise.all(
      entries.map(async ([name, src]) => {
        const m = await this.load(src);
        if (!m.animations.length) throw new Error(`Animasyon dosyasında klip yok: ${src}`);
        const clip = m.animations[0].clone();
        clip.name = name;
        const speed = ROOT_SPEED.get(m.animations[0]);
        if (speed !== undefined) ROOT_SPEED.set(clip, speed);
        // Animasyon dosyasındaki iskeletin duruş pozu kalça yüksekliği (retarget ölçeği için).
        let hipsY: number | undefined;
        m.scene.traverse((o) => {
          if (hipsY === undefined && (o as THREE.Bone).isBone && /hips$/i.test(o.name)) hipsY = o.position.y;
        });
        if (hipsY) SOURCE_HIPS_HEIGHT.set(clip, hipsY);
        SOURCE_SKELETON.set(clip, m.scene);
        return clip;
      }),
    );
  }
}

const ENHANCED_TEXTURES = new WeakSet<THREE.Texture>();

function enhancePineTexture(tex: THREE.Texture) {
  if (ENHANCED_TEXTURES.has(tex)) return;
  const img = tex.image as HTMLImageElement | ImageBitmap | HTMLCanvasElement | undefined;
  if (!img || !('width' in img) || !img.width || !img.height) return;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img as CanvasImageSource, 0, 0);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a < 20) {
        // Şeffaf arka plan piksellerini siyah yerine çam yeşiline boyayarak uzak mipmap kararmasını önle
        data[i] = 54;
        data[i + 1] = 88;
        data[i + 2] = 38;
        data[i + 3] = 0;
      } else {
        // Çam iğnelerinin canlılığını ve uzak mesafe görünürlüğünü (alpha) güçlendir
        data[i] = Math.min(255, Math.round(data[i] * 0.95));
        data[i + 1] = Math.min(255, Math.round(data[i + 1] * 1.18 + 8));
        data[i + 2] = Math.min(255, Math.round(data[i + 2] * 0.9));
        data[i + 3] = Math.min(255, Math.round(a * 2.2));
      }
    }
    ctx.putImageData(imgData, 0, 0);
    tex.image = canvas;
    tex.needsUpdate = true;
    ENHANCED_TEXTURES.add(tex);
  } catch {
    // Canvas erişimi başarısız olursa mevcut dokuyu koru
  }
}

function makeRoadTextureOpaque(tex: THREE.Texture) {
  if (ENHANCED_TEXTURES.has(tex)) return;
  const img = tex.image as HTMLImageElement | ImageBitmap | HTMLCanvasElement | undefined;
  if (!img || !('width' in img) || !img.width || !img.height) return;
  try {
    const canvas = document.createElement('canvas');
    const w = img.width;
    const h = img.height;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img as CanvasImageSource, 0, 0);
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    const orig = new Uint8ClampedArray(data);

    for (let y = 0; y < h; y++) {
      const refY = Math.min(h - 1, Math.max(0, Math.floor(h * (0.38 + (y / h) * 0.24))));
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const a = orig[idx + 3];
        if (a < 250) {
          const refIdx = (refY * w + x) * 4;
          const wOrig = a / 255;
          const wRef = 1 - wOrig;
          data[idx] = Math.round(orig[idx] * wOrig + orig[refIdx] * wRef);
          data[idx + 1] = Math.round(orig[idx + 1] * wOrig + orig[refIdx + 1] * wRef);
          data[idx + 2] = Math.round(orig[idx + 2] * wOrig + orig[refIdx + 2] * wRef);
        }
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
    tex.image = canvas;
    tex.needsUpdate = true;
    ENHANCED_TEXTURES.add(tex);
  } catch {
    // Canvas erişimi başarısız olursa mevcut dokuyu koru
  }
}

/**
 * Orijinal haritanın gerçek kalitesini (PBR materyaller, yüksek çözünürlüklü dokular, normal ve pürüzlülük haritaları) korur ve optimize eder.
 */
function preserveAndOptimizeMap(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;

    const setupMaterial = (mat: THREE.Material) => {
      const s = mat as THREE.MeshStandardMaterial;
      if (!s.isMeshStandardMaterial) return s;

      // Harita elemanlarında siyah çizgi film konturu olmamalı
      s.userData.outlineParameters = { visible: false };

      if (s.map) {
        s.map.colorSpace = THREE.SRGBColorSpace;
        s.map.anisotropy = 8;
        s.map.needsUpdate = true;
      }
      if (s.normalMap) {
        s.normalMap.colorSpace = THREE.NoColorSpace;
        s.normalMap.anisotropy = 8;
        s.normalMap.needsUpdate = true;
      }
      if (s.roughnessMap) {
        s.roughnessMap.anisotropy = 8;
      }

      const isFoliage = /pine_v2|needle|bush|grass_vegetation|tree_atlas/i.test(s.name);
      const isMainRoad = /^dirt_road$/i.test(s.name) || /^mesh_dirt_road$/i.test(mesh.name);

      if (isFoliage) {
        if (/pine_v2/i.test(s.name) && s.map) {
          enhancePineTexture(s.map);
        }
        // Çam iğneleri ve yapraklar için çift taraflı alpha-cutout + MSAA alphaToCoverage
        s.transparent = false;
        s.alphaTest = 0.14;
        s.alphaToCoverage = true;
        s.side = THREE.DoubleSide;
        s.shadowSide = THREE.DoubleSide;
        s.depthWrite = true;
        s.roughness = 0.65;
        s.metalness = 0.0;
      } else if (isMainRoad) {
        // Ana toprak yol şeridi: kenar alpha geçişleri altındaki arazi çukurunu göstermemeli, tam opak olmalı
        if (s.map) {
          makeRoadTextureOpaque(s.map);
        }
        s.transparent = false;
        s.alphaTest = 0;
        s.opacity = 1;
        s.depthWrite = true;
        s.polygonOffset = true;
        s.polygonOffsetFactor = -1;
        s.polygonOffsetUnits = -1;
        s.side = THREE.DoubleSide;
        mesh.renderOrder = 0;
      } else if (s.transparent) {
        // Zemin üstü yol ve dekal kaplamaları (tekerlek izleri, çakıl, dökülen yapraklar, su birikintisi)
        s.transparent = true;
        s.depthWrite = false;
        s.polygonOffset = true;
        s.polygonOffsetFactor = -2;
        s.polygonOffsetUnits = -2;
        s.side = THREE.DoubleSide;
        mesh.renderOrder = /trail|puddle|decal|gravel|leaf|leaves/i.test(mesh.name) || /trail|puddle|decal|gravel|leaf|leaves/i.test(s.name) ? 2 : 1;
      } else {
        s.side = THREE.FrontSide;
        s.depthWrite = true;
      }

      s.needsUpdate = true;
      return s;
    };

    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(setupMaterial)
      : setupMaterial(mesh.material);

    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
}

/** Toon malzemeye çevirir, ölçekler, ayakları yere oturtur; ölçeklenmiş boyutları döndürür. */
function prepareModel(model: THREE.Object3D, def: ModelAsset, fbx: boolean, outline: number | false) {
  const isMap = def.align === 'none';
  if (isMap) {
    preserveAndOptimizeMap(model);
  } else {
    toonify(model, outline);
  }

  model.traverse((o) => {
    // Kemikle hareket eden mesh'lerin sınır kutusu güvenilmez; kırpılmasın.
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) o.frustumCulled = false;
  });
  // Ölçü bir kez, ölçeklemeden önce alınır: ölçek sonrası kemik matrisleri bir sonraki
  // render'a kadar eski kalır ve skinned mesh'in kutusu yanlış çıkar.
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model, true);
  const size = box.getSize(new THREE.Vector3());
  // Mixamo/FBX santimetre kullanır; açık ölçek verilmediyse metreye çevir.
  const s = def.height ? def.height / Math.max(1e-6, size.y) : (def.scale ?? (fbx ? 0.01 : 1));
  model.scale.multiplyScalar(s);
  model.position.multiplyScalar(s);
  if (def.align === 'feet') model.position.y -= box.min.y * s; // ayaklar yere
  return { height: size.y * s, width: Math.max(size.x, size.z) * s, scale: s };
}

/** Mixamo vb. kliplerdeki kalça ötelemesini (root motion) sıfırlar; konumu motor yönetir. */
function stripRootMotion(clip: THREE.AnimationClip) {
  for (const track of clip.tracks) {
    if (!/hips\.position$/i.test(track.name)) continue;
    const v = track.values;
    const n = v.length;
    if (n >= 6 && clip.duration > 0) ROOT_SPEED.set(clip, Math.hypot(v[n - 3] - v[0], v[n - 1] - v[2]) / clip.duration);
    for (let i = 0; i < v.length; i += 3) {
      v[i] = 0;
      v[i + 2] = 0;
    }
  }
}

/**
 * Erika (Meşe) karakterinin Blender üzerinde yapılan özelleştirmelerini sahne motorunda uygular:
 * 1. Yeşil orman kostümü dokusunu (`Erika_Archer_Clothes_diffuse.png`) ve koyu kızıl-kahve saç derisi
 *    dokusunu (`FemaleFitA_Body_diffuse.png`) materyallere bağlar.
 * 2. Yaka ve omuz pelerinini (`y <= 151.5 cm`) koruyarak başın üzerindeki şapkayı (kapüşonu) kaldırır.
 * 3. Baş kemiğine (`mixamorigHead`) bağlı 3B kızıl-kahve saç tepesi ve arka saç hacmini ekler.
 */
async function customizeErikaModel(root: THREE.Object3D) {
  try {
    const texLoader = new THREE.TextureLoader();
    const [greenClothesTex, bodyTex] = await Promise.all([
      texLoader.loadAsync('/models/characters/Erika/Erika_Archer_Clothes_diffuse.png'),
      texLoader.loadAsync('/models/characters/Erika/FemaleFitA_Body_diffuse.png'),
    ]);
    greenClothesTex.colorSpace = THREE.SRGBColorSpace;
    bodyTex.colorSpace = THREE.SRGBColorSpace;

    root.traverse((o) => {
      const skinned = o as THREE.SkinnedMesh;
      if (!skinned.isMesh) return;

      if (/body_mesh/i.test(skinned.name)) {
        const mats = Array.isArray(skinned.material) ? skinned.material : [skinned.material];
        for (const mat of mats) {
          const std = mat as THREE.MeshPhongMaterial | THREE.MeshStandardMaterial;
          if (std && 'map' in std) {
            std.map = bodyTex;
            std.needsUpdate = true;
          }
        }
      } else if (/clothes_mesh/i.test(skinned.name)) {
        const mats = Array.isArray(skinned.material) ? skinned.material : [skinned.material];
        for (const mat of mats) {
          const std = mat as THREE.MeshPhongMaterial | THREE.MeshStandardMaterial;
          if (std && 'map' in std) {
            std.map = greenClothesTex;
            std.needsUpdate = true;
          }
        }

        const geom = skinned.geometry;
        const pos = geom.attributes.position;
        const norm = geom.attributes.normal;
        const uv = geom.attributes.uv;
        const skinIdx = geom.attributes.skinIndex;
        const skinW = geom.attributes.skinWeight;
        if (!pos || !norm || !uv || !skinIdx || !skinW) return;

        let headBoneIdx = 5;
        if (skinned.skeleton && skinned.skeleton.bones) {
          const found = skinned.skeleton.bones.findIndex((b) => /head$/i.test(b.name));
          if (found >= 0) headBoneIdx = found;
        }

        const newPos: number[] = [];
        const newNorm: number[] = [];
        const newUV: number[] = [];
        const newSkinIdx: number[] = [];
        const newSkinW: number[] = [];

        const triCount = Math.floor(pos.count / 3);
        for (let t = 0; t < triCount; t++) {
          const i0 = t * 3;
          const i1 = t * 3 + 1;
          const i2 = t * 3 + 2;

          const u0 = uv.getX(i0), u1 = uv.getX(i1), u2 = uv.getX(i2);
          const v0 = uv.getY(i0), v1 = uv.getY(i1), v2 = uv.getY(i2);
          const y0 = pos.getY(i0), y1 = pos.getY(i1), y2 = pos.getY(i2);

          const maxU = Math.max(u0, u1, u2);
          const minU = Math.min(u0, u1, u2);
          const minV = Math.min(v0, v1, v2);
          const maxV = Math.max(v0, v1, v2);
          const minY = Math.min(y0, y1, y2);
          const maxY = Math.max(y0, y1, y2);
          const avgY = (y0 + y1 + y2) / 3;

          const isHoodIsland = maxU < 0.34 && minV > 0.14 && maxV < 0.615;
          if (isHoodIsland && (minY > 151.8 || avgY > 152.4)) {
            continue;
          }
          // Kapüşon altına göre kesilmiş eski düz saç kartlarını kaldır (omuz kayışı y <= 151.5 korunur)
          const isOldHoodHairCard = minU > 0.73 && minV > 0.26 && maxV < 0.35 && maxY > 152.0;
          if (isOldHoodHairCard) {
            continue;
          }

          for (const idx of [i0, i1, i2]) {
            let vx = pos.getX(idx);
            let vy = pos.getY(idx);
            const vz = pos.getZ(idx);
            if (isHoodIsland && vy > 151.5) {
              vy = 151.5;
              if (vx > 5.2) vx = 5.2 + (vx - 5.2) * 0.4;
              if (vx < -5.2) vx = -5.2 + (vx + 5.2) * 0.4;
            }
            newPos.push(vx, vy, vz);
            newNorm.push(norm.getX(idx), norm.getY(idx), norm.getZ(idx));
            newUV.push(uv.getX(idx), uv.getY(idx));
            newSkinIdx.push(skinIdx.getX(idx), skinIdx.getY(idx), skinIdx.getZ(idx), skinIdx.getW(idx));
            newSkinW.push(skinW.getX(idx), skinW.getY(idx), skinW.getZ(idx), skinW.getW(idx));
          }
        }

        interface HairPoint {
          x: number;
          y: number;
          z: number;
          u: number;
          v: number;
        }

        const pushHairTri = (a: HairPoint, b: HairPoint, c: HairPoint) => {
          const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
          const acx = c.x - a.x, acy = c.y - a.y, acz = c.z - a.z;
          let nx = aby * acz - abz * acy;
          let ny = abz * acx - abx * acz;
          let nz = abx * acy - aby * acx;
          const len = Math.hypot(nx, ny, nz) || 1;
          nx /= len;
          ny /= len;
          nz /= len;
          for (const pt of [a, b, c]) {
            newPos.push(pt.x, pt.y, pt.z);
            newNorm.push(nx, ny, nz);
            newUV.push(pt.u, pt.v);
            newSkinIdx.push(headBoneIdx, 0, 0, 0);
            newSkinW.push(1, 0, 0, 0);
          }
        };

        const addHairGrid = (grid: HairPoint[][], flipNormals = false) => {
          const rows = grid.length;
          const cols = grid[0].length;
          for (let r = 0; r < rows - 1; r++) {
            for (let c = 0; c < cols - 1; c++) {
              const v00 = grid[r][c];
              const v01 = grid[r][c + 1];
              const v10 = grid[r + 1][c];
              const v11 = grid[r + 1][c + 1];
              if (!flipNormals) {
                pushHairTri(v00, v10, v11);
                pushHairTri(v00, v11, v01);
              } else {
                pushHairTri(v00, v11, v10);
                pushHairTri(v00, v01, v11);
              }
            }
          }
        };

        // 1. Ortadan ayrılmış tepe, şakak/yanak çerçeveleyen tutamlar ve omuzlara dökülen katmanlı 3B saç hacmi
        const cx = 0.0, cy = 166.6, cz = 1.15;
        const nRows = 30;
        const nCols = 80;
        const outerGrid: HairPoint[][] = [];
        const innerGrid: HairPoint[][] = [];

        for (let r = 0; r <= nRows; r++) {
          const vFrac = r / nRows;
          const rowOut: HairPoint[] = [];
          const rowIn: HairPoint[] = [];
          for (let c = 0; c <= nCols; c++) {
            const uFrac = (c % nCols) / nCols;
            const theta = (uFrac - 0.5) * 2.0 * Math.PI;
            const absT = Math.abs(theta);
            const sinT = Math.sin(theta);
            const cosT = Math.cos(theta);

            let phiMax: number;
            if (absT < 0.42) {
              const s = absT / 0.42;
              const sSmooth = s * s * (3.0 - 2.0 * s);
              phiMax = (0.345 + 0.080 * sSmooth) * Math.PI;
            } else if (absT < 0.72) {
              const s = (absT - 0.42) / (0.72 - 0.42);
              const sSmooth = s * s * (3.0 - 2.0 * s);
              phiMax = (0.425 + 0.435 * sSmooth) * Math.PI;
            } else if (absT < 1.20) {
              const s = (absT - 0.72) / (1.20 - 0.72);
              const lockTip = 0.040 * Math.sin(s * Math.PI);
              phiMax = (0.86 + lockTip) * Math.PI;
            } else {
              const s = (absT - 1.20) / (Math.PI - 1.20);
              const sSmooth = s * s * (3.0 - 2.0 * s);
              const tipWave = 0.024 * Math.cos(theta * 10.0);
              phiMax = (0.86 + 0.06 * sSmooth + tipWave) * Math.PI;
            }

            const phi = vFrac * phiMax;
            const cosPhi = Math.cos(phi);

            let horizScale: number;
            let vertY: number;
            if (phi <= 0.5 * Math.PI) {
              horizScale = Math.sin(phi);
              vertY = cy + 12.10 * cosPhi;
            } else {
              const dropT = (phi - 0.5 * Math.PI) / (0.45 * Math.PI);
              const cheekFrame = -0.04 * Math.sin(Math.min(1.0, dropT * 1.3) * Math.PI) * Math.max(0.0, cosT);
              const shoulderFlare = 0.14 * Math.pow(dropT, 1.35) * (0.35 + 0.65 * Math.max(0.0, -cosT));
              horizScale = 1.0 + cheekFrame + shoulderFlare;
              vertY = cy - 16.5 * dropT;
            }

            const rx = 8.60;
            const rz = cosT >= 0.0 ? 10.50 : 11.25;

            const partGroove =
              -0.58 *
              Math.exp(-Math.pow(theta / 0.11, 2)) *
              Math.sin(Math.min(1.0, vFrac * 2.5) * Math.PI * 0.5) *
              (1.0 - 0.35 * vFrac);
            const crownSwell =
              0.72 *
              Math.sin(Math.min(1.0, absT / 0.58) * Math.PI) *
              Math.sin(Math.min(1.0, phi / (0.52 * Math.PI)) * Math.PI);

            const strandEnv = Math.sin(vFrac * Math.PI * 0.92);
            const strandRidge =
              (0.30 * Math.cos(theta * 14.0) + 0.16 * Math.sin(theta * 7.0) + 0.08 * Math.cos(theta * 28.0)) *
              strandEnv;

            const templeLockBulge =
              0.75 * Math.exp(-Math.pow((absT - 0.78) / 0.26, 2)) * Math.sin(vFrac * Math.PI * 0.92);
            const earZone =
              Math.exp(-Math.pow((absT - 1.35) / 0.48, 2)) *
              Math.exp(-Math.pow((phi - 0.50 * Math.PI) / 0.36, 2));

            const rxLocal = rx + 1.05 * earZone + 0.60 * templeLockBulge + strandRidge * 0.80;

            let frontEdgeTaper = 0.0;
            if (absT < 0.68 && vFrac > 0.68) {
              const tEdge = (vFrac - 0.68) / 0.32;
              frontEdgeTaper = -0.45 * Math.pow(tEdge, 1.4) * Math.cos((absT / 0.68) * Math.PI * 0.5);
            }

            const rzLocal = rz + 0.70 * templeLockBulge + strandRidge + frontEdgeTaper;

            const px = cx + rxLocal * horizScale * sinT;
            const py = vertY + (partGroove + crownSwell) * Math.max(0.0, cosPhi);
            const pz = cz + rzLocal * horizScale * cosT;

            const inScale = vFrac < 0.94 ? 0.935 : 0.985;
            const pxIn = cx + (px - cx) * inScale;
            const pyIn = py - 0.25 * (1.0 - vFrac);
            const pzIn = cz + (pz - cz) * inScale;

            const uCoord = 0.80 + 0.14 * Math.abs(Math.sin(theta * 2.0));
            const vCoord = 0.275 + 0.060 * vFrac;
            rowOut.push({ x: px, y: py, z: pz, u: uCoord, v: vCoord });
            rowIn.push({ x: pxIn, y: pyIn, z: pzIn, u: uCoord, v: vCoord });
          }
          outerGrid.push(rowOut);
          innerGrid.push(rowIn);
        }

        addHairGrid(outerGrid, false);
        addHairGrid(innerGrid, true);

        // Dış ve iç saç kabuğunun alt sınırını birleştirerek hacimli kenar oluştur
        for (let c = 0; c < nCols; c++) {
          const v00 = outerGrid[nRows][c];
          const v01 = outerGrid[nRows][c + 1];
          const v10 = innerGrid[nRows][c];
          const v11 = innerGrid[nRows][c + 1];
          pushHairTri(v00, v10, v11);
          pushHairTri(v00, v11, v01);
        }

        // 2. Başın arkasında dalgalı okçu at kuyruğu (ponytail)
        const ptRows = 18;
        const ptCols = 20;
        const ptGrid: HairPoint[][] = [];
        for (let r = 0; r <= ptRows; r++) {
          const t = r / ptRows;
          const spineX = 0.0;
          const spineY = 168.5 - 23.5 * Math.pow(t, 1.12) + 1.8 * Math.sin(t * Math.PI);
          const spineZ = -9.2 - 5.0 * Math.sin(t * Math.PI * 0.72) - 1.5 * t;
          let radX: number;
          let radZ: number;
          if (t < 0.15) {
            radX = 2.6 - 0.5 * (t / 0.15);
            radZ = 2.4 - 0.4 * (t / 0.15);
          } else {
            const s = (t - 0.15) / 0.85;
            const envelope = Math.sin(s * Math.PI * 0.82) * (1.0 - 0.82 * Math.pow(s, 1.5));
            radX = Math.max(0.25, 2.1 * (1.0 - 0.88 * Math.pow(s, 1.4)) + 1.85 * envelope);
            radZ = Math.max(0.25, 2.0 * (1.0 - 0.88 * Math.pow(s, 1.4)) + 1.55 * envelope);
          }
          const rowList: HairPoint[] = [];
          for (let c = 0; c <= ptCols; c++) {
            const ang = ((c % ptCols) / ptCols) * 2.0 * Math.PI;
            const ridge = 1.0 + 0.14 * Math.cos(ang * 8.0) * Math.sin(t * Math.PI);
            const px = spineX + radX * ridge * Math.sin(ang);
            const py = spineY + 0.35 * radZ * Math.cos(ang);
            const pz = spineZ + radZ * ridge * Math.cos(ang);
            const uCoord = 0.80 + 0.14 * ((c % ptCols) / ptCols);
            const vCoord = 0.275 + 0.060 * t;
            rowList.push({ x: px, y: py, z: pz, u: uCoord, v: vCoord });
          }
          ptGrid.push(rowList);
        }

        addHairGrid(ptGrid, false);

        const nextGeom = new THREE.BufferGeometry();
        nextGeom.setAttribute('position', new THREE.Float32BufferAttribute(newPos, 3));
        nextGeom.setAttribute('normal', new THREE.Float32BufferAttribute(newNorm, 3));
        nextGeom.setAttribute('uv', new THREE.Float32BufferAttribute(newUV, 2));
        nextGeom.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(newSkinIdx, 4));
        nextGeom.setAttribute('skinWeight', new THREE.Float32BufferAttribute(newSkinW, 4));
        skinned.geometry.dispose();
        skinned.geometry = nextGeom;
      }
    });
  } catch (err) {
    console.warn('Erika model özelleştirmesi uygulanamadı:', err);
  }
}
