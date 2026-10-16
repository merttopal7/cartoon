import * as THREE from 'three';

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
      const below = smoothstep(spec.seam + 0.15, spec.seam - 0.35, y);
      const lateral = 1 - smoothstep(spec.width * 0.75, spec.width, Math.abs(x));
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
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const names = (mesh.geometry as THREE.BufferGeometry | undefined)?.userData?.faceMorphNames as string[] | undefined;
    if (!mesh.isMesh || !names) return;
    mesh.morphTargetDictionary = Object.fromEntries(names.map((nm, i) => [nm, i]));
    mesh.morphTargetInfluences = names.map(() => 0);
  });
}
