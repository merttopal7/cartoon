import * as THREE from 'three';

/** Zemin yüksekliği (dünya x, z); arazi dışında null. */
export type GroundFn = (x: number, z: number) => number | null;

export interface Leg {
  upLeg: THREE.Object3D;
  leg: THREE.Object3D;
  foot: THREE.Object3D;
}

/** Bileğin düz zeminde basarken tabandan yüksekliği, boyun oranı olarak (~10 cm / 1.7 m). */
const ANKLE_REST = 0.06;
/** Ayağın "basıyor" sayıldığı yükseklik aralığı (bilek dinlenme yüksekliğinin üstünde, m). */
const PLANT_FULL = 0.04;
const PLANT_NONE = 0.2;
/** Kalçanın inip çıkabileceği en büyük miktar (boyun oranı). */
const MAX_DROP = 0.2;
const MAX_RISE = 0.08;
/** Tabanın arazi eğimine yatabileceği en büyük açı (rad, ~25°). */
const MAX_TILT = 0.44;
/** Bu kadar küçük düzeltmeler (m) atlanır: düz zeminde poz birebir aynı kalır. */
const EPS = 0.004;

const smoothstep = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * Eğimli arazide ayak IK'sı. Animasyon karakterin merkezinin altında düz bir zemin varsayar; eğimde
 * ayaklardan biri havada kalır, öbürü gömülür. Burada:
 *  1. Kalça, basan ayaklardan en alçaktakine göre iner (bacak boyu yetsin diye);
 *  2. Her bacak iki kemikli IK ile ayağı, animasyondaki yüksekliğini koruyarak arazinin üstüne taşır
 *     (havadaki ayak havada kalır, yalnızca altındaki zemin farkı kadar kayar);
 *  3. Basan ayağın tabanı arazi eğimine yatar.
 * Yalnızca o anki poza ve araziye bağlıdır (deterministik). Düz zeminde düzeltme sıfırdır, poz değişmez.
 */
export class FootIK {
  private readonly ankleRest: number;

  constructor(
    private readonly legs: Leg[],
    private readonly height: number,
    private readonly ground: GroundFn,
  ) {
    this.ankleRest = height * ANKLE_REST;
  }

  /**
   * @param root      karakter kökü (konumu = animasyonun varsaydığı zemin noktası)
   * @param body      kalçayı indirip kaldırmak için yüksekliği ayarlanacak gövde grubu
   * @param weight    0..1; havadayken (zıplama, savrulma) 0
   * @param touch     kemiği değiştirmeden önce çağrılır (bir sonraki karede geri alınsın diye)
   */
  apply(root: THREE.Object3D, body: THREE.Object3D, weight: number, touch: (o: THREE.Object3D) => void) {
    if (weight <= 0.001) return;
    root.updateMatrixWorld(true);
    const floor = root.position.y;

    // Her ayak: animasyondaki konumu, altındaki zeminin animasyon düzleminden farkı ve basma ağırlığı
    const feet = this.legs.map((leg) => {
      const pos = leg.foot.getWorldPosition(new THREE.Vector3());
      const g = this.ground(pos.x, pos.z);
      const off = g === null ? 0 : g - floor;
      const plant = 1 - smoothstep(this.ankleRest + PLANT_FULL, this.ankleRest + PLANT_NONE, pos.y - floor);
      return { leg, pos, off, plant, quat: leg.foot.getWorldQuaternion(new THREE.Quaternion()) };
    });
    if (feet.every((f) => Math.abs(f.off) < EPS)) return;

    // Kalça: basan ayaklardan en alçaktakine göre. Kalkmış ayak kısıt getirmez (en yüksek farkı alır);
    // ikisi de havadaysa (koşu) kalça kaydırılmaz. Ağırlıklar sürekli olduğundan sıçrama olmaz.
    const maxOff = Math.max(...feet.map((f) => f.off));
    let pelvis = Math.min(...feet.map((f) => THREE.MathUtils.lerp(maxOff, f.off, f.plant)));
    pelvis *= Math.max(...feet.map((f) => f.plant));
    pelvis = THREE.MathUtils.clamp(pelvis, -MAX_DROP * this.height, MAX_RISE * this.height) * weight;
    body.position.y += pelvis;
    body.updateMatrixWorld(true);

    for (const f of feet) {
      // Hedef: animasyondaki konum + zemin farkı (kalça kaydırması zaten uygulandı)
      _t.copy(f.pos);
      _t.y += f.off * weight;
      this.solve(f.leg, _t, touch);

      // Taban: animasyondaki dünya yönü korunur, basıyorsa arazi eğimine yatar
      const tilt = this.groundTilt(_t.x, _t.z, f.plant * weight);
      const parent = f.leg.foot.parent;
      if (!parent) continue;
      touch(f.leg.foot);
      parent.getWorldQuaternion(_pq).invert();
      f.leg.foot.quaternion.copy(_pq).multiply(tilt.multiply(f.quat));
      f.leg.foot.updateMatrixWorld(true);
    }
  }

  /** İki kemikli IK: diz açısı kosinüs teoremiyle, sonra uyluk ayak hedefe bakacak şekilde döner. */
  private solve(leg: Leg, target: THREE.Vector3, touch: (o: THREE.Object3D) => void) {
    leg.upLeg.getWorldPosition(_a);
    leg.leg.getWorldPosition(_b);
    leg.foot.getWorldPosition(_c);
    if (_c.distanceToSquared(target) < EPS * EPS) return;
    const lab = _a.distanceTo(_b);
    const lbc = _b.distanceTo(_c);
    const reach = THREE.MathUtils.clamp(_a.distanceTo(target), Math.abs(lab - lbc) + 1e-4, lab + lbc - 1e-4);

    // Diz: menteşe ekseni bacağın düzleminin normali; bacak dümdüzse (eksen tanımsız) dizi bükmeden geç
    _v1.subVectors(_a, _b);
    _v2.subVectors(_c, _b);
    _axis.crossVectors(_v1, _v2);
    if (_axis.lengthSq() > 1e-10) {
      _axis.normalize();
      const current = _v1.angleTo(_v2);
      const wanted = Math.acos(THREE.MathUtils.clamp((lab * lab + lbc * lbc - reach * reach) / (2 * lab * lbc), -1, 1));
      touch(leg.leg);
      rotateWorld(leg.leg, _axis, wanted - current);
    }

    // Uyluk: ayağın yeni konumunu hedefe çevir
    leg.foot.getWorldPosition(_c);
    _v1.subVectors(_c, _a).normalize();
    _v2.subVectors(target, _a).normalize();
    _q.setFromUnitVectors(_v1, _v2);
    touch(leg.upLeg);
    applyWorldRotation(leg.upLeg, _q);
  }

  /** Arazinin (x, z)'deki eğimine göre, ağırlıkla ölçeklenmiş ve sınırlanmış yatırma dönüşü. */
  private groundTilt(x: number, z: number, weight: number): THREE.Quaternion {
    const q = new THREE.Quaternion();
    if (weight <= 0.001) return q;
    const e = 0.15;
    const hx1 = this.ground(x + e, z);
    const hx0 = this.ground(x - e, z);
    const hz1 = this.ground(x, z + e);
    const hz0 = this.ground(x, z - e);
    if (hx1 === null || hx0 === null || hz1 === null || hz0 === null) return q;
    const n = new THREE.Vector3(-(hx1 - hx0) / (2 * e), 1, -(hz1 - hz0) / (2 * e)).normalize();
    const angle = Math.min(_up.angleTo(n), MAX_TILT) * weight;
    if (angle < 1e-4) return q;
    _axis.crossVectors(_up, n).normalize();
    return q.setFromAxisAngle(_axis, angle);
  }
}

function rotateWorld(bone: THREE.Object3D, axisWorld: THREE.Vector3, angle: number) {
  if (!angle) return;
  applyWorldRotation(bone, _q.setFromAxisAngle(axisWorld, angle));
}

/** Kemiği dünya uzayındaki bir dönüşle döndürür: yerel = ebeveyn⁻¹ · R · ebeveyn · yerel. */
function applyWorldRotation(bone: THREE.Object3D, rotation: THREE.Quaternion) {
  if (!bone.parent) return;
  bone.parent.updateMatrixWorld(true);
  bone.parent.getWorldQuaternion(_pq);
  const r = rotation.clone();
  bone.quaternion.premultiply(_pq.clone().invert().multiply(r).multiply(_pq));
  bone.updateMatrixWorld(true);
}
