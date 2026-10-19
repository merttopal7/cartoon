/**
 * Yordamsal müzik için ortak sentez altyapısı (savaş müziği, ana tema). OfflineAudioContext üzerinde:
 * - enstrüman kanalları (kazanç → süzgeçler → pan) → kuru veri yolu (yumuşak kompresör) + yankı gönderimi;
 * - notalar ölçü ölçü, render askıya alınarak kurulur ve iki iş sonra veri yolları kesilir (hepsi baştan grafikte
 *   olunca ya da bitenler bağlı kalınca binlerce düğüm her blokta işlenip sentez gerçek zamandan yavaş kalıyordu);
 * - yankı render sonrası JS'te (Freeverb) eklenir (ConvolverNode çevrimdışı render'da saniyelerce sürüyordu).
 * Tohumlu gürültü ve iş sırası sabit: aynı beste her zaman aynı sesi verir.
 */
import { rng } from '../sfx/dsp';

export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export interface RenderOptions {
  /** Yankının karışımdaki payı */
  wet?: number;
  /** Ortalama güç hedefi (dBFS) */
  rmsDb?: number;
  /**
   * Döngü uzunluğu (sn): render bundan uzunsa taşan kuyruk (son notaların sönümü, yankı) başa eklenir ve tampon
   * bu uzunluğa kesilir; döngü noktasında dikiş duyulmaz.
   */
  loop?: number;
}

export class Synth {
  readonly ctx: OfflineAudioContext;
  readonly r: () => number;
  readonly noise: AudioBuffer;
  private readonly comp: DynamicsCompressorNode;
  private readonly verb: GainNode;
  private readonly inputs = new Map<string, AudioNode>();
  private bus = new Map<string, AudioNode>();
  private readonly jobs: [number, () => void][] = [];

  constructor(
    seconds: number,
    readonly sampleRate: number,
    seed: number,
  ) {
    // 4 kanal: 0–1 kuru karışım, 2–3 yankı gönderimi
    const ctx = new OfflineAudioContext(4, Math.ceil(seconds * sampleRate), sampleRate);
    ctx.destination.channelInterpretation = 'discrete';
    this.ctx = ctx;
    this.r = rng(seed);
    const merger = ctx.createChannelMerger(4);
    merger.connect(ctx.destination);
    const route = (node: AudioNode, first: number) => {
      const split = ctx.createChannelSplitter(2);
      node.connect(split);
      split.connect(merger, 0, first);
      split.connect(merger, 1, first + 1);
    };
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 8;
    this.comp.ratio.value = 3;
    this.comp.attack.value = 0.01;
    this.comp.release.value = 0.2;
    route(this.comp, 0);
    this.verb = ctx.createGain();
    route(this.verb, 2);
    // Tohumlu gürültü (trampet, zil, hi-hat, yükselen ses, nefes)
    this.noise = ctx.createBuffer(1, sampleRate * 2, sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = this.r() * 2 - 1;
  }

  filter(type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  /** Enstrüman kanalı: kazanç → süzgeçler → pan → kuru yol + yankı gönderimi (send oranında). */
  channel(name: string, gain: number, pan: number, send: number, ...filters: BiquadFilterNode[]): void {
    const ctx = this.ctx;
    const input = ctx.createGain();
    input.gain.value = gain;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    let node: AudioNode = input;
    for (const f of filters) node = node.connect(f);
    node.connect(p);
    p.connect(this.comp);
    const s = ctx.createGain();
    s.gain.value = send;
    p.connect(s).connect(this.verb);
    this.inputs.set(name, input);
  }

  /** Kanalın o anki işe ait girişi (notalar buraya bağlanır). */
  out(name: string): AudioNode {
    const node = this.bus.get(name);
    if (!node) throw new Error(`Bilinmeyen müzik kanalı: ${name}`);
    return node;
  }

  /** t anında başlayan notaları kuran iş (ölçü). İşler zaman sırasıyla eklenmelidir. */
  at(t: number, fn: () => void): void {
    this.jobs.push([t, fn]);
  }

  /** Tohumlu gürültüden kısa bir parça (ofset tohumdan; iş sırası sabit olduğundan belirli). */
  noiseAt(t: number, dur: number, dest: AudioNode, env: (g: AudioParam) => void): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    env(g.gain);
    src.connect(g).connect(dest);
    src.start(t, this.r() * (this.noise.duration - dur - 0.01));
    src.stop(t + dur);
  }

  /** Vurmalı zarf: 2 ms atak, decay saniyede sönüm. */
  perc(g: AudioParam, t: number, vel: number, decay: number): void {
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(vel, t + 0.002);
    g.exponentialRampToValueAtTime(0.0008, t + decay);
  }

  private openBus(): Map<string, AudioNode> {
    const bus = new Map<string, AudioNode>();
    for (const [name, input] of this.inputs) {
      const g = this.ctx.createGain();
      g.connect(input);
      bus.set(name, g);
    }
    return bus;
  }

  async render(opts: RenderOptions = {}): Promise<AudioBuffer> {
    const ctx = this.ctx;
    const buses: Map<string, AudioNode>[] = [];
    for (const [t, fn] of this.jobs) {
      const at = t - 0.15;
      const run = () => {
        // İki iş önceki notalar bitti (en uzun nota ~2.5 sn < 2 ölçü): yollarını kes
        const old = buses[buses.length - 2];
        if (old) for (const node of old.values()) node.disconnect();
        this.bus = this.openBus();
        buses.push(this.bus);
        fn();
      };
      if (at <= 0) run();
      else
        void ctx.suspend(at).then(() => {
          run();
          return ctx.resume();
        });
    }
    const quad = await ctx.startRendering();
    const wet = freeverb(quad.getChannelData(2), quad.getChannelData(3), this.sampleRate);
    const mix = [0, 1].map((c) => {
      const d = quad.getChannelData(c);
      const w = wet[c];
      const k = opts.wet ?? 0.3;
      for (let i = 0; i < d.length; i++) d[i] += w[i] * k;
      return d;
    });
    let length = quad.length;
    if (opts.loop) {
      length = Math.min(quad.length, Math.round(opts.loop * this.sampleRate));
      for (const d of mix) for (let i = length; i < d.length; i++) d[i - length] += d[i];
    }
    const out = new AudioBuffer({ numberOfChannels: 2, length, sampleRate: this.sampleRate });
    mix.forEach((d, c) => out.copyToChannel(d.subarray(0, length), c));
    normalize(out, opts.rmsDb ?? -17);
    return out;
  }
}

/**
 * Freeverb (Schroeder–Moorer): kanal başına 8 paralel sönümlü tarak + 4 seri tüm geçiren süzgeç; sağ kanal
 * gecikmeleri 23 örnek kaydırılır (stereo genişlik). ~1.8 sn kuyruk.
 */
function freeverb(inL: Float32Array, inR: Float32Array, sampleRate: number): [Float32Array, Float32Array] {
  const k = sampleRate / 44100;
  const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const ALLPASS = [556, 441, 341, 225];
  const feedback = 0.84;
  const damp = 0.2;
  const run = (input: Float32Array, spread: number) => {
    const n = input.length;
    const out = new Float32Array(n);
    for (const len0 of COMBS) {
      const len = Math.round((len0 + spread) * k);
      const buf = new Float32Array(len);
      let idx = 0;
      let store = 0;
      for (let i = 0; i < n; i++) {
        const y = buf[idx];
        store = y * (1 - damp) + store * damp;
        buf[idx] = input[i] * 0.015 + store * feedback;
        out[i] += y;
        if (++idx >= len) idx = 0;
      }
    }
    for (const len0 of ALLPASS) {
      const len = Math.round((len0 + spread) * k);
      const buf = new Float32Array(len);
      let idx = 0;
      for (let i = 0; i < n; i++) {
        const b = buf[idx];
        const x = out[i];
        buf[idx] = x + b * 0.5;
        out[i] = b - x;
        if (++idx >= len) idx = 0;
      }
    }
    return out;
  };
  return [run(inL, 0), run(inR, 23)];
}

/** Ortalama gücü (RMS) hedefe getirir, tepeyi −1 dBFS'te tutar. */
function normalize(buf: AudioBuffer, rmsDb: number) {
  let sum = 0;
  let peak = 0;
  let n = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      sum += d[i] * d[i];
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
    }
    n += d.length;
  }
  const rms = Math.sqrt(sum / Math.max(1, n));
  if (rms < 1e-6) return;
  const k = Math.min(Math.pow(10, rmsDb / 20) / rms, 0.89 / Math.max(1e-6, peak));
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= k;
  }
}
