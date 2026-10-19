/**
 * Yordamsal savaş müziği: telifsiz, belirli (aynı ölçüler her zaman aynı sesi verir). Re minör, 4/4.
 * Düzen: hazırlık ölçüleri (taiko, bas pedalı, açılan yaylı ostinato, son ölçüde trampet rulosu ve yükselen
 * gürültü) → ilk isabette tam düzen (davul, bas, 16'lık yaylılar, bakır melodi, pad; 8 ölçülük A/B cümleleri)
 * → son ölçüden sonraki ilk vuruşta kapanış akoru. OfflineAudioContext ile bir kez sentezlenir ve önbelleklenir.
 */
import { Synth, mtof } from './synth';

export interface BattleScore {
  bpm: number;
  /** İlk isabetten önceki hazırlık ölçüleri (0–4). */
  introBars: number;
  /** İlk isabetten kapanış akoruna kadar tam düzen ölçüleri. */
  bodyBars: number;
}

/** Kapanış akorunun ardından sönümlenme payı (sn). */
export const BATTLE_TAIL = 3.2;

export const barLength = (bpm: number) => 240 / bpm;

interface Chord {
  /** Bas kökü (2. oktav civarı) */
  root: number;
  /** Orta oktavda akor sesleri (yaylı ostinato ve pad) */
  tones: [number, number, number];
}

const Dm: Chord = { root: 38, tones: [62, 65, 69] };
const Bb: Chord = { root: 34, tones: [62, 65, 70] };
const F: Chord = { root: 41, tones: [60, 65, 69] };
const C: Chord = { root: 36, tones: [60, 64, 67] };
const Gm: Chord = { root: 43, tones: [62, 67, 70] };
const A: Chord = { root: 33, tones: [61, 64, 69] };

/** Melodi notası: [8'lik başlangıcı (4 ölçü = 32), 8'lik uzunluğu, MIDI] */
type Note = [number, number, number];

const SECTIONS: Record<'A' | 'B', { chords: Chord[]; first: Note[]; second: Note[] }> = {
  A: {
    chords: [Dm, Bb, F, C],
    first: [
      [0, 3, 74], [3, 1, 69], [4, 2, 74], [6, 2, 76],
      [8, 4, 77], [12, 2, 76], [14, 2, 74],
      [16, 3, 72], [19, 1, 69], [20, 2, 72], [22, 2, 77],
      [24, 6, 76], [30, 2, 72],
    ],
    second: [
      [0, 3, 74], [3, 1, 69], [4, 2, 74], [6, 2, 76],
      [8, 4, 77], [12, 2, 76], [14, 2, 74],
      [16, 3, 72], [19, 1, 69], [20, 2, 72], [22, 2, 77],
      [24, 2, 76], [26, 2, 74], [28, 2, 72], [30, 2, 76],
    ],
  },
  B: {
    chords: [Gm, Dm, Bb, A],
    first: [
      [0, 4, 79], [4, 2, 77], [6, 2, 74],
      [8, 3, 77], [11, 1, 76], [12, 4, 74],
      [16, 2, 74], [18, 2, 77], [20, 4, 82],
      [24, 6, 81], [30, 2, 73],
    ],
    second: [
      [0, 4, 79], [4, 2, 77], [6, 2, 74],
      [8, 3, 77], [11, 1, 76], [12, 4, 74],
      [16, 2, 74], [18, 2, 77], [20, 4, 82],
      [24, 2, 81], [26, 2, 79], [28, 2, 76], [30, 2, 73],
    ],
  },
};

/** 16'lık ızgarada davul kalıbı */
const KICK = [0, 6, 8, 11];
const SNARE = [4, 12];
/** Yaylı ostinato: akor seslerinden [kök, üçlü, beşli, oktav] dizinleri */
const OSTINATO = [0, 2, 3, 2, 1, 2, 3, 2, 0, 2, 3, 2, 1, 2, 3, 1];
const BASS = [0, 0, 12, 0, 0, 0, 12, 7];


/** Bir yetenek kullanımı (film zamanı): başlangıç ve isabet anı. */
export interface FightUse {
  start: number;
  impact: number;
}

export interface BattlePlan {
  /** Müziğin başladığı an (hazırlık ölçüleri) */
  start: number;
  /** Kapanış akoru */
  end: number;
  introBars: number;
  bodyBars: number;
}

/** Bir sonraki yetenek bu süreden (sn) uzun aradan sonra başlıyorsa yeni savaş sayılır. */
const FIGHT_GAP = 8;
/** Son isabetten sonra tam düzenin sürdüğü en kısa süre (sn); kapanış akoru ardından ilk ölçü başına düşer. */
const AFTER_LAST_HIT = 1.5;

/**
 * Yetenek kullanımlarını savaşlara ayırır ve her birinin müziğini ölçü ızgarasına oturtur: tam düzenin ilk vuruşu
 * ilk isabete denk gelir; hazırlık ölçüleri ilk yeteneğin başlangıcını kapsar (en çok 4 ölçü, filmin başından önce
 * değil).
 */
export function planBattles(uses: FightUse[], bpm: number, filmDuration: number): BattlePlan[] {
  const bar = barLength(bpm);
  const sorted = [...uses].sort((a, b) => a.start - b.start);
  const groups: FightUse[][] = [];
  for (const u of sorted) {
    const g = groups[groups.length - 1];
    if (g && u.start - Math.max(...g.map((x) => x.impact)) < FIGHT_GAP) g.push(u);
    else groups.push([u]);
  }
  const plans: BattlePlan[] = [];
  for (const g of groups) {
    const firstHit = Math.min(...g.map((u) => u.impact));
    const firstStart = Math.min(...g.map((u) => u.start));
    const lastHit = Math.max(...g.map((u) => u.impact));
    const want = Math.ceil((firstHit - firstStart + 0.3) / bar);
    const introBars = Math.max(0, Math.min(4, want, Math.floor(firstHit / bar)));
    const bodyBars = Math.max(2, Math.ceil((lastHit + AFTER_LAST_HIT - firstHit) / bar));
    const start = firstHit - introBars * bar;
    const prev = plans[plans.length - 1];
    // Bir önceki savaşın kapanışı bitmeden yenisi başlamasın
    if (prev && start < prev.end + BATTLE_TAIL * 0.5) continue;
    if (start >= filmDuration) continue;
    plans.push({ start, end: firstHit + bodyBars * bar, introBars, bodyBars });
  }
  return plans;
}

const cache = new Map<string, Promise<AudioBuffer>>();

/** Savaş müziğinin toplam süresi (sn): hazırlık + tam düzen + kapanış sönümü. */
export function battleDuration(score: BattleScore): number {
  return (score.introBars + score.bodyBars) * barLength(score.bpm) + BATTLE_TAIL;
}

/** Savaş müziğini sentezler (aynı parametreler için önbellekten). */
export function renderBattleMusic(score: BattleScore, sampleRate = 44100): Promise<AudioBuffer> {
  const key = `${score.bpm}|${score.introBars}|${score.bodyBars}|${sampleRate}`;
  let p = cache.get(key);
  if (!p) {
    p = compose(score, sampleRate);
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

async function compose(score: BattleScore, sampleRate: number): Promise<AudioBuffer> {
  const bar = barLength(score.bpm);
  const s16 = bar / 16;
  const total = battleDuration(score);
  const S = new Synth(total, sampleRate, 0xba771e);
  const ctx = S.ctx;
  // Filtre zarfı yerine sabit filtreli iki katman (parlak hızla söner, koyu sürer): frekansı otomasyonlu
  // nota başına süzgeç Chrome'da her örnekte katsayı hesaplatıp sentezi saniyelerce uzatıyordu
  S.channel('kickCh', 0.95, 0, 0.05);
  S.channel('snareCh', 0.55, 0.05, 0.25, S.filter('bandpass', 1900, 0.7));
  S.channel('snareBodyCh', 0.4, 0.05, 0.2);
  S.channel('hatCh', 0.16, 0.25, 0.08, S.filter('highpass', 7200));
  S.channel('tomCh', 0.7, -0.1, 0.35);
  S.channel('crashCh', 0.22, -0.2, 0.4, S.filter('highpass', 3800));
  S.channel('riserCh', 0.16, 0, 0.5);
  S.channel('bassBright', 0.34, 0, 0.04, S.filter('lowpass', 1500, 2));
  S.channel('bassDark', 0.34, 0, 0.04, S.filter('lowpass', 300, 1));
  S.channel('strL', 0.12, -0.45, 0.3, S.filter('highpass', 180), S.filter('lowpass', 2600));
  S.channel('strR', 0.12, 0.45, 0.3, S.filter('highpass', 180), S.filter('lowpass', 2600));
  S.channel('brassBright', 0.17, 0.1, 0.35, S.filter('lowpass', 2900, 1.2));
  S.channel('brassDark', 0.17, 0.1, 0.35, S.filter('lowpass', 1500, 0.9));
  S.channel('padCh', 0.075, 0, 0.45, S.filter('lowpass', 1150));
  const filter = S.filter.bind(S);
  const noiseAt = S.noiseAt.bind(S);
  const perc = S.perc.bind(S);
  const noise = S.noise;

  // --- Enstrümanlar
  const kick = (t: number, vel: number) => {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(155, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.13);
    const g = ctx.createGain();
    perc(g.gain, t, vel, 0.42);
    o.connect(g).connect(S.out('kickCh'));
    o.start(t);
    o.stop(t + 0.45);
  };
  const snare = (t: number, vel: number) => {
    noiseAt(t, 0.2, S.out('snareCh'), (g) => perc(g, t, vel, 0.18));
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(160, t + 0.08);
    const g = ctx.createGain();
    perc(g.gain, t, vel * 0.8, 0.1);
    o.connect(g).connect(S.out('snareBodyCh'));
    o.start(t);
    o.stop(t + 0.12);
  };
  const hat = (t: number, vel: number) => noiseAt(t, 0.06, S.out('hatCh'), (g) => perc(g, t, vel, 0.045));
  const tom = (t: number, midi: number, vel: number, decay = 0.55) => {
    const o = ctx.createOscillator();
    const f0 = mtof(midi);
    o.frequency.setValueAtTime(f0 * 1.5, t);
    o.frequency.exponentialRampToValueAtTime(f0, t + 0.04);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.8, t + decay);
    const g = ctx.createGain();
    perc(g.gain, t, vel, decay);
    o.connect(g).connect(S.out('tomCh'));
    o.start(t);
    o.stop(t + decay + 0.02);
    noiseAt(t, 0.08, S.out('tomCh'), (gn) => perc(gn, t, vel * 0.12, 0.06));
  };
  const crash = (t: number, vel: number) => noiseAt(t, 1.95, S.out('crashCh'), (g) => perc(g, t, vel, 1.9));
  const riser = (t0: number, t1: number) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const bp = filter('bandpass', 300, 2.5);
    bp.frequency.setValueAtTime(300, t0);
    bp.frequency.exponentialRampToValueAtTime(6500, t1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.9, t1 - 0.02);
    g.gain.linearRampToValueAtTime(0, t1);
    src.connect(bp).connect(g).connect(S.out('riserCh'));
    src.start(t0);
    src.stop(t1);
  };
  const bass = (t: number, midi: number, dur: number, vel: number) => {
    const end = t + dur;
    const dark = ctx.createGain();
    dark.gain.setValueAtTime(0, t);
    dark.gain.linearRampToValueAtTime(vel, t + 0.005);
    dark.gain.setValueAtTime(vel, t + dur * 0.85);
    dark.gain.linearRampToValueAtTime(0, end);
    dark.connect(S.out('bassDark'));
    const bright = ctx.createGain();
    perc(bright.gain, t, vel * 0.9, Math.min(dur, 0.16));
    bright.connect(S.out('bassBright'));
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.value = mtof(midi);
    saw.connect(dark);
    saw.connect(bright);
    const sub = ctx.createOscillator();
    sub.frequency.value = mtof(midi) * 0.5;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.8;
    sub.connect(subGain).connect(dark);
    for (const o of [saw, sub]) {
      o.start(t);
      o.stop(end + 0.01);
    }
  };
  const string = (t: number, midi: number, vel: number, dest: AudioNode) => {
    const g = ctx.createGain();
    perc(g.gain, t, vel, s16 * 2.2);
    g.connect(dest);
    for (const det of [-7, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = mtof(midi);
      o.detune.value = det;
      o.connect(g);
      o.start(t);
      o.stop(t + s16 * 2.3);
    }
  };
  const brass = (t: number, midi: number, dur: number, vel: number) => {
    // Gövde (orta parlaklık) yavaşça açılır ve sürer; parlak katman yalnızca atakta (bakırın "blat"ı)
    const body = ctx.createGain();
    body.gain.setValueAtTime(0, t);
    body.gain.linearRampToValueAtTime(vel * 0.8, t + 0.06);
    body.gain.setValueAtTime(vel * 0.8, t + Math.max(0.06, dur - 0.08));
    body.gain.linearRampToValueAtTime(0, t + dur + 0.06);
    body.connect(S.out('brassDark'));
    const blat = ctx.createGain();
    blat.gain.setValueAtTime(0, t);
    blat.gain.linearRampToValueAtTime(vel * 0.7, t + 0.05);
    blat.gain.linearRampToValueAtTime(vel * 0.15, t + 0.28);
    blat.gain.setValueAtTime(vel * 0.15, t + Math.max(0.28, dur - 0.08));
    blat.gain.linearRampToValueAtTime(0, t + dur + 0.06);
    blat.connect(S.out('brassBright'));
    const lp = ctx.createGain();
    lp.connect(body);
    lp.connect(blat);
    // Uzun notada gecikmeli vibrato
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.4;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(dur > 0.5 ? 9 : 0, t + Math.min(dur, 0.45));
    lfo.connect(depth);
    for (const det of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = mtof(midi);
      o.detune.value = det;
      depth.connect(o.detune);
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.08);
    }
    lfo.start(t);
    lfo.stop(t + dur + 0.08);
  };
  const pad = (t: number, tones: number[], dur: number, vel: number) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + Math.min(0.5, dur * 0.4));
    g.gain.setValueAtTime(vel, t + dur * 0.8);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.4);
    g.connect(S.out('padCh'));
    for (const m of tones) {
      for (const det of [-9, 9]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(m);
        o.detune.value = det;
        o.connect(g);
        o.start(t);
        o.stop(t + dur + 0.45);
      }
    }
  };

  const ostinato = (t0: number, chord: Chord, vel: (k: number) => number) => {
    const pitches = [...chord.tones, chord.tones[0] + 12];
    for (let k = 0; k < 16; k++) {
      string(t0 + k * s16, pitches[OSTINATO[k]], vel(k) * (k % 4 === 0 ? 1 : 0.75), k % 2 === 0 ? S.out('strL') : S.out('strR'));
    }
  };
  const bassBar = (t0: number, root: number, vel: number) => {
    for (let k = 0; k < 8; k++) bass(t0 + k * 2 * s16, root + BASS[k], s16 * 1.8, vel * (k % 2 === 0 ? 1 : 0.8));
  };


  // --- Hazırlık: taiko, bas pedalı, açılan ostinato; son ölçüde trampet rulosu ve yükselen ses
  for (let i = 0; i < score.introBars; i++) {
    const t0 = i * bar;
    S.at(t0, () => {
      const k = (i + 1) / score.introBars;
      const quiet = score.introBars >= 3 && i === 0;
      // Hazırlık tam düzenden belirgin kısık başlar ve giderek yükselir; ilk isabette tam düzen patlar
      const k2 = k * k;
      tom(t0, 38, 0.4 + 0.4 * k2, 0.9);
      tom(t0 + 8 * s16, 38, 0.3 + 0.4 * k2, 0.8);
      if (!quiet) {
        tom(t0 + 14 * s16, 45, 0.25 + 0.3 * k2, 0.4);
        bassBar(t0, Dm.root, 0.15 + 0.35 * k2);
        ostinato(t0, Dm, (n) => (0.1 + 0.32 * k2) * (0.7 + 0.3 * (n / 16)));
      }
      pad(t0, [50, 57, 62], bar, 0.25 + 0.3 * k2);
      if (i === score.introBars - 1) {
        for (let n = 0; n < 16; n++) snare(t0 + n * s16, 0.12 + 0.55 * (n / 15));
        for (let n = 0; n < 8; n++) snare(t0 + (8 + n) * s16 + s16 / 2, 0.15 + 0.5 * (n / 7));
        riser(t0, t0 + bar);
      }
    });
  }

  // --- Tam düzen (ilk isabet = ilk vuruş)
  const body0 = score.introBars * bar;
  for (let b = 0; b < score.bodyBars; b++) {
    const t0 = body0 + b * bar;
    S.at(t0, () => {
      const phrase = Math.floor(b / 8);
      const inPhrase = b % 8;
      const sec = SECTIONS[phrase % 2 === 0 ? 'A' : 'B'];
      const chord = sec.chords[inPhrase % 4];
      const last = b === score.bodyBars - 1;
      const fill = inPhrase === 7 || last;

      if (inPhrase === 0) {
        crash(t0, 1);
        tom(t0, 36, 1, 1.0);
      }
      for (const n of KICK) if (!(fill && n >= 8)) kick(t0 + n * s16, n === 0 ? 1 : 0.85);
      for (const n of SNARE) if (!(fill && n >= 8)) snare(t0 + n * s16, 0.85);
      if (!fill) snare(t0 + 14 * s16, 0.22);
      for (let n = 0; n < 16; n += 2) if (!(fill && n >= 8)) hat(t0 + n * s16, n % 4 === 0 ? 0.42 : 0.26);
      if (fill) {
        // Cümle sonu: ikinci yarıda inen tom geçişi (son ölçüde kapanışa tırmanan rulo)
        const toms = last ? [45, 45, 45, 45, 47, 47, 48, 48] : [52, 52, 50, 50, 47, 47, 43, 43];
        toms.forEach((m, j) => tom(t0 + (8 + j) * s16, m, 0.55 + 0.4 * (j / 7), 0.35));
        if (last) for (let n = 0; n < 8; n++) snare(t0 + (8 + n) * s16 + s16 / 2, 0.2 + 0.6 * (n / 7));
      }

      bassBar(t0, chord.root, 0.8);
      ostinato(t0, chord, () => 0.62);
      pad(t0, chord.tones.map((m) => m - 12), bar, 0.8);

      const notes = inPhrase < 4 ? sec.first : sec.second;
      const vel = phrase === 0 ? 0.6 : 0.75;
      for (const [start, len, midi] of notes) {
        const barOf = Math.floor(start / 8);
        if (barOf !== inPhrase % 4) continue;
        const t = t0 + (start - barOf * 8) * 2 * s16;
        const dur = len * 2 * s16 * 0.94;
        brass(t, midi, dur, vel);
        if (phrase > 0) brass(t, midi - 12, dur, vel * 0.55);
      }
    });
  }

  // --- Kapanış akoru (son ölçüden sonraki ilk vuruş)
  const end = body0 + score.bodyBars * bar;
  S.at(end, () => {
    crash(end, 1);
    kick(end, 1);
    tom(end, 36, 1, 1.6);
    tom(end, 43, 0.6, 1.2);
    bass(end, Dm.root, 1.6, 0.9);
    bass(end, Dm.root - 12, 1.6, 0.6);
    for (const m of [62, 69, 74]) brass(end, m, 1.25, 0.6);
    pad(end, [50, 57, 62, 65], 1.6, 0.9);
  });

  return S.render({ wet: 0.3, rmsDb: -17 });
}
