import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { Film } from '../engine/film';
import type { FormatPreset } from '../formats';
import type { Viewport } from '../render/viewport';

export interface ExportOptions {
  film: Film;
  viewport: Viewport;
  format: FormatPreset;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export function webCodecsSupported(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** H.264 High → Main → Baseline sırasıyla tarayıcının desteklediği ilk profili seçer. */
async function pickConfig(width: number, height: number, fps: number): Promise<VideoEncoderConfig> {
  const level = width * height > 2_100_000 ? '33' /* 5.1: 4K */ : '28'; /* 4.0: 1080p */
  // YouTube önerisine yakın: 1080p30 ≈ 9 Mbps, 4K30 ≈ 37 Mbps
  const bitrate = Math.round(width * height * fps * 0.15);
  for (const profile of ['6400', '4d00', '4200']) {
    const config: VideoEncoderConfig = {
      codec: `avc1.${profile}${level}`,
      width,
      height,
      bitrate,
      framerate: fps,
      avc: { format: 'avc' },
      latencyMode: 'quality',
    };
    if ((await VideoEncoder.isConfigSupported(config)).supported) return config;
  }
  throw new Error(`Bu tarayıcı ${width}×${height} H.264 kodlamayı desteklemiyor`);
}

/**
 * Filmi kare kare (gerçek zamandan bağımsız) render edip MP4 (H.264 + isteğe bağlı AAC ses) üretir.
 * Kodlama tarayıcının donanım kodlayıcısıyla yapılır, sunucu gerekmez.
 */
export async function exportMp4({ film, viewport, format, onProgress, signal }: ExportOptions): Promise<Blob> {
  const { width, height } = format;
  const fps = film.fps;
  const total = film.frameCount;
  const config = await pickConfig(width, height, fps);

  const audioCues = film.audio.getCues().filter((c) => c.buffer);
  const musicBuffer = film.audio.getMusicBuffer();
  const musicConfig = film.audio.getMusicConfig();
  const hasAudio = audioCues.length > 0 || (musicBuffer !== null && musicConfig.enabled && musicConfig.volume > 0);
  const sampleRate = 44100;
  const numberOfChannels = 2;
  let useAudio = false;

  let audioConfig: AudioEncoderConfig | null = null;
  if (hasAudio && typeof AudioEncoder !== 'undefined' && typeof AudioData !== 'undefined') {
    try {
      const cfg: AudioEncoderConfig = {
        codec: 'mp4a.40.2',
        sampleRate,
        numberOfChannels,
        bitrate: 128_000,
      };
      if ((await AudioEncoder.isConfigSupported(cfg)).supported) {
        audioConfig = cfg;
        useAudio = true;
      }
    } catch {
      useAudio = false;
    }
  }

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width, height, frameRate: fps },
    audio: useAudio ? { codec: 'aac', numberOfChannels, sampleRate } : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  let encodeError: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (encodeError = e),
  });
  encoder.configure(config);

  let audioEncoder: AudioEncoder | null = null;
  if (useAudio && audioConfig) {
    audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (e) => (encodeError = e),
    });
    audioEncoder.configure(audioConfig);
  }

  const prevFilmMode = film.getRenderMode();
  film.setRenderMode('render');
  const restore = viewport.beginOffscreen(width, height);
  try {
    const frameUs = 1e6 / fps;
    for (let i = 0; i < total; i++) {
      if (signal?.aborted) throw new DOMException('Dışa aktarım iptal edildi', 'AbortError');
      if (encodeError) throw encodeError;

      film.evaluate(i / fps, format);
      viewport.render(film);
      const frame = new VideoFrame(viewport.canvas, { timestamp: Math.round(i * frameUs), duration: Math.round(frameUs) });
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      onProgress?.(i + 1, total);

      while (encoder.encodeQueueSize > 6) await sleep(1);
      if (i % 4 === 0) await sleep(0); // arayüz nefes alsın
    }
    await encoder.flush();

    // Ses parçası varsa eksiksiz master mix (diyaloglar + arkaplan müziği + ducking) çevrimdışı üretilip AAC olarak kodlanır
    if (audioEncoder && hasAudio) {
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
    }

    if (encodeError) throw encodeError;
    muxer.finalize();
    return new Blob([target.buffer], { type: 'video/mp4' });
  } finally {
    if (encoder.state !== 'closed') encoder.close();
    if (audioEncoder && audioEncoder.state !== 'closed') audioEncoder.close();
    film.setRenderMode(prevFilmMode);
    restore();
  }
}

/**
 * Filmin tüm seslendirmelerini ve arkaplan müziğini miksleyip bağımsız bir ses dosyası (.wav) olarak dışa aktarır.
 */
export async function exportMasterAudio(film: Film): Promise<Blob> {
  const { audioBufferToWav } = await import('../engine/audio');
  const buffer = await film.audio.renderMasterAudio(film.duration, 44100);
  return audioBufferToWav(buffer);
}

