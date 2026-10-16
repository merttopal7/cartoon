import * as THREE from 'three';
import type { Action } from '../schema';
import { TAU, angleLerp, clamp, deg, easeInOut, envelope, hash, lerp, seedFrom, wrapAngle } from './math';
import { createPose, resetPose, type Pose, type Rig } from './pose';

export interface SceneContext {
  positionOf(id: string, t: number): THREE.Vector3;
  headOf(id: string, t: number): THREE.Vector3;
  cameraPosition: THREE.Vector3;
  voiceState?(id: string, t: number): { hasCue: boolean; active: boolean; level: number } | null;
}

/** Yürümeye başlarken yola dönme hızı (rad/sn); yetenek dönüşleriyle aynı. */
const WALK_TURN_SPEED = (320 * Math.PI) / 180;

/** Yürüme yolunun köşelerinde yuvarlatma yarıçapı (m) ve yay başına örnek sayısı. */
const CORNER_RADIUS = 2.0;
const CORNER_SAMPLES = 8;

/**
 * Ara noktalardaki köşeleri ikinci derece Bézier yaylarıyla yuvarlar (yarıçap komşu bölümlerin %45'ini
 * geçmez). Köşeli yolda hız yönü tek karede değişiyordu: 6.9 m/sn koşuda 40°'lik köşe ≈ 4.7 m/sn sıçrama.
 */
function roundCorners(points: THREE.Vector3[]): THREE.Vector3[] {
  if (points.length < 3) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const p = points[i];
    const next = points[i + 1];
    const lenIn = horizontalDistance(prev, p);
    const lenOut = horizontalDistance(p, next);
    const r = Math.min(CORNER_RADIUS, lenIn * 0.45, lenOut * 0.45);
    const dirIn = new THREE.Vector3().subVectors(p, prev).normalize();
    const dirOut = new THREE.Vector3().subVectors(next, p).normalize();
    if (r < 0.05 || dirIn.dot(dirOut) > 0.996) {
      out.push(p);
      continue;
    }
    const a = p.clone().addScaledVector(dirIn, -r);
    const b = p.clone().addScaledVector(dirOut, r);
    for (let k = 0; k <= CORNER_SAMPLES; k++) {
      const u = k / CORNER_SAMPLES;
      out.push(
        new THREE.Vector3()
          .addScaledVector(a, (1 - u) * (1 - u))
          .addScaledVector(p, 2 * u * (1 - u))
          .addScaledVector(b, u * u),
      );
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Yürüme yolu: noktalardan geçen, köşeleri yuvarlatılmış çoklu doğru. Konum mesafeye göre, yön yumuşatılmış teğetten. */
class WalkPath {
  private readonly cum: number[] = [0];
  readonly length: number;
  readonly points: THREE.Vector3[];

  constructor(points: THREE.Vector3[]) {
    this.points = roundCorners(points);
    for (let i = 1; i < this.points.length; i++) this.cum.push(this.cum[i - 1] + horizontalDistance(this.points[i - 1], this.points[i]));
    this.length = this.cum[this.cum.length - 1];
  }

  get end() {
    return this.points[this.points.length - 1];
  }

  /** Yol üzerinde p'ye en yakın örnek noktanın baştan mesafesi. */
  distanceTo(p: THREE.Vector3): number {
    let best = 0;
    let bestD = Infinity;
    this.points.forEach((q, i) => {
      const d = horizontalDistance(p, q);
      if (d < bestD) {
        bestD = d;
        best = this.cum[i];
      }
    });
    return best;
  }

  at(s: number, out: THREE.Vector3): THREE.Vector3 {
    const pts = this.points;
    if (pts.length === 1 || s <= 0) return out.copy(pts[0]);
    if (s >= this.length) return out.copy(this.end);
    let i = 1;
    while (this.cum[i] < s) i++;
    const seg = this.cum[i] - this.cum[i - 1];
    return out.lerpVectors(pts[i - 1], pts[i], seg > 0 ? (s - this.cum[i - 1]) / seg : 0);
  }

  /** s noktasındaki yürüme yönü; köşelerde ani dönüş olmasın diye ±0.6 m aralığın kirişinden. */
  heading(s: number): number | null {
    if (this.length < 1e-3) return null;
    const a = this.at(Math.max(0, s - 0.6), new THREE.Vector3());
    const b = this.at(Math.min(this.length, s + 0.6), new THREE.Vector3());
    return Math.atan2(b.x - a.x, b.z - a.z);
  }
}

const horizontalDistance = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(b.x - a.x, b.z - a.z);
const toVec = (p: number[]) => (p.length === 2 ? new THREE.Vector3(p[0], 0, p[1]) : new THREE.Vector3(p[0], p[1], p[2]));

/** Birleşik bir yürüyüşün bir bölümü: [start, end] zamanında yol üzerinde s0 → s1 mesafesi. */
interface WalkLeg {
  start: number;
  end: number;
  s0: number;
  s1: number;
}

interface TimedAction {
  action: Action;
  start: number;
  end: number;
  walk?: WalkPath;
  /** Yürüyüşün zamanlaması; ardışık walk_to'lar birleşince her biri kendi süresini korur. */
  legs?: WalkLeg[];
  knockback?: {
    path: WalkPath;
    arcHeight: number;
  };
  /**
   * Yeni bir hareket bu yürüyüşü/savrulmayı yarıda kestiyse kesilme anı. Kesilmeden önceki hareket
   * yazıldığı gibi kalır; konum bu anda donar (yeni hareket buradan devam eder).
   */
  cutAt?: number;
}

/** Oynarken karakterin otomatik güldüğü klipler. */
const HAPPY_CLIP = /jump_?joy|danc|hip_?hop|celebrat|cheer|victory|singing|^happy$/i;

/** Kesilen yürüyüşün animasyonunun ve savrulma yayının sönümlenme süresi (sn). */
const CUT_FADE = 0.3;

/** Yürüyüşün t anında yol üzerinde aldığı mesafe; ilk bölüm hızlanarak başlar, son bölüm yavaşlayarak biter. */
function walkDistance(ta: TimedAction, t: number): number {
  const legs = ta.legs!;
  const tt = Math.min(t, ta.cutAt ?? Infinity);
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    if (tt > leg.end && i < legs.length - 1) continue;
    const dur = Math.max(leg.end - leg.start, 1e-3);
    const ramp = Math.min(0.15, 0.6 / dur);
    const k = clamp((tt - leg.start) / dur);
    return leg.s0 + (leg.s1 - leg.s0) * rampProgress(k, i === 0 ? ramp : 0, i === legs.length - 1 ? ramp : 0);
  }
  return 0;
}

const tmp = new THREE.Vector3();

/**
 * Sahnedeki bir karakter: başlangıç konumu + zamanlanmış hareketler.
 * `computeBody` / `computeLook` yalnızca t'ye bağlıdır; aynı t her zaman aynı pozu verir.
 */
export class Character {
  readonly pose: Pose = createPose();
  private readonly timed: TimedAction[] = [];
  private readonly seed: number;
  private lastWalkEnd: THREE.Vector3;

  constructor(
    readonly id: string,
    readonly rig: Rig,
    private readonly start: THREE.Vector3,
    private readonly startFacing: number,
    /** Arazi varsa (x, z) için zemin yüksekliği; karakter yüzeye basar. */
    private readonly groundAt?: (x: number, z: number) => number | null,
  ) {
    this.seed = seedFrom(id);
    this.lastWalkEnd = start.clone();
  }

  /**
   * Yeni bir yürüyüş veya savrulma (knockback) başladığında, karakterin o andaki gerçek konumunu
   * döndürür ve hala devam eden önceki hareketleri bu noktada sonlandırır; böylece konumda
   * asla sıçrama / ışınlanma (discontinuity) oluşmaz.
   */
  private beginMoveAt(start: number): THREE.Vector3 {
    const posNow = this.positionAt(start, new THREE.Vector3());
    posNow.y = 0;
    // Yol ve süre değiştirilmez (eskiden yol başlangıçtan kesilme noktasına düz çizgiye çevriliyordu ve
    // kesilmeden önceki hareket de geriye dönük değişiyordu); yalnızca kesilme anı işaretlenir.
    for (const ta of this.timed) {
      if (!ta.walk && !ta.knockback) continue;
      if (ta.start < start && ta.end > start) ta.cutAt = Math.min(ta.cutAt ?? Infinity, start);
    }
    this.lastWalkEnd.copy(posNow);
    return posNow;
  }

  /** Özel yetenek isabetinde düşmanı geriye doğru parabolik yay çizerek savurur (yüzü saldıran karaktere dönük kalır). */
  scheduleKnockback(to: [number, number], start: number, duration = 0.85, arcHeight = 1.1) {
    const fromPos = this.beginMoveAt(start);
    const dest = new THREE.Vector3(to[0], 0, to[1]);
    const path = new WalkPath([fromPos, dest]);
    this.lastWalkEnd = path.end.clone();
    const dummyAction: Action = { who: this.id, do: 'jump', at: start, duration, height: arcHeight };
    this.timed.push({
      action: dummyAction,
      start,
      end: start + duration,
      knockback: { path, arcHeight },
    });
    this.timed.sort((a, b) => a.start - b.start);
    this.resolveTimelineOverlaps();
  }

  /**
   * Zaman çizelgesinde üst üste binen ardışık klip ve savrulma (knockback) eylemlerini hizalar:
   * - Önceki bir tepki/kaçınma klibi (ör. dodge_back / impact) karakterin bir sonraki yetenek
   *   veya eylem klibinin başlangıcını aşıyorsa, yeni klibin başlangıcında kesilir.
   * - Savrulma (knockback) süresi karakterin bir sonraki yetenek klibinin başlangıcını aşıyorsa,
   *   karakter yeni yeteneğe başlamadan hemen önce yere inmiş olacak şekilde kısaltılır.
   */
  private resolveTimelineOverlaps() {
    const clips = this.timed.filter((ta) => ta.action.do === 'clip');
    for (let i = 0; i < clips.length - 1; i++) {
      const curr = clips[i];
      const next = clips[i + 1];
      if (curr.start < next.start && curr.end > next.start) {
        curr.end = next.start;
      }
    }
    for (const kb of this.timed) {
      if (!kb.knockback) continue;
      for (const c of clips) {
        if (c.start > kb.start + 0.15 && kb.end > c.start - 0.02) {
          kb.end = Math.max(kb.start + 0.25, c.start - 0.02);
          break;
        }
      }
    }
  }

  /** Hareketleri başlangıç zamanına göre sıralı çağırın (yürüyüşler bir öncekinin bittiği yerden başlar). */
  schedule(action: Action, start: number, warn: (msg: string) => void) {
    if (action.do === 'ability') {
      return;
    }
    let duration: number;
    let walk: WalkPath | undefined;

    if (action.do === 'walk_to') {
      const targets = typeof action.to[0] === 'number' ? [action.to as number[]] : (action.to as number[][]);
      const newPts = targets.map(toVec);

      // Ardışık walk_to eylemlerini (ör. çekim geçişlerinde bölünmüş yürüyüş/koşuları) tek kesintisiz yolda birleştir
      const prev = [...this.timed].reverse().find((ta) => ta.action.do === 'walk_to');
      if (
        prev &&
        prev.walk &&
        prev.action.do === 'walk_to' &&
        Math.abs(start - prev.end) <= 0.35 &&
        (prev.action.clip ?? '') === (action.clip ?? '') &&
        // Kesilmiş yürüyüşe ya da araya savrulma girmişse birleştirilmez (konum donar / ışınlanırdı)
        prev.cutAt === undefined &&
        !this.timed.some((ta) => ta.knockback && ta.start >= prev.start && ta.start <= start)
      ) {
        const mergedWalk = new WalkPath([...prev.walk.points, ...newPts]);
        const addDur = action.duration ?? Math.max(0.3, new WalkPath([this.lastWalkEnd.clone(), ...newPts]).length / action.speed);
        // Her bölüm kendi süresini korur (eskiden toplam süre tüm yola yayılıyor, önceki bölümün hızı
        // geriye dönük değişiyordu); yalnızca bölümler arasındaki yavaşlama/hızlanma kalkar.
        const legs = prev.legs!;
        const last = legs[legs.length - 1];
        const junction = Math.min(mergedWalk.distanceTo(prev.walk.end), mergedWalk.length);
        last.s1 = Math.max(last.s0, junction);
        legs.push({ start: last.end, end: Math.max(last.end + 0.05, start + addDur), s0: last.s1, s1: mergedWalk.length });
        prev.walk = mergedWalk;
        prev.end = legs[legs.length - 1].end;
        this.lastWalkEnd = mergedWalk.end.clone();
        return;
      }

      const fromPos = this.beginMoveAt(start);
      walk = new WalkPath([fromPos, ...newPts]);
      duration = action.duration ?? Math.max(0.3, walk.length / action.speed);
      this.lastWalkEnd = walk.end.clone();
    } else if (action.do === 'clip') {
      const clipLen = this.rig.clipDuration?.(action.name);
      if (clipLen === undefined) warn(`"${this.id}": "${action.name}" adlı animasyon klibi bulunamadı, atlanıyor`);
      duration = action.duration ?? clipLen ?? 1;

      // Ardışık aynı isimli clip eylemlerini birleştir (çekim geçişinde baştan başlamasını önle)
      const prevClip = [...this.timed].reverse().find((ta) => ta.action.do === 'clip');
      if (
        prevClip &&
        prevClip.action.do === 'clip' &&
        prevClip.action.name === action.name &&
        Math.abs(start - prevClip.end) <= 0.35
      ) {
        prevClip.end = start + duration;
        this.resolveTimelineOverlaps();
        return;
      }
    } else {
      duration = action.duration;
    }
    // Sesli konuşma eylemleri ses başlamadan önce ağız açılışını yakalayabilmeli (arayüzden 2000ms'ye kadar dinamik ayarlanabilir)
    const lead = action.do === 'talk' && action.audio ? 2.0 : 0;
    const legs = walk ? [{ start, end: start + duration, s0: 0, s1: walk.length }] : undefined;
    this.timed.push({ action, start: Math.max(0, start - lead), end: start + duration, walk, legs });
    this.timed.sort((a, b) => a.start - b.start);
    this.resolveTimelineOverlaps();
  }

  /** Yalnızca yürüyüşlere ve savrulmalara (knockback) bağlı konum. */
  positionAt(t: number, out: THREE.Vector3): THREE.Vector3 {
    out.copy(this.start);
    for (const ta of this.timed) {
      if (t < ta.start) break;
      if (ta.knockback) {
        const k = clamp((Math.min(t, ta.cutAt ?? Infinity) - ta.start) / (ta.end - ta.start));
        const eased = 1 - Math.pow(1 - k, 2.4);
        ta.knockback.path.at(eased * ta.knockback.path.length, out);
        continue;
      }
      if (!ta.walk) continue;
      ta.walk.at(walkDistance(ta, t), out);
    }
    if (this.groundAt) out.y = this.groundAt(out.x, out.z) ?? out.y;
    return out;
  }

  /**
   * Ses efektleri için hareket olayları (sahne zamanı, karakterin hit-stop'lu zamanı):
   * - step: ayağın yere bastığı anlar (klibin gerçek basış anlarından; klipsiz karakterde bacak salınımından),
   *   weight = yürüyüşün o anki ağırlığı (başlarken/biterken azalır)
   * - land: savrulmanın ya da zıplamanın yere iniş anı
   */
  motionEvents(): { kind: 'step' | 'land'; time: number; weight: number; run: boolean }[] {
    const out: { kind: 'step' | 'land'; time: number; weight: number; run: boolean }[] = [];
    for (const ta of this.timed) {
      const a = ta.action;
      if (ta.knockback) {
        out.push({ kind: 'land', time: Math.min(ta.end, ta.cutAt ?? Infinity), weight: 1, run: false });
        continue;
      }
      if (a.do === 'jump') {
        out.push({ kind: 'land', time: ta.start + (ta.end - ta.start) * 0.8, weight: 0.6, run: false });
        continue;
      }
      if (a.do !== 'walk_to' || !ta.walk) continue;
      const dur = ta.end - ta.start;
      const end = ta.cutAt !== undefined ? Math.min(ta.end, ta.cutAt + CUT_FADE) : ta.end;
      const speed = ta.walk.length / dur;
      const clip = a.clip ?? '';
      const run = /run|jog|sprint/i.test(clip) || speed > 2.5;
      const weightAt = (t: number) => {
        const cutFade = ta.cutAt !== undefined && t > ta.cutAt ? 1 - easeInOut(clamp((t - ta.cutAt) / CUT_FADE)) : 1;
        return envelope(t, ta.start, dur, 0.35) * cutFade;
      };
      const times: number[] = [];
      const gait = this.rig.gait?.(clip, speed);
      if (gait) {
        // Klip zamanı = t × rate (mod period) → basış anı c için t = (k·period + c) / rate
        const k0 = Math.floor((ta.start * gait.rate) / gait.period) - 1;
        const k1 = Math.ceil((end * gait.rate) / gait.period);
        for (let k = k0; k <= k1; k++) for (const c of gait.contacts) times.push((k * gait.period + c) / gait.rate);
      } else {
        // Prosedürel yürüyüş: bacak salınımının uç noktaları (faz π/2 + mπ)
        const w = (speed / (this.rig.height * 0.72)) * TAU;
        for (let m = Math.floor((ta.start * w) / Math.PI) - 1; m <= Math.ceil((end * w) / Math.PI); m++) times.push((Math.PI / 2 + m * Math.PI) / w);
      }
      for (const t of times.sort((x, y) => x - y)) {
        if (t < ta.start || t > end) continue;
        const weight = weightAt(t);
        if (weight > 0.25) out.push({ kind: 'step', time: t, weight, run });
      }
    }
    return out.sort((x, y) => x.time - y.time);
  }

  /** Gövdenin baktığı yön (radyan, 0 = +Z). Yürüyüş yönü ve turn hareketlerinden hesaplanır. */
  facingAt(t: number, ctx: SceneContext): number {
    const pos = this.positionAt(t, new THREE.Vector3());
    let facing = this.startFacing;
    for (const ta of this.timed) {
      if (t < ta.start) break;
      if (ta.knockback) continue;
      const a = ta.action;
      if (a.do === 'walk_to' && ta.walk) {
        const heading = ta.walk.heading(walkDistance(ta, t));
        if (heading !== null) {
          // Dönüş yönü yürüyüşün başında bir kez seçilir; ~180°'lik dönüşte en kısa yön kareden kareye
          // sağ/sol arasında gidip geliyordu. Süre açıyla orantılı: geri dönüp koşmak 0.35 sn'ye sıkışmaz.
          const h0 = ta.walk.heading(0) ?? heading;
          const delta0 = wrapAngle(h0 - facing);
          const target = facing + delta0 + wrapAngle(heading - h0);
          const blend = clamp(Math.abs(delta0) / WALK_TURN_SPEED, 0.35, 0.7);
          facing = lerp(facing, target, easeInOut(clamp((t - ta.start) / blend)));
        }
      } else if (a.do === 'turn') {
        let target: number;
        if (typeof a.to === 'number') target = deg(a.to);
        else {
          const o = ctx.positionOf(a.to, t);
          target = Math.atan2(o.x - pos.x, o.z - pos.z);
        }
        facing = angleLerp(facing, target, easeInOut(clamp((t - ta.start) / (ta.end - ta.start))));
      }
    }
    return facing;
  }

  /** Gövde pozu: konum, yön, yürüme, zıplama, el sallama, ifadeler, konuşma. */
  computeBody(t: number, ctx: SceneContext) {
    const p = this.pose;
    resetPose(p);
    p.time = t;
    this.positionAt(t, p.position);
    p.facing = this.facingAt(t, ctx);

    for (const ta of this.timed) {
      if (ta.action.do === 'clip') {
        // Sevinç klipleri (sevinçle zıplama, dans) sırasında yüz güler
        if (HAPPY_CLIP.test(ta.action.name) && t >= ta.start && t <= ta.end) {
          p.expr.happy = Math.max(p.expr.happy, envelope(t, ta.start, ta.end - ta.start, 0.3));
        }
        continue;
      }
      const end = ta.cutAt !== undefined ? Math.min(ta.end, ta.cutAt + CUT_FADE) : ta.end;
      if (t < ta.start || t > end) continue;
      const a = ta.action;
      const local = t - ta.start;
      const dur = ta.end - ta.start;
      // Kesilmiş hareket kesilme anından sonra CUT_FADE içinde söner
      const cutFade = ta.cutAt !== undefined && t > ta.cutAt ? 1 - easeInOut(clamp((t - ta.cutAt) / CUT_FADE)) : 1;

      if (ta.knockback) {
        const u = clamp((Math.min(t, ta.cutAt ?? Infinity) - ta.start) / dur);
        p.jumpLift += Math.sin(u * Math.PI) * ta.knockback.arcHeight * cutFade;
        continue;
      }

      switch (a.do) {
        case 'walk_to': {
          const env = envelope(t, ta.start, dur, 0.35) * cutFade;
          const speed = ta.walk ? ta.walk.length / dur : 1;
          // Adım uzunluğu boya oranlı (bir döngü = iki adım ≈ boyun %72'si); frekans = hız / döngü boyu.
          // Sürekli sahne zamanı (t) kullanılarak yürüyüş/koşu döngüsünün sıfırlanması önlenir.
          const phase = t * (speed / (this.rig.height * 0.72)) * TAU;
          p.legSwing += Math.sin(phase) * 0.7 * env;
          p.legSwingVelocity += Math.cos(phase) * env;
          p.armSwing += -Math.sin(phase) * 0.5 * env;
          p.bob += Math.abs(Math.sin(phase)) * 0.05 * env;
          p.walkWeight = Math.max(p.walkWeight, env);
          p.walkTime = t;
          p.walkSpeed = speed;
          p.walkClip = a.clip ?? '';
          break;
        }
        case 'jump': {
          const u = local / dur;
          p.jumpWeight = 1;
          p.jumpTime = local;
          if (u < 0.25) {
            // hazırlık: çömelme
            p.squash += -0.22 * Math.sin((Math.PI / 2) * (u / 0.25));
          } else if (u < 0.8) {
            const v = (u - 0.25) / 0.55;
            p.jumpLift += a.height * 4 * v * (1 - v);
            const ramp = Math.min(clamp(v / 0.12), clamp((1 - v) / 0.12));
            p.squash += 0.16 * Math.abs(Math.cos(Math.PI * v)) * ramp - 0.22 * clamp(1 - v / 0.12);
            p.raise.left += 0.9 * Math.sin(Math.PI * v);
            p.raise.right += 0.9 * Math.sin(Math.PI * v);
          } else {
            // iniş: basılma ve toparlanma
            p.squash += -0.25 * Math.sin(Math.PI * ((u - 0.8) / 0.2));
          }
          break;
        }
        case 'wave': {
          const env = envelope(t, ta.start, dur, 0.3);
          p.raise[a.hand] = Math.max(p.raise[a.hand], 2.5 * env);
          p.wave[a.hand] += Math.sin(local * TAU * 2.2) * 0.35 * env;
          p.waveWeight = Math.max(p.waveWeight, env);
          p.waveTime = local;
          break;
        }
        case 'talk': {
          if (a.audio) {
            // Ses dosyası tanımlı: ağız HASSAS VE KESİNLİKLE ses dosyasının çalma süresine kilitlidir
            const vs = ctx.voiceState?.(this.id, t);
            if (!vs || !vs.active) {
              // Ses başlamadan önce veya bittikten hemen sonra ağız kesinlikle kapalı kalır
              break;
            }
            // Ses boyunca ağzın açık kalmasını sağlayan taban açıklık (0.38)
            const baseOpen = 0.38;
            // Konuşma hece ritmi (~4.5 Hz)
            const sinSyllable = 0.5 + 0.5 * Math.sin(local * TAU * 4.5);
            // Ses şiddetiyle modülasyon
            const intensity = Math.max(0.4, vs.level * 1.3);
            const flap = baseOpen + (1 - baseOpen) * Math.min(1, sinSyllable * intensity);
            p.mouth = Math.max(p.mouth, clamp(flap, 0, 1));
          } else {
            // Ses dosyası hiç tanımlı değilse süreye göre yumuşak konuşma
            const env = envelope(t, ta.start, dur, 0.05);
            const baseOpen = 0.38;
            const sinSyllable = 0.5 + 0.5 * Math.sin(local * TAU * 4.5);
            const flap = baseOpen + (1 - baseOpen) * sinSyllable;
            p.mouth = Math.max(p.mouth, clamp(flap, 0, 1) * env);
          }

          // Konuşurken doğal baş hareketleri
          const vs = a.audio ? ctx.voiceState?.(this.id, t) : null;
          const headEnv = a.audio ? (vs?.active ? 1.0 : 0.0) : envelope(t, ta.start, dur, 0.1);
          p.headPitch += Math.sin(local * TAU * 2.1 + 0.5) * 0.08 * headEnv;
          p.headYaw += Math.sin(local * TAU * 1.05 + this.seed) * 0.05 * headEnv;
          break;
        }
        case 'emote':
          p.expr[a.expression] = Math.max(p.expr[a.expression], envelope(t, ta.start, dur, 0.25));
          break;
      }
    }

    // Animasyon klipleri: ardışık klipler (ör. draw_arrow -> aim_overdraw -> aim_recoil) arasında
    // idle pozuna düşmeden doğrudan çapraz geçiş (crossfade, w_prev + w_next = 1.0) yapılır.
    const clipActions = this.timed.filter((ta) => ta.action.do === 'clip');
    for (let i = 0; i < clipActions.length; i++) {
      const curr = clipActions[i];
      const a = curr.action as Extract<Action, { do: 'clip' }>;
      const dur = curr.end - curr.start;
      if (dur <= 0) continue;

      const prev = i > 0 && Math.abs(curr.start - clipActions[i - 1].end) <= 0.08 ? clipActions[i - 1] : null;
      const next =
        i + 1 < clipActions.length && Math.abs(clipActions[i + 1].start - curr.end) <= 0.08
          ? clipActions[i + 1]
          : null;

      const prevDur = prev ? prev.end - prev.start : 0;
      const nextDur = next ? next.end - next.start : 0;
      const nextA = next ? (next.action as Extract<Action, { do: 'clip' }>) : null;

      // Ardışık iki klip arasındaki geçiş yeni klibin `fade` süresi kadardır (kısa klipte en çok %40'ı);
      // sabit kısa bir üst sınır, pozları çok farklı kliplerde (ör. capoeira → breakdance) sıçrama yapıyordu.
      const cfIn = prev
        ? Math.min(a.fade, dur * 0.4, prevDur * 0.4)
        : Math.min(a.fade, dur * 0.35);
      const cfOut =
        next && nextA
          ? Math.min(nextA.fade, nextDur * 0.4, dur * 0.4)
          : Math.min(a.fade, dur * 0.35);

      // Pencereler bitişik ve yarı açıktır: çıkan klip sonraki klip başlayana kadar tam ağırlıkta sürer,
      // solma kolu tam o anda başlar. (77.6 + 3.6 = 81.1999… gibi kayan nokta sınırlarında, kare tam
      // sınıra denk gelince hiçbir klip seçilmiyor ve karakter tek kare idle pozuna düşüyordu.)
      const activeUntil = next ? next.start : curr.end;
      const inMain = t >= curr.start && (next ? t < activeUntil : t <= activeUntil);
      if (inMain) {
        const local = t - curr.start;
        const wIn = cfIn > 0 && local < cfIn ? easeInOut(local / cfIn) : 1;
        const wOut = !next && cfOut > 0 && dur - local < cfOut ? easeInOut((dur - local) / cfOut) : 1;
        const weight = Math.min(wIn, wOut);
        if (weight > 0) {
          p.clips.push({ name: a.name, time: local, weight, loop: a.loop });
        }
      } else if (next && cfOut > 0 && t >= next.start && t < next.start + cfOut) {
        const weight = 1 - easeInOut((t - next.start) / cfOut);
        if (weight > 0) {
          const local = t - curr.start;
          p.clips.push({
            name: a.name,
            time: a.loop ? local : Math.min(local, dur + cfOut),
            weight,
            loop: a.loop,
          });
        }
      }
    }

    p.blink = this.blinkAt(t);
    p.breathe = Math.sin((t * TAU) / 3.2 + this.seed) * 0.015;
    p.sway = Math.sin((t * TAU) / 4.3 + this.seed * 2) * 0.03 * (1 - p.walkWeight);
  }

  /** Bakış: kameranın konumu belli olduktan sonra ikinci geçişte hesaplanır. */
  computeLook(t: number, ctx: SceneContext) {
    const p = this.pose;
    const headY = p.position.y + p.jumpLift + this.rig.height * 0.8;
    for (const ta of this.timed) {
      if (ta.action.do !== 'look_at' || t < ta.start || t > ta.end) continue;
      const a = ta.action;
      const env = envelope(t, ta.start, ta.end - ta.start, 0.5);
      const target =
        a.target === 'camera' ? ctx.cameraPosition : typeof a.target === 'string' ? ctx.headOf(a.target, t) : tmp.set(...a.target);
      const dx = target.x - p.position.x;
      const dz = target.z - p.position.z;
      const yaw = clamp(wrapAngle(Math.atan2(dx, dz) - p.facing), -1.1, 1.1);
      const pitch = clamp(Math.atan2(target.y - headY, Math.hypot(dx, dz)), -0.5, 0.5);
      p.headYaw = lerp(p.headYaw, yaw, env);
      p.headPitch = lerp(p.headPitch, -pitch, env);
    }
  }

  /** Düzensiz ama deterministik göz kırpma. */
  private blinkAt(t: number): number {
    let at = 0.6 + hash(this.seed) * 1.5;
    for (let i = 1; at <= t; i++) {
      const d = t - at;
      if (d < 0.16) return Math.sin((Math.PI * d) / 0.16);
      at += 2 + hash(this.seed + i * 13.7) * 3;
    }
    return 0;
  }
}

/**
 * Yamuk hız profili: k ∈ [0, 1] → yol oranı. Başta `rampIn`, sonda `rampOut` oranında sabit ivmeyle
 * hızlanır/yavaşlar (0 = rampa yok), ortası sabit hızlıdır. Rampalar en çok 0.6 sn sürer (çağıran ayarlar).
 */
function rampProgress(k: number, rampIn: number, rampOut: number): number {
  const v = 1 / (1 - rampIn / 2 - rampOut / 2);
  if (rampIn > 0 && k < rampIn) return (v * k * k) / (2 * rampIn);
  if (rampOut > 0 && k > 1 - rampOut) return 1 - (v * (1 - k) * (1 - k)) / (2 * rampOut);
  return v * (k - rampIn / 2);
}
