import { FORMATS, type FormatPreset } from '../formats';
import type { Film } from '../engine/film';
import type { Viewport } from '../render/viewport';
import { encodeAudio, encodeVideoRange, pickConfig, planAudio } from './mp4';

/**
 * Paralel segment render köprüsü: tools/render-parallel.mjs her Puppeteer sayfasında bu fonksiyonları çağırır.
 * Kodlanmış paketler base64 olarak Node tarafına akıtılır, birleştirme (MP4 muxer) orada yapılır.
 */

export interface WirePacket {
  kind: 'video' | 'audio';
  type: 'key' | 'delta';
  timestamp: number;
  duration: number;
  /** Base64 kodlanmış paket verisi. */
  data: string;
  /** Yalnızca meta.decoderConfig içeren pakette: avcC / AudioSpecificConfig (base64). */
  description?: string;
}

export type PacketSink = (packet: WirePacket) => Promise<void>;

export interface JobInfo {
  format: FormatPreset;
  fps: number;
  duration: number;
  totalFrames: number;
  /** Filmde ses varsa ve AAC kodlanabiliyorsa parametreleri, yoksa null. */
  audio: { sampleRate: number; numberOfChannels: number } | null;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function bufferSourceToBytes(src: BufferSource): Uint8Array {
  return src instanceof ArrayBuffer ? new Uint8Array(src) : new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
}

function toWire(
  kind: WirePacket['kind'],
  chunk: EncodedVideoChunk | EncodedAudioChunk,
  description: BufferSource | undefined,
): WirePacket {
  const bytes = new Uint8Array(chunk.byteLength);
  chunk.copyTo(bytes);
  return {
    kind,
    type: chunk.type === 'key' ? 'key' : 'delta',
    timestamp: chunk.timestamp,
    duration: chunk.duration ?? 0,
    data: toBase64(bytes),
    description: description ? toBase64(bufferSourceToBytes(description)) : undefined,
  };
}

function findFormat(formatId: string): FormatPreset {
  const format = FORMATS.find((f) => f.id === formatId);
  if (!format) throw new Error(`Bilinmeyen format: ${formatId} (${FORMATS.map((f) => f.id).join(', ')})`);
  return format;
}

/** İş tanımı: format, fps, süre, toplam kare ve (varsa) ses parametreleri. */
export async function describeJob(film: Film, formatId: string, fps?: number): Promise<JobInfo> {
  const format = findFormat(formatId);
  const useFps = fps ?? film.fps;
  const plan = await planAudio(film);
  return {
    format,
    fps: useFps,
    duration: film.duration,
    totalFrames: Math.max(1, Math.round(film.duration * useFps)),
    audio: plan ? { sampleRate: plan.sampleRate, numberOfChannels: plan.numberOfChannels } : null,
  };
}

/** [from, to) kare aralığını render edip kodlanmış paketleri sırayla sink'e verir (sink bekletilir, geri basınç sağlar). */
export async function renderSegment(
  film: Film,
  viewport: Viewport,
  formatId: string,
  fps: number,
  from: number,
  to: number,
  sink: PacketSink,
): Promise<void> {
  const format = findFormat(formatId);
  const config = await pickConfig(format.width, format.height, fps);
  let pending: Promise<void> = Promise.resolve();
  await encodeVideoRange({
    film,
    viewport,
    format,
    fps,
    config,
    from,
    to,
    onChunk: (chunk, meta) => {
      const packet = toWire('video', chunk, meta?.decoderConfig?.description);
      pending = pending.then(() => sink(packet));
    },
  });
  await pending;
}

/** Filmin master ses miksini AAC olarak kodlayıp paketleri sink'e verir. Ses yoksa false döner. */
export async function renderAudio(film: Film, sink: PacketSink): Promise<boolean> {
  const plan = await planAudio(film);
  if (!plan) return false;
  let pending: Promise<void> = Promise.resolve();
  await encodeAudio(film, plan, (chunk, meta) => {
    const packet = toWire('audio', chunk, meta?.decoderConfig?.description);
    pending = pending.then(() => sink(packet));
  });
  await pending;
  return true;
}
