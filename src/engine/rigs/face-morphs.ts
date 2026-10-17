import * as THREE from 'three';
import { toonMaterial } from '../toon';

/**
 * Yüz şekil anahtarı (blendshape) olmayan modellere yüklemede üretilen ağız şekilleri: çene açma (konuşma,
 * şaşkınlık), gülümseme ve üzgün. Değerler modelin bağlama uzayında (FBX birimi, genelde cm; y yukarı, z ileri).
 * Üretilen şekiller motorun tanıdığı adlarla eklenir ("jawopen", "smile", "sad"); konuşma ve ifadeler
 * onları diğer modellerdeki hazır şekil anahtarları gibi sürer.
 */
export interface FaceSpec {
  /** Yüzün bulunduğu mesh (ad için düzenli ifade) */
  mesh: string;
  /** Kafa kemiği (ad için düzenli ifade); yalnızca bu kemiğe bağlı köşeler oynar */
  bone: string;
  /** Dudak çizgisinin yüksekliği (y) */
  seam: number;
  /** Çene menteşesi (y, z): kulak hizası */
  hinge: [number, number];
  /** Alt çenenin yarı genişliği (x) */
  width: number;
  /** Ağız köşesi (x, z); y = seam */
  corner: [number, number];
  /** Dudakların ortadaki ön yüzeyi (z); dişler bunun arkasına yerleşir. Verilmezse köşe + 1.35 */
  front?: number;
}

/** Çene açma şeklinin tam etkideki dönüşü (derece). Motor ağız açıklığını ~3.5 katına kadar sürer: konuşmada ~5°, en çok ~9°. */
const JAW_DEGREES = 2.6;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Şekilleri mesh'in geometrisine ekler (paylaşılan geometride bir kez). */
export function addFaceMorphs(root: THREE.Object3D, spec: FaceSpec) {
  const meshRe = new RegExp(spec.mesh, 'i');
  const boneRe = new RegExp(spec.bone, 'i');
  root.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || !meshRe.test(mesh.name)) return;
    const g = mesh.geometry;
    if (g.userData.faceMorphs) {
      mesh.updateMorphTargets();
      return;
    }
    const boneIdx = mesh.skeleton.bones.findIndex((b) => boneRe.test(b.name));
    if (boneIdx < 0) return;
    const pos = g.attributes.position;
    const si = g.attributes.skinIndex;
    const sw = g.attributes.skinWeight;
    if (!pos || !si || !sw) return;

    const n = pos.count;
    const indexed = g.index !== null;
    const jaw = new Float32Array(n * 3);
    const smile = new Float32Array(n * 3);
    const sad = new Float32Array(n * 3);
    const [hy, hz] = spec.hinge;
    const [cx, cz] = spec.corner;
    const phi = THREE.MathUtils.degToRad(JAW_DEGREES);
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);

    for (let i = 0; i < n; i++) {
      let wHead = 0;
      for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === boneIdx) wHead += sw.getComponent(i, k);
      if (wHead < 0.05) continue;
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);

      // Çene: dudak çizgisinin altı (dar geçiş bandında dudaklar gerilir, yırtılmaz), alt yüz genişliğinde,
      // menteşenin önünde; boyuna doğru söner
      // Ağız bölgesinde dudaklar üçgen bazında ayrılır: merkezi dudak çizgisinin altındaki üçgen çeneyle tam
      // iner, üstündeki hiç oynamaz. FBX geometrisinde her üçgenin kendi köşeleri olduğundan dudak çizgisinde
      // temiz bir yarık açılır (köşe bazlı yumuşak geçişte iki dudak birlikte esneyip ağız açılmıyordu).
      let below = smoothstep(spec.seam + 0.15, spec.seam - 0.35, y);
      if (!indexed) {
        const t = i - (i % 3);
        const tx = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3;
        const ty = (pos.getY(t) + pos.getY(t + 1) + pos.getY(t + 2)) / 3;
        const tz = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3;
        if (Math.abs(tx) < cx && Math.abs(ty - spec.seam) < 1.0 && tz > cz - 3) below = ty < spec.seam ? 1 : 0;
      }
      // Dudak hizasında yalnızca ortası iner, köşeler neredeyse yerinde kalır (yoksa ağız yanlara gerilip
      // genişliyordu); aşağıda çene tam genişlikte iner
      const lipLateral = 1 - smoothstep(cx * 0.35, cx * 1.1, Math.abs(x)) * 0.85;
      const jawLateral = 1 - smoothstep(spec.width * 0.75, spec.width, Math.abs(x));
      const lateral = THREE.MathUtils.lerp(lipLateral, jawLateral, smoothstep(spec.seam - 0.4, spec.seam - 1.6, y)) * jawLateral;
      const front = smoothstep(hz - 2, hz + 3, z);
      const neck = smoothstep(spec.seam - 6, spec.seam - 3.5, y);
      const wj = below * lateral * front * neck * wHead;
      if (wj > 0) {
        const dy = y - hy;
        const dz = z - hz;
        jaw[i * 3 + 1] = (hy + dy * cos - dz * sin - y) * wj;
        jaw[i * 3 + 2] = (hz + dy * sin + dz * cos - z) * wj;
      }

      // Gülümseme / üzgün: ağız köşeleri çevresinde yumuşak bir bölge
      const side = Math.sign(x) || 1;
      const d2 = (Math.abs(x) - cx) ** 2 + (y - spec.seam) ** 2 + (z - cz) ** 2;
      const wc = Math.exp(-d2 / (1.3 * 1.3)) * wHead * smoothstep(cz - 2.5, cz - 0.5, z);
      if (wc > 0.001) {
        smile[i * 3] = side * 0.25 * wc;
        smile[i * 3 + 1] = 0.32 * wc;
        smile[i * 3 + 2] = -0.15 * wc;
        sad[i * 3] = side * 0.05 * wc;
        sad[i * 3 + 1] = -0.3 * wc;
      }
    }

    g.morphAttributes.position = [
      new THREE.Float32BufferAttribute(jaw, 3),
      new THREE.Float32BufferAttribute(smile, 3),
      new THREE.Float32BufferAttribute(sad, 3),
    ];
    g.morphTargetsRelative = true;
    g.userData.faceMorphs = true;
    // Adlar motorun MORPHS tablosuyla eşleşir (src/engine/rigs/model.ts)
    g.userData.faceMorphNames = ['jawopen', 'smile', 'sad'];
    mesh.updateMorphTargets();
  });
  // updateMorphTargets geometride ad yoksa sayısal anahtar verir; adları elle yaz
  const faces: THREE.SkinnedMesh[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const names = (mesh.geometry as THREE.BufferGeometry | undefined)?.userData?.faceMorphNames as string[] | undefined;
    if (!mesh.isMesh || !names) return;
    mesh.morphTargetDictionary = Object.fromEntries(names.map((nm, i) => [nm, i]));
    mesh.morphTargetInfluences = names.map(() => 0);
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) faces.push(mesh as THREE.SkinnedMesh);
  });
  for (const face of faces) addTeeth(face, spec, boneRe);
}

/** Dişlerin rengi (fildişi beyazı) ve ağız içinin rengi (koyu kırmızı) */
const TEETH_COLOR = '#efe8da';
const MOUTH_COLOR = '#3a1215';

/**
 * Dudak kavsini izleyen, kafa kemiğine bağlı kavisli şerit (bağlama uzayında). back: dudak ön yüzeyinin ne kadar
 * arkasında; halfScale: ağız köşesine göre yarı genişlik oranı.
 */
function mouthStrip(
  face: THREE.SkinnedMesh,
  spec: FaceSpec,
  boneIdx: number,
  opts: { name: string; color: string; y0: number; y1: number; back: number; halfScale: number },
): THREE.SkinnedMesh {
  const [cx, cz] = spec.corner;
  const front = spec.front ?? cz + 1.35;
  const k = (front - cz) / (cx * cx);
  const half = cx * opts.halfScale;
  const SX = 16;
  const SY = 2;
  const posArr: number[] = [];
  const nrm: number[] = [];
  for (let j = 0; j <= SY; j++) {
    for (let i = 0; i <= SX; i++) {
      const x = -half + (2 * half * i) / SX;
      const y = opts.y0 + ((opts.y1 - opts.y0) * j) / SY;
      posArr.push(x, y, front - k * x * x - opts.back);
      const nx = 2 * k * x;
      const len = Math.hypot(nx, 1);
      nrm.push(nx / len, 0, 1 / len);
    }
  }
  const index: number[] = [];
  for (let j = 0; j < SY; j++) {
    for (let i = 0; i < SX; i++) {
      const a = j * (SX + 1) + i;
      index.push(a, a + 1, a + SX + 1, a + 1, a + SX + 2, a + SX + 1);
    }
  }
  const count = posArr.length / 3;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  const si = new Uint16Array(count * 4);
  const sw = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    si[i * 4] = boneIdx;
    sw[i * 4] = 1;
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  geo.setIndex(index);
  const mesh = new THREE.SkinnedMesh(geo, toonMaterial(opts.color, { outline: false }));
  mesh.name = opts.name;
  mesh.frustumCulled = false;
  mesh.bind(face.skeleton, face.bindMatrix);
  return mesh;
}

/**
 * Ağız içi ve üst diş sırası (model dişsiz): dudakların arkasında, kafa kemiğine bağlı. Ağız kapalıyken dudakların
 * ardında kalır; çene inince dudak yarığından üstte beyaz dişler, arkada koyu ağız boşluğu görünür.
 */
function addTeeth(face: THREE.SkinnedMesh, spec: FaceSpec, boneRe: RegExp) {
  const parent = face.parent ?? face;
  if (parent.getObjectByName('face_teeth')) return;
  const boneIdx = face.skeleton.bones.findIndex((b) => boneRe.test(b.name));
  if (boneIdx < 0) return;
  parent.add(
    mouthStrip(face, spec, boneIdx, { name: 'face_mouth', color: MOUTH_COLOR, y0: spec.seam - 1.6, y1: spec.seam + 0.5, back: 1.7, halfScale: 0.95 }),
    mouthStrip(face, spec, boneIdx, { name: 'face_teeth', color: TEETH_COLOR, y0: spec.seam - 0.28, y1: spec.seam + 0.4, back: 0.8, halfScale: 0.72 }),
  );
}
