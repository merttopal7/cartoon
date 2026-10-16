import { clamp } from './math';

/** Bir isabet anı (sahne zamanı) ve gücü (~0.6 hafif vuruş … 1.5 yere seren final). */
export interface ImpactEvent {
  time: number;
  strength: number;
}

export interface ImpactOptions {
  /** Kamera sarsıntısı çarpanı (0 = kapalı). */
  shake: number;
  /** Hit-stop (vuruş duraksaması) çarpanı (0 = kapalı). */
  hitStop: number;
}

/** Güç 1'de hit-stop'un yavaş evresi (sn); ~2–3 kare. */
const HOLD = 0.078;
/** Yavaş evrede zamanın akış hızı (1 = normal); tam donma yerine belirgin bir ağırlaşma. */
const SLOW_RATE = 0.14;
/** Gecikmenin geri kazanıldığı süre (sn); bu sürede zaman ~1.3× akar. */
const CATCH_UP = 0.25;
/** Sarsıntının sönüm süresi (sn, e-katlama) ve dikkate alındığı en uzun süre. */
const SHAKE_DECAY = 0.12;
const SHAKE_WINDOW = SHAKE_DECAY * 5;

/** Savrulma mesafesinden vuruş gücü: 0.35 m ≈ 0.7, 2.8 m ≈ 1.45. */
export const impactStrengthFor = (knockback: number) => clamp(0.6 + 0.3 * knockback, 0.6, 1.5);

/**
 * Vuruş hissi: isabet anlarında yerel zaman bükme (hit-stop) ve kamera sarsıntısı.
 *
 * Hit-stop toplam süreyi değiştirmez: isabette karakterler ve efektler kısa süre neredeyse durur, ardından
 * biraz hızlı akıp gerçek zamana yetişir. Böylece sesler, müzik ve sonraki tüm eylemler kaymaz; sonuç yine
 * yalnızca zamana bağlıdır. Üst üste binen isabetlerde gecikmelerin en büyüğü alınır, zaman geri akmaz.
 */
export class ImpactFeel {
  private readonly events: ImpactEvent[];

  constructor(
    events: ImpactEvent[],
    private readonly options: ImpactOptions,
  ) {
    this.events = [...events].sort((a, b) => a.time - b.time);
  }

  get isEmpty() {
    return this.events.length === 0;
  }

  /** Sahne zamanı lt → karakterlerin ve efektlerin değerlendirileceği bükülmüş zaman (her zaman ≤ lt). */
  warp(lt: number): number {
    if (this.options.hitStop <= 0) return lt;
    let lag = 0;
    for (const e of this.events) {
      const u = lt - e.time;
      if (u < 0) break;
      const hold = HOLD * e.strength * this.options.hitStop;
      const maxLag = hold * (1 - SLOW_RATE);
      if (u < hold) lag = Math.max(lag, u * (1 - SLOW_RATE));
      else if (u < hold + CATCH_UP) lag = Math.max(lag, maxLag * (1 - (u - hold) / CATCH_UP));
    }
    return lt - lag;
  }

  /**
   * lt anındaki kamera sarsıntısı, ekran ekseninde birim uzaklık başına (x sağ, y yukarı).
   * Yüksek frekanslı, hızla sönen ve deterministik bir titreşim.
   */
  shake(lt: number): { x: number; y: number } | null {
    if (this.options.shake <= 0) return null;
    let x = 0;
    let y = 0;
    for (const e of this.events) {
      const u = lt - e.time;
      if (u < 0) break;
      if (u > SHAKE_WINDOW) continue;
      const a = e.strength * this.options.shake * Math.exp(-u / SHAKE_DECAY);
      const ph = e.time * 7.31;
      x += a * (Math.sin(u * 113 + ph) * 0.6 + Math.sin(u * 181 + ph * 1.7) * 0.4);
      y += a * (Math.sin(u * 97 + ph * 2.3) * 0.6 + Math.sin(u * 157 + ph * 0.6) * 0.4);
    }
    return x === 0 && y === 0 ? null : { x, y };
  }
}
