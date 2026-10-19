import {
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  type StreamTargetChunk,
  type Target,
} from 'mediabunny';
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

/**
 * Arayüze sıra veren bekleme. setTimeout arka plandaki sekmede en az 1 sn bekletilir (5 dk sonra dakikada bir):
 * sekme gizlenince dışa aktarım ~10 kat yavaşlıyor, uzun bölümde neredeyse duruyordu. MessageChannel mesajları
 * kısılmaz; render sekme arka plandayken de aynı hızda sürer.
 */
const yieldTask = (() => {
  let channel: MessageChannel | null = null;
  const waiting: Array<() => void> = [];
  return () =>
    new Promise<void>((resolve) => {
      if (!channel) {
        channel = new MessageChannel();
        channel.port1.onmessage = () => waiting.shift()?.();
      }
      waiting.push(resolve);
      channel.port2.postMessage(null);
    });
})();

/** Kodlayıcı kuyruğu `max`'a inene kadar bekler (kodlayıcının kendi 'dequeue' olayıyla; zamanlayıcı yok). */
async function drain(encoder: VideoEncoder | AudioEncoder, max: number) {
  while (encoder.encodeQueueSize > max && encoder.state === 'configured') {
    if ('ondequeue' in encoder) {
      await new Promise<void>((resolve) => encoder.addEventListener('dequeue', () => resolve(), { once: true }));
    } else {
      await yieldTask();
    }
  }
}

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
  /** Her kareden sonra beklenir: paketleri yazan taraf (dosya akışı) geride kalırsa render beklesin. */
  backpressure?: () => Promise<void>;
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
  backpressure,
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

      await drain(encoder, 6);
      if (backpressure) await backpressure();
      if (i % 4 === 0) await yieldTask(); // arayüz nefes alsın
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

      await drain(audioEncoder, 12);
    }
    await audioEncoder.flush();
    if (encodeError) throw encodeError;
  } finally {
    if (audioEncoder.state !== 'closed') audioEncoder.close();
  }
}

/**
 * Filmi kare kare (gerçek zamandan bağımsız) render edip MP4'e (H.264 + isteğe bağlı AAC ses) yazar. Kodlama tarayıcının
 * donanım kodlayıcısıyla yapılır, sunucu gerekmez; birleştirme (MP4 muxer) Mediabunny ile.
 *
 * Meta veri dosyanın başında (Fast Start: oynatıcılar ve paylaşım siteleri hemen oynatabilir). Paket sayıları baştan
 * bilindiği için yer ayrılır ('reserve'): kodlanan paketler bellekte toplanmadan sırayla hedefe yazılır. Dosyaya
 * akıtıldığında (StreamTarget) bellek kullanımı film uzunluğundan bağımsızdır (10 dk 1080p ≈ 750 MB, 60 fps'te iki katı).
 * Ses önce kodlanır (birkaç MB): MP4 izleri zamana göre iç içe yazıldığından video paketleri ses beklemeden akar.
 */
async function writeMp4(target: Target, { film, viewport, format, fps: fpsOverride, onProgress, signal }: ExportOptions): Promise<void> {
  const { width, height } = format;
  const fps = fpsOverride ?? film.fps;
  const total = Math.max(1, Math.round(film.duration * fps));
  const config = await pickConfig(width, height, fps);
  const audio = await planAudio(film);

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'reserve' }), target });
  const video = new EncodedVideoPacketSource('avc');
  output.addVideoTrack(video, { frameRate: fps, maximumPacketCount: total + 2 });
  let sound: EncodedAudioPacketSource | null = null;
  if (audio) {
    sound = new EncodedAudioPacketSource('aac');
    // AAC: 1024 örnek/paket; kodlayıcının başa eklediği paket(ler) için pay
    output.addAudioTrack(sound, { maximumPacketCount: Math.ceil((film.duration * audio.sampleRate) / 1024) + 16 });
  }
  await output.start();

  // Kodlayıcı paketleri eşzamanlı verir; yazıcıya sırayla aktarılır, yazıcı geride kalırsa render bekler
  let queue = Promise.resolve();
  let queued = 0;
  const enqueue = (add: () => Promise<void>) => {
    queued++;
    queue = queue.then(add).finally(() => queued--);
  };
  try {
    if (audio && sound) {
      const src = sound;
      await encodeAudio(film, audio, (chunk, meta) => enqueue(() => src.add(EncodedPacket.fromEncodedChunk(chunk), meta)), signal);
      await queue;
      src.close();
    }
    await encodeVideoRange({
      film,
      viewport,
      format,
      fps,
      config,
      from: 0,
      to: total,
      onChunk: (chunk, meta) => enqueue(() => video.add(EncodedPacket.fromEncodedChunk(chunk), meta)),
      onProgress,
      signal,
      backpressure: async () => {
        if (queued > 8) await queue;
      },
    });
    await queue;
    video.close();
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  }
}

/** Filmi MP4 olarak bellekte üretip Blob döndürür (kısa filmler ve testler; uzun filmlerde exportMp4ToStream). */
export async function exportMp4(options: ExportOptions): Promise<Blob> {
  const target = new BufferTarget();
  await writeMp4(target, options);
  return new Blob([target.buffer!], { type: 'video/mp4' });
}

/**
 * Filmi MP4 olarak doğrudan bir yazma akışına (ör. tarayıcının kaydetme penceresinden alınan dosya,
 * FileSystemWritableFileStream) yazar; yazılan bayt sayısını döndürür. Akış, bitince kapatılır.
 */
export async function exportMp4ToStream(options: ExportOptions, writable: WritableStream<StreamTargetChunk>): Promise<number> {
  let bytes = 0;
  const counting = new WritableStream<StreamTargetChunk>({
    write: async (chunk) => {
      bytes = Math.max(bytes, chunk.position + chunk.data.byteLength);
      await writer.write(chunk);
    },
    close: () => writer.close(),
    abort: (reason) => writer.abort(reason),
  });
  const writer = writable.getWriter();
  await writeMp4(new StreamTarget(counting, { chunked: true }), options);
  return bytes;
}

/**
 * Filmin tüm seslendirmelerini ve arkaplan müziğini miksleyip bağımsız bir ses dosyası (.wav) olarak dışa aktarır.
 */
export async function exportMasterAudio(film: Film): Promise<Blob> {
  const { audioBufferToWav } = await import('../engine/audio');
  const buffer = await film.audio.renderMasterAudio(film.duration, 44100);
  return audioBufferToWav(buffer);
}

