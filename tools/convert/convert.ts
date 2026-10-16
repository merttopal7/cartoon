import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeStatic } from '../../src/engine/merge';

export interface ConvertOptions {
  url: string;
  scale: number;
  maxTexture: number;
  crop: [number, number, number, number] | null;
}

export interface ConvertStats {
  meshesBefore: number;
  trianglesBefore: number;
  meshesAfter: number;
  cropped: number;
  size: [number, number, number];
  min: [number, number, number];
  materials: string[];
  warnings: string[];
}

declare global {
  interface Window {
    convert(o: ConvertOptions): Promise<ConvertStats>;
    __write(b64: string, first: boolean): Promise<void>;
  }
}

function countMeshes(root: THREE.Object3D) {
  let meshes = 0;
  let tris = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
  });
  return { meshes, tris };
}

/** Modeli yükler; gömülü/harici dokular dahil her şey bitene kadar bekler. */
async function loadAll(url: string): Promise<THREE.Object3D> {
  const manager = new THREE.LoadingManager();
  const done = new Promise<void>((resolve) => (manager.onLoad = resolve));
  manager.onError = (u) => warnings.push(`yüklenemedi: ${decodeURIComponent(u)}`);
  const root = /\.fbx$/i.test(decodeURI(url))
    ? await new FBXLoader(manager).loadAsync(url)
    : (await new GLTFLoader(manager).loadAsync(url)).scene;
  await done;
  return root;
}

const warnings: string[] = [];

/** Tarayıcının açamadığı (ör. desteklenmeyen biçimde gömülü) dokuları ele. */
function validTexture(tex: THREE.Texture | null, owner: string): THREE.Texture | null {
  if (!tex) return null;
  const img = tex.image as { width?: number } | undefined;
  if (img && (img.width ?? 0) > 0) return tex;
  warnings.push(`"${owner}" malzemesindeki "${tex.name || 'adsız'}" dokusu okunamadı, atlandı`);
  return null;
}

/** Her malzemeyi glTF'in anladığı MeshStandardMaterial'a çevirir; kesik (alpha) dokular MASK olur. */
function toStandard(src: THREE.Material): THREE.MeshStandardMaterial {
  const s = src as THREE.MeshPhongMaterial;
  s.map = validTexture(s.map, s.name);
  s.normalMap = validTexture(s.normalMap, s.name);
  const cutout = (s.transparent && s.opacity >= 1 && !!s.map) || s.alphaTest > 0;
  const m = new THREE.MeshStandardMaterial({
    name: s.name,
    color: s.color,
    map: s.map,
    normalMap: s.normalMap,
    side: s.side,
    roughness: 1,
    metalness: 0,
    alphaTest: cutout ? 0.5 : 0,
    transparent: !cutout && s.opacity < 1,
    opacity: s.opacity,
  });
  // Saydamlığı olmayan dokular JPEG olarak yazılsın (çok daha küçük).
  if (m.map) m.map.userData.mimeType = cutout || m.transparent ? 'image/png' : 'image/jpeg';
  if (m.normalMap) m.normalMap.userData.mimeType = 'image/jpeg';
  return m;
}

/** Merkezi XZ dikdörtgeni dışında kalan mesh'leri kaldırır. */
function cropMeshes(root: THREE.Object3D, [minX, minZ, maxX, maxZ]: [number, number, number, number]): number {
  root.updateMatrixWorld(true);
  const remove: THREE.Object3D[] = [];
  const c = new THREE.Vector3();
  root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    new THREE.Box3().setFromObject(o).getCenter(c);
    if (c.x < minX || c.x > maxX || c.z < minZ || c.z > maxZ) remove.push(o);
  });
  remove.forEach((o) => o.removeFromParent());
  return remove.length;
}

window.convert = async ({ url, scale, maxTexture, crop }) => {
  const root = await loadAll(url);
  const before = countMeshes(root);

  root.scale.multiplyScalar(scale);
  const cropped = crop ? cropMeshes(root, crop) : 0;
  const merged = mergeStatic(root);
  const converted = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  merged.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const src = m.material as THREE.Material;
    if (!converted.has(src)) converted.set(src, toStandard(src));
    m.material = converted.get(src)!;
  });

  const box = new THREE.Box3().setFromObject(merged);
  const glb = (await new GLTFExporter().parseAsync(merged, { binary: true, maxTextureSize: maxTexture })) as ArrayBuffer;

  const bytes = new Uint8Array(glb);
  const step = 1 << 20;
  for (let i = 0; i < bytes.length; i += step) {
    let bin = '';
    const part = bytes.subarray(i, i + step);
    for (let j = 0; j < part.length; j += 0x8000) bin += String.fromCharCode(...part.subarray(j, j + 0x8000));
    await window.__write(btoa(bin), i === 0);
  }

  return {
    meshesBefore: before.meshes,
    trianglesBefore: before.tris,
    meshesAfter: merged.children.length,
    cropped,
    size: box.getSize(new THREE.Vector3()).toArray(),
    min: box.min.toArray(),
    materials: [...converted.values()].map(
      (m) => `${m.name}: map=${m.map ? `${m.map.image.width}x${m.map.image.height}` : '-'} normal=${!!m.normalMap} alphaTest=${m.alphaTest}`,
    ),
    warnings,
  };
};
