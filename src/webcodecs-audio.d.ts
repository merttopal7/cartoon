interface AudioEncoderConfig {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  bitrate?: number;
}

interface AudioDataInit {
  format: 'f32' | 'f32-planar' | 's16' | 's16-planar' | 's32' | 's32-planar' | 'u8' | 'u8-planar';
  sampleRate: number;
  numberOfFrames: number;
  numberOfChannels: number;
  timestamp: number;
  data: BufferSource;
  transfer?: ArrayBuffer[];
}

declare class AudioData {
  constructor(init: AudioDataInit);
  readonly format: string;
  readonly sampleRate: number;
  readonly numberOfFrames: number;
  readonly numberOfChannels: number;
  readonly duration: number;
  readonly timestamp: number;
  close(): void;
  clone(): AudioData;
  copyTo(destination: BufferSource, options: { planeIndex: number; frameOffset?: number; frameCount?: number }): void;
}

interface AudioEncoderInit {
  output: (chunk: any, metadata?: any) => void;
  error: (error: any) => void;
}

declare class AudioEncoder {
  constructor(init: AudioEncoderInit);
  readonly state: 'unconfigured' | 'configured' | 'closed';
  readonly encodeQueueSize: number;
  configure(config: AudioEncoderConfig): void;
  encode(data: AudioData): void;
  flush(): Promise<void>;
  reset(): void;
  close(): void;
  static isConfigSupported(config: AudioEncoderConfig): Promise<{ supported: boolean; config: AudioEncoderConfig }>;
}

interface EncodedAudioChunk {
  readonly type: 'key' | 'delta';
  readonly timestamp: number;
  readonly duration: number | null;
  readonly byteLength: number;
  copyTo(destination: BufferSource): void;
}

interface EncodedAudioChunkMetadata {
  decoderConfig?: {
    codec: string;
    sampleRate?: number;
    numberOfChannels?: number;
    description?: BufferSource;
  };
}
