import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { Film } from '../engine/film';
import type { FormatPreset } from '../formats';
import type { Viewport } from '../render/viewport';

export interface ExportOptions {
  film: Film;
  viewport: Viewport;
  format: FormatPreset;
  /** Çıktı kare hızı; verilmezse senaryodaki (film.fps) değer kullanılır. */
  fps?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export function webCodecsSupported(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * H.264 seviyeleri (level_idc, saniyedeki en çok makroblok, kare başına en çok makroblok, en çok bitrate bps).
 * Bitrate sınırı Baseline/Main içindir; High profilde 1.25 ile çarpılır.
 */
const H264_LEVELS: ReadonlyArray<readonly [string, number, number, number]> = [
  ['1f', 108_000, 3_600, 14_000_000], // 3.1
  ['20', 216_000, 5_120, 20_000_000], // 3.2
  ['28', 245_760, 8_192, 20_000_000], // 4.0
  ['29', 245_760, 8_192, 50_000_000], // 4.1
  ['2a', 522_240, 8_704, 50_000_000], // 4.2
  ['32', 589_824, 22_080, 135_000_000], // 5.0
  ['33', 983_040, 36_864, 240_000_000], // 5.1
  ['34', 2_073_600, 36_864, 240_000_000], // 5.2
];

/**
 * Çözünürlük, fps ve bitrate'i taşıyan en düşük H.264 seviyesini seçer. Seviye yetersiz kalırsa (ör. 1080p60'ta 4.0)
 * donanım kodlayıcılar bitrate'i kısıp görüntüyü bozar; bu yüzden seviye fps'e göre hesaplanır.
 */
function pickLevel(width: number, height: number, fps: number, bitrate: number, high: boolean): string {
  const mbs = Math.ceil(width / 16) * Math.ceil(height / 16);
  const brScale = high ? 1.25 : 1;
  const fit = H264_LEVELS.find(([, maxMbps, maxFs, maxBr]) => mbs <= maxFs && mbs * fps <= maxMbps && bitrate <= maxBr * brScale);
  return (fit ?? H264_LEVELS[H264_LEVELS.length - 1])[0];
}

/** H.264 High → Main → Baseline sırasıyla tarayıcının desteklediği ilk profili seçer. */
export async function pickConfig(width: number, height: number, fps: number): Promise<VideoEncoderConfig> {
  // YouTube önerisine yakın: 1080p30 ≈ 9 Mbps, 4K30 ≈ 37 Mbps, 1080p60 ≈ 19 Mbps
  const bitrate = Math.round(width * height * fps * 0.15);
  // Yüksek fps'te donanım kodlayıcıların değişken bitrate modu hedefin çok altında kalıp görüntüyü bozabilir;
  // bu yüzden önce sabit bitrate denenir.
  const modes: Array<'constant' | 'variable'> = fps > 30 ? ['constant', 'variable'] : ['variable'];
  for (const profile of ['6400', '4d00', '4200']) {
    const level = pickLevel(width, height, fps, bitrate, profile === '6400').padStart(2, '0');
    for (const bitrateMode of modes) {
      const config: VideoEncoderConfig = {
        codec: `avc1.${profile}${level}`,
        width,
        height,
        bitrate,
        bitrateMode,
        framerate: fps,
        avc: { format: 'avc' },
        latencyMode: 'quality',
      };
      if ((await VideoEncoder.isConfigSupported(config)).supported) return config;
    }
  }
  throw new Error(`Bu tarayıcı ${width}×${height} @${fps}fps H.264 kodlamayı desteklemiyor`);
}

export interface VideoRangeOptions {
  film: Film;
  viewport: Viewport;
  format: FormatPreset;
  fps: number;
  config: VideoEncoderConfig;
  /** Kodlanacak kare aralığı [from, to). */
  from: number;
  to: number;
  onChunk: (chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) => void;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * Filmin [from, to) kare aralığını render edip H.264 olarak kodlar. Zaman damgaları filmin başından (kare numarası / fps)
 * hesaplanır, böylece farklı aralıklar farklı sayfalarda üretilip sonradan birleştirilebilir. Aralığın ilk karesi anahtar karedir.
 */
export async function encodeVideoRange({
  film,
  viewport,
  format,
  fps,
  config,
  from,
  to,
  onChunk,
  onProgress,
  signal,
}: VideoRangeOptions): Promise<void> {
  const { width, height } = format;
  let encodeError: unknown = null;
  const encoder = new VideoEncoder({
    output: onChunk,
    error: (e) => (encodeError = e),
  });
  encoder.configure(config);

  const prevFilmMode = film.getRenderMode();
  film.setRenderMode('render');
  const restore = viewport.beginOffscreen(width, height);
  try {
    const frameUs = 1e6 / fps;
    const count = to - from;
    for (let i = from; i < to; i++) {
      if (signal?.aborted) throw new DOMException('Dışa aktarım iptal edildi', 'AbortError');
      if (encodeError) throw encodeError;

      film.evaluate(i / fps, format);
      viewport.render(film);
      const frame = new VideoFrame(viewport.canvas, { timestamp: Math.round(i * frameUs), duration: Math.round(frameUs) });
      encoder.encode(frame, { keyFrame: (i - from) % (fps * 2) === 0 });
      frame.close();
      onProgress?.(i - from + 1, count);

      while (encoder.encodeQueueSize > 6) await sleep(1);
      if (i % 4 === 0) await sleep(0); // arayüz nefes alsın
    }
    await encoder.flush();
    if (encodeError) throw encodeError;
  } finally {
    if (encoder.state !== 'closed') encoder.close();
    film.setRenderMode(prevFilmMode);
    restore();
  }
}

export interface AudioPlan {
  config: AudioEncoderConfig;
  sampleRate: number;
  numberOfChannels: number;
}

/** Filmde ses varsa ve tarayıcı AAC kodlayabiliyorsa kodlama planını, aksi halde null döndürür. */
export async function planAudio(film: Film): Promise<AudioPlan | null> {
  const audioCues = film.audio.getCues().filter((c) => c.buffer);
  const musicBuffer = film.audio.getMusicBuffer();
  const musicConfig = film.audio.getMusicConfig();
  const hasAudio =
    audioCues.length > 0 || film.audio.hasSfx() || (musicBuffer !== null && musicConfig.enabled && musicConfig.volume > 0);
  if (!hasAudio || typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return null;

  const sampleRate = 44100;
  const numberOfChannels = 2;
  try {
    const config: AudioEncoderConfig = { codec: 'mp4a.40.2', sampleRate, numberOfChannels, bitrate: 128_000 };
    if ((await AudioEncoder.isConfigSupported(config)).supported) return { config, sampleRate, numberOfChannels };
  } catch {
    /* AAC yok: sessiz çıktı */
  }
  return null;
}

/** Eksiksiz master mix'i (diyaloglar + arkaplan müziği + ducking) çevrimdışı üretip AAC olarak kodlar. */
export async function encodeAudio(
  film: Film,
  { config, sampleRate, numberOfChannels }: AudioPlan,
  onChunk: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => void,
  signal?: AbortSignal,
): Promise<void> {
  let encodeError: unknown = null;
  const audioEncoder = new AudioEncoder({
    output: onChunk,
    error: (e) => (encodeError = e),
  });
  audioEncoder.configure(config);
  try {
    const renderedAudio = await film.audio.renderMasterAudio(film.duration, sampleRate);
    const totalAudioFrames = renderedAudio.length;
    const ch0 = renderedAudio.getChannelData(0);
    const ch1 = renderedAudio.numberOfChannels > 1 ? renderedAudio.getChannelData(1) : ch0;

    const chunkSize = 1024;
    for (let offset = 0; offset < totalAudioFrames; offset += chunkSize) {
      if (signal?.aborted) throw new DOMException('Dışa aktarım iptal edildi', 'AbortError');
      if (encodeError) throw encodeError;

      const frames = Math.min(chunkSize, totalAudioFrames - offset);
      const planar = new Float32Array(frames * 2);
      planar.set(ch0.subarray(offset, offset + frames), 0);
      planar.set(ch1.subarray(offset, offset + frames), frames);

      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate,
        numberOfFrames: frames,
        numberOfChannels,
        timestamp: Math.round((offset / sampleRate) * 1e6),
        data: planar,
      });
      audioEncoder.encode(audioData);
      audioData.close();

      while (audioEncoder.encodeQueueSize > 12) await sleep(1);
    }
    await audioEncoder.flush();
    if (encodeError) throw encodeError;
  } finally {
    if (audioEncoder.state !== 'closed') audioEncoder.close();
  }
}

/**
 * Filmi kare kare (gerçek zamandan bağımsız) render edip MP4 (H.264 + isteğe bağlı AAC ses) üretir.
 * Kodlama tarayıcının donanım kodlayıcısıyla yapılır, sunucu gerekmez.
 */
export async function exportMp4({ film, viewport, format, fps: fpsOverride, onProgress, signal }: ExportOptions): Promise<Blob> {
  const { width, height } = format;
  const fps = fpsOverride ?? film.fps;
  const total = Math.max(1, Math.round(film.duration * fps));
  const config = await pickConfig(width, height, fps);
  const audio = await planAudio(film);

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width, height, frameRate: fps },
    audio: audio ? { codec: 'aac', numberOfChannels: audio.numberOfChannels, sampleRate: audio.sampleRate } : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  await encodeVideoRange({
    film,
    viewport,
    format,
    fps,
    config,
    from: 0,
    to: total,
    onChunk: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    onProgress,
    signal,
  });
  if (audio) await encodeAudio(film, audio, (chunk, meta) => muxer.addAudioChunk(chunk, meta), signal);

  muxer.finalize();
  return new Blob([target.buffer], { type: 'video/mp4' });
}

/**
 * Filmin tüm seslendirmelerini ve arkaplan müziğini miksleyip bağımsız bir ses dosyası (.wav) olarak dışa aktarır.
 */
export async function exportMasterAudio(film: Film): Promise<Blob> {
  const { audioBufferToWav } = await import('../engine/audio');
  const buffer = await film.audio.renderMasterAudio(film.duration, 44100);
  return audioBufferToWav(buffer);
}

