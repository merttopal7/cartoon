import * as THREE from 'three';
import type { Action, CameraDef, CameraTarget, OverlayDef, Scenario, TransitionType } from '../schema';
import type { FormatPreset } from '../formats';
import { waitForPendingLoads, type AssetLibrary } from './assets';
import { applyCamera, resolveCamera, type Subject } from './camera';
import { Character, type SceneContext } from './character';
import { buildEnvironment } from './environment';
import { EASES, clamp, deg, wrapAngle } from './math';
import { Heightfield } from './terrain';
import { disposeTree } from './toon';
import { setupVegetationWind, type WindSystem } from './wind';
import { AudioTimeline, type AudioCue } from './audio';
import { buildSceneRenderDetails } from './details';
import { loadOverlayFonts, renderMotionGraphicsLayer, type TransitionCue } from './motion-graphics';
import { AbilitySystem, type AbilityRecipe, type ActiveAbilityHUDInfo } from './abilities';
import { buildRecipe, resolveAbility } from './ability-registry';
import { setupLods } from './lod';
import { CLEARANCE_SAMPLE_STEP, CameraClearance, type CameraSample } from './camera-clearance';
import { ImpactFeel } from './impact';
import { FocusTrack } from './focus-track';
import { RoadPath } from './road';
import { buildSfx } from './sfx/cues';

export interface BuiltShot {
  index: number;
  start: number;
  duration: number;
  camera: CameraDef;
  transition: TransitionType;
}

export interface FilmOptions {
  fadeIn: number;
  fadeOut: number;
  handheld: number;
}

/** Çekimler arası karartmalı geçişin yarım süresi (sn): önceki çekim kararır, yenisi açılır. */
const SHOT_FADE = 0.4;
/** Element adları (uyarılar için). */
const ELEMENT_NAMES: Record<string, string> = { ates: 'ateş', su: 'su', toprak: 'toprak', hava: 'hava', golge: 'gölge' };
/** Yetenek kliplerinin birbirine ve idle'a geçiş süresi (reçetede klip başına ezilebilir). */
const ABILITY_CLIP_FADE = 0.3;
/** Dönüş hızı (rad/sn) ve süre sınırları (sn). */
const TURN_SPEED = (320 * Math.PI) / 180;
const MIN_TURN = 0.25;
const MAX_TURN = 0.7;
/** Yandan bakışta kameranın döndüğü en büyük açı (derece). */
const SIDE_VIEW_MAX = 45;
/** İsabet sarsıntısının genliği: güç 1'de kamera–hedef uzaklığının bu oranı (≈0.57°). */
const SHAKE_SCALE = 0.01;
/** Savrulma yayı: taban + metre başına yükseklik (m); reçetedeki arcHeight üst sınırdır. */
const KNOCKBACK_ARC_BASE = 0.15;
const KNOCKBACK_ARC_PER_M = 0.4;

export class BuiltScene implements SceneContext {
  readonly cameraPosition = new THREE.Vector3();
  audio?: AudioTimeline;
  /** Kameranın ağaçlara girmesini önler (haritada ağaç veya arazi varsa). */
  clearance: CameraClearance | null = null;
  /** Yetenek isabetlerinde hit-stop ve kamera sarsıntısı (sahnede isabet varsa). */
  impact: ImpactFeel | null = null;
  /** Yeteneklerin kamera odağı, zaman içinde yumuşatılmış (peş peşe yeteneklerde kamera pompalamasın). */
  focus: FocusTrack | null = null;

  /** Karakterlerin ve efektlerin değerlendirildiği zaman: isabetlerde kısa süre yavaşlar (hit-stop). */
  actionTime(lt: number): number {
    return this.impact ? this.impact.warp(lt) : lt;
  }

  constructor(
    readonly id: string,
    readonly group: THREE.Group,
    readonly start: number,
    readonly duration: number,
    readonly shots: BuiltShot[],
    readonly characters: Map<string, Character>,
    readonly sky: THREE.Color,
    readonly fog: THREE.Fog | null,
    readonly sun: THREE.DirectionalLight,
    readonly sunOffset: THREE.Vector3,
    readonly wind: WindSystem | null = null,
    readonly hemi?: THREE.HemisphereLight,
    readonly overlays: OverlayDef[] = [],
    readonly abilities: AbilitySystem | null = null,
  ) {}

  applyRenderMode(mode: 'preview' | 'render') {
    const isPreview = mode === 'preview';
    this.sun.castShadow = !isPreview;

    const detailGroup = this.group.getObjectByName('render_mode_details');
    if (detailGroup) {
      detailGroup.visible = !isPreview;
    }

    if (this.hemi) {
      if (this.hemi.userData.origIntensity === undefined) {
        this.hemi.userData.origIntensity = this.hemi.intensity;
      }
      this.hemi.intensity = isPreview ? this.hemi.userData.origIntensity * 1.15 : this.hemi.userData.origIntensity;
    }

    this.wind?.setRenderMode(mode);

    this.group.traverse((o) => {
      // Karakterleri, yetenek efektlerini ve bileşenlerini koru
      if (
        o.userData.isCharacter ||
        o.userData.isAbility ||
        o.name.startsWith('character_') ||
        o.name === 'ability_effects_group'
      ) {
        return;
      }
      let p = o.parent;
      while (p) {
        if (p.userData?.isAbility) return;
        p = p.parent;
      }

      // Tüm ağaçlar, çam iğneleri, çalılar ve zemin katmanları daima görünür tutulur
      if (o.userData.origVisible !== undefined) {
        o.visible = o.userData.origVisible;
      } else {
        o.visible = true;
      }

      const m = o as THREE.Mesh;
      if (m.isMesh) {
        if (m.userData.origCastShadow === undefined) m.userData.origCastShadow = m.castShadow;
        if (m.userData.origReceiveShadow === undefined) m.userData.origReceiveShadow = m.receiveShadow;
        m.castShadow = isPreview ? false : m.userData.origCastShadow;
        m.receiveShadow = isPreview ? false : m.userData.origReceiveShadow;

        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) {
          if (!mat) continue;

          const isFoliage = /pine|leaf|leaves|needle|bush|vegetation|tree/i.test(mat.name) || /pine|leaf|leaves|needle|bush|vegetation/i.test(m.name);
          if (isFoliage) {
            mat.side = THREE.DoubleSide;
          }

          if ('normalScale' in mat && (mat as THREE.MeshStandardMaterial).normalScale) {
            const stdMat = mat as THREE.MeshStandardMaterial;
            if (mat.userData.origNormalScale === undefined) {
              mat.userData.origNormalScale = stdMat.normalScale.clone();
            }
            if (mat.userData.origNormalScale) {
              stdMat.normalScale.copy(mat.userData.origNormalScale);
            }
          }
        }
      }
    });
  }

  voiceState(id: string, t: number) {
    return this.audio?.getVoiceState(id, this.start + t) ?? null;
  }

  /**
   * Gölge alanını bakılan noktaya taşır. Gölge dokusu kaymasın diye hedef, gölge
   * dokusunun bir pikseline denk gelen adımlara yuvarlanır.
   */
  followShadow(focus: THREE.Vector3) {
    const cam = this.sun.shadow.camera;
    const step = (cam.right - cam.left) / this.sun.shadow.mapSize.x;
    const f = new THREE.Vector3(Math.round(focus.x / step) * step, Math.round(focus.y / step) * step, Math.round(focus.z / step) * step);
    this.sun.target.position.copy(f);
    this.sun.position.copy(f).add(this.sunOffset);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
  }

  positionOf(id: string, t: number) {
    return this.characters.get(id)!.positionAt(t, new THREE.Vector3());
  }

  headOf(id: string, t: number) {
    const c = this.characters.get(id)!;
    return c.positionAt(t, new THREE.Vector3()).setY(c.rig.height * 0.85);
  }

  facingOf(target: CameraTarget, t: number): number {
    let id: string | null = null;
    if (typeof target === 'string') id = target;
    else if (Array.isArray(target) && target.some((item) => Array.isArray(item))) {
      const last = target[target.length - 1];
      if (typeof last === 'string' && this.characters.has(last)) id = last;
    } else if (typeof target[0] === 'string') {
      id = target[0];
    }
    if (!id || !this.characters.has(id)) return 0;
    const ch = this.characters.get(id)!;
    const pNow = ch.positionAt(t, new THREE.Vector3());
    const pPrev = ch.positionAt(Math.max(0, t - 2.3), new THREE.Vector3());
    const dx = pNow.x - pPrev.x;
    const dz = pNow.z - pPrev.z;
    if (dx * dx + dz * dz > 1.0) {
      return Math.atan2(dx, dz);
    }
    return ch.facingAt(t, this);
  }

  subject(target: CameraTarget, t: number, right: THREE.Vector3, shotProgress = 0): Subject {
    if (typeof target !== 'string' && typeof target[0] === 'number') {
      const [x, y, z] = target as [number, number, number];
      return { center: new THREE.Vector3(x, y, z), height: 1.7, width: 1 };
    }
    if (Array.isArray(target) && target.some((item) => Array.isArray(item))) {
      const pts = (target as ([number, number, number] | string)[]).map((item) => {
        if (typeof item === 'string') {
          return this.positionOf(item, t);
        }
        return new THREE.Vector3(item[0], item[1], item[2]);
      });
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      const center = curve.getPoint(clamp(shotProgress, 0, 1));
      return { center, height: 1.7, width: 1 };
    }
    const ids = typeof target === 'string' ? [target] : (target as string[]);
    const center = new THREE.Vector3();
    let height = 0;
    let maxWidth = 0;
    let min = Infinity;
    let max = -Infinity;
    for (const id of ids) {
      const c = this.characters.get(id)!;
      const pos = c.positionAt(t, new THREE.Vector3());
      center.add(pos);
      height = Math.max(height, c.rig.height);
      maxWidth = Math.max(maxWidth, c.rig.width);
      const d = pos.dot(right);
      min = Math.min(min, d);
      max = Math.max(max, d);
    }
    center.divideScalar(ids.length);
    return { center, height, width: max - min + maxWidth };
  }
}

export interface FrameInfo {
  scene: BuiltScene;
  shot: BuiltShot;
  /** Siyah örtü opaklığı (0 = yok, 1 = tamamen siyah). */
  fade: number;
}

/** Derlenmiş film: tek bir three.js sahnesi, sahneler arasında görünürlük değişir. */
export class Film {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 1500);
  /** Kamera yolunu örneklemek için ekrana çizilmeyen ikinci kamera. */
  private readonly probeCamera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 1500);
  readonly duration: number;
  readonly audio = new AudioTimeline();
  /** Son değerlendirilen karenin siyah örtü opaklığı; görüntüleyici bunu çizer. */
  fade = 0;
  currentTime = 0;
  currentSceneLocalTime = 0;
  currentOverlays: OverlayDef[] = [];
  currentActiveAbilities: ActiveAbilityHUDInfo[] = [];
  readonly transitionCues: TransitionCue[] = [];
  private active: BuiltScene | null = null;
  private renderMode: 'preview' | 'render' = 'render';

  constructor(
    readonly title: string,
    readonly fps: number,
    readonly scenes: BuiltScene[],
    private readonly options: FilmOptions = { fadeIn: 0, fadeOut: 0, handheld: 0 },
  ) {
    for (const s of scenes) {
      this.scene.add(s.group);
      for (const sh of s.shots) {
        const start = s.start + sh.start;
        if (start > 0 && sh.transition !== 'cut' && sh.transition !== 'fade') {
          this.transitionCues.push({ time: start, type: sh.transition });
        }
      }
    }
    const last = scenes[scenes.length - 1];
    this.duration = last.start + last.duration;
  }

  setRenderMode(mode: 'preview' | 'render') {
    this.renderMode = mode;
    for (const s of this.scenes) {
      s.applyRenderMode(mode);
    }
  }

  getRenderMode(): 'preview' | 'render' {
    return this.renderMode;
  }

  get frameCount() {
    return Math.max(1, Math.round(this.duration * this.fps));
  }

  /** t anındaki kareyi hazırlar. Aynı (t, format) her zaman aynı görüntüyü verir. */
  evaluate(t: number, format: FormatPreset): FrameInfo {
    t = clamp(t, 0, this.duration - 1e-6);
    const sc = this.scenes.find((s) => t < s.start + s.duration) ?? this.scenes[this.scenes.length - 1];
    if (this.active !== sc) {
      if (this.active) this.active.group.visible = false;
      sc.group.visible = true;
      this.scene.background = sc.sky;
      this.scene.fog = sc.fog;
      this.active = sc;
    }

    const lt = t - sc.start;
    const shot = sc.shots.find((s) => lt < s.start + s.duration) ?? sc.shots[sc.shots.length - 1];
    const shotProgress = EASES[resolveCamera(shot.camera, format).ease](clamp((lt - shot.start) / shot.duration));
    if (this.renderMode === 'render') {
      sc.wind?.update(t);
    }
    // Karakterler ve efektler hit-stop'lu zamanda (wt); kamera hareketi ve sesler gerçek zamanda (lt) akar
    const wt = sc.actionTime(lt);
    for (const c of sc.characters.values()) {
      c.computeBody(wt, sc);
      c.rig.apply(c.pose);
    }
    sc.abilities?.update(wt, sc.characters);
    this.placeCamera(this.camera, sc, shot, lt, t, format);
    // O çekimde kameranın içine girdiği ya da konuşanı örttüğü ağaçlar çekim boyunca gizlenir
    sc.clearance?.apply(`${shot.index}|${format.id}|${format.width}x${format.height}`, shot.start, wt, () =>
      this.sampleShot(sc, shot, format),
    );
    sc.cameraPosition.copy(this.camera.position);
    const spec = shot.camera;
    if (this.renderMode === 'render') {
      sc.followShadow(sc.subject(spec.target, wt, new THREE.Vector3(1, 0, 0), shotProgress).center);
    }
    for (const c of sc.characters.values()) {
      c.computeLook(wt, sc);
      c.rig.apply(c.pose);
    }
    this.fade = this.fadeAt(t, sc, lt);
    this.currentTime = t;
    this.currentSceneLocalTime = lt;
    this.currentOverlays = sc.overlays;
    this.currentActiveAbilities = sc.abilities?.getActiveAbilities(wt, sc.characters) ?? [];
    return { scene: sc, shot, fade: this.fade };
  }

  /**
   * Çekimin kamerasını lt anına yerleştirir (yetenek odağı, kuş bakışı ve arazi payı dahil) ve bakış noktasını döndürür.
   * Yalnızca zamana bağlıdır; çekim boyunca kamera yolunu örneklemek için başka bir kamerayla da çağrılır.
   */
  private placeCamera(cam: THREE.PerspectiveCamera, sc: BuiltScene, shot: BuiltShot, lt: number, t: number, format: FormatPreset): THREE.Vector3 {
    const resolvedCam = resolveCamera(shot.camera, format, this.options.handheld);
    const shotProgress = EASES[resolvedCam.ease](clamp((lt - shot.start) / shot.duration));
    const wt = sc.actionTime(lt);
    const abilityFocus = sc.focus?.at(wt) ?? null;
    if (
      abilityFocus &&
      abilityFocus.birdEyeWeight !== undefined &&
      abilityFocus.birdEyeWeight > 0 &&
      abilityFocus.elevationOverride !== undefined
    ) {
      const rawB = clamp(abilityFocus.birdEyeWeight, 0, 1);
      const birdW = rawB * rawB * (3 - 2 * rawB);
      const elev = resolvedCam.elevation;
      const elevFrom = typeof elev === 'object' && elev !== null && 'from' in elev ? elev.from : elev;
      const elevTo = typeof elev === 'object' && elev !== null && 'from' in elev ? elev.to : elev;
      resolvedCam.elevation = {
        from: THREE.MathUtils.lerp(elevFrom, abilityFocus.elevationOverride, birdW),
        to: THREE.MathUtils.lerp(elevTo, abilityFocus.elevationOverride, birdW),
      };
    }
    // Yandan bakış (yer dikenleri): kamera saldırı çizgisine dik yöne, şu anki açısına en yakın yandan döner
    if (abilityFocus?.sideWeight && abilityFocus.lineAngle !== undefined) {
      const k = EASES[resolvedCam.ease](clamp((lt - shot.start) / shot.duration));
      const a = resolvedCam.angle;
      const from = typeof a === 'object' && a !== null && 'from' in a ? a.from : a;
      const to = typeof a === 'object' && a !== null && 'from' in a ? a.to : a;
      const facingDeg = resolvedCam.relative ? (sc.facingOf(resolvedCam.target, wt) * 180) / Math.PI : 0;
      const baseAz = THREE.MathUtils.lerp(from, to, k) + facingDeg;
      const line = (abilityFocus.lineAngle * 180) / Math.PI;
      const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
      // İki yan neredeyse eşit uzaktaysa (kamera çizginin arkasında) saldırının ekranda soldan sağa aktığı yan
      // seçilir (kullanan solda, hedef sağda); yoksa her yetenekte rastgele bir yana dönebiliyordu.
      // Kameranın sağ ekseni (cos az, −sin az); hedef sağda ⇔ sin(çizgi − az) > 0.
      const sides = [wrap(line + 90 - baseAz), wrap(line - 90 - baseAz)];
      const leftToRight = (d: number) => Math.sin(((line - (baseAz + d)) * Math.PI) / 180) > 0;
      const toSide =
        Math.abs(Math.abs(sides[0]) - Math.abs(sides[1])) < 30
          ? (sides.find(leftToRight) ?? sides[0])
          : sides.sort((x, y) => Math.abs(x) - Math.abs(y))[0];
      const turn = THREE.MathUtils.clamp(toSide, -SIDE_VIEW_MAX, SIDE_VIEW_MAX) * abilityFocus.sideWeight;
      resolvedCam.angle = baseAz + turn - facingDeg;
    }
    const aim = applyCamera(
      cam,
      resolvedCam,
      lt - shot.start,
      shot.duration,
      format.width / format.height,
      {
        subject: (target, right) => {
          const base = sc.subject(target, wt, right, shotProgress);
          if (abilityFocus && abilityFocus.zoomWeight > 0) {
            const rawW = clamp(abilityFocus.zoomWeight, 0, 1);
            // Kuş bakışı oranlarına sürekli geçiş (eskiden ağırlık 0.01'i geçince tek karede ~10 m sıçrıyordu)
            const b = clamp(abilityFocus.birdEyeWeight ?? 0, 0, 1);
            const bird = b * b * (3 - 2 * b);
            const maxBlend = THREE.MathUtils.lerp(0.72, 0.9, bird);
            const w = rawW * rawW * (3 - 2 * rawW) * maxBlend;
            const focusGround = new THREE.Vector3(
              abilityFocus.effectCenter.x,
              base.center.y,
              abilityFocus.effectCenter.z,
            );
            base.center.lerp(focusGround, w);
            base.width = THREE.MathUtils.lerp(base.width, abilityFocus.suggestedSize * THREE.MathUtils.lerp(0.78, 0.92, bird), w);
            base.height = THREE.MathUtils.lerp(
              base.height,
              abilityFocus.suggestedSize * THREE.MathUtils.lerp(0.68, 0.85, bird),
              w * THREE.MathUtils.lerp(0.85, 0.95, bird),
            );
          }
          return base;
        },
        facing: (target) => sc.facingOf(target, wt),
      },
      t,
    );
    // İsabet sarsıntısı: bakış noktası ekran ekseninde titrer, kamera biraz daha az (uzaklıkla orantılı)
    const shake = sc.impact?.shake(lt);
    let looked = false;
    if (shake) {
      const amp = cam.position.distanceTo(aim) * SHAKE_SCALE;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
      const offset = right.multiplyScalar(shake.x * amp).addScaledVector(up, shake.y * amp);
      cam.position.addScaledVector(offset, 0.35);
      cam.lookAt(aim.clone().add(offset));
      looked = true;
    }
    if (sc.clearance?.liftAboveGround(cam.position) && !looked) cam.lookAt(aim);
    return aim;
  }

  /**
   * Ses efektlerini konumlandırmak için t anındaki kamera (dinleyici): konum, sağ/ileri eksenler ve yatay
   * görüş açısının yarısının tanjantı. Ekrandaki görüntüyü değiştirmez (ayrı kamerayla hesaplanır).
   */
  listenerAt(t: number, format: FormatPreset) {
    t = clamp(t, 0, this.duration - 1e-6);
    const sc = this.scenes.find((s) => t < s.start + s.duration) ?? this.scenes[this.scenes.length - 1];
    const lt = t - sc.start;
    const shot = sc.shots.find((s) => lt < s.start + s.duration) ?? sc.shots[sc.shots.length - 1];
    const cam = this.probeCamera;
    this.placeCamera(cam, sc, shot, lt, t, format);
    cam.updateMatrixWorld();
    const aspect = format.width / format.height;
    return {
      position: cam.position.clone(),
      right: new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion),
      forward: new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion),
      tanHalf: Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * aspect,
    };
  }

  /** Çekim boyunca kamera yolunu (konum + bakış noktası) örnekler. */
  private sampleShot(sc: BuiltScene, shot: BuiltShot, format: FormatPreset): CameraSample[] {
    const samples: CameraSample[] = [];
    const end = Math.min(shot.start + shot.duration, sc.duration);
    for (let lt = shot.start; ; lt = Math.min(end, lt + CLEARANCE_SAMPLE_STEP)) {
      const aim = this.placeCamera(this.probeCamera, sc, shot, lt, sc.start + lt, format);
      samples.push({ camera: this.probeCamera.position.clone(), aim });
      if (lt >= end) break;
    }
    return samples;
  }

  /** Aktif Remotion tarzı 2B katmanları ve çizgi film kamera geçişlerini verilen 2B tuvale çizer. */
  renderMotionOverlay(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
    return renderMotionGraphicsLayer(
      ctx,
      width,
      height,
      this.fps,
      this.currentTime,
      this.currentSceneLocalTime,
      this.currentOverlays,
      this.transitionCues,
      this.currentActiveAbilities,
      this.camera,
    );
  }

  /** Başta açılma, sonda kararma ve "fade" geçişli çekimlerin etrafındaki siyah örtü. */
  private fadeAt(t: number, sc: BuiltScene, lt: number): number {
    const { fadeIn, fadeOut } = this.options;
    let f = 0;
    if (fadeIn > 0 && t < fadeIn) f = Math.max(f, 1 - t / fadeIn);
    if (fadeOut > 0 && t > this.duration - fadeOut) f = Math.max(f, (t - (this.duration - fadeOut)) / fadeOut);
    // Film zamanında: sahnelerin ilk çekimleri de (sahne geçişi) karartmalı olabilir.
    for (const scene of this.scenes) {
      for (const s of scene.shots) {
        const start = scene.start + s.start;
        if (s.transition !== 'fade' || start === 0) continue;
        const d = Math.abs(t - start);
        if (d < SHOT_FADE) f = Math.max(f, 1 - d / SHOT_FADE);
      }
    }
    void sc;
    void lt;
    return clamp(f);
  }

  /**
   * Her sahnenin shader'larını ve dokularını oynatmadan önce GPU'ya hazırlar. Yoksa her yetenek ve
   * kameranın ilk gördüğü her malzeme, göründüğü karede derlenir ve önizleme saniyelerce donar.
   * Render modu değişince (gölge açılıp kapanınca) yeniden çağrılmalıdır.
   */
  async warmup(renderer: THREE.WebGLRenderer) {
    // Yazı tipi ve tüm dokular inmeden çizilen kareler, yüklemenin ne zaman bittiğine göre değişirdi
    await Promise.all([loadOverlayFonts(), waitForPendingLoads()]);
    const prevBackground = this.scene.background;
    const prevFog = this.scene.fog;
    const prevVisible = this.scenes.map((s) => s.group.visible);
    for (const sc of this.scenes) {
      for (const s of this.scenes) s.group.visible = s === sc;
      this.scene.background = sc.sky;
      this.scene.fog = sc.fog;
      const restores = [sc.abilities?.revealAllForWarmup()];
      for (const c of sc.characters.values()) restores.push(c.rig.prepareWarmup?.());
      sc.group.traverse((o) => {
        const mats = (o as THREE.Mesh).material;
        if (!mats) return;
        for (const m of Array.isArray(mats) ? mats : [mats]) {
          for (const value of Object.values(m)) if (value instanceof THREE.Texture) renderer.initTexture(value);
        }
      });
      try {
        await renderer.compileAsync(this.scene, this.camera);
        // Geometriler ilk çizildikleri karede GPU'ya yüklenir; kameranın henüz görmediği bölgeler de
        // hazır olsun diye ayıklama kapalıyken tek piksellik bir çizim yapılır (yükleme ekranının arkasında).
        const culled: THREE.Object3D[] = [];
        sc.group.traverse((o) => {
          if (o.frustumCulled) {
            o.frustumCulled = false;
            culled.push(o);
          }
        });
        const scissorTest = renderer.getScissorTest();
        renderer.setScissorTest(true);
        renderer.setScissor(0, 0, 1, 1);
        renderer.render(this.scene, this.camera);
        renderer.setScissorTest(scissorTest);
        for (const o of culled) o.frustumCulled = true;
      } finally {
        for (const r of restores) r?.();
      }
    }
    this.scenes.forEach((s, i) => (s.group.visible = prevVisible[i]));
    this.scene.background = prevBackground;
    this.scene.fog = prevFog;
  }

  dispose() {
    this.audio.stop();
    for (const s of this.scenes) s.wind?.dispose();
    disposeTree(this.scene);
  }
}

export async function buildFilm(
  s: Scenario,
  lib: AssetLibrary,
  onProgress?: (status: string, percent: number) => void,
): Promise<{ film: Film; warnings: string[] }> {
  const warnings: string[] = [];
  const scenes: BuiltScene[] = [];
  const audioCues: AudioCue[] = [];
  let filmTime = 0;

  onProgress?.('Varlıklar önbelleğe alınıyor…', 0.05);
  const usedAssetKeys = new Set<string>();
  for (const sc of s.scenes) {
    for (const p of sc.props) usedAssetKeys.add(p.asset);
    for (const c of sc.characters) usedAssetKeys.add(c.asset);
  }
  const usedAssets: Record<string, (typeof s.assets)[string]> = {};
  for (const k of usedAssetKeys) {
    if (s.assets[k]) usedAssets[k] = s.assets[k];
  }
  await lib.preloadAssets(usedAssets, (ratio) => {
    onProgress?.('Modeller ve animasyonlar indiriliyor…', 0.05 + ratio * 0.45);
  });

  // Arayüzün donmaması için ana iş parçacığına kısa nefes payı
  await new Promise((r) => setTimeout(r, 0));

  const totalScenes = s.scenes.length;
  for (let sceneIdx = 0; sceneIdx < totalScenes; sceneIdx++) {
    const def = s.scenes[sceneIdx];
    const sceneProgress = 0.5 + (sceneIdx / Math.max(1, totalScenes)) * 0.3;
    onProgress?.(`Sahne kuruluyor: ${def.id}…`, sceneProgress);

    const group = new THREE.Group();
    group.visible = false;
    const env = buildEnvironment(def.environment);
    group.add(env.group);

    let terrain: Heightfield | null = null;
    /** Yolu olan haritalar (varlık adı → yol); walk_to `road: true` ilkini kullanır. */
    const roads = new Map<string, RoadPath>();
    for (const p of def.props) {
      const assetDef = s.assets[p.asset];
      if ('road' in assetDef && assetDef.road && !roads.has(p.asset)) {
        try {
          roads.set(p.asset, await RoadPath.load(assetDef.road, p.at, p.rotation, p.scale));
        } catch (e) {
          warnings.push(`${def.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      const obj = await lib.prop(assetDef);
      obj.position.set(...p.at);
      obj.rotation.y = deg(p.rotation);
      obj.scale.multiplyScalar(p.scale);
      group.add(obj);
      if (p.terrain) {
        terrain = Heightfield.fromObject(obj, 0.3, Array.isArray(p.terrain) ? p.terrain : undefined);
        if (!terrain) warnings.push(`${def.id}: "${p.asset}" içinde arazi yüzeyi bulunamadı`);
      }
    }
    // Haritadaki "_LOD1/_LOD2" seviyeli ağaçlar uzaklığa göre sadeleşir
    setupLods(group);

    // Render modunda devreye giren zengin arka plan ormanı ve detay grubu
    const existingPropsList = def.props.map((p) => ({ at: p.at, scale: p.scale }));
    const detailGroup = buildSceneRenderDetails(def, existingPropsList, terrain);
    group.add(detailGroup);

    if (env.wind) {
      setupVegetationWind(group, terrain);
    }
    // Zemini ayak izi büyüklüğünde bir alanın ortalamasından oku; arazideki küçük pürüzler sekme yapmasın.
    const groundAt = terrain
      ? (x: number, z: number) => {
          const r = 0.35;
          let sum = 0;
          let n = 0;
          for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
            const h = terrain.heightAt(x + dx, z + dz);
            if (h !== null) {
              sum += h;
              n++;
            }
          }
          return n ? sum / n : null;
        }
      : undefined;

    const characters = new Map<string, Character>();
    for (const c of def.characters) {
      const rig = await lib.character(s.assets[c.asset]);
      liftCharacter(rig.root, def.environment.character_light ?? CHARACTER_LIGHT[def.environment.preset]);
      if (rig.clipDuration && rig.clipDuration('idle') === undefined)
        warnings.push(`${def.id}: "${c.id}" modelinde "idle" klibi yok; boşta dururken hareketsiz kalır (ilk klibin ilk karesindeki poz)`);
      rig.root.name = `character_${c.id}`;
      rig.root.userData.isCharacter = true;
      // Ayaklar eğimli araziye basar (ayak IK'sı); kök yüksekliği ise ortalamalı zeminden
      if (terrain) rig.setGround?.((x, z) => terrain!.heightAt(x, z));
      characters.set(c.id, new Character(c.id, rig, new THREE.Vector3(...c.at), deg(c.facing), groundAt));
      group.add(rig.root);
    }

    const abilities = new AbilitySystem();
    if (terrain) abilities.setGround((x, z) => terrain!.heightAt(x, z));
    group.add(abilities.group);
    abilities.bindSceneTrees(group);

    const shots: BuiltShot[] = [];
    const allActions: { action: Action; start: number }[] = [];
    let t = 0;
    const camEntries = def.cameras ?? def.shots ?? [];
    camEntries.forEach((shot, index) => {
      const shotStart = shot.at !== undefined ? shot.at : t;
      shots.push({ index, start: shotStart, duration: shot.duration, camera: shot.camera, transition: shot.transition });
      if ('actions' in shot && Array.isArray(shot.actions)) {
        for (const action of shot.actions) {
          allActions.push({ action, start: shotStart + action.at });

          if (action.do === 'talk' && action.audio) {
            audioCues.push({
              id: `${def.id}_${action.who}_${index}_${audioCues.length}`,
              who: action.who,
              text: action.text,
              url: action.audio,
              start: filmTime + shotStart + action.at,
              duration: action.duration,
            });
          }
        }
      }
      t = Math.max(t, shotStart + shot.duration);
    });

    // Sahne genelinde tanımlanan senaryo eylemleri kamera geçişlerinden tamamen bağımsızdır
    for (const action of def.actions ?? []) {
      allActions.push({ action, start: action.at });

      if (action.do === 'talk' && action.audio) {
        audioCues.push({
          id: `${def.id}_${action.who}_scene_${audioCues.length}`,
          who: action.who,
          text: action.text,
          url: action.audio,
          start: filmTime + action.at,
          duration: action.duration,
        });
      }
    }

    allActions.sort((a, b) => a.start - b.start);
    const warnFn = (m: string) => warnings.push(`${def.id}: ${m}`);

    type TimelineEvent =
      | { kind: 'action'; time: number; action: Action; start: number }
      | {
          kind: 'tree_fall_cast';
          time: number;
          action: Extract<Action, { do: 'ability' }>;
          start: number;
          recipe: AbilityRecipe;
        }
      | {
          kind: 'ability_impact';
          time: number;
          action: Extract<Action, { do: 'ability' }>;
          targetId: string;
          groupIndex: number;
          groupSize: number;
          start: number;
          recipe: AbilityRecipe;
        }
      | { kind: 'ability_turn'; time: number; who: string; targets: string[] };

    const timelineEvents: TimelineEvent[] = [];
    const recipeWarned = new Set<string>();
    const charAssets = new Map(def.characters.map((c) => [c.id, c.asset]));

    // Derleme sırasında yön hesabı için (kamera henüz yok)
    const compileCtx: SceneContext = {
      positionOf: (id, tt) => characters.get(id)!.positionAt(tt, new THREE.Vector3()),
      headOf: (id, tt) => characters.get(id)!.positionAt(tt, new THREE.Vector3()),
      cameraPosition: new THREE.Vector3(),
    };
    /** Dönüş süresi açıyla orantılı (TURN_SPEED); küçük dönüşler kısa, geri dönüşler uzun sürer, ayak kayması azalır. */
    const turnDuration = (who: Character, at: number, yaw: number) =>
      clamp(Math.abs(wrapAngle(yaw - who.facingAt(at, compileCtx))) / TURN_SPEED, MIN_TURN, MAX_TURN);
    const yawTo = (from: THREE.Vector3, to: THREE.Vector3) => Math.atan2(to.x - from.x, to.z - from.z);

    for (const { action, start } of allActions) {
      if (action.do === 'ability') {
        const caster = characters.get(action.who);
        if (!caster) {
          warnFn(`Yeteneği kullanan karakter bulunamadı: ${action.who}`);
          continue;
        }
        const def = resolveAbility(action.name);
        if (!def) {
          warnFn(`Bilinmeyen yetenek: ${action.name} (tanımlar: src/data/abilities.yaml)`);
          continue;
        }
        // Süreler kullananın gerçek kliplerinden; aynı uyarı (her kullanımda tekrar eden) bir kez yazılır
        const { recipe, warnings: recipeWarnings } = buildRecipe(def, (n) => caster.rig.clipDuration?.(n), action.clips);
        const casterAsset = s.assets[charAssets.get(action.who) ?? ''];
        const casterElement = casterAsset && 'element' in casterAsset ? casterAsset.element : undefined;
        if (casterElement && def.element !== casterElement) {
          recipeWarnings.push(
            `"${action.who}" ${ELEMENT_NAMES[casterElement]} elementinde ama "${action.name}" bir ${ELEMENT_NAMES[def.element]} yeteneği`,
          );
        }
        for (const w of recipeWarnings) {
          if (!recipeWarned.has(w)) {
            recipeWarned.add(w);
            warnFn(w);
          }
        }

        // Ağaç Devirme gibi çevreye yönelik (hasar vermeyen) yetenekler haritadaki gerçek ağacı devirir
        if (recipe.targetKind === 'map_tree') {
          let clipStart = start;
          for (const c of recipe.clips) {
            caster.schedule(
              { who: action.who, at: clipStart, do: 'clip', name: c.name, duration: c.duration, loop: c.loop ?? false, fade: c.fade ?? ABILITY_CLIP_FADE },
              clipStart,
              warnFn,
            );
            clipStart += c.duration;
          }
          timelineEvents.push({
            kind: 'tree_fall_cast',
            time: start,
            action,
            start,
            recipe,
          });
          continue;
        }

        const rawTargets = action.target
          ? Array.isArray(action.target)
            ? action.target
            : [action.target]
          : [];
        const validTargets = rawTargets.filter((tid): tid is string => Boolean(tid && characters.has(tid)));
        if (validTargets.length === 0) {
          warnFn(`Yetenek hedefi bulunamadı: ${action.who} -> ${rawTargets.join(', ')}`);
          continue;
        }

        // 1. Yeteneği kullanan karakter birincil hedefe döner ve 1 veya 2 animasyonluk komboyu sırayla oynatır (yalnızca 1 kez)
        timelineEvents.push({ kind: 'ability_turn', time: start, who: action.who, targets: validTargets });
        let clipStart = start;
        for (const c of recipe.clips) {
          caster.schedule(
            { who: action.who, at: clipStart, do: 'clip', name: c.name, duration: c.duration, loop: c.loop ?? false, fade: c.fade ?? ABILITY_CLIP_FADE },
            clipStart,
            warnFn,
          );
          clipStart += c.duration;
        }

        // Çoklu hedef varsa her hedefe aynı anda vuracak şekilde etki (impact) olayı ekle
        validTargets.forEach((targetId, idx) => {
          timelineEvents.push({
            kind: 'ability_impact',
            time: start + recipe.impactOffset,
            action,
            targetId,
            groupIndex: idx,
            groupSize: validTargets.length,
            start,
            recipe,
          });
        });
      } else {
        timelineEvents.push({
          kind: 'action',
          time: start,
          action,
          start,
        });
      }
    }

    // 2. Yürüyüş (walk_to), harita ağacı devirme ve yetenek savrulma (knockback) olaylarını kronolojik sırayla işle
    timelineEvents.sort((a, b) => a.time - b.time);
    for (const ev of timelineEvents) {
      if (ev.kind === 'action') {
        let action = ev.action;
        // Yol boyunca yürüyüş: karakterin o anki yerinden hedefe, yolun orta çizgisi (ve şeridi) üzerinden
        if (action.do === 'walk_to' && action.road) {
          const road = typeof action.road === 'string' ? roads.get(action.road) : roads.values().next().value;
          const ch = characters.get(action.who);
          if (!road) {
            warnFn(`"${action.who}": yol bulunamadı (${typeof action.road === 'string' ? `"${action.road}" varlığında road yok` : 'sahnedeki haritalarda road tanımlı değil'}); düz yürünecek`);
          } else if (ch) {
            const targets = typeof action.to[0] === 'number' ? [action.to as number[]] : (action.to as number[][]);
            const last = targets[targets.length - 1];
            const goal = new THREE.Vector3(last[0], 0, last.length === 3 ? last[2] : last[1]);
            action = { ...action, to: road.route(ch.positionAt(ev.start, new THREE.Vector3()), goal, action.lane) };
          }
        }
        characters.get(action.who)?.schedule(action, ev.start, warnFn);
        continue;
      }

      if (ev.kind === 'ability_turn') {
        // Tek hedefte hedefe kilitlenir (hareket ederse izler); çoklu hedefte hedeflerin ortasına döner
        const caster = characters.get(ev.who)!;
        const from = caster.positionAt(ev.time, new THREE.Vector3());
        const centroid = new THREE.Vector3();
        for (const id of ev.targets) centroid.add(characters.get(id)!.positionAt(ev.time, new THREE.Vector3()));
        centroid.divideScalar(ev.targets.length);
        const yaw = yawTo(from, centroid);
        const to = ev.targets.length === 1 ? ev.targets[0] : (yaw * 180) / Math.PI;
        caster.schedule({ who: ev.who, at: ev.time, do: 'turn', to, duration: turnDuration(caster, ev.time, yaw) }, ev.time, warnFn);
        continue;
      }

      if (ev.kind === 'tree_fall_cast') {
        const { action, start, recipe } = ev;
        const caster = characters.get(action.who)!;
        const casterPos = caster.positionAt(start, new THREE.Vector3());
        const preferredTreeId = typeof action.target === 'string' ? action.target : undefined;
        const picked = abilities.selectMapTreeForFall(casterPos, characters, start, preferredTreeId);
        const treePos = picked ? picked.tree.worldPos.clone() : new THREE.Vector3(casterPos.x + 3.5, casterPos.y, casterPos.z - 4.5);
        const treeId = picked ? picked.tree.id : 'map_tree';
        const fallDirXZ = picked ? picked.fallDirXZ : new THREE.Vector3(-0.75, 0, 0.65).normalize();

        // Karabey kesim başlangıcında haritadaki ağaca döner, kılıcını savurduktan sonra tekrar sahnedeki rakiplerine döner
        const treeYawDeg = (Math.atan2(treePos.x - casterPos.x, treePos.z - casterPos.z) * 180) / Math.PI;
        const toTree = turnDuration(caster, start, (treeYawDeg * Math.PI) / 180);
        caster.schedule({ who: action.who, at: start, do: 'turn', to: treeYawDeg, duration: toTree }, start, warnFn);
        for (const [cid, other] of characters) {
          if (cid !== action.who) {
            const back = start + 3.1;
            const yawBack = yawTo(caster.positionAt(back, new THREE.Vector3()), other.positionAt(back, new THREE.Vector3()));
            caster.schedule({ who: action.who, at: back, do: 'turn', to: cid, duration: turnDuration(caster, back, yawBack) }, back, warnFn);
            break;
          }
        }

        abilities.add({
          who: action.who,
          target: treeId,
          name: action.name,
          recipe,
          start,
          knockback: 0,
          impact: action.impact,
          impactPos: treePos,
          groupIndex: 0,
          groupSize: 1,
          mapTreeId: picked?.tree.id,
          fallDirXZ,
          slideTargetPos: picked?.slideTargetPos,
        });
        continue;
      }

      const { action, targetId, groupIndex, groupSize, start, time: impactTime, recipe } = ev;
      const caster = characters.get(action.who)!;
      const target = characters.get(targetId)!;

      const casterPos = caster.positionAt(start + recipe.chargeEnd, new THREE.Vector3());
      const targetImpactPos = target.positionAt(impactTime, new THREE.Vector3());
      const dx = targetImpactPos.x - casterPos.x;
      const dz = targetImpactPos.z - casterPos.z;
      const dist = Math.hypot(dx, dz) || 1;
      const landX = targetImpactPos.x + (dx / dist) * action.knockback;
      const landZ = targetImpactPos.z + (dz / dist) * action.knockback;

      if (action.knockback > 0) {
        // Yay yüksekliği savrulma mesafesiyle orantılı: 0.35 m itilen biri 1 m havaya sıçramasın
        const arc = Math.min(recipe.arcHeight, KNOCKBACK_ARC_BASE + KNOCKBACK_ARC_PER_M * action.knockback);
        target.scheduleKnockback([landX, landZ], impactTime, recipe.knockbackDuration, arc);
      }
      const rawKnockdown = action.impact_clip ?? recipe.defaultImpactClip;
      const knockdownClip =
        target.rig.clipDuration?.(rawKnockdown) !== undefined
          ? rawKnockdown
          : target.rig.clipDuration?.('death') !== undefined
            ? 'death'
            : 'fall_flat';
      target.schedule(
        {
          who: targetId,
          at: impactTime,
          do: 'clip',
          name: knockdownClip,
          duration: knockdownClip === 'death' || knockdownClip === 'fall_flat' ? 2.6 : 1.7,
          loop: false,
          fade: 0.18,
        },
        impactTime,
        warnFn,
      );

      // 3. 3B Yetenek Sistemine kaydet
      abilities.add({
        who: action.who,
        target: targetId,
        name: action.name,
        recipe,
        start,
        knockback: action.knockback,
        impact: action.impact,
        impactPos: targetImpactPos.clone(),
        groupIndex,
        groupSize,
      });
    }

    const built = new BuiltScene(
      def.id,
      group,
      filmTime,
      t,
      shots,
      characters,
      env.sky,
      env.fog,
      env.sun,
      env.sunOffset,
      env.wind,
      env.hemi,
      def.overlays ?? [],
      abilities,
    );
    if (abilities.getScheduledCasts().length) built.focus = new FocusTrack(abilities, characters);
    const impacts = abilities.impactEvents();
    if (impacts.length) built.impact = new ImpactFeel(impacts, { shake: s.film.impact_shake, hitStop: s.film.hit_stop });
    const trees = abilities.clearanceTrees();
    if (trees.length || terrain) {
      built.clearance = new CameraClearance(trees, terrain, env.sun.shadow.camera, (lt) => abilities.update(lt, characters));
    }
    scenes.push(built);
    filmTime += t;
  }

  const options = { fadeIn: s.film.fade_in, fadeOut: s.film.fade_out, handheld: s.film.handheld };
  const film = new Film(s.film.title, s.film.fps, scenes, options);
  film.audio.setFilmDuration(film.duration);

  if (audioCues.length > 0) {
    onProgress?.('Sesler ve senkronizasyon yükleniyor…', 0.85);
  }
  await film.audio.load(audioCues);

  // Arkaplan müziğini yükle (varsayılan: jyproject-carousel-dreams-396029.mp3)
  const musicDef = s.film.music;
  const musicSrc = musicDef?.src || '/audio/main-theme/jyproject-carousel-dreams-396029.mp3';
  await film.audio.loadMusic({
    src: musicSrc,
    volume: musicDef?.volume ?? 0.35,
    ducking: musicDef?.ducking ?? 0.25,
    loop: musicDef?.loop ?? true,
    fadeIn: musicDef?.fade_in ?? 1.0,
    fadeOut: musicDef?.fade_out ?? 1.5,
    start: musicDef?.start ?? 0,
    enabled: musicDef?.enabled ?? true,
  });

  // Ses efektleri (sentezlenir; dosya indirilmez)
  onProgress?.('Ses efektleri hazırlanıyor…', 0.95);
  const sfx = await buildSfx(
    film,
    s.scenes.map((d) => d.environment.preset),
    s.film.sfx,
  );
  film.audio.setSfx(sfx.cues, sfx.ambience);

  for (const scene of scenes) {
    scene.audio = film.audio;
  }
  onProgress?.('Sahne hazır!', 1.0);
  return { film, warnings };
}

const CHARACTER_LIGHT = { day: 0, sunset: 0.12, night: 0.35 } as const;

/**
 * Karakter malzemelerine kendi renk/dokularından öz ışık ekler. Ortam ışığını değiştirmeden
 * karakteri karanlıkta okunur kılar (çizgi filmlerdeki "karakter ışığı" gibi).
 */
function liftCharacter(root: THREE.Object3D, amount: number) {
  if (amount <= 0) return;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const mat = m as THREE.MeshToonMaterial;
      if (!mat.isMeshToonMaterial) continue;
      mat.emissive.copy(mat.color);
      mat.emissiveMap = mat.map;
      mat.emissiveIntensity = amount;
    }
  });
}
