/**
 * Ses sentezi yapı taşları: tohumlu gürültü, filtreler, zarflar. Hepsi örnek örnek çalışır ve yalnızca
 * tohuma bağlıdır; aynı ses her çalıştırmada bit bit aynı çıkar (dışa aktarım deterministik kalır).
 */

export const SR = 44100;

/** Tohumlu sözde rastgele üreteç (mulberry32), 0..1. */
export function rng(seed: number): () => number {
  let a = (seed * 2654435761) >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const TAU = Math.PI * 2;
export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export const smooth = (x: number) => {
  const k = clamp01(x);
  return k * k * (3 - 2 * k);
};

/** Saniyeden örnek sayısına. */
export const samples = (sec: number) => Math.max(1, Math.round(sec * SR));

/** RBJ biquad filtresi; frekans sürekli değişebilir (set her örnekte çağrılabilir). */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(
    private readonly type: 'lowpass' | 'highpass' | 'bandpass',
    freq: number,
    q = 0.707,
  ) {
    this.set(freq, q);
  }

  set(freq: number, q = 0.707) {
    const f = Math.min(Math.max(freq, 10), SR * 0.45);
    const w = (TAU * f) / SR;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    let b0: number, b1: number, b2: number;
    if (this.type === 'lowpass') {
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = b0;
    } else if (this.type === 'highpass') {
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = b0;
    } else {
      // Sabit tepe kazançlı bant geçiren (tepe = 1)
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Tek kutuplu alçak geçiren (yumuşak, ucuz). */
export class OnePole {
  private y = 0;
  private a: number;
  constructor(freq: number) {
    this.a = 1 - Math.exp((-TAU * freq) / SR);
  }
  set(freq: number) {
    this.a = 1 - Math.exp((-TAU * freq) / SR);
  }
  process(x: number): number {
    this.y += this.a * (x - this.y);
    return this.y;
  }
}

/** Kahverengi (alçak frekanslı, gürleyen) gürültü: beyaz gürültünün sızdıran toplamı. */
export function brown(r: () => number): () => number {
  let y = 0;
  return () => {
    y = (y + (r() * 2 - 1) * 0.06) * 0.996;
    return y * 3.2;
  };
}

/** Saldırı + üstel sönüm zarfı (t sn). */
export const hit = (t: number, attack: number, decay: number) =>
  t < 0 ? 0 : t < attack ? t / attack : Math.exp(-(t - attack) / decay);

/** Tepeyi 1'e getirir (sessizse dokunmaz). */
export function normalize(buf: Float32Array, peak = 1): Float32Array {
  let m = 0;
  for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
  if (m > 1e-6) {
    const k = peak / m;
    for (let i = 0; i < buf.length; i++) buf[i] *= k;
  }
  return buf;
}

/** Baştaki ve sondaki tıkırtıyı önleyen kısa kenar yumuşatması. */
export function edgeFade(buf: Float32Array, inSec = 0.002, outSec = 0.02): Float32Array {
  const a = samples(inSec);
  const b = samples(outSec);
  for (let i = 0; i < Math.min(a, buf.length); i++) buf[i] *= i / a;
  for (let i = 0; i < Math.min(b, buf.length); i++) buf[buf.length - 1 - i] *= i / b;
  return buf;
}

/** Yumuşak doyum: vuruşlara gövde katar, tepeleri yuvarlar. */
export const drive = (x: number, k: number) => Math.tanh(x * k) / Math.tanh(k);

/** dur saniyelik tamponu fn(t, i) ile doldurur. */
export function render(dur: number, fn: (t: number, i: number) => number): Float32Array {
  const n = samples(dur);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = fn(i / SR, i);
  return out;
}

/** b'yi a'nın içine at saniyesinden itibaren kazançla ekler (a gerekirse uzar). */
export function mixInto(a: Float32Array, b: Float32Array, at: number, gain = 1): Float32Array {
  const off = Math.round(at * SR);
  const need = off + b.length;
  const out = need > a.length ? new Float32Array(need) : a;
  if (out !== a) out.set(a);
  for (let i = 0; i < b.length; i++) out[off + i] += b[i] * gain;
  return out;
}

/**
 * Açık hava yankısı için dürtü yanıtı (stereo, ~1.1 sn): üstel sönen gürültü, zamanla kararan (yüksek
 * frekanslar daha hızlı söner). Bağlamın örnekleme hızında üretilir (ConvolverNode bunu ister).
 */
export function reverbImpulse(sampleRate: number, seconds = 1.1): Float32Array[] {
  const n = Math.round(seconds * sampleRate);
  return [1, 2].map((s) => {
    const r = rng(9100 + s);
    const out = new Float32Array(n);
    let y = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      const a = 1 - Math.exp((-TAU * (6000 * Math.exp(-t / 0.35) + 500)) / sampleRate);
      y += a * (r() * 2 - 1 - y);
      out[i] = y * Math.exp(-t / 0.28) * (i < 0.012 * sampleRate ? 0 : 1);
    }
    return out;
  });
}
