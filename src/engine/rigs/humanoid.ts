import * as THREE from 'three';
import { ROOT_SPEED } from '../clips';

/**
 * Farklı iskeletler arası insansı retarget (ör. Mixamo klibi → Source/Blender rig'li karakter).
 *
 * Yöntem (dünya uzayı):
 *  1. Kaynak (klibin çekildiği iskelet) ile hedef iskeletin kemikleri ada göre eşlenir.
 *  2. Dinlenme pozunda her hedef kemiğin yönü (kemik başından çocuğuna) kaynak kemiğin yönüne
 *     hizalanır (qAlign); iki iskelet farklı pozda (A/T) olsa bile uzuvlar aynı yöne bakar.
 *  3. Her örnek karede: hedefDünya = (kaynakDünya · kaynakDinlenme⁻¹) · qAlign · hedefDinlenme
 *     yani kaynağın dinlenmeye göre dönüşü hedefe dünya uzayında aktarılır; sonra ebeveyne göre
 *     yerel dönüşe çevrilir.
 *  4. Kalça konumu bacak boyu oranında ölçeklenir.
 */

/** Mixamo kemiği (öneksiz, küçük harf) → hedefte aranacak adlar (normalize edilmiş). Sıra önemli. */
const HUMANOID: [string, string[]][] = [
  ['hips', ['hips', 'pelvis', 'hip']],
  ['spine', ['spine', 'spine01']],
  ['spine2', ['spine2', 'upperchest', 'chest', 'spine1', 'spine02']],
  ['spine1', ['spine1', 'chest', 'spine02']],
  ['neck', ['neck']],
  ['head', ['head']],
  ['leftshoulder', ['leftshoulder', 'shoulderl', 'claviclel', 'lclavicle', 'lshoulder']],
  ['leftarm', ['leftarm', 'upperarml', 'leftupperarm', 'lupperarm', 'arml']],
  ['leftforearm', ['leftforearm', 'forearml', 'lowerarml', 'lforearm', 'leftlowerarm']],
  ['lefthand', ['lefthand', 'handl', 'lhand', 'wristl']],
  ['rightshoulder', ['rightshoulder', 'shoulderr', 'clavicler', 'rclavicle', 'rshoulder']],
  ['rightarm', ['rightarm', 'upperarmr', 'rightupperarm', 'rupperarm', 'armr']],
  ['rightforearm', ['rightforearm', 'forearmr', 'lowerarmr', 'rforearm', 'rightlowerarm']],
  ['righthand', ['righthand', 'handr', 'rhand', 'wristr']],
  ['leftupleg', ['leftupleg', 'thighl', 'upperlegl', 'leftthigh', 'lthigh']],
  ['leftleg', ['leftleg', 'calfl', 'shinl', 'lowerlegl', 'leftshin', 'lcalf']],
  ['leftfoot', ['leftfoot', 'footl', 'lfoot']],
  ['lefttoebase', ['lefttoebase', 'toel', 'toesl', 'lefttoe', 'ltoe']],
  ['rightupleg', ['rightupleg', 'thighr', 'upperlegr', 'rightthigh', 'rthigh']],
  ['rightleg', ['rightleg', 'calfr', 'shinr', 'lowerlegr', 'rightshin', 'rcalf']],
  ['rightfoot', ['rightfoot', 'footr', 'rfoot']],
  ['righttoebase', ['righttoebase', 'toer', 'toesr', 'righttoe', 'rtoe']],
];

/** Yön hizalaması için her kemiğin "çocuğu" (kemik başından bu çocuğun başına olan yön). */
const CHILD: Record<string, string> = {
  hips: 'spine',
  spine: 'spine2',
  spine2: 'neck',
  neck: 'head',
  leftshoulder: 'leftarm',
  leftarm: 'leftforearm',
  leftforearm: 'lefthand',
  rightshoulder: 'rightarm',
  rightarm: 'rightforearm',
  rightforearm: 'righthand',
  leftupleg: 'leftleg',
  leftleg: 'leftfoot',
  leftfoot: 'lefttoebase',
  rightupleg: 'rightleg',
  rightleg: 'rightfoot',
  rightfoot: 'righttoebase',
};

const norm = (s: string) => s.toLowerCase().replace(/[\s_.\-:]/g, '');
const suffix = (s: string) => norm(s).replace(/^mixamorig\d*/, '');

function bonesBy(root: THREE.Object3D, key: (name: string) => string) {
  const map = new Map<string, THREE.Object3D>();
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone && !map.has(key(o.name))) map.set(key(o.name), o);
  });
  return map;
}

/** Hedef iskelette Mixamo adlarının karşılıklarını bulur (her hedef kemik en fazla bir kez). */
export function mapHumanoid(target: THREE.Object3D): Map<string, THREE.Object3D> | null {
  const byName = bonesBy(target, norm);
  const used = new Set<THREE.Object3D>();
  const out = new Map<string, THREE.Object3D>();
  for (const [mix, candidates] of HUMANOID) {
    for (const c of candidates) {
      const b = byName.get(c);
      if (b && !used.has(b)) {
        out.set(mix, b);
        used.add(b);
        break;
      }
    }
  }
  // Uzuvların çoğu bulunamadıysa insansı sayma.
  return out.has('hips') && out.size >= 14 ? out : null;
}

interface Pair {
  key: string;
  src: THREE.Object3D;
  tgt: THREE.Object3D;
  depth: number;
  srcRest: THREE.Quaternion;
  tgtRest: THREE.Quaternion;
  align: THREE.Quaternion;
}

const worldQ = (o: THREE.Object3D) => o.getWorldQuaternion(new THREE.Quaternion());
const worldP = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());

/**
 * Kaynak iskelette çekilmiş klibi hedef iskelete uyarlar. Hedef model dinlenme (bind) pozunda olmalı.
 * Dönen klip hedefin kendi kemik adlarıyla, 30 fps örneklenmiş izler içerir.
 */
export function retargetHumanoid(
  clip: THREE.AnimationClip,
  sourceSkeleton: THREE.Object3D,
  target: THREE.Object3D,
  targetMap: Map<string, THREE.Object3D>,
  unitScale: number,
): THREE.AnimationClip | null {
  const source = sourceSkeleton.clone(true);
  source.updateMatrixWorld(true);
  target.updateMatrixWorld(true);
  const srcBones = bonesBy(source, suffix);

  // Dinlenme pozları ve hizalamalar
  const pairs: Pair[] = [];
  for (const [key, tgt] of targetMap) {
    const src = srcBones.get(key);
    if (!src) continue;
    let depth = 0;
    for (let p = tgt.parent; p; p = p.parent) depth++;
    const align = new THREE.Quaternion();
    const child = CHILD[key];
    const srcChild = child ? srcBones.get(child) : undefined;
    const tgtChild = child ? targetMap.get(child) : undefined;
    if (srcChild && tgtChild) {
      const ds = worldP(srcChild).sub(worldP(src)).normalize();
      const dt = worldP(tgtChild).sub(worldP(tgt)).normalize();
      if (ds.lengthSq() > 0 && dt.lengthSq() > 0) align.setFromUnitVectors(dt, ds);
    }
    pairs.push({ key, src, tgt, depth, srcRest: worldQ(src), tgtRest: worldQ(tgt), align });
  }
  if (!pairs.some((p) => p.key === 'hips')) return null;
  pairs.sort((a, b) => a.depth - b.depth);

  // Bacak boyu oranı (kalça yüksekliği ölçeği) ve kalça dinlenme konumları
  const hips = pairs.find((p) => p.key === 'hips')!;
  const legLen = (bones: (k: string) => THREE.Object3D | undefined) => {
    const up = bones('leftupleg');
    const foot = bones('leftfoot');
    return up && foot ? worldP(up).distanceTo(worldP(foot)) : 0;
  };
  const srcLeg = legLen((k) => srcBones.get(k));
  const tgtLeg = legLen((k) => targetMap.get(k));
  const ratio = srcLeg > 0 && tgtLeg > 0 ? tgtLeg / srcLeg : 1;
  const srcHipsRestWorld = worldP(hips.src);
  const tgtHipsRestWorld = worldP(hips.tgt);

  // Hedefin dinlenme yerel dönüşümlerini sakla (örnekleme sırasında kemikler değişecek)
  const restLocal = pairs.map((p) => ({ q: p.tgt.quaternion.clone(), pos: p.tgt.position.clone() }));

  const mixer = new THREE.AnimationMixer(source);
  const action = mixer.clipAction(clip);
  action.play();

  const fps = 30;
  const n = Math.max(2, Math.ceil(clip.duration * fps) + 1);
  const times = new Float32Array(n);
  const quatValues = pairs.map(() => new Float32Array(n * 4));
  const hipsPos = new Float32Array(n * 3);

  const desired = new THREE.Quaternion();
  const parentQ = new THREE.Quaternion();
  const inv = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    const t = Math.min(clip.duration, i / fps);
    times[i] = t;
    action.time = t;
    mixer.update(0);
    source.updateMatrixWorld(true);

    pairs.forEach((p, j) => {
      // hedefDünya = (kaynakDünya · kaynakDinlenme⁻¹) · hizalama · hedefDinlenme
      desired.copy(worldQ(p.src)).multiply(p.srcRest.clone().invert()).multiply(p.align).multiply(p.tgtRest);
      p.tgt.parent ? p.tgt.parent.getWorldQuaternion(parentQ) : parentQ.identity();
      p.tgt.quaternion.copy(parentQ.invert().multiply(desired));
      p.tgt.updateMatrixWorld(true);
      p.tgt.quaternion.toArray(quatValues[j], i * 4);
    });

    // Kalça: yalnızca dikey (Y) yaylanmayı aktar; yatay (X/Z) konumu motor yönettiği için sıfırla (ışınlanmayı önler)
    const delta = worldP(hips.src).sub(srcHipsRestWorld).multiplyScalar(ratio);
    delta.x = 0;
    delta.z = 0;
    const worldPos = tgtHipsRestWorld.clone().add(delta);
    if (hips.tgt.parent) {
      hips.tgt.parent.updateMatrixWorld(true);
      worldPos.applyMatrix4(inv.copy(hips.tgt.parent.matrixWorld).invert());
    }
    worldPos.toArray(hipsPos, i * 3);
  }

  // Hedefi dinlenme pozuna geri al
  pairs.forEach((p, j) => {
    p.tgt.quaternion.copy(restLocal[j].q);
    p.tgt.position.copy(restLocal[j].pos);
  });
  target.updateMatrixWorld(true);

  const tracks: THREE.KeyframeTrack[] = pairs.map(
    (p, j) => new THREE.QuaternionKeyframeTrack(`${p.tgt.name}.quaternion`, times, quatValues[j]),
  );
  tracks.push(new THREE.VectorKeyframeTrack(`${hips.tgt.name}.position`, times, hipsPos));
  const out = new THREE.AnimationClip(clip.name, clip.duration, tracks);

  // Doğal ilerleme hızı: kaynak birimi/sn → hedef dünya (metre) → hedef model birimi
  const speed = ROOT_SPEED.get(clip);
  if (speed !== undefined) {
    const srcUnitToWorld = sourceSkeleton.getWorldScale(new THREE.Vector3()).x || 1;
    ROOT_SPEED.set(out, (speed * srcUnitToWorld * ratio) / (unitScale || 1));
  }
  return out;
}
