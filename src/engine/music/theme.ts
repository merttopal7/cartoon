/**
 * Yordamsal ana tema: telifsiz, belirli, kusursuz döngülü. Sol majör, 4/4, neşeli orman macerası.
 * 32 ölçü: A (melodi: klarnet) → B (marimba karşı ezgisi, el çırpma, pad) → A' (melodiyi bir oktav yukarıdan
 * glockenspiel eşler, davul dolar) → C (ara bölüm: melodi susar, marimba öne çıkar, yarım tempo davul; son ölçüde
 * başa dönen geçiş). Eşlik: tuba benzeri "um-pa" bas ve iki yana açılan pizzicato yaylılar.
 */
import { Synth, mtof } from './synth';

export interface ThemeOptions {
  bpm: number;
}

const BARS = 32;

interface Chord {
  /** Bas kökü (2. oktav) */
  root: number;
  /** Pizzicato ve pad sesleri (orta oktav) */
  tones: [number, number, number];
}

const G: Chord = { root: 43, tones: [59, 62, 67] };
const Em: Chord = { root: 40, tones: [59, 64, 67] };
const C: Chord = { root: 36, tones: [60, 64, 67] };
const D: Chord = { root: 38, tones: [57, 62, 66] };
const Am: Chord = { root: 45, tones: [57, 60, 64] };
const Bm: Chord = { root: 47, tones: [59, 62, 66] };

/** Melodi notası: [8'lik başlangıcı (8 ölçü = 64), 8'lik uzunluğu, MIDI] */
type Note = [number, number, number];

const MELODY_A: Note[] = [
  [0, 1, 74], [1, 1, 71], [2, 2, 67], [4, 1, 71], [5, 1, 74], [6, 2, 79],
  [8, 3, 76], [11, 1, 74], [12, 2, 71], [14, 2, 67],
  [16, 1, 72], [17, 1, 76], [18, 2, 79], [20, 1, 76], [21, 1, 72], [22, 2, 76],
  [24, 4, 74], [30, 1, 69], [31, 1, 71],
  [32, 1, 74], [33, 1, 71], [34, 2, 67], [36, 1, 71], [37, 1, 74], [38, 2, 79],
  [40, 1, 76], [41, 1, 78], [42, 2, 79], [44, 1, 78], [45, 1, 76], [46, 2, 74],
  [48, 2, 72], [50, 1, 69], [51, 1, 71], [52, 2, 72], [54, 2, 76],
  [56, 6, 74],
];

const MELODY_B: Note[] = [
  [0, 2, 79], [2, 2, 76], [4, 2, 72], [6, 2, 76],
  [8, 2, 78], [10, 2, 74], [12, 2, 69], [14, 2, 74],
  [16, 3, 78], [19, 1, 76], [20, 2, 74], [22, 2, 71],
  [24, 4, 76], [28, 2, 79], [30, 2, 76],
  [32, 2, 72], [34, 2, 76], [36, 2, 81], [38, 2, 79],
  [40, 3, 78], [43, 1, 76], [44, 2, 74], [46, 2, 72],
  [48, 2, 71], [50, 2, 74], [52, 4, 79],
  [56, 2, 78], [58, 2, 76], [60, 2, 74], [62, 2, 69],
];

/** C bölümünün son ölçüsünde başa (A'nın ilk notası Re) kromatik çıkış */
const PICKUP: Note[] = [[60, 1, 69], [61, 1, 71], [62, 1, 72], [63, 1, 73]];

const SECTIONS: { name: 'A' | 'B' | "A'" | 'C'; chords: Chord[]; melody: Note[] }[] = [
  { name: 'A', chords: [G, Em, C, D, G, Em, Am, D], melody: MELODY_A },
  { name: 'B', chords: [C, D, Bm, Em, Am, D, G, D], melody: MELODY_B },
  { name: "A'", chords: [G, Em, C, D, G, Em, Am, D], melody: MELODY_A },
  { name: 'C', chords: [Em, C, G, D, Em, C, Am, D], melody: PICKUP },
];

/** Marimba arpejı: akor seslerinden (bir oktav yukarı) 8'lik dizinler */
const ARP = [0, 1, 2, 3, 2, 1, 2, 1];

const cache = new Map<string, Promise<AudioBuffer>>();

export const themeDuration = (bpm: number) => BARS * (240 / bpm);

/** Ana temayı sentezler (aynı parametreler için önbellekten). Tampon tam döngü uzunluğundadır. */
export function renderMainTheme(opts: ThemeOptions = { bpm: 116 }, sampleRate = 44100): Promise<AudioBuffer> {
  const key = `${opts.bpm}|${sampleRate}`;
  let p = cache.get(key);
  if (!p) {
    p = compose(opts.bpm, sampleRate);
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

async function compose(bpm: number, sampleRate: number): Promise<AudioBuffer> {
  const bar = 240 / bpm;
  const e8 = bar / 8;
  const loop = BARS * bar;
  // Son ölçünün sönümü ve yankı kuyruğu için pay; render sonunda başa sarılır
  const S = new Synth(loop + 3, sampleRate, 0x7e3a);
  const ctx = S.ctx;

  S.channel('kick', 0.5, 0, 0.05);
  S.channel('brush', 0.3, 0.1, 0.25, S.filter('bandpass', 2600, 0.6));
  S.channel('shaker', 0.09, 0.35, 0.1, S.filter('highpass', 6500));
  S.channel('clap', 0.26, -0.1, 0.35, S.filter('bandpass', 1300, 0.9));
  S.channel('tom', 0.35, -0.15, 0.3);
  S.channel('bass', 0.2, 0, 0.05, S.filter('lowpass', 520, 0.8));
  S.channel('pizzL', 0.2, -0.35, 0.3, S.filter('highpass', 150), S.filter('lowpass', 2200));
  S.channel('pizzR', 0.2, 0.35, 0.3, S.filter('highpass', 150), S.filter('lowpass', 2200));
  S.channel('lead', 0.3, 0.05, 0.3, S.filter('lowpass', 3200));
  S.channel('glock', 0.12, 0.25, 0.45);
  S.channel('marimba', 0.28, -0.3, 0.3);
  S.channel('pad', 0.06, 0, 0.5, S.filter('lowpass', 1000));

  const osc = (type: OscillatorType, freq: number, t: number, end: number, dest: AudioNode, detune = 0) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    o.connect(dest);
    o.start(t);
    o.stop(end);
    return o;
  };
  const gainNode = (dest: AudioNode) => {
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(dest);
    return g;
  };

  // --- Davul
  const kick = (t: number, vel: number) => {
    const g = gainNode(S.out('kick'));
    S.perc(g.gain, t, vel, 0.28);
    const o = osc('sine', 130, t, t + 0.3, g);
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(52, t + 0.08);
  };
  const brush = (t: number, vel: number) =>
    S.noiseAt(t, 0.25, S.out('brush'), (g) => {
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(vel, t + 0.01);
      g.exponentialRampToValueAtTime(0.0008, t + 0.22);
    });
  const shaker = (t: number, vel: number) =>
    S.noiseAt(t, 0.08, S.out('shaker'), (g) => {
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(vel, t + 0.012);
      g.exponentialRampToValueAtTime(0.0008, t + 0.07);
    });
  const clap = (t: number, vel: number) => {
    for (const d of [0, 0.011, 0.022]) S.noiseAt(t + d, 0.03, S.out('clap'), (g) => S.perc(g, t + d, vel * 0.7, 0.02));
    S.noiseAt(t + 0.03, 0.16, S.out('clap'), (g) => S.perc(g, t + 0.03, vel, 0.13));
  };
  const tom = (t: number, midi: number, vel: number) => {
    const g = gainNode(S.out('tom'));
    S.perc(g.gain, t, vel, 0.3);
    const o = osc('sine', mtof(midi), t, t + 0.32, g);
    o.frequency.setValueAtTime(mtof(midi) * 1.3, t);
    o.frequency.exponentialRampToValueAtTime(mtof(midi), t + 0.05);
  };

  // --- Ezgili çalgılar
  /** Tuba benzeri bas: kare + sinüs, kısa atak, hafif sönüp süren gövde */
  const bass = (t: number, midi: number, dur: number, vel: number) => {
    const g = gainNode(S.out('bass'));
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.012);
    g.gain.linearRampToValueAtTime(vel * 0.65, t + 0.12);
    g.gain.setValueAtTime(vel * 0.65, t + Math.max(0.12, dur - 0.05));
    g.gain.linearRampToValueAtTime(0, t + dur);
    const sq = ctx.createGain();
    sq.gain.value = 0.45;
    sq.connect(g);
    osc('square', mtof(midi), t, t + dur + 0.01, sq);
    osc('sine', mtof(midi), t, t + dur + 0.01, g);
  };
  const pizz = (t: number, midi: number, vel: number, side: 'pizzL' | 'pizzR') => {
    const g = gainNode(S.out(side));
    S.perc(g.gain, t, vel, 0.22);
    osc('sawtooth', mtof(midi), t, t + 0.24, g);
  };
  /** Klarnet benzeri melodi: tek harmonikli kare (yumuşatılmış) + üçgen, uzun notada gecikmeli vibrato */
  const lead = (t: number, midi: number, dur: number, vel: number) => {
    const g = gainNode(S.out('lead'));
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.03);
    g.gain.linearRampToValueAtTime(vel * 0.85, t + 0.12);
    g.gain.setValueAtTime(vel * 0.85, t + Math.max(0.12, dur - 0.06));
    g.gain.linearRampToValueAtTime(0, t + dur);
    const sq = ctx.createGain();
    sq.gain.value = 0.35;
    sq.connect(g);
    const end = t + dur + 0.02;
    const a = osc('square', mtof(midi), t, end, sq);
    const b = osc('triangle', mtof(midi), t, end, g);
    if (dur > 0.4) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5.2;
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(10, t + Math.min(dur, 0.4));
      lfo.connect(depth);
      depth.connect(a.detune);
      depth.connect(b.detune);
      lfo.start(t);
      lfo.stop(end);
    }
  };
  /** Glockenspiel: sinüs + 2.76 katı kısmi (metal çubuk), uzun çınlama */
  const glock = (t: number, midi: number, vel: number) => {
    const g = gainNode(S.out('glock'));
    S.perc(g.gain, t, vel, 1.0);
    osc('sine', mtof(midi), t, t + 1.05, g);
    const p = gainNode(S.out('glock'));
    S.perc(p.gain, t, vel * 0.25, 0.25);
    osc('sine', mtof(midi) * 2.76, t, t + 0.3, p);
  };
  /** Marimba: sinüs + 4 katı kısmi (tahta çubuk), kısa tok sönüm */
  const marimba = (t: number, midi: number, vel: number) => {
    const g = gainNode(S.out('marimba'));
    S.perc(g.gain, t, vel, 0.45);
    osc('sine', mtof(midi), t, t + 0.5, g);
    const p = gainNode(S.out('marimba'));
    S.perc(p.gain, t, vel * 0.18, 0.07);
    osc('sine', mtof(midi) * 4, t, t + 0.1, p);
  };
  const pad = (t: number, tones: number[], dur: number, vel: number) => {
    const g = gainNode(S.out('pad'));
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + Math.min(0.4, dur * 0.4));
    g.gain.setValueAtTime(vel, t + dur * 0.8);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.4);
    for (const m of tones) for (const det of [-8, 8]) osc('sawtooth', mtof(m), t, t + dur + 0.45, g, det);
  };

  for (let b = 0; b < BARS; b++) {
    const t0 = b * bar;
    const sec = SECTIONS[Math.floor(b / 8)];
    const inSec = b % 8;
    const chord = sec.chords[inSec];
    const next = SECTIONS[Math.floor(((b + 1) % BARS) / 8)].chords[(b + 1) % 8];
    const lastOfSec = inSec === 7;
    S.at(t0, () => {
      const bridge = sec.name === 'C';
      // Davul: A hafif, B el çırpmalı, A' dolgun, C yarım tempo; bölüm sonunda kısa geçiş
      if (bridge) {
        kick(t0, 0.75);
        brush(t0 + 4 * e8, 0.55);
      } else {
        kick(t0, 0.85);
        kick(t0 + 4 * e8, 0.7);
        if (sec.name === "A'") kick(t0 + 3 * e8, 0.45);
        brush(t0 + 2 * e8, 0.6);
        if (!lastOfSec) brush(t0 + 6 * e8, 0.6);
        if (sec.name === 'B') {
          clap(t0 + 2 * e8, 0.7);
          clap(t0 + 6 * e8, 0.7);
        }
      }
      const shakeStep = sec.name === "A'" ? e8 / 2 : e8;
      for (let t = 0; t < bar - 1e-6; t += shakeStep) {
        const onBeat = Math.abs((t / e8) % 2) < 1e-6;
        if (!bridge || onBeat) shaker(t0 + t, onBeat ? 0.55 : 0.32);
      }
      if (lastOfSec) {
        // Bölüm geçişi: son yarım ölçüde fırça ve tom tırmanışı (C'nin sonunda başa dönüş)
        [50, 52, 55, 57].forEach((m, j) => tom(t0 + (4 + j) * e8, m, 0.4 + 0.12 * j));
        for (let j = 0; j < 4; j++) brush(t0 + (4 + j) * e8 + e8 / 2, 0.25 + 0.1 * j);
      }

      // Bas: um (1. vuruş kök) – pa (3. vuruş beşli); bölüm sonunda bir sonraki köke yürüyüş
      if (bridge) {
        bass(t0, chord.root, bar * 0.48, 0.85);
        bass(t0 + 4 * e8, chord.root + 7, bar * 0.45, 0.7);
      } else {
        bass(t0, chord.root, e8 * 1.7, 0.9);
        bass(t0 + 4 * e8, chord.root + 7, e8 * 1.7, 0.75);
      }
      if (lastOfSec || inSec === 3) {
        bass(t0 + 6 * e8, next.root - 2, e8 * 0.9, 0.6);
        bass(t0 + 7 * e8, next.root - 1, e8 * 0.9, 0.65);
      }

      // Pizzicato: 2. ve 4. vuruşta akor (pa), A' ve B'de 4'ün "ve"sinde ek vuruş
      if (!bridge) {
        for (const beat of [2, 6]) chord.tones.forEach((m, j) => pizz(t0 + beat * e8 + j * 0.008, m, 0.55, j % 2 ? 'pizzR' : 'pizzL'));
        if (sec.name !== 'A') chord.tones.forEach((m, j) => pizz(t0 + 7 * e8 + j * 0.008, m, 0.35, j % 2 ? 'pizzL' : 'pizzR'));
      }

      // Marimba: B'de yumuşak, C'de öne çıkan 8'lik arpej
      if (sec.name === 'B' || bridge) {
        const tones = [...chord.tones.map((m) => m + 12), chord.tones[0] + 24];
        ARP.forEach((k, j) => marimba(t0 + j * e8, tones[k], (bridge ? 0.75 : 0.45) * (j % 2 ? 0.8 : 1)));
      }
      if (sec.name === 'B' || bridge) pad(t0, chord.tones, bar, bridge ? 0.9 : 0.6);

      // Melodi (ve A''de glockenspiel eşliği)
      for (const [start, len, midi] of sec.melody) {
        if (Math.floor(start / 8) !== inSec) continue;
        const t = t0 + (start % 8) * e8;
        const dur = len * e8 * 0.92;
        lead(t, midi, dur, sec.name === "A'" ? 0.85 : 0.75);
        if (sec.name === "A'") glock(t, midi + 12, 0.6);
      }
    });
  }

  // Ortalama güç eski hazır parçayla (−19.4 dB) aynı: konuşma ve efektlerle denge korunur
  return S.render({ wet: 0.28, rmsDb: -19, loop });
}
