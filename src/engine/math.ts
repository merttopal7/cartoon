export const TAU = Math.PI * 2;

export const clamp = (x: number, min = 0, max = 1) => Math.min(max, Math.max(min, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const deg = (d: number) => (d * Math.PI) / 180;

export const EASES = {
  linear: (t: number) => t,
  in: (t: number) => t * t,
  out: (t: number) => 1 - (1 - t) * (1 - t),
  inOut: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
};
export const easeInOut = EASES.inOut;

/** -π..π aralığına sarar. */
export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** İki açı arasında en kısa yoldan ara değer. */
export const angleLerp = (a: number, b: number, t: number) => a + wrapAngle(b - a) * t;

/**
 * [start, start+duration] aralığında 0→1→0 zarf: başta ve sonda `fade` saniyede
 * yumuşakça açılır/kapanır. Aralık dışında 0.
 */
export function envelope(t: number, start: number, duration: number, fade = 0.25): number {
  if (t < start || t > start + duration) return 0;
  const f = Math.min(fade, duration / 2);
  return easeInOut(clamp((t - start) / f)) * easeInOut(clamp((start + duration - t) / f));
}

/** Deterministik 0..1 sözde rastgele sayı (render her seferinde aynı olsun diye). */
export function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function seedFrom(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h) % 1000;
}
