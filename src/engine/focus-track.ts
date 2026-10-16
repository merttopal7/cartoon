import * as THREE from 'three';
import type { AbilitySystem, ActiveAbilityFocus } from './abilities';
import type { Character } from './character';

/** Ham odağın örneklendiği zaman ızgarası (sn). */
const STEP = 0.1;
/** Bu kadar adımdan (±1.0 sn → 2 sn) kısa odak boşlukları kapatılır: peş peşe yeteneklerde kamera geri çekilmez. */
const GAP_STEPS = 10;
/** Zoom ağırlığının yumuşatma çekirdeği (Gauss σ, sn) ve yarıçapı (adım). */
const ZOOM_SIGMA = 0.35;
const ZOOM_RADIUS = 10;
/** Odak merkezinin ve kadraj boyutunun yumuşatma çekirdeği; daha geniş, odak karakterden karaktere akarak geçsin. */
const CENTER_SIGMA = 0.6;
const CENTER_RADIUS = 18;
/** Kadraj boyutu en yavaş değişen bileşendir: yetenekten yeteneğe (ör. ateş topu ↔ üç hedefli büyü) zoom pompalamasın. */
const SIZE_SIGMA = 1.2;
const SIZE_RADIUS = 36;

/**
 * Yetenek kamera odağının zaman içinde yumuşatılmış hali.
 *
 * Her yetenek kendi zoom eğrisini çiziyordu (başta yaklaş, isabetten sonra uzaklaş); yetenekler arası
 * ~0.6 sn olunca kamera 45 sn'lik savaşta 23 kez yaklaşıp uzaklaşıyordu. Burada ham odak 0.1 sn'lik
 * ızgarada bir kez hesaplanır, kısa boşluklar kapatılır (morfolojik kapama: önce en büyük, sonra en
 * küçük) ve sonuç Gauss ile yumuşatılır. Gelecekteki yetenekler de pencerede olduğu için kamera
 * hareketi önceden sezer. Yalnızca zamana bağlıdır; aynı t her zaman aynı odağı verir.
 */
export class FocusTrack {
  private readonly raw = new Map<number, ActiveAbilityFocus | null>();
  private readonly dilated = new Map<number, number>();
  private readonly closed = new Map<number, number>();

  constructor(
    private readonly abilities: AbilitySystem,
    private readonly characters: Map<string, Character>,
  ) {}

  at(t: number): ActiveAbilityFocus | null {
    const i0 = Math.round(t / STEP);

    let zSum = 0;
    let zNorm = 0;
    let birdSum = 0;
    let elevation: number | undefined;
    // Yandan bakış: ağırlık Gauss ile yumuşar; çizgi yönü (±180° belirsiz) çift açıyla ortalanır
    let sideSum = 0;
    let lineX = 0;
    let lineZ = 0;
    for (let i = i0 - ZOOM_RADIUS; i <= i0 + ZOOM_RADIUS; i++) {
      const g = gauss(i * STEP - t, ZOOM_SIGMA);
      zSum += g * this.closedAt(i);
      zNorm += g;
      const f = this.rawAt(i);
      birdSum += g * (f?.birdEyeWeight ?? 0);
      if (f?.elevationOverride !== undefined && (f.birdEyeWeight ?? 0) > 0) elevation = f.elevationOverride;
      if (f?.sideWeight && f.lineAngle !== undefined) {
        sideSum += g * f.sideWeight;
        lineX += g * f.sideWeight * Math.cos(2 * f.lineAngle);
        lineZ += g * f.sideWeight * Math.sin(2 * f.lineAngle);
      }
    }
    const zoomWeight = zSum / zNorm;
    if (zoomWeight < 1e-3) return null;

    const center = new THREE.Vector3();
    let cNorm = 0;
    let size = 0;
    let sNorm = 0;
    let casterId = '';
    let targetId = '';
    let best = 0;
    for (let i = i0 - SIZE_RADIUS; i <= i0 + SIZE_RADIUS; i++) {
      const f = this.rawAt(i);
      if (!f || f.zoomWeight <= 0) continue;
      const ws = gauss(i * STEP - t, SIZE_SIGMA) * f.zoomWeight;
      size += f.suggestedSize * ws;
      sNorm += ws;
      if (Math.abs(i - i0) > CENTER_RADIUS) continue;
      const w = gauss(i * STEP - t, CENTER_SIGMA) * f.zoomWeight;
      center.addScaledVector(f.effectCenter, w);
      cNorm += w;
      if (w > best) {
        best = w;
        casterId = f.casterId;
        targetId = f.targetId;
      }
    }
    if (cNorm <= 0 || sNorm <= 0) return null;

    const birdEyeWeight = birdSum / zNorm;
    return {
      casterId,
      targetId,
      zoomWeight,
      effectCenter: center.divideScalar(cNorm),
      suggestedSize: size / sNorm,
      birdEyeWeight: birdEyeWeight > 1e-3 ? birdEyeWeight : undefined,
      elevationOverride: elevation,
      sideWeight: sideSum / zNorm > 1e-3 ? sideSum / zNorm : undefined,
      lineAngle: sideSum > 0 ? Math.atan2(lineZ, lineX) / 2 : undefined,
    };
  }

  private rawAt(i: number): ActiveAbilityFocus | null {
    let f = this.raw.get(i);
    if (f === undefined) {
      f = this.abilities.getActiveCameraFocus(i * STEP, this.characters);
      this.raw.set(i, f);
    }
    return f;
  }

  /** Ham zoom ağırlığının ±GAP_STEPS penceredeki en büyüğü (genişletme). */
  private dilatedAt(i: number): number {
    let v = this.dilated.get(i);
    if (v === undefined) {
      v = 0;
      for (let j = i - GAP_STEPS; j <= i + GAP_STEPS; j++) v = Math.max(v, this.rawAt(j)?.zoomWeight ?? 0);
      this.dilated.set(i, v);
    }
    return v;
  }

  /** Genişletilmiş ağırlığın ±GAP_STEPS penceredeki en küçüğü (aşındırma): kısa boşluklar dolar, uçlar uzamaz. */
  private closedAt(i: number): number {
    let v = this.closed.get(i);
    if (v === undefined) {
      v = Infinity;
      for (let j = i - GAP_STEPS; j <= i + GAP_STEPS; j++) v = Math.min(v, this.dilatedAt(j));
      this.closed.set(i, v);
    }
    return v;
  }
}

const gauss = (x: number, sigma: number) => Math.exp(-(x * x) / (2 * sigma * sigma));
