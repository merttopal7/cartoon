/**
 * Web Audio timeline playback & synchronization for cartoon dialogues.
 */
import { clamp01, reverbImpulse } from './sfx/dsp';
import { renderMainTheme } from './music/theme';
import type { AmbienceCue, SfxCue } from './sfx/cues';

/** Önizlemede efektlerin önceden zamanlandığı pencere (sn): kare atlansa da ses tam anında çalar. */
const SFX_LOOKAHEAD = 0.25;
/** Konuşma sırasında ortam sesinin kısıldığı oran. */
const AMBIENCE_DUCK = 0.55;
/** Ortam sesinin sahne başında/sonunda açılıp kapanma süresi (sn). */
const AMBIENCE_EDGE = 0.8;
/** Ana temanın savaş müziğine geçerken kısılma ve savaştan sonra geri gelme süreleri (sn). */
const BATTLE_MAIN_OUT = 1.4;
const BATTLE_MAIN_BACK = 2.4;
/** Savaş müziği konuşmada en fazla bu orana kısılır (ana temadan hafif: savaşın gerilimi düşmesin). */
const BATTLE_DUCK = 0.5;

export interface AudioCue {
  id: string;
  who: string;
  text?: string;
  url: string;
  start: number;     // Absolute film time in seconds
  duration: number;  // Duration in seconds
  buffer?: AudioBuffer;
  rms?: Float32Array;
  rmsFps?: number;
  activeStart?: number;
  activeEnd?: number;
}

export interface MusicConfig {
  src: string;
  volume: number;       // 0 - 1, varsayılan 0.35
  loop: boolean;        // varsayılan true
  ducking: number;      // 0 - 1, konuşma anında müzik seviye katsayısı (varsayılan 0.25)
  fadeIn: number;       // saniye (varsayılan 1.0)
  fadeOut: number;      // saniye (varsayılan 1.5)
  start: number;        // saniye (varsayılan 0)
  enabled: boolean;     // varsayılan true
}

/** Bir savaşın müziği: tampon `start` anında başlar; `end` kapanış akorudur, ana tema ardından geri gelir. */
export interface BattleMusicSegment {
  buffer: AudioBuffer;
  start: number;
  end: number;
  volume: number;
}

export class AudioTimeline {
  private ctx: AudioContext | null = null;
  private cues: AudioCue[] = [];
  private activeSources = new Map<string, AudioBufferSourceNode>();
  /**
   * Bu oynatmada (son aramadan beri) başlatılmış replikler: biten bir replik, film saati replik bitişine henüz
   * varmadıysa yeniden başlatılmaz (eskiden sonu tekrar çalıyordu).
   */
  private readonly cuePlayed = new Set<string>();
  /** Sonraki update bir arama (seek) sayılsın: tüm sesler o andan yeniden kurulur. */
  private seekPending = false;
  private masterGain: GainNode | null = null;
  private musicGainNode: GainNode | null = null;
  private musicSource: AudioBufferSourceNode | null = null;
  private musicBuffer: AudioBuffer | null = null;
  private musicLoadingUrl: string | null = null;
  private musicFallback: string | null = null;
  private filmDuration = 0;
  private volume = 1.0;
  private isMuted = false;
  private isPlaying = false;
  private lastTime = 0;
  private leadIn = 0.70;  // Varsayılan: ses başlamadan 700ms önce
  private leadOut = 0.70; // Varsayılan: ses bitmeden 700ms önce

  /** Ses efektleri (yetenekler, ayak sesleri, yazılar); konuşma sayılmaz (ducking ve ağız hareketi yok). */
  private sfxCues: SfxCue[] = [];
  private ambienceCues: AmbienceCue[] = [];
  private sfxInput: GainNode | null = null;
  private readonly sfxSources = new Map<string, AudioBufferSourceNode>();
  /** Bu oynatmada zamanlanmış efektler (atlama/durdurmada sıfırlanır; aynı efekt iki kez çalmasın). */
  private readonly sfxPlayed = new Set<string>();
  private readonly ambSources = new Map<AmbienceCue, { src: AudioBufferSourceNode; gain: GainNode }>();
  private battle: BattleMusicSegment[] = [];
  private readonly battleSources = new Map<BattleMusicSegment, AudioBufferSourceNode>();
  private battleGainNode: GainNode | null = null;

  private musicConfig: MusicConfig = {
    src: 'procedural:main',
    volume: 0.35,
    loop: true,
    ducking: 0.25,
    fadeIn: 1.0,
    fadeOut: 1.5,
    start: 0,
    enabled: true,
  };

  setFilmDuration(duration: number): void {
    this.filmDuration = duration;
  }

  getFilmDuration(): number {
    return this.filmDuration;
  }

  getMusicConfig(): MusicConfig {
    return { ...this.musicConfig };
  }

  getMusicBuffer(): AudioBuffer | null {
    return this.musicBuffer;
  }

  /** Savaş müziklerini ayarlar (film derlenirken). */
  setBattleMusic(segments: BattleMusicSegment[]): void {
    this.stopBattle();
    this.battle = [...segments].sort((a, b) => a.start - b.start);
  }

  getBattleMusic(): BattleMusicSegment[] {
    return this.battle;
  }

  /** Ana temanın t anındaki savaş payı çarpanı: savaş girerken kısılır, kapanış akorundan sonra geri gelir. */
  private mainThemeMix(t: number): number {
    let k = 1;
    for (const b of this.battle) {
      const out = clamp01((t - (b.start - 0.4)) / BATTLE_MAIN_OUT);
      const back = clamp01((t - (b.end + 0.6)) / BATTLE_MAIN_BACK);
      k *= 1 - out * (1 - back);
    }
    return k;
  }

  /** Savaş müziğinin t anındaki kazancı (konuşmada hafif kısılır, film sonunda söner). */
  getBattleGainAt(segment: BattleMusicSegment, t: number): number {
    if (!this.musicConfig.enabled) return 0;
    if (t < segment.start || t >= segment.start + segment.buffer.duration) return 0;
    let g = segment.volume * clamp01((t - segment.start) / 0.05);
    if (this.isVoiceActive(t)) g *= Math.max(this.musicConfig.ducking, BATTLE_DUCK);
    const fadeOut = this.musicConfig.fadeOut;
    if (this.filmDuration > 0 && fadeOut > 0) g *= clamp01((this.filmDuration - t) / fadeOut);
    return g;
  }

  private getBattleGainNode(): GainNode {
    const ctx = this.getContext();
    if (!this.battleGainNode) {
      this.battleGainNode = ctx.createGain();
      this.battleGainNode.gain.value = 0;
      this.battleGainNode.connect(this.getMasterGain());
    }
    return this.battleGainNode;
  }

  /** Savaş müziğini t anına göre başlatır/durdurur ve kazancını günceller. */
  private updateBattle(time: number, jumped: boolean) {
    if (jumped) this.stopBattle();
    const ctx = this.getContext();
    let gain = 0;
    for (const seg of this.battle) {
      const inside = this.musicConfig.enabled && time >= seg.start && time < seg.start + seg.buffer.duration;
      const playing = this.battleSources.get(seg);
      if (inside && !playing) {
        const src = ctx.createBufferSource();
        src.buffer = seg.buffer;
        src.connect(this.getBattleGainNode());
        src.start(0, time - seg.start);
        this.battleSources.set(seg, src);
      } else if (!inside && playing) {
        this.stopBattleSource(seg);
      }
      gain = Math.max(gain, this.getBattleGainAt(seg, time));
    }
    if (this.battleGainNode) this.battleGainNode.gain.setTargetAtTime(gain, ctx.currentTime, 0.03);
  }

  private stopBattleSource(seg: BattleMusicSegment) {
    const src = this.battleSources.get(seg);
    if (!src) return;
    try {
      src.stop();
      src.disconnect();
    } catch {}
    this.battleSources.delete(seg);
  }

  private stopBattle() {
    for (const seg of [...this.battleSources.keys()]) this.stopBattleSource(seg);
  }

  setSyncTiming(leadInMs: number, leadOutMs: number): void {
    this.leadIn = Math.max(0, leadInMs / 1000);
    this.leadOut = Math.max(0, leadOutMs / 1000);
  }

  getSyncTiming(): { leadInMs: number; leadOutMs: number } {
    return {
      leadInMs: Math.round(this.leadIn * 1000),
      leadOutMs: Math.round(this.leadOut * 1000),
    };
  }

  private getContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private getMasterGain(): GainNode {
    const ctx = this.getContext();
    if (!this.masterGain) {
      this.masterGain = ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : this.volume, ctx.currentTime);
      this.masterGain.connect(createLimiter(ctx, ctx.destination));
    }
    return this.masterGain;
  }

  private getMusicGainNode(): GainNode {
    const ctx = this.getContext();
    if (!this.musicGainNode) {
      this.musicGainNode = ctx.createGain();
      this.musicGainNode.gain.setValueAtTime(this.musicConfig.volume, ctx.currentTime);
      this.musicGainNode.connect(this.getMasterGain());
    }
    return this.musicGainNode;
  }

  /** Ses efektlerini ve ortam seslerini ayarlar (film derlenirken). */
  setSfx(cues: SfxCue[], ambience: AmbienceCue[]): void {
    this.stopSfx();
    this.sfxCues = [...cues].sort((a, b) => a.start - b.start);
    this.ambienceCues = ambience;
  }

  getSfxCues(): SfxCue[] {
    return this.sfxCues;
  }

  hasSfx(): boolean {
    return this.sfxCues.length > 0 || this.ambienceCues.length > 0;
  }

  /**
   * Efekt kanalı: hafif açık hava yankısı + tepe sınırlayıcı (aynı anda çok efekt üst üste binince
   * patlamasın). Konuşma ve müzik bu kanaldan geçmez, seviyeleri değişmez.
   */
  private createSfxChain(ctx: BaseAudioContext, dest: AudioNode): GainNode {
    const input = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 6;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    const verb = ctx.createConvolver();
    const ir = reverbImpulse(ctx.sampleRate);
    const irBuf = ctx.createBuffer(2, ir[0].length, ctx.sampleRate);
    ir.forEach((c, i) => irBuf.copyToChannel(c, i));
    verb.buffer = irBuf;
    const wet = ctx.createGain();
    wet.gain.value = 0.18;
    input.connect(comp);
    input.connect(verb);
    verb.connect(wet);
    wet.connect(comp);
    comp.connect(dest);
    return input;
  }

  private getSfxInput(): GainNode {
    if (!this.sfxInput) this.sfxInput = this.createSfxChain(this.getContext(), this.getMasterGain());
    return this.sfxInput;
  }

  /** Ortam sesinin t anındaki kazancı: sahne kenarlarında açılıp kapanır, konuşmada kısılır, film sonunda söner. */
  private ambienceGainAt(cue: AmbienceCue, t: number): number {
    if (t < cue.start || t >= cue.end) return 0;
    let g = cue.gain * Math.min(1, (t - cue.start) / AMBIENCE_EDGE, (cue.end - t) / AMBIENCE_EDGE) * (cue.level ? cue.level(t) : 1);
    if (this.isVoiceActive(t)) g *= AMBIENCE_DUCK;
    const fadeOut = this.musicConfig.fadeOut;
    if (this.filmDuration > 0 && fadeOut > 0) g *= Math.max(0, Math.min(1, (this.filmDuration - t) / fadeOut));
    return Math.max(0, g);
  }

  private playSfx(cue: SfxCue, when: number, offset: number) {
    const ctx = this.getContext();
    const src = ctx.createBufferSource();
    src.buffer = cue.buffer;
    const gain = ctx.createGain();
    const pan = ctx.createStereoPanner();
    applyCueParams(cue, gain, pan, when, offset);
    src.connect(gain);
    gain.connect(pan);
    pan.connect(this.getSfxInput());
    src.onended = () => {
      if (this.sfxSources.get(cue.id) === src) this.sfxSources.delete(cue.id);
      try {
        pan.disconnect();
      } catch {}
    };
    src.start(when, offset);
    this.sfxSources.set(cue.id, src);
    this.sfxPlayed.add(cue.id);
  }

  /** Efektleri önceden zamanlar, ortam döngülerini açar/kapatır. jumped: zaman sıçradı (seek). */
  private updateSfx(time: number, jumped: boolean) {
    const ctx = this.getContext();
    if (jumped) this.stopSfx();
    const now = ctx.currentTime;
    for (const cue of this.sfxCues) {
      if (cue.start > time + SFX_LOOKAHEAD) break;
      if (this.sfxPlayed.has(cue.id) || cue.start + cue.buffer.duration <= time) continue;
      const delay = cue.start - time;
      this.playSfx(cue, now + Math.max(0, delay), Math.max(0, -delay));
    }
    for (const cue of this.ambienceCues) {
      const inside = time >= cue.start && time < cue.end;
      const playing = this.ambSources.get(cue);
      if (inside && !playing) {
        const src = ctx.createBufferSource();
        src.buffer = cue.buffer;
        src.loop = true;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        src.connect(gain);
        gain.connect(this.getMasterGain());
        src.start(0, (time - cue.start) % cue.buffer.duration);
        this.ambSources.set(cue, { src, gain });
      } else if (!inside && playing) {
        this.stopAmbience(cue);
      }
      const p = this.ambSources.get(cue);
      if (p) p.gain.gain.setTargetAtTime(this.ambienceGainAt(cue, time), now, 0.08);
    }
  }

  private stopAmbience(cue: AmbienceCue) {
    const p = this.ambSources.get(cue);
    if (!p) return;
    try {
      p.src.stop();
      p.src.disconnect();
      p.gain.disconnect();
    } catch {}
    this.ambSources.delete(cue);
  }

  private stopSfx() {
    for (const src of this.sfxSources.values()) {
      try {
        src.stop();
        src.disconnect();
      } catch {}
    }
    this.sfxSources.clear();
    this.sfxPlayed.clear();
    for (const cue of [...this.ambSources.keys()]) this.stopAmbience(cue);
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.volume > 0) {
      this.isMuted = false;
    }
    this.applyGain();
  }

  getVolume(): number {
    return this.volume;
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    this.applyGain();
  }

  toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    this.applyGain();
    return this.isMuted;
  }

  getMuted(): boolean {
    return this.isMuted;
  }

  private applyGain(): void {
    if (this.masterGain && this.ctx) {
      const targetGain = this.isMuted ? 0 : this.volume;
      this.masterGain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.02);
    }
  }

  async loadMusic(config?: Partial<MusicConfig>): Promise<void> {
    if (config) {
      this.musicConfig = { ...this.musicConfig, ...config };
    }
    const src = this.musicConfig.src;
    if (!src) return;

    if (this.musicBuffer && this.musicLoadingUrl === src) return;
    this.musicLoadingUrl = src;
    this.musicFallback = null;

    try {
      if (src.startsWith('procedural:')) {
        // Yordamsal ana tema (telifsiz; kod içinde sentezlenir, kusursuz döngü)
        this.musicBuffer = await renderMainTheme();
        return;
      }
      const res = await fetch(src);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ab = await res.arrayBuffer();
      const ctx = this.getContext();
      this.musicBuffer = await ctx.decodeAudioData(ab);
    } catch (err) {
      // Dosya yoksa (ör. silinmiş eski parça) film sessiz kalmasın: yordamsal ana temaya dönülür
      console.warn(`[AudioTimeline] Arkaplan müziği yüklenemedi, ana tema çalınıyor: ${src}`, err);
      this.musicFallback = src;
      try {
        this.musicBuffer = await renderMainTheme();
      } catch {
        this.musicBuffer = null;
      }
    }
  }

  /** Senaryodaki müzik dosyası yüklenemediyse o dosyanın yolu (yerine ana tema çalınıyor). */
  getMusicFallback(): string | null {
    return this.musicFallback;
  }

  setMusicConfig(partial: Partial<MusicConfig>): void {
    const prevSrc = this.musicConfig.src;
    this.musicConfig = { ...this.musicConfig, ...partial };
    if (partial.src && partial.src !== prevSrc) {
      this.loadMusic();
    }
    if (this.musicGainNode && this.ctx) {
      const gain = this.getMusicGainAt(this.lastTime);
      this.musicGainNode.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.05);
    }
  }

  /** Karakterlerin t anında aktif bir şekilde ses çıkarıp çıkarmadığını kontrol eder */
  isVoiceActive(filmTime: number): boolean {
    for (const cue of this.cues) {
      const soundStart = cue.start + (cue.activeStart ?? 0);
      const soundEnd = cue.start + (cue.activeEnd ?? cue.duration);
      if (filmTime >= soundStart - 0.08 && filmTime <= soundEnd + 0.08) {
        return true;
      }
    }
    return false;
  }

  /**
   * t anındaki arkaplan müziği ses kazancını (ducking, fade-in, fade-out dahil) hesaplar.
   */
  getMusicGainAt(filmTime: number): number {
    if (!this.musicConfig.enabled || this.musicConfig.volume <= 0) return 0;

    let gain = this.musicConfig.volume;

    // 1. Ducking (karakter konuşuyorsa müzik seviyesini kıs)
    if (this.isVoiceActive(filmTime)) {
      gain *= this.musicConfig.ducking;
    }

    // 2. Fade In (başta yumuşak açılış)
    if (this.musicConfig.fadeIn > 0 && filmTime < this.musicConfig.fadeIn) {
      gain *= Math.max(0, filmTime / this.musicConfig.fadeIn);
    }

    // 3. Fade Out (sonda yumuşak kapanış)
    if (this.filmDuration > 0 && this.musicConfig.fadeOut > 0) {
      const endOffset = this.filmDuration - filmTime;
      if (endOffset < this.musicConfig.fadeOut) {
        gain *= Math.max(0, endOffset / this.musicConfig.fadeOut);
      }
    }

    // 4. Savaş müziği çalarken ana tema çekilir
    gain *= this.mainThemeMix(filmTime);

    return Math.max(0, Math.min(1, gain));
  }

  /** Senaryodaki tüm seslendirme eylemlerini yükler ve zaman çizelgesine dizer. */
  async load(cues: Omit<AudioCue, 'buffer'>[]): Promise<void> {
    this.stop();
    this.cues = cues;
    const ctx = this.getContext();

    await Promise.all(
      this.cues.map(async (cue) => {
        try {
          const res = await fetch(cue.url);
          if (!res.ok) return;
          const ab = await res.arrayBuffer();
          cue.buffer = await ctx.decodeAudioData(ab);
          if (cue.buffer) {
            cue.duration = cue.buffer.duration;
            const data = cue.buffer.getChannelData(0);
            const fps = 50; // 50 Hz çözünürlük (her 20 ms'de 1 örnek)
            const step = Math.floor(cue.buffer.sampleRate / fps);
            const frameCount = Math.floor(data.length / step);
            const rms = new Float32Array(frameCount);
            let firstActive = -1;
            let lastActive = -1;
            for (let f = 0; f < frameCount; f++) {
              let sum = 0;
              const startIdx = f * step;
              const endIdx = Math.min(data.length, startIdx + step);
              for (let s = startIdx; s < endIdx; s++) {
                sum += data[s] * data[s];
              }
              const val = Math.sqrt(sum / (endIdx - startIdx));
              rms[f] = val;
              if (val > 0.005) {
                if (firstActive === -1) firstActive = f;
                lastActive = f;
              }
            }
            cue.rms = rms;
            cue.rmsFps = fps;
            cue.activeStart = firstActive >= 0 ? Math.max(0, (firstActive / fps) - 0.02) : 0;
            cue.activeEnd = lastActive >= 0 ? Math.min(cue.duration, (lastActive / fps) + 0.04) : cue.duration;
          }
        } catch (e) {
          console.warn(`Ses yüklenemedi: ${cue.url}`, e);
        }
      }),
    );
  }

  /**
   * Önizlemenin ana saati (sn): ses bağlamının saati. Oynatırken film zamanı buna bağlanır; görüntü yavaş çizilse de
   * (render modu) ses ile görüntü ayrışmaz. Ses bağlamı henüz yoksa null.
   */
  clock(): number | null {
    return this.ctx ? this.ctx.currentTime : null;
  }

  /** Zaman dışarıdan değişti (arama, döngü başı): sonraki update tüm sesleri o andan yeniden kurar. */
  seek(): void {
    this.seekPending = true;
  }

  /** Oynatma döngüsünde her karede çağrılır (zamanı takip edip sesleri tetikler). */
  update(time: number, playing: boolean) {
    if (!playing) {
      if (this.isPlaying) this.stop();
      this.isPlaying = false;
      this.lastTime = time;
      return;
    }

    const ctx = this.getContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    // Arama: açıkça bildirilen arama, oynatmanın başı, geriye gidiş ya da çok büyük sıçrama. Film zamanı ses saatine
    // bağlı olduğundan yavaş çizilen bir kare (0.35 sn'den uzun) arama sayılmaz; eskiden tüm sesler baştan kuruluyordu.
    const jumped = this.seekPending || !this.isPlaying || time < this.lastTime - 0.05 || time - this.lastTime > 2;
    this.seekPending = false;
    this.isPlaying = true;
    this.lastTime = time;

    if (jumped) {
      this.stop();
      // O anda çalması gereken sesleri doğru ofsetten başlat
      for (const cue of this.cues) {
        if (!cue.buffer) continue;
        if (time >= cue.start && time < cue.start + cue.duration) {
          const offset = time - cue.start;
          this.playCue(cue, offset);
        }
      }
      this.startMusicAt(time);
      this.updateSfx(time, true);
      this.updateBattle(time, true);
      return;
    }

    this.updateSfx(time, false);
    this.updateBattle(time, false);

    // Normal akış: başlangıç anı bu kareye denk gelen sesleri başlat
    for (const cue of this.cues) {
      if (!cue.buffer) continue;
      if (time >= cue.start && time < cue.start + cue.duration) {
        if (!this.activeSources.has(cue.id) && !this.cuePlayed.has(cue.id)) {
          const offset = Math.max(0, time - cue.start);
          this.playCue(cue, offset);
        }
      } else {
        if (this.activeSources.has(cue.id)) {
          this.stopCue(cue.id);
        }
      }
    }

    // Müzik devamlılığı ve dinamik ducking
    if (this.musicConfig.enabled && this.musicBuffer) {
      if (!this.musicSource) {
        this.startMusicAt(time);
      }
      if (this.musicGainNode && this.ctx) {
        const targetGain = this.getMusicGainAt(time);
        this.musicGainNode.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.04);
      }
    } else if (this.musicSource) {
      this.stopMusic();
    }
  }

  private startMusicAt(time: number) {
    if (!this.musicConfig.enabled || !this.musicBuffer) return;
    this.stopMusic();
    const ctx = this.getContext();
    const src = ctx.createBufferSource();
    src.buffer = this.musicBuffer;
    src.loop = this.musicConfig.loop;
    src.connect(this.getMusicGainNode());

    const relTime = time - this.musicConfig.start;
    if (relTime < 0) {
      return;
    }
    const offset = this.musicConfig.loop ? (relTime % this.musicBuffer.duration) : relTime;
    if (offset < this.musicBuffer.duration) {
      src.start(0, offset);
      this.musicSource = src;
    }
  }

  private stopMusic() {
    if (this.musicSource) {
      try {
        this.musicSource.stop();
        this.musicSource.disconnect();
      } catch {}
      this.musicSource = null;
    }
  }

  private playCue(cue: AudioCue, offset = 0) {
    if (!cue.buffer) return;
    this.stopCue(cue.id);
    const ctx = this.getContext();
    const src = ctx.createBufferSource();
    src.buffer = cue.buffer;
    src.connect(this.getMasterGain());
    src.onended = () => {
      if (this.activeSources.get(cue.id) === src) {
        this.activeSources.delete(cue.id);
      }
    };
    src.start(0, offset);
    this.activeSources.set(cue.id, src);
    this.cuePlayed.add(cue.id);
  }

  private stopCue(id: string) {
    const src = this.activeSources.get(id);
    if (src) {
      try {
        src.stop();
        src.disconnect();
      } catch {}
      this.activeSources.delete(id);
    }
  }

  stop() {
    for (const src of this.activeSources.values()) {
      try {
        src.stop();
        src.disconnect();
      } catch {}
    }
    this.activeSources.clear();
    this.cuePlayed.clear();
    this.stopMusic();
    this.stopSfx();
    this.stopBattle();
  }

  getCues(): AudioCue[] {
    return this.cues;
  }

  /**
   * Filmin tüm seslendirmelerini ve arkaplan müziğini eksiksiz bir şekilde miksleyip
   * tek bir stereo AudioBuffer olarak döner.
   */
  async renderMasterAudio(duration: number, sampleRate = 44100): Promise<AudioBuffer> {
    const totalFrames = Math.max(1, Math.ceil(duration * sampleRate));
    const numberOfChannels = 2;
    const offlineCtx = new OfflineAudioContext(numberOfChannels, totalFrames, sampleRate);
    // Tüm miks tepe sınırlayıcıdan geçer (konuşma + müzik + efektler üst üste bindiğinde taşmasın)
    const out = createLimiter(offlineCtx, offlineCtx.destination);

    // 1. Diyaloglar
    for (const cue of this.cues) {
      if (!cue.buffer) continue;
      const src = offlineCtx.createBufferSource();
      src.buffer = cue.buffer;
      src.connect(out);
      src.start(Math.max(0, cue.start));
    }

    // 2. Arkaplan Müziği (Ducking ve Fade In / Fade Out otomasyonu ile)
    if (this.musicBuffer && this.musicConfig.enabled && this.musicConfig.volume > 0) {
      const musicSrc = offlineCtx.createBufferSource();
      musicSrc.buffer = this.musicBuffer;
      musicSrc.loop = this.musicConfig.loop;

      const musicGain = offlineCtx.createGain();
      musicSrc.connect(musicGain);
      musicGain.connect(out);

      // Ducking ve Fade otomasyonu (25 Hz çözünürlük)
      const points = Math.max(2, Math.floor(duration * 25));
      const curve = new Float32Array(points);
      for (let i = 0; i < points; i++) {
        const t = (i / (points - 1)) * duration;
        curve[i] = this.getMusicGainAt(t);
      }
      musicGain.gain.setValueCurveAtTime(curve, 0, duration);
      musicSrc.start(Math.max(0, this.musicConfig.start));
    }

    // 2b. Savaş müzikleri (ana temayla çapraz geçiş getMusicGainAt içinde)
    for (const seg of this.battle) {
      if (!this.musicConfig.enabled || seg.start >= duration) continue;
      const end = Math.min(seg.start + seg.buffer.duration, duration);
      const src = offlineCtx.createBufferSource();
      src.buffer = seg.buffer;
      const gain = offlineCtx.createGain();
      const points = Math.max(2, Math.floor((end - seg.start) * 25));
      const curve = new Float32Array(points);
      for (let i = 0; i < points; i++) curve[i] = this.getBattleGainAt(seg, seg.start + (i / (points - 1)) * (end - seg.start - 1e-3));
      gain.gain.setValueCurveAtTime(curve, seg.start, end - seg.start);
      src.connect(gain);
      gain.connect(out);
      src.start(seg.start);
      src.stop(end);
    }

    // 3. Ses efektleri (yankı + sınırlayıcı kanalından) ve döngülü ortam sesleri
    if (this.sfxCues.length) {
      const input = this.createSfxChain(offlineCtx, out);
      for (const cue of this.sfxCues) {
        if (cue.start >= duration) continue;
        const src = offlineCtx.createBufferSource();
        src.buffer = cue.buffer;
        const gain = offlineCtx.createGain();
        const pan = offlineCtx.createStereoPanner();
        applyCueParams(cue, gain, pan, cue.start, 0);
        src.connect(gain);
        gain.connect(pan);
        pan.connect(input);
        src.start(cue.start);
      }
    }
    for (const cue of this.ambienceCues) {
      const end = Math.min(cue.end, duration);
      if (end - cue.start < 0.05) continue;
      const src = offlineCtx.createBufferSource();
      src.buffer = cue.buffer;
      src.loop = true;
      const gain = offlineCtx.createGain();
      const points = Math.max(2, Math.floor((end - cue.start) * 25));
      const curve = new Float32Array(points);
      for (let i = 0; i < points; i++) curve[i] = this.ambienceGainAt(cue, cue.start + (i / (points - 1)) * (end - cue.start - 1e-3));
      gain.gain.setValueCurveAtTime(curve, cue.start, end - cue.start);
      src.connect(gain);
      gain.connect(out);
      src.start(cue.start);
      src.stop(end);
    }

    return await offlineCtx.startRendering();
  }

  /**
   * Karakterin t anındaki konuşma ve ses durumunu döner.
   * hasCue: true dönerse karakter bu aralıkta bir ses dosyasına sahiptir; ses bittiğinde active: false
   * döner ve karakterin yedek yordamsal konuşmaya düşüp ağzını açmaya devam etmesini önler.
   */
  getVoiceState(who: string, filmTime: number): { hasCue: boolean; active: boolean; level: number } {
    for (const cue of this.cues) {
      if (cue.who !== who) continue;
      const soundStart = cue.start + (cue.activeStart ?? 0);
      const soundEnd = cue.start + (cue.activeEnd ?? cue.duration);
      const mouthStart = soundStart - this.leadIn;
      const mouthEnd = Math.max(mouthStart + 0.2, soundEnd - this.leadOut);

      // Cue kapsama alanı
      if (filmTime >= mouthStart - 0.1 && filmTime <= soundEnd + 0.2) {
        if (filmTime < mouthStart || filmTime > mouthEnd) {
          return { hasCue: true, active: false, level: 0 };
        }

        let level = 0.6;
        if (filmTime < soundStart && this.leadIn > 0) {
          // Ses başlamadan önceki hazırlık payı: ağız açılmaya başlar
          const prepProgress = (filmTime - mouthStart) / this.leadIn;
          level = 0.4 + 0.5 * prepProgress;
        } else if (cue.rms && cue.rmsFps) {
          const local = filmTime - cue.start;
          const f = Math.floor(local * cue.rmsFps);
          const raw = cue.rms[Math.min(cue.rms.length - 1, Math.max(0, f))] ?? 0;
          level = Math.min(1, Math.max(0.3, (raw - 0.005) / 0.12));
        }

        // Bitmeden hemen önce (son 40 ms) pürüzsüz kapanış rampası
        const remaining = mouthEnd - filmTime;
        const ramp = Math.min(1, Math.max(0, remaining / 0.04));

        return {
          hasCue: true,
          active: true,
          level: level * ramp,
        };
      }
    }
    return { hasCue: false, active: false, level: 0 };
  }
}

/**
 * Efektin kazancı ve pan'ı; hareketli kaynakta (auto) eğriler offset'ten itibaren when anına yerleştirilir.
 */
function applyCueParams(cue: SfxCue, gain: GainNode, pan: StereoPannerNode, when: number, offset: number) {
  gain.gain.value = cue.gain;
  pan.pan.value = cue.pan;
  const a = cue.auto;
  if (!a) return;
  const k0 = Math.floor(offset * a.hz);
  if (a.gain.length - k0 < 2) return;
  const g = a.gain.slice(k0).map((v) => v * cue.gain);
  const p = a.pan.slice(k0);
  const span = (g.length - 1) / a.hz;
  gain.gain.value = g[0];
  pan.pan.value = p[0];
  gain.gain.setValueCurveAtTime(g, when, span);
  pan.pan.setValueCurveAtTime(p, when, span);
}

/**
 * Ana çıkış sınırlayıcısı: yalnızca tepeler -1.5 dBFS'i aşınca devreye girer (normal seviyede ses değişmez),
 * üst üste binen sesler dışa aktarımda kırpılıp cızırdamasın.
 */
function createLimiter(ctx: BaseAudioContext, dest: AudioNode): AudioNode {
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -1.5;
  lim.knee.value = 0;
  lim.ratio.value = 20;
  lim.attack.value = 0.002;
  lim.release.value = 0.12;
  lim.connect(dest);
  return lim;
}

/** AudioBuffer'ı standart uncompressed 16-bit PCM WAV Blob'una dönüştürür. */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length * numChannels * 2;
  const out = new ArrayBuffer(44 + length);
  const view = new DataView(out);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + length, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, length, true);

  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < numChannels; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([out], { type: 'audio/wav' });
}

