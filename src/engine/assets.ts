import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import type { AssetDef } from '../schema';
import type { Rig } from './pose';
import { buildProp, type PropKind } from './props';
import { ModelRig } from './rigs/model';
import { PlaceholderRig, type CharacterKind } from './rigs/placeholder';
import { ROOT_SPEED, SOURCE_HIPS_HEIGHT, SOURCE_SKELETON } from './clips';
import { mergeStatic } from './merge';
import { OUTLINE, toonMaterial, toonify } from './toon';

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
    src = movedPath(src);
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
    return new ModelRig(scene, size, [...model.animations, ...extra], def.clips, def.eyelids, def.mouth, def.face);
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

/**
 * Taşınan dosyalar: ortak animasyon kütüphanesi eskiden models/characters/main-character/animations altındaydı
 * (Toprak'ın klasörü gibi görünüyordu); artık models/animations. Eski yolla kaydedilmiş senaryolar da yüklensin.
 */
function movedPath(src: string): string {
  return src.replace(/^(\/?)models\/characters\/main-character\/animations\//, '$1models/animations/');
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
/**
 * Varlığın renk parlaklığı ve doygunluğu (pastel dokulu bir karakter aynı ışıkta diğerlerinden fırlamasın).
 * Parlaklık malzeme rengini çarpar; doygunluk doku rengine shader'da uygulanır.
 */
function adjustColors(root: THREE.Object3D, brightness: number, saturation: number) {
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) {
      const c = (mat as THREE.MeshToonMaterial).color;
      if (c) c.multiplyScalar(brightness);
      if (saturation === 1) continue;
      const s = saturation.toFixed(3);
      const prev = mat.onBeforeCompile;
      mat.onBeforeCompile = (shader, renderer) => {
        prev?.(shader, renderer);
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <map_fragment>',
          `#include <map_fragment>\n\tdiffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722))), diffuseColor.rgb, ${s});`,
        );
      };
      mat.customProgramCacheKey = () => `sat${s}`;
    }
  });
}

function prepareModel(model: THREE.Object3D, def: ModelAsset, fbx: boolean, outline: number | false) {
  const isMap = def.align === 'none';
  if (isMap) {
    preserveAndOptimizeMap(model);
  } else {
    toonify(model, outline);
    if (def.brightness !== undefined || def.saturation !== undefined) adjustColors(model, def.brightness ?? 1, def.saturation ?? 1);
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
      // Su elementine uygun mavi tonlu kıyafet (yeşilden çevrildi)
      texLoader.loadAsync('/models/characters/Erika/Erika_Archer_Clothes_diffuse_mavi.png'),
      // Çizgi film tonuna çekilmiş yüz: temiz göz akı, su-yeşili iris, sağlıklı dudak (Blender/Python ile düzenlendi)
      texLoader.loadAsync('/models/characters/Erika/FemaleFitA_Body_diffuse_mese.png'),
    ]);
    greenClothesTex.colorSpace = THREE.SRGBColorSpace;
    bodyTex.colorSpace = THREE.SRGBColorSpace;

    root.traverse((o) => {
      const skinned = o as THREE.SkinnedMesh;
      if (!skinned.isMesh) return;

      // Gözler de aynı atlasın göz bölgesini kullanır (düzeltilmiş göz akı ve iris)
      if (/body_mesh|eyes_mesh/i.test(skinned.name)) {
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
    await attachErikaHair(root);
  } catch (err) {
    console.warn('Erika model özelleştirmesi uygulanamadı:', err);
  }
}

/** Meşe'nin saç rengi (kestane-kızıl); tepe noktası renkleri bunu çarpar (kök koyu, uçlar bakır, tutam tonları) */
const ERIKA_HAIR_COLOR = '#6b2419';
/** Saçın kafadan gövdeye geçtiği yükseklik aralığı (bağlama uzayı, cm): üstü kafayla, altı gövdeyle hareket eder */
const HAIR_HEAD_FROM = 148.5;
const HAIR_HEAD_TO = 157.5;
/**
 * Saç fiziği kemikleri (göğüs kemiğinin çocukları, bağlama uzayında dönme noktaları): sırttaki saç ense
 * hizasından, ön tutamlar omuz başlarından sallanır. ModelRig adlarından bulur, Character yay fiziğiyle sürer.
 */
const HAIR_PIVOTS: { name: string; at: [number, number, number] }[] = [
  { name: 'hair_phys_back', at: [0, 156, -7.5] },
  { name: 'hair_phys_l', at: [7.5, 153, 0.5] },
  { name: 'hair_phys_r', at: [-7.5, 153, 0.5] },
];

const hash3 = (x: number, y: number, z: number) => {
  const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return h - Math.floor(h);
};

/**
 * Blender'da modellenen uzun dalgalı saç (sırtın ortasına inen katmanlı tutamlar, kulakları örten yan saç,
 * omuzlardan göğse dökülen ön tutamlar, yana taranmış kâkül): public/models/characters/Erika/sac.obj, modelin
 * bağlama uzayında (y yukarı). Çizgi film gölgelendirmesi; tepe noktası renkleriyle kök koyu, uçlar açık, tutamlar
 * arasında ton farkı, tepede ışık bandı. Ağırlıklar: boyun üstü kafa; aşağısı gövde ile fizik kemikleri arasında,
 * dönme noktasından uzaklaştıkça fizik payı artar (uçlar en çok sallanır).
 */
async function attachErikaHair(root: THREE.Object3D) {
  let body: THREE.SkinnedMesh | undefined;
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh && /body_mesh/i.test(o.name)) body = o as THREE.SkinnedMesh;
  });
  if (!body) return;
  const face = body;
  const bones = face.skeleton.bones;
  const headIdx = bones.findIndex((b) => /head$/i.test(b.name));
  const chestIdx = bones.findIndex((b) => /spine2$/i.test(b.name));
  if (headIdx < 0 || chestIdx < 0) return;
  // Fizik kemikleri: model şu an bağlama pozunda; dönme noktaları göğüs kemiğinin yerel uzayına çevrilir
  root.updateMatrixWorld(true);
  const chest = bones[chestIdx];
  const physBones = HAIR_PIVOTS.map(({ name, at }) => {
    const b = new THREE.Bone();
    b.name = name;
    chest.add(b);
    b.position.copy(chest.worldToLocal(new THREE.Vector3(...at)));
    b.updateMatrixWorld(true);
    return b;
  });
  const allBones = [...bones, ...physBones];
  const inverses = [...face.skeleton.boneInverses, ...physBones.map((b) => b.matrixWorld.clone().invert())];
  const [backIdx, leftIdx, rightIdx] = physBones.map((_, i) => bones.length + i);

  const hair = await new OBJLoader().loadAsync('/models/characters/Erika/sac.obj');
  const material = toonMaterial(ERIKA_HAIR_COLOR, { outline: false });
  material.vertexColors = true;
  material.name = 'erika_sac';
  material.userData.noFill = true;
  hair.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry;
    const pos = g.attributes.position;
    const si = new Uint16Array(pos.count * 4);
    const sw = new Float32Array(pos.count * 4);
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      // --- Ağırlık: kafa / gövde / fizik
      const kHead = THREE.MathUtils.smoothstep(y, HAIR_HEAD_FROM, HAIR_HEAD_TO);
      // Tek parça saç: önde (omuzların önü) yan fizik kemikleri, arkada sırt kemiği; aradaki geçiş yumuşak
      // (iki fizik kemiği karışır), yoksa ön ile arka arasında saç yırtılırdı
      const kFront = THREE.MathUtils.smoothstep(z, -2, 2);
      const sideIdx = x > 0 ? leftIdx : rightIdx;
      const pivotY = 156 - 3 * kFront;
      const reach = Math.pow(THREE.MathUtils.clamp((pivotY - y) / 20, 0, 1), 0.8) * (1 - kHead);
      si[i * 4] = headIdx;
      sw[i * 4] = kHead;
      si[i * 4 + 1] = chestIdx;
      sw[i * 4 + 1] = (1 - kHead) - reach;
      si[i * 4 + 2] = backIdx;
      sw[i * 4 + 2] = reach * (1 - kFront);
      si[i * 4 + 3] = sideIdx;
      sw[i * 4 + 3] = reach * kFront;
      // --- Renk: kökten uca açılan ton, tutam tonları (yatay konuma göre şeritler), tepede ışık bandı
      const tip = THREE.MathUtils.clamp((168 - y) / 34, 0, 1);
      const ang = Math.atan2(x, -z);
      // Tutam şeritleri: geniş açık/koyu bantlar + aralarda ince koyu çizgiler (tutam ayrımı)
      const s1 = Math.sin(ang * 9 + Math.sin(y * 0.19) * 0.9);
      const s2 = Math.sin(ang * 23 + 1.3 + Math.sin(y * 0.33) * 0.6);
      const strand = 0.5 + 0.25 * s1 + 0.12 * s2 - 0.22 * Math.pow(Math.max(0, -s2), 6);
      const grain = hash3(Math.round(x * 3), Math.round(y * 0.7), Math.round(z * 3)) - 0.5;
      const band = Math.exp(-(((y - 174.5) / 1.6) ** 2)) * THREE.MathUtils.clamp(-z / 6 + 0.6, 0, 1);
      let k = 0.66 + 0.36 * tip + 0.45 * (strand - 0.5) + 0.05 * grain + 0.4 * band;
      k = THREE.MathUtils.clamp(k, 0.35, 1.4);
      col[i * 3] = k * (1 + 0.06 * tip);
      col[i * 3 + 1] = k * (1 + 0.1 * tip);
      col[i * 3 + 2] = k;
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const skinnedHair = new THREE.SkinnedMesh(g, material);
    skinnedHair.name = 'erika_sac';
    skinnedHair.userData.keepMaterial = true;
    skinnedHair.frustumCulled = false;
    skinnedHair.bind(new THREE.Skeleton(allBones, inverses), face.bindMatrix);
    (face.parent ?? root).add(skinnedHair);
  });
}
