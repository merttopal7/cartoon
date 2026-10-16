import * as THREE from 'three';
import type { Animatable, CameraDef, CameraTarget } from '../schema';
import { orientationOf, type FormatPreset } from '../formats';
import { EASES, clamp, deg, lerp } from './math';

export interface Subject {
  /** Hedefin yerdeki merkezi. */
  center: THREE.Vector3;
  height: number;
  /** Kameranın sağ eksenindeki genişlik (birden çok karakter için aralarındaki mesafe dahil). */
  width: number;
}
export interface CameraScene {
  subject(target: CameraTarget, rightAxis: THREE.Vector3): Subject;
  /** Hedefin (birden çoksa ilkinin) çekim başındaki yönü, radyan. */
  facing(target: CameraTarget): number;
}

type Size = Exclude<CameraDef['size'], undefined | { from: unknown }>;
export interface ResolvedCamera {
  target: CameraTarget;
  size: Animatable<Size>;
  angle: Animatable<number>;
  elevation: Animatable<number>;
  fov: number;
  ease: keyof typeof EASES;
  relative: boolean;
  handheld: number;
}

const DEFAULTS = { size: 'full', angle: 0, elevation: 6, fov: 30, ease: 'inOut', relative: false } as const;

/** Plan boyu → karakter boyunun katı olarak görünür dikey alan. */
const SIZE_FACTORS = { wide: 3.6, full: 1.35, medium: 0.9, close: 0.55 } as const;
/** Plan boyuna göre bakış noktası (karakter boyuna oran): yakın planda yüz, genişte gövde ortası. */
const AIM_TABLE: [number, number][] = [
  [0.55, 0.8],
  [0.9, 0.68],
  [1.35, 0.5],
  [3.6, 0.45],
];

/** Varsayılanlar + yöne göre ezme (landscape/portrait/square) + format kimliğine göre ezme. */
export function resolveCamera(def: CameraDef, format: FormatPreset, handheld = 0): ResolvedCamera {
  const { formats = {}, ...base } = def;
  return { ...DEFAULTS, handheld, ...base, ...formats[orientationOf(format)], ...formats[format.id] } as ResolvedCamera;
}

const pick = <T>(v: Animatable<T>, which: 'from' | 'to'): T =>
  typeof v === 'object' && v !== null && 'from' in v ? v[which] : (v as T);

const sizeFactor = (s: Size) => (typeof s === 'number' ? s : SIZE_FACTORS[s]);

function aimRatio(f: number): number {
  if (f <= AIM_TABLE[0][0]) return AIM_TABLE[0][1];
  for (let i = 1; i < AIM_TABLE.length; i++) {
    const [f1, a1] = AIM_TABLE[i];
    const [f0, a0] = AIM_TABLE[i - 1];
    if (f <= f1) return lerp(a0, a1, (f - f0) / (f1 - f0));
  }
  return AIM_TABLE[AIM_TABLE.length - 1][1];
}

/**
 * Kamerayı çekim tanımına göre yerleştirir. Mesafe iki koşulun büyüğüdür:
 * (1) plan boyu dikeyde sığsın, (2) hedef(ler) yatayda sığsın. Böylece aynı çekim
 * 16:9'da ve 9:16'da kırpılmadan, her formata göre ayrı kadrajlanır.
 */
export function applyCamera(
  cam: THREE.PerspectiveCamera,
  spec: ResolvedCamera,
  local: number,
  duration: number,
  aspect: number,
  scene: CameraScene,
  /** Film zamanı (sn); el kamerası sallantısı çekimler arasında kesintisiz aksın diye. */
  filmTime = 0,
): THREE.Vector3 {
  const k = EASES[spec.ease](clamp(local / duration));
  const f = lerp(sizeFactor(pick(spec.size, 'from')), sizeFactor(pick(spec.size, 'to')), k);
  const az = deg(lerp(pick(spec.angle, 'from'), pick(spec.angle, 'to'), k)) + (spec.relative ? scene.facing(spec.target) : 0);
  const el = deg(lerp(pick(spec.elevation, 'from'), pick(spec.elevation, 'to'), k));

  const right = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
  const s = scene.subject(spec.target, right);

  const tanHalf = Math.tan(deg(spec.fov) / 2);
  const aim = s.center.clone();
  aim.y += s.height * aimRatio(f);
  // Yakın planda tüm genişliğin sığması gerekmez; plan daraldıkça gereken genişlik azalır.
  // Ama dar (dikey) karede plan boyuna oranla bir alt genişlik korunur; yoksa yakın plan yüze girer.
  const minWidthRatio = lerp(0.75, 0.4, clamp((f - SIZE_FACTORS.close) / (SIZE_FACTORS.full - SIZE_FACTORS.close)));
  const needWidth = Math.max(s.width * Math.min(1, f / SIZE_FACTORS.full), f * s.height * minWidthRatio) * 1.15;
  const dist = Math.max((f * s.height) / 2 / tanHalf, needWidth / 2 / (tanHalf * aspect));

  cam.position.set(
    aim.x + Math.sin(az) * Math.cos(el) * dist,
    aim.y + Math.sin(el) * dist,
    aim.z + Math.cos(az) * Math.cos(el) * dist,
  );
  if (spec.handheld > 0) {
    // Birkaç düşük frekanslı sinüsün toplamı: nefes alan bir operatör gibi, tekrar etmeyen ve
    // deterministik sallantı. Genlik kamera mesafesiyle orantılı (her plan boyunda aynı his).
    const n = (f: number, ph: number) => Math.sin(filmTime * f + ph) * 0.6 + Math.sin(filmTime * f * 2.17 + ph * 1.7) * 0.4;
    const amp = spec.handheld * dist * 0.012;
    cam.position.x += n(1.1, 0.3) * amp;
    cam.position.y += n(0.9, 1.9) * amp * 0.7;
    cam.position.z += n(1.3, 4.1) * amp;
    aim.x += n(0.7, 2.2) * amp * 0.5;
    aim.y += n(0.8, 5.0) * amp * 0.5;
  }
  cam.fov = spec.fov;
  cam.aspect = aspect;
  cam.updateProjectionMatrix();
  cam.lookAt(aim);
  return aim;
}
