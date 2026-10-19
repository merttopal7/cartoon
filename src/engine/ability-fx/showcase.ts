import * as THREE from 'three';
import type { AbilityEffectType, AbilityRecipe } from '../abilities';
import { elevationFactor, type Character } from '../character';
import { clamp } from '../math';
import type { GroundFn } from './earth';
import { drawTornado } from './tornado';
import { DETAIL_COUNT, ROCK_SPIKES, SMOKE_COUNT, WAVE_U, WAVE_V, type AbilityVisual } from './visual';

/**
 * ELEMENT GÖSTERİLERİ (açılış klibi; hedefsiz, hasar vermez). Üçünde de bekçi elementinin üstüne çıkar:
 * - Defne (whirl): Northern Soul Spin dönerken ayağının dibinde rüzgâr toplanır; fırlatmada altında kısa bir hortum
 *   (saldırı hortumunun ~%25'i) yükselip onu kaldırır, tepesinde durup konuşur; sonda iner, hortum dağılır.
 * - Toprak (rock_rise): diz çöküp yere dokunur; altından düz tepeli bir kaya sütunu yükselip onu kaldırır, çevresinde
 *   kaya dikenler fışkırır; tepede konuşur, sonra kaya geri batar.
 * - Meşe (wave): ayağının çevresinde su halkası toplanır; altından bir dalga kabarıp onu tepesinde taşır, dalganın
 *   köpüklü dudağı önünde kıvrılır; o konuşurken su akar, sonunda dalga çöker ve Meşe yere iner.
 * Zamanlar tanımdan (src/data/abilities.yaml): chargeEnd yükselişin başladığı, impactOffset tepeye ulaştığı an;
 * totalDuration'a kadar sürer, son saniyelerde iner. Karakterin yüksekliği (Character.scheduleElevation) ile efektin
 * tepesi aynı eğriyi (elevationFactor) kullanır: ayaklar hep yüzeyde kalır.
 */

/** Kayanın Toprak'ı kaldırdığı yükseklik (m) ve sütunun toprağa gömülü kalan boyu. */
export const ROCK_HEIGHT = 0.9;
const ROCK_BURIED = 0.55;
/** Kayanın geri batma süresi (sn; gösterinin sonunda). */
const ROCK_SINK = 1.1;

/** Hortumun Defne'yi kaldırdığı yükseklik (m; saldırı hortumunun 3.25 m'lik boyunun ~%25'i) ve iniş süresi. */
const WHIRL_LIFT = 0.85;
const WHIRL_SINK = 1.2;
/** Huni geometrisinin ölçek 1'deki boyu (shaders.ts VORTEX_VERTEX: h × 3.25). */
const FUNNEL_H = 3.25;

/** Dalganın Meşe'yi taşıdığı tepe yüksekliği (m), yanlara uzanımı (m; yanındakine değmesin) ve çöküş süresi. */
const WAVE_LIFT = 0.85;
const WAVE_HALF = 1.6;
/** Kesitin ileri-geri boyu çarpanı (kesit 1.25 m'lik tepeye göre çizildi; alçak dalgada orantılı kısalır). */
const WAVE_DEPTH = 0.8;
const WAVE_CRASH = 1.4;

/** Karakteri kaldıran gösterinin zamanları (yerel saniye) ve yüksekliği. */
export interface ShowcaseLift {
  riseStart: number;
  riseEnd: number;
  sinkStart: number;
  sinkEnd: number;
  height: number;
}

type Timing = Pick<AbilityRecipe, 'chargeEnd' | 'impactOffset' | 'totalDuration'>;

export function showcaseLift(effect: AbilityEffectType, r: Timing): ShowcaseLift | null {
  const spec =
    effect === 'rock_rise'
      ? { height: ROCK_HEIGHT, sink: ROCK_SINK }
      : effect === 'whirl'
        ? { height: WHIRL_LIFT, sink: WHIRL_SINK }
        : effect === 'wave'
          ? { height: WAVE_LIFT, sink: WAVE_CRASH }
          : null;
  if (!spec) return null;
  return { riseStart: r.chargeEnd, riseEnd: r.impactOffset, sinkStart: r.totalDuration - spec.sink, sinkEnd: r.totalDuration, height: spec.height };
}

const liftFactor = (l: ShowcaseLift, local: number) =>
  elevationFactor({ start: l.riseStart, up: l.riseEnd, down: l.sinkStart, end: l.sinkEnd }, local);

/** Kaya zaman çizelgesi (ses de kullanır). */
export function rockLiftTimes(r: Timing) {
  return showcaseLift('rock_rise', r)!;
}

/** Dalga zaman çizelgesi (yerel saniye): ses aynı anları kullanır. */
export function waveTimes(r: Timing) {
  const l = showcaseLift('wave', r)!;
  return { riseStart: l.riseStart, riseEnd: l.riseEnd, crashStart: l.sinkStart, end: l.sinkEnd };
}

/** Gösterinin zemin noktası: kullananın fırlatma anındaki yeri (efekt onun altında yükselir). */
export function showcaseAnchor(_effect: AbilityEffectType, pos: THREE.Vector3, _facing: number): THREE.Vector3 {
  return pos.clone();
}

const seeded = (n: number) => {
  const x = Math.sin(n * 63.7 + 12.9) * 43758.5453;
  return x - Math.floor(x);
};
const smooth = (x: number) => {
  const u = clamp(x, 0, 1);
  return u * u * (3 - 2 * u);
};
/** Hafif aşan yükseliş (diken fırlar, biraz geri oturur). */
const easeOutBack = (x: number) => {
  const c = 1.6;
  return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
};

function hideCommon(v: AbilityVisual) {
  v.fireCoreMesh.visible = false;
  v.fireCoronaMesh.visible = false;
  v.vortexMesh.visible = false;
  v.outerVortexMesh.visible = false;
  v.lightningLine.visible = false;
  v.arrowGroup.visible = false;
  v.treeGroup.visible = false;
  v.treeSlashMesh.visible = false;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

// ---------------------------------------------------------------------------------------------------
// DEFNE: GÖSTERİ HORTUMU
// ---------------------------------------------------------------------------------------------------

export function updateWhirl(
  v: AbilityVisual,
  local: number,
  lt: number,
  caster: Character,
  _target: Character,
  chargeEnd: number,
  impactOffset: number,
  totalDuration: number,
  ground?: GroundFn,
) {
  const casterPos = caster.positionAt(lt, _a);
  const lift = showcaseLift('whirl', { chargeEnd, impactOffset, totalDuration })!;
  const f = liftFactor(lift, local);
  const grow = smooth(local / Math.max(0.1, chargeEnd));
  let top: number;
  let sXZ: number;
  let alpha: number;
  let outer: number;
  if (local < lift.riseStart) {
    // Dönerken ayağının dibinde alçak bir rüzgâr girdabı toplanır
    top = 0.12 + 0.1 * grow;
    sXZ = 0.22 + 0.28 * grow;
    alpha = clamp(local / 0.6, 0, 1) * (0.4 + 0.6 * grow);
    outer = 0.8 * grow;
  } else {
    // Hortumun tepesi her an Defne'nin ayağının altında; inişte genişler, yere değince söner
    const sinkU = clamp((local - lift.sinkStart) / WHIRL_SINK, 0, 1);
    top = Math.max(0.22, WHIRL_LIFT * f);
    sXZ = 0.5 + 0.02 * Math.sin(local * 2.1) + 0.3 * sinkU;
    alpha = 1 - smooth((local - (totalDuration - 0.45)) / 0.45);
    outer = alpha;
  }
  // Tepe salınımı kısık: üstünde biri duruyor
  v.vortexMat.uniforms.uSway.value = 0.35;
  v.outerVortexMat.uniforms.uSway.value = 0.35;
  _b.set(casterPos.x, ground?.(casterPos.x, casterPos.z) ?? casterPos.y - WHIRL_LIFT * f, casterPos.z);
  drawTornado(v, _b, local, sXZ, top / FUNNEL_H, alpha, outer);
  // Kısa hunide duman topakları (taban tozu ve tepe bulutu) huniyi örtüyordu: seyreltilir
  for (let i = 0; i < SMOKE_COUNT; i++) v.smokeAlphas[i] *= i < 20 ? 0.6 : 0.25;
}

// ---------------------------------------------------------------------------------------------------
// TOPRAK: KAYA SÜTUNU
// ---------------------------------------------------------------------------------------------------

export function updateRockRise(
  v: AbilityVisual,
  local: number,
  _lt: number,
  _caster: Character,
  _target: Character,
  chargeEnd: number,
  impactOffset: number,
  totalDuration: number,
  ground?: GroundFn,
) {
  hideCommon(v);
  const rock = v.rock;
  if (!rock) return;
  rock.group.visible = true;
  const base = v.ability.impactPos;
  const g = ground?.(base.x, base.z) ?? base.y;
  const times = rockLiftTimes({ chargeEnd, impactOffset, totalDuration });
  const f = elevationFactor({ start: times.riseStart, up: times.riseEnd, down: times.sinkStart, end: times.sinkEnd }, local);
  const sinkK = 1 - smooth((local - times.sinkStart) / ROCK_SINK);
  const riseDur = Math.max(0.05, times.riseEnd - times.riseStart);

  // 1) Sütun: tepesi her an karakterin ayağının altında (karakter aynı eğriyle kalkar)
  const total = ROCK_HEIGHT + ROCK_BURIED;
  rock.pillar.visible = local > times.riseStart && local < times.sinkEnd;
  rock.pillar.scale.set(1, total, 1);
  rock.pillar.position.set(base.x, g + ROCK_HEIGHT * f - total, base.z);
  rock.pillar.rotation.set(0, (v.ability.facing ?? 0) + 0.4, 0);

  // 2) Çevresinde sırayla fışkıran, dışa açılan kaya dikenler
  rock.spikes.forEach((m, i) => {
    const delay = (0.1 + 0.55 * ((i * 3) % ROCK_SPIKES) / ROCK_SPIKES) * riseDur;
    const life = local - (times.riseStart + delay);
    const rise = life <= 0 ? 0 : easeOutBack(clamp(life / 0.24, 0, 1));
    const h = (0.55 + 0.6 * seeded(i + 5)) * rise * sinkK;
    m.visible = h > 0.01;
    if (!m.visible) return;
    const a = (i / ROCK_SPIKES) * Math.PI * 2 + seeded(i + 11) * 0.6;
    const rad = 0.98 + 0.32 * seeded(i + 17);
    const x = base.x + Math.cos(a) * rad;
    const z = base.z + Math.sin(a) * rad;
    const r = 0.17 + 0.1 * seeded(i + 23);
    m.position.set(x, (ground?.(x, z) ?? g) - 0.05, z);
    m.scale.set(r, h, r);
    const outward = _c.set(Math.cos(a), 0, Math.sin(a));
    const axis = _a.set(0, 1, 0).cross(outward).normalize();
    m.quaternion.setFromAxisAngle(axis, 0.32 + 0.22 * seeded(i + 29));
  });

  // 3) Işık: güç toplarken ayak dibinde, yükselişte parlar
  v.light.position.set(base.x, g + 0.5 + ROCK_HEIGHT * f, base.z);
  v.light.intensity =
    local < times.riseStart ? 0.7 * smooth(local / chargeEnd) : 0.7 + 1.6 * Math.exp(-Math.max(0, local - times.riseStart) * 1.6) * sinkK;

  // 4) Toz: güç toplarken ayaklarda dönen toz; yükselişte tabandan dışa açılan halka; batışta küçük halka
  for (let i = 0; i < SMOKE_COUNT; i++) {
    const s0 = v.seeds[i * 4 + 0];
    const s1 = v.seeds[i * 4 + 1];
    const s2 = v.seeds[i * 4 + 2];
    const s3 = v.seeds[i * 4 + 3];
    const ang = s2 * Math.PI * 2;
    let x = base.x;
    let y = g;
    let z = base.z;
    let size = 0;
    let alpha = 0;
    if (local < times.riseStart) {
      const u = clamp(local / chargeEnd, 0, 1);
      const a = ang + local * 0.7;
      const r = 0.35 + s0 * 0.55;
      x += Math.cos(a) * r;
      z += Math.sin(a) * r;
      y += 0.05 + s1 * 0.2 * u;
      size = (0.28 + s1 * 0.3) * u;
      alpha = 0.2 * u;
    } else if (local < times.sinkStart) {
      const u = clamp((local - times.riseStart - s3 * 0.15) / 1.7, 0, 1);
      const r = 0.75 + Math.sqrt(u) * (1.3 + s0 * 0.9);
      x += Math.cos(ang) * r;
      z += Math.sin(ang) * r;
      y += 0.08 + Math.sqrt(u) * (0.35 + s1 * 0.7);
      size = (0.5 + u * 0.9) * (0.8 + s3 * 0.4);
      alpha = 0.5 * (1 - u) * clamp(u * 10, 0, 1);
    } else {
      const u = clamp((local - times.sinkStart - s3 * 0.1) / ROCK_SINK, 0, 1);
      const r = 0.7 + Math.sqrt(u) * (0.7 + s0 * 0.5);
      x += Math.cos(ang) * r;
      z += Math.sin(ang) * r;
      y += 0.06 + u * (0.2 + s1 * 0.3);
      size = (0.35 + u * 0.5) * (0.8 + s3 * 0.4);
      alpha = 0.32 * Math.sin(u * Math.PI);
    }
    v.smokePositions[i * 3 + 0] = x;
    v.smokePositions[i * 3 + 1] = y;
    v.smokePositions[i * 3 + 2] = z;
    const shade = 0.52 + s3 * 0.12;
    v.smokeColors[i * 3 + 0] = shade;
    v.smokeColors[i * 3 + 1] = shade * 0.86;
    v.smokeColors[i * 3 + 2] = shade * 0.7;
    v.smokeSizes[i] = size;
    v.smokeAngles[i] = s3 * Math.PI * 2 + local * 0.5;
    v.smokeAlphas[i] = alpha;
  }

  // 5) Taşçıklar: güç toplarken çevrede havalanır; yükselişte dışa fırlar, sütunun yanlarından dökülür
  for (let i = 0; i < DETAIL_COUNT; i++) {
    const s0 = v.seeds[i * 4 + 0];
    const s1 = v.seeds[i * 4 + 1];
    const s2 = v.seeds[i * 4 + 2];
    const s3 = v.seeds[i * 4 + 3];
    const ang = s2 * Math.PI * 2;
    let x = base.x;
    let y = g;
    let z = base.z;
    let alpha = 0;
    if (local < times.riseStart) {
      const u = clamp(local / chargeEnd, 0, 1);
      const a = ang + local * (0.8 + s0);
      const r = 0.55 + s1 * 0.5;
      x += Math.cos(a) * r;
      z += Math.sin(a) * r;
      y += 0.1 + u * (0.3 + s0 * 0.7) + Math.sin(local * 4 + s3 * 6) * 0.05;
      alpha = u * 0.9;
    } else if (i % 2 === 0) {
      // Fırlayan parça (balistik)
      const t = local - times.riseStart;
      const speed = 1.6 + s0 * 2.2;
      const vy = 2.6 + s1 * 2.6;
      x += Math.cos(ang) * (0.7 + speed * t);
      z += Math.sin(ang) * (0.7 + speed * t);
      y = Math.max(g, g + 0.3 + vy * t - 4.9 * t * t);
      alpha = clamp(1 - t / 1.2, 0, 1);
    } else {
      // Sütunun yanından dökülen kırıntı: yükselen kenardan kopar, düşer
      const period = 0.9;
      const born = times.riseStart + s3 * riseDur * 1.4;
      const t = local - born;
      if (t > 0 && t < period && local < times.sinkStart) {
        const topY = g + ROCK_HEIGHT * f;
        const r = 0.7 + s0 * 0.12;
        x += Math.cos(ang) * (r + t * 0.25);
        z += Math.sin(ang) * (r + t * 0.25);
        y = Math.max(g, topY - (0.1 + s1 * 0.5) - 4.9 * t * t);
        alpha = 0.9 * (1 - t / period);
      }
    }
    v.detailPositions[i * 3 + 0] = x;
    v.detailPositions[i * 3 + 1] = y;
    v.detailPositions[i * 3 + 2] = z;
    v.detailColors[i * 3 + 0] = 0.45 + s3 * 0.15;
    v.detailColors[i * 3 + 1] = 0.38 + s3 * 0.12;
    v.detailColors[i * 3 + 2] = 0.3 + s3 * 0.1;
    v.detailSizes[i] = 0.07 + s0 * 0.09;
    v.detailAngles[i] = ang + local * (2 + s1 * 4);
    v.detailAlphas[i] = alpha;
  }
}

// ---------------------------------------------------------------------------------------------------
// MEŞE: DALGA
// ---------------------------------------------------------------------------------------------------

/**
 * Dalga kesiti: [ileri (m), yükseklik (tepeye oranla)]. Arkadan tabandan Meşe'nin ayağının altındaki tepeye (0, 1),
 * sonra önde ya yamaçla yere iner (FLAT, yükselirken) ya da köpüklü dudak öne taşıp aşağı kıvrılır ve altından
 * içbükey yüz yere iner (CURL: tüp; dudağın altı gölgede). Dudak ucu PROFILE_LIP. noktada (shader köpüğü oraya göre).
 */
const PROFILE_BACK: [number, number][] = [[-1.9, 0], [-1.3, 0.3], [-0.75, 0.7], [-0.32, 0.95], [0, 1]];
const PROFILE_FLAT: [number, number][] = [
  [0.35, 0.97], [0.75, 0.84], [1.05, 0.66], [1.3, 0.48], [1.48, 0.33], [1.62, 0.2], [1.74, 0.09], [1.85, 0],
];
const PROFILE_CURL: [number, number][] = [
  [0.4, 0.99], [0.95, 0.94], [1.42, 0.8], [1.6, 0.58], [1.4, 0.44], [1.1, 0.42], [0.86, 0.22], [0.92, 0],
];
const PROFILE_N = PROFILE_BACK.length + PROFILE_FLAT.length;
/** Dudak ucunun kontrol noktası ve şeritteki satırı (v = PROFILE_LIP / (PROFILE_N − 1)). */
export const PROFILE_LIP = 8;
const LIP_ROW = Math.round((PROFILE_LIP / (PROFILE_N - 1)) * WAVE_V);

/** Dalganın dudak ucu noktaları, yan boyunca WAVE_U + 1; serpinti buradan saçılır. */
const lip: THREE.Vector3[] = Array.from({ length: WAVE_U + 1 }, () => new THREE.Vector3());
const ctrlF = new Float64Array(PROFILE_N);
const ctrlY = new Float64Array(PROFILE_N);

const catmull = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);

export function updateWave(
  v: AbilityVisual,
  local: number,
  _lt: number,
  _caster: Character,
  _target: Character,
  chargeEnd: number,
  impactOffset: number,
  totalDuration: number,
  ground?: GroundFn,
) {
  hideCommon(v);
  const wave = v.wave;
  if (!wave) return;
  wave.group.visible = true;
  const center = v.ability.impactPos;
  const g = ground?.(center.x, center.z) ?? center.y;
  const facing = v.ability.facing ?? 0;
  // İleri (Meşe'nin baktığı yön; dalga o yöne kırılır) ve yan eksen
  const fx = Math.sin(facing);
  const fz = Math.cos(facing);
  const sx = fz;
  const sz = -fx;
  const lift = showcaseLift('wave', { chargeEnd, impactOffset, totalDuration })!;
  const tm = waveTimes({ chargeEnd, impactOffset, totalDuration });
  const fH = liftFactor(lift, local);
  const H = WAVE_LIFT * fH;

  // Kıvrılma: yükselirken ön yamaç, tepede dudak öne kıvrılır, çöküşte tam kıvrık; çöküşün sonunda saydamlaşır
  let curl: number;
  let opacity = 1;
  let crashK = 0;
  if (local < tm.riseEnd) curl = 0.6 * smooth((local - tm.riseStart) / Math.max(0.05, tm.riseEnd - tm.riseStart));
  else if (local < tm.crashStart) curl = 0.6 + 0.32 * smooth((local - tm.riseEnd) / 1.0);
  else {
    crashK = clamp((local - tm.crashStart) / WAVE_CRASH, 0, 1);
    curl = 0.92 + 0.08 * smooth(crashK * 2);
    opacity = 1 - smooth((crashK - 0.6) / 0.4);
  }
  const showWave = H > 0.02 && opacity > 0.01;
  wave.mesh.visible = showWave;

  // 1) Şerit: yan boyunca her dilimde kesit eğrisi (Catmull-Rom). Ortadaki dilimin tepesi tam Meşe'nin ayağının
  //    altında (yükseklik H); yanlara doğru alçalıp söner. Gizliyken de hesaplanır: serpinti dudak noktalarını kullanır.
  if (local >= tm.riseStart) {
    const cols = WAVE_U + 1;
    const P = wave.positions;
    const widthK = (0.55 + 0.45 * fH) * WAVE_DEPTH;
    for (let i = 0; i <= WAVE_U; i++) {
      const x = (i / WAVE_U) * 2 - 1;
      const ax = Math.abs(x);
      // Ortada geniş düzlük, uçlarda kesit bütün olarak küçülür: kıvrık profil dalganın uçlarında da okunur
      // (yavaş daralan uçlar dalgayı önden ve yandan bir tümsek gibi gösteriyordu)
      const T = 1 - smooth((ax - 0.5) / 0.5);
      const c = curl * (0.4 + 0.6 * T);
      for (let k = 0; k < PROFILE_BACK.length; k++) {
        ctrlF[k] = PROFILE_BACK[k][0];
        ctrlY[k] = PROFILE_BACK[k][1];
      }
      for (let k = 0; k < PROFILE_FLAT.length; k++) {
        ctrlF[PROFILE_BACK.length + k] = PROFILE_FLAT[k][0] + (PROFILE_CURL[k][0] - PROFILE_FLAT[k][0]) * c;
        ctrlY[PROFILE_BACK.length + k] = PROFILE_FLAT[k][1] + (PROFILE_CURL[k][1] - PROFILE_FLAT[k][1]) * c;
      }
      // Tepe çizgisi yanlarda hafifçe öne-geri dalgalanır, uçlarda kabarır (ortada sabit: Meşe orada duruyor)
      const fOff = 0.15 * x * x * Math.sin(local * 1.3 + x * 2.0);
      const sw = 1 + 0.06 * ax * Math.sin(Math.PI * 2 * (0.8 * x - 0.3 * local));
      for (let j = 0; j <= WAVE_V; j++) {
        const sp = ((PROFILE_N - 1) * j) / WAVE_V;
        const k = Math.min(PROFILE_N - 2, Math.floor(sp));
        const t = sp - k;
        const k0 = Math.max(0, k - 1);
        const k3 = Math.min(PROFILE_N - 1, k + 2);
        const f = catmull(ctrlF[k0], ctrlF[k], ctrlF[k + 1], ctrlF[k3], t);
        const y = Math.max(0, catmull(ctrlY[k0], ctrlY[k], ctrlY[k + 1], ctrlY[k3], t));
        const fw = f * widthK * (0.3 + 0.7 * T) + fOff;
        const wx = center.x + fx * fw + sx * x * WAVE_HALF;
        const wz = center.z + fz * fw + sz * x * WAVE_HALF;
        const yy = y * H * T * sw;
        const idx = (j * cols + i) * 3;
        P[idx] = wx;
        // Taban toprağa biraz gömülür; tepe tam yüksekliğinde
        P[idx + 1] = (ground?.(wx, wz) ?? g) + yy - 0.04 * (1 - y);
        P[idx + 2] = wz;
      }
      const top = (LIP_ROW * cols + i) * 3;
      lip[i].set(P[top], P[top + 1], P[top + 2]);
    }
    const geo = wave.mesh.geometry;
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    geo.computeVertexNormals();
  }
  wave.mat.uniforms.uTime.value = local;
  wave.mat.uniforms.uOpacity.value = opacity;

  // 2) Su halkası: güç toplarken ayağından dışa yayılır (dalga onun üstünde kabarır), çöküşte genişleyip söner
  const charge = smooth(local / Math.max(0.1, chargeEnd));
  const puddleR = crashK > 0 ? 1.4 + crashK * 1.2 : 0.3 + 1.1 * charge;
  wave.puddle.visible = local < totalDuration;
  wave.puddle.position.set(center.x, g + 0.03, center.z);
  wave.puddle.scale.set(puddleR, 1, puddleR);
  wave.puddleMat.uniforms.uTime.value = local;
  wave.puddleMat.uniforms.uOpacity.value = clamp(local / 0.4, 0, 1) * (1 - smooth((crashK - 0.4) / 0.6));

  // 3) Işık: Meşe'nin çevresinde serin mavi parıltı
  v.light.position.set(center.x, g + H + 0.6, center.z);
  v.light.intensity = (0.6 * charge + 0.8 * fH) * opacity;

  const widthK = (0.55 + 0.45 * fH) * WAVE_DEPTH;
  // 4) Damlalar (yağmur çizgisi kipi): güç toplarken halkadan yükselip Meşe'nin çevresinde döner; dalga boyunca
  //    dudaktan öne saçılıp düşer, önündeki zeminde sıçrar; çöküşte dudaktan yoğun serpinti
  for (let i = 0; i < DETAIL_COUNT; i++) {
    const s0 = v.seeds[i * 4 + 0];
    const s1 = v.seeds[i * 4 + 1];
    const s2 = v.seeds[i * 4 + 2];
    const s3 = v.seeds[i * 4 + 3];
    const ring = s1 > 0.78; // shader: yerde sıçrama halkası
    let x = center.x;
    let y = g;
    let z = center.z;
    let size = 0;
    let alpha = 0;
    const ci = Math.min(WAVE_U, Math.max(0, Math.round((0.18 + 0.64 * s2) * WAVE_U)));
    const p = lip[ci];
    if (local < tm.riseStart) {
      const u = charge;
      const a = s2 * Math.PI * 2 + local * (1.6 + s0);
      const r = (0.5 + s3 * 0.9) * (0.4 + 0.6 * u);
      x += Math.cos(a) * r;
      z += Math.sin(a) * r;
      if (ring) {
        y += 0.04;
        size = 0.3 + s0 * 0.25;
        alpha = 0.6 * u * (0.5 + 0.5 * Math.sin(local * 5 + s3 * 9));
      } else {
        const cyc = (local * (0.8 + s0 * 0.6) + s3) % 1;
        y += cyc * (0.6 + 1.0 * u);
        size = 0.1 + s0 * 0.08;
        alpha = Math.sin(cyc * Math.PI) * 0.75 * u;
      }
    } else if (crashK <= 0 && showWave) {
      if (ring) {
        // Dalganın önünde köpüren sıçramalar
        const fwd = (1.25 + s0 * 0.5) * widthK;
        const lat = (s2 * 2 - 1) * WAVE_HALF * 0.75;
        x += fx * fwd + sx * lat;
        z += fz * fwd + sz * lat;
        y = (ground?.(x, z) ?? g) + 0.05;
        const cyc = (local * 1.1 + s3) % 1;
        size = 0.25 + cyc * 0.45;
        alpha = 0.55 * (1 - cyc);
      } else {
        // Dudaktan kopup öne düşen damla (kısa balistik döngü)
        const period = 0.85 + s0 * 0.4;
        const t = (local + s3 * period) % period;
        const out = 0.5 + s1 * 0.9;
        x = p.x + fx * out * t;
        z = p.z + fz * out * t;
        y = p.y + (0.5 + s1 * 0.8) * t - 4.9 * t * t;
        size = 0.12 + s0 * 0.1;
        alpha = y > g ? 0.8 * (1 - t / period) * opacity : 0;
      }
    } else if (crashK > 0) {
      if (ring) {
        const fwd = (0.6 + 1.4 * s0) * widthK;
        const lat = (s2 * 2 - 1) * WAVE_HALF;
        x += fx * fwd + sx * lat;
        z += fz * fwd + sz * lat;
        y = (ground?.(x, z) ?? g) + 0.05;
        const t = clamp((crashK - 0.3 - s3 * 0.25) / 0.4, 0, 1);
        size = 0.3 + t * 0.7;
        alpha = t > 0 ? 0.7 * (1 - t) : 0;
      } else {
        // Çöküş serpintisi: dudaktan öne ve yukarı püskürür
        const t = Math.max(0, local - tm.crashStart - s3 * 0.35);
        const sp = 0.6 + s0 * 1.6;
        x = p.x + fx * sp * t + sx * (s1 - 0.5) * 0.8 * t;
        z = p.z + fz * sp * t + sz * (s1 - 0.5) * 0.8 * t;
        y = p.y + (1.2 + s1 * 1.4) * t - 4.9 * t * t;
        size = 0.13 + s0 * 0.12;
        alpha = t > 0 && y > g ? 0.85 * (1 - clamp(t / 1.0, 0, 1)) : 0;
      }
    }
    v.detailPositions[i * 3 + 0] = x;
    v.detailPositions[i * 3 + 1] = y;
    v.detailPositions[i * 3 + 2] = z;
    v.detailColors[i * 3 + 0] = 0.62 + s2 * 0.15;
    v.detailColors[i * 3 + 1] = 0.86 + s2 * 0.1;
    v.detailColors[i * 3 + 2] = 1.0;
    v.detailSizes[i] = size;
    v.detailAngles[i] = 0;
    v.detailAlphas[i] = alpha;
  }

  // 5) Sis: dudak boyunca ince köpük buğusu, çöküşte büyük serpinti bulutu
  for (let i = 0; i < SMOKE_COUNT; i++) {
    const s0 = v.seeds[i * 4 + 0];
    const s1 = v.seeds[i * 4 + 1];
    const s2 = v.seeds[i * 4 + 2];
    const s3 = v.seeds[i * 4 + 3];
    const ci = Math.min(WAVE_U, Math.max(0, Math.round((0.15 + 0.7 * s2) * WAVE_U)));
    let alpha = 0;
    let size = 0;
    _c.copy(center);
    if (showWave && crashK <= 0 && local >= tm.riseStart) {
      const rise = smooth((local - tm.riseStart) / 0.8);
      _c.copy(lip[ci]);
      _c.y += 0.1 + s1 * 0.2 + Math.sin(local * 1.5 + s3 * 6) * 0.05;
      size = 0.4 + s0 * 0.35;
      alpha = 0.16 * rise;
    } else if (crashK > 0) {
      const u = clamp((crashK - s3 * 0.2) / 0.8, 0, 1);
      _c.copy(lip[ci]);
      _c.x += fx * u * 0.8;
      _c.z += fz * u * 0.8;
      _c.y = Math.max(g + 0.2, _c.y * (1 - u) + (g + 0.4 + s1 * 0.8) * u);
      size = (0.6 + u * 1.2) * (0.8 + s0 * 0.4);
      alpha = 0.32 * Math.sin(u * Math.PI);
    }
    v.smokePositions[i * 3 + 0] = _c.x;
    v.smokePositions[i * 3 + 1] = _c.y;
    v.smokePositions[i * 3 + 2] = _c.z;
    v.smokeColors[i * 3 + 0] = 0.82;
    v.smokeColors[i * 3 + 1] = 0.93;
    v.smokeColors[i * 3 + 2] = 1.0;
    v.smokeSizes[i] = size;
    v.smokeAngles[i] = s3 * Math.PI * 2 + local * 0.4;
    v.smokeAlphas[i] = alpha;
  }
}
