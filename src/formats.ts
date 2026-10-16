export type Orientation = 'landscape' | 'portrait' | 'square';

export interface FormatPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  /** Platform arayüzünün (butonlar, açıklama) kapattığı yaklaşık alan, kenar başına oran. */
  safe?: { top: number; bottom: number; left: number; right: number };
}

export const FORMATS: FormatPreset[] = [
  { id: 'youtube_16x9', label: 'YouTube 16:9 · 1080p', width: 1920, height: 1080 },
  { id: 'youtube_4k', label: 'YouTube 16:9 · 4K', width: 3840, height: 2160 },
  {
    id: 'vertical_9x16',
    label: 'Reels / Shorts 9:16',
    width: 1080,
    height: 1920,
    safe: { top: 0.12, bottom: 0.2, left: 0.05, right: 0.13 },
  },
  { id: 'ig_4x5', label: 'Instagram Feed 4:5', width: 1080, height: 1350 },
  { id: 'ig_1x1', label: 'Instagram Kare 1:1', width: 1080, height: 1080 },
];

export function orientationOf(f: FormatPreset): Orientation {
  return f.width > f.height ? 'landscape' : f.width < f.height ? 'portrait' : 'square';
}
