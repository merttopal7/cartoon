/**
 * Web Audio timeline playback & synchronization for cartoon dialogues.
 */

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

export class AudioTimeline {
  private ctx: AudioContext | null = null;
  private cues: AudioCue[] = [];
  private activeSources = new Map<string, AudioBufferSourceNode>();
  private masterGain: GainNode | null = null;
  private musicGainNode: GainNode | null = null;
  private musicSource: AudioBufferSourceNode | null = null;
  private musicBuffer: AudioBuffer | null = null;
  private musicLoadingUrl: string | null = null;
  private filmDuration = 0;
  private volume = 1.0;
  private isMuted = false;
  private isPlaying = false;
  private lastTime = 0;
  private leadIn = 0.70;  // Varsayılan: ses başlamadan 700ms önce
  private leadOut = 0.70; // Varsayılan: ses bitmeden 700ms önce

  private musicConfig: MusicConfig = {
    src: '/audio/main-theme/jyproject-carousel-dreams-396029.mp3',
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
      this.masterGain.connect(ctx.destination);
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

    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ab = await res.arrayBuffer();
      const ctx = this.getContext();
      this.musicBuffer = await ctx.decodeAudioData(ab);
    } catch (err) {
      console.warn(`[AudioTimeline] Arkaplan müziği yüklenemedi: ${src}`, err);
      this.musicBuffer = null;
    }
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

    // Zaman geriye veya ileriye sıçradıysa (seek)
    const jumped = Math.abs(time - this.lastTime) > 0.35 || !this.isPlaying;
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
      return;
    }

    // Normal akış: başlangıç anı bu kareye denk gelen sesleri başlat
    for (const cue of this.cues) {
      if (!cue.buffer) continue;
      if (time >= cue.start && time < cue.start + cue.duration) {
        if (!this.activeSources.has(cue.id)) {
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
    this.stopMusic();
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

    // 1. Diyaloglar
    for (const cue of this.cues) {
      if (!cue.buffer) continue;
      const src = offlineCtx.createBufferSource();
      src.buffer = cue.buffer;
      src.connect(offlineCtx.destination);
      src.start(Math.max(0, cue.start));
    }

    // 2. Arkaplan Müziği (Ducking ve Fade In / Fade Out otomasyonu ile)
    if (this.musicBuffer && this.musicConfig.enabled && this.musicConfig.volume > 0) {
      const musicSrc = offlineCtx.createBufferSource();
      musicSrc.buffer = this.musicBuffer;
      musicSrc.loop = this.musicConfig.loop;

      const musicGain = offlineCtx.createGain();
      musicSrc.connect(musicGain);
      musicGain.connect(offlineCtx.destination);

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

