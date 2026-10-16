import * as THREE from 'three';

export type Expression = 'happy' | 'sad' | 'surprised' | 'angry';
export type Side = 'left' | 'right';

export interface ClipState {
  name: string;
  time: number;
  weight: number;
  loop: boolean;
}

/**
 * Bir karakterin belirli bir andaki tüm hareket bilgisi. Zaman çizelgesinden saf
 * fonksiyon olarak hesaplanır, sonra rig'e uygulanır. Rig türü (placeholder veya GLB)
 * bu bilgiyi kendi iskeletine nasıl yansıtacağına kendisi karar verir.
 */
export interface Pose {
  time: number;
  position: THREE.Vector3;
  facing: number;
  /** Yürüme sekmesi (m). */
  bob: number;
  /** Zıplama yüksekliği (m) ve squash/stretch (0 = normal, + uzama, - basılma). */
  jumpLift: number;
  squash: number;
  breathe: number;
  sway: number;

  walkWeight: number;
  walkTime: number;
  /** Yürüme hızı (m/sn); yürüme klibinin oynatma hızı buna göre ölçeklenir. */
  walkSpeed: number;
  /** Bu yürüyüşte kullanılacak klip (boşsa "walk"). */
  walkClip: string;
  legSwing: number;
  /** legSwing'in değişim yönü (-1..1, zarfla ölçekli): - iken sol bacak öne geliyor. */
  legSwingVelocity: number;
  armSwing: number;
  raise: Record<Side, number>;
  wave: Record<Side, number>;
  waveWeight: number;
  waveTime: number;
  jumpWeight: number;
  jumpTime: number;

  headYaw: number;
  headPitch: number;
  blink: number;
  mouth: number;
  expr: Record<Expression, number>;
  clips: ClipState[];
}

export function createPose(): Pose {
  return {
    time: 0,
    position: new THREE.Vector3(),
    facing: 0,
    bob: 0,
    jumpLift: 0,
    squash: 0,
    breathe: 0,
    sway: 0,
    walkWeight: 0,
    walkTime: 0,
    walkSpeed: 0,
    walkClip: '',
    legSwing: 0,
    legSwingVelocity: 0,
    armSwing: 0,
    raise: { left: 0, right: 0 },
    wave: { left: 0, right: 0 },
    waveWeight: 0,
    waveTime: 0,
    jumpWeight: 0,
    jumpTime: 0,
    headYaw: 0,
    headPitch: 0,
    blink: 0,
    mouth: 0,
    expr: { happy: 0, sad: 0, surprised: 0, angry: 0 },
    clips: [],
  };
}

export function resetPose(p: Pose) {
  p.bob = p.jumpLift = p.squash = p.breathe = p.sway = 0;
  p.walkWeight = p.walkTime = p.walkSpeed = p.legSwing = p.legSwingVelocity = p.armSwing = 0;
  p.raise.left = p.raise.right = p.wave.left = p.wave.right = 0;
  p.waveWeight = p.waveTime = p.jumpWeight = p.jumpTime = 0;
  p.headYaw = p.headPitch = p.blink = p.mouth = 0;
  p.expr.happy = p.expr.sad = p.expr.surprised = p.expr.angry = 0;
  p.clips.length = 0;
  p.walkClip = '';
}

/** Rig: bir pozu sahnedeki nesnelere uygulayan katman. */
export interface Rig {
  readonly root: THREE.Object3D;
  /** Ayaktan tepeye yükseklik (m). Kamera kadrajı için kullanılır. */
  readonly height: number;
  readonly width: number;
  apply(pose: Pose): void;
  /** Klip varsa süresi (s); placeholder rig'lerde yok. */
  clipDuration?(name: string): number | undefined;
  /** Shader ısıtması için yalnızca zaman zaman görünen malzemeleri (ör. kapalı göz) sahneye koyar; geri alma döndürür. */
  prepareWarmup?(): () => void;
  /** Arazi yüksekliği verilirse ayaklar eğimli zemine basar (ayak IK'sı). */
  setGround?(ground: (x: number, z: number) => number | null): void;
  /**
   * Ayak sesleri için yürüme/koşu klibinin ritmi: klip süresi (period), verilen hızdaki oynatma hızı ve
   * ayakların yere bastığı klip anları. Klip zamanı = sahne zamanı × rate (mod period).
   */
  gait?(clip: string, speed: number): { period: number; rate: number; contacts: number[] } | undefined;
}
