import * as THREE from 'three';
import type { Character } from '../character';
import { clamp } from '../math';
import { DETAIL_COUNT, SMOKE_COUNT, type AbilityVisual } from './visual';

/** Zemin yüksekliği (dünya x, z); arazi dışında null. */
export type GroundFn = (x: number, z: number) => number | null;

/** Bir dikenin yerden çıkış süresi ve geri batmaya başlamadan önceki duruşu (sn). */
const RISE = 0.14;
const WAVE_HOLD = 0.55;
const WAVE_SINK = 0.35;
const BIG_SINK = 0.45;

/** Hafif aşan (overshoot) yükseliş: diken fırlar, biraz geri oturur. */
const easeOutBack = (x: number) => {
  const c = 1.9;
  return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
};
const seeded = (n: number) => {
  const x = Math.sin(n * 91.7 + 47.3) * 43758.5453;
  return x - Math.floor(x);
};

const _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * TOPRAK'IN YER DİKENLERİ (toprak elementi)
 * - Güç toplama: kullananın çevresinde yerden taşçıklar yükselir, ayaklarında toz.
 * - Fırlatma (kullanan diz çöküp yere dokunur): kullanandan hedefe doğru sırayla yerden kaya dikenler
 *   fışkırır; her diken kısa süre durup geri batar, dalga hedefe ilerler.
 * - İsabet: hedefin altında üç büyük diken fışkırır, toz bulutu ve taş parçaları saçılır.
 * Dikenler cel-shade malzemeyle çizilir; tabanları arazinin yüksekliğindedir.
 */
export function updateEarth(
  v: AbilityVisual,
  local: number,
  lt: number,
  caster: Character,
  target: Character,
  chargeEnd: number,
  impactOffset: number,
  totalDuration: number,
  ground?: GroundFn,
) {
  v.fireCoreMesh.visible = false;
  v.fireCoronaMesh.visible = false;
  v.vortexMesh.visible = false;
  v.outerVortexMesh.visible = false;
  v.lightningLine.visible = false;
  v.arrowGroup.visible = false;
  v.treeGroup.visible = false;
  v.treeSlashMesh.visible = false;
  const earth = v.earth;
  if (!earth) return;
  earth.group.visible = true;

  const casterPos = caster.positionAt(lt, new THREE.Vector3());
  const end = v.ability.impactPos.clone();
  const dir = new THREE.Vector3(end.x - casterPos.x, 0, end.z - casterPos.z);
  const dist = Math.max(0.5, dir.length());
  dir.divideScalar(dist);
  const side = new THREE.Vector3(-dir.z, 0, dir.x);
  // Dalga kullananın önünden başlar ve hedefin biraz önünde biter (büyük dikenler hedefin altında)
  const startOff = Math.min(0.9, dist * 0.2);
  const span = Math.max(0.2, dist - startOff - 0.5);
  const groundAt = (x: number, z: number, t: number) => ground?.(x, z) ?? THREE.MathUtils.lerp(casterPos.y, end.y, t);
  const flight = Math.max(0.05, impactOffset - chargeEnd);
  const sizeK = THREE.MathUtils.clamp(target.rig.height / 1.7, 0.75, 1.25);

  // 1) Yol boyunca diken dalgası
  let lead = -1;
  earth.wave.forEach((m, i) => {
    const f = (i + 0.5) / earth.wave.length;
    const life = local - (chargeEnd + f * flight);
    const rise = life <= 0 ? 0 : easeOutBack(clamp(life / RISE, 0, 1));
    const sink = clamp((life - RISE - WAVE_HOLD) / WAVE_SINK, 0, 1);
    const h = THREE.MathUtils.lerp(0.55, 1.1, f) * sizeK * rise * (1 - sink * sink * (3 - 2 * sink));
    m.visible = h > 0.01;
    if (!m.visible) return;
    if (life < RISE + WAVE_HOLD) lead = i;
    const zig = (i % 2 === 0 ? 1 : -1) * (0.15 + seeded(i) * 0.25);
    _p.copy(casterPos).addScaledVector(dir, startOff + span * f).addScaledVector(side, zig);
    const r = THREE.MathUtils.lerp(0.17, 0.27, f) * sizeK;
    m.position.set(_p.x, groundAt(_p.x, _p.z, f) - 0.04, _p.z);
    m.scale.set(r, h, r);
    // İleri doğru hafif eğik, her biri kendi yönünde döner
    m.quaternion.setFromAxisAngle(side, 0.22 + seeded(i + 30) * 0.12);
    m.rotateOnWorldAxis(_up, seeded(i + 60) * Math.PI * 2);
  });

  // 2) Hedefin altında büyük dikenler
  const bigLife = local - impactOffset;
  const bigRise = bigLife <= 0 ? 0 : easeOutBack(clamp(bigLife / RISE, 0, 1));
  const bigSink = clamp((local - (totalDuration - BIG_SINK)) / BIG_SINK, 0, 1);
  const bigK = bigRise * (1 - bigSink * bigSink * (3 - 2 * bigSink));
  const heights = [1.7, 1.35, 1.15];
  earth.big.forEach((m, i) => {
    m.visible = bigK > 0.01;
    if (!m.visible) return;
    const a = (i / earth.big.length) * Math.PI * 2 + seeded(i + 90) * 0.8;
    const rad = i === 0 ? 0.08 : 0.42;
    _p.set(end.x + Math.cos(a) * rad, 0, end.z + Math.sin(a) * rad);
    const r = (i === 0 ? 0.36 : 0.27) * sizeK;
    m.position.set(_p.x, groundAt(_p.x, _p.z, 1) - 0.05, _p.z);
    m.scale.set(r, heights[i % heights.length] * sizeK * bigK, r);
    // Dışa doğru açılır
    const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const tiltAxis = new THREE.Vector3().crossVectors(_up, out).normalize();
    m.quaternion.setFromAxisAngle(tiltAxis, i === 0 ? 0.06 : 0.32);
  });

  // 3) Işık: dalganın önünde, isabette parlar
  if (local < chargeEnd) {
    v.light.position.set(casterPos.x, casterPos.y + 0.4, casterPos.z);
    v.light.intensity = 0.8 * clamp(local / chargeEnd, 0, 1);
  } else if (local < impactOffset) {
    const f = lead >= 0 ? (lead + 0.5) / earth.wave.length : 0;
    _p.copy(casterPos).addScaledVector(dir, startOff + span * f);
    v.light.position.set(_p.x, _p.y + 0.5, _p.z);
    v.light.intensity = 1.6;
  } else {
    v.light.position.set(end.x, end.y + 0.8, end.z);
    v.light.intensity = 3.2 * Math.exp(-(local - impactOffset) * 3.2);
  }

  // 4) Toz: güç toplarken ayaklarda, dalgada her dikenin dibinde, isabette büyük bulut
  for (let i = 0; i < SMOKE_COUNT; i++) {
    const s0 = v.seeds[i * 4 + 0];
    const s1 = v.seeds[i * 4 + 1];
    const s2 = v.seeds[i * 4 + 2];
    const s3 = v.seeds[i * 4 + 3];
    let x = casterPos.x;
    let y = casterPos.y;
    let z = casterPos.z;
    let size = 0;
    let alpha = 0;
    if (local < chargeEnd) {
      const u = clamp(local / chargeEnd, 0, 1);
      const a = s2 * Math.PI * 2 + local * 0.6;
      const r = 0.35 + s0 * 0.6;
      x += Math.cos(a) * r;
      z += Math.sin(a) * r;
      y += 0.05 + s1 * 0.25 * u;
      size = (0.3 + s1 * 0.35) * u;
      alpha = 0.22 * u;
    } else if (local < impactOffset + 0.1 || i < SMOKE_COUNT / 2) {
      // Dalga tozu: her parçacık bir dikene bağlı, diken çıkarken yükselip dağılır
      const k = i % earth.wave.length;
      const f = (k + 0.5) / earth.wave.length;
      const life = local - (chargeEnd + f * flight);
      const u = clamp(life / 0.9, 0, 1);
      _p.copy(casterPos).addScaledVector(dir, startOff + span * f);
      const a = s2 * Math.PI * 2;
      x = _p.x + Math.cos(a) * (0.15 + u * 0.5);
      z = _p.z + Math.sin(a) * (0.15 + u * 0.5);
      y = groundAt(_p.x, _p.z, f) + 0.05 + u * (0.3 + s1 * 0.4);
      size = (0.35 + u * 0.6) * (0.8 + s0 * 0.4);
      alpha = life > 0 ? Math.sin(u * Math.PI) * 0.4 : 0;
    } else {
      // İsabet bulutu: hedefin altından dışa ve yukarı açılır
      const u = clamp((local - impactOffset) / (totalDuration - impactOffset), 0, 1);
      const a = s2 * Math.PI * 2;
      const r = 0.2 + Math.sqrt(u) * (1.3 + s0 * 0.8);
      x = end.x + Math.cos(a) * r;
      z = end.z + Math.sin(a) * r;
      y = end.y + 0.1 + Math.sqrt(u) * (0.4 + s1 * 0.9);
      size = (0.6 + u * 1.1) * (0.8 + s3 * 0.5);
      alpha = 0.55 * (1 - u) * clamp(u * 8, 0, 1);
    }
    v.smokePositions[i * 3 + 0] = x;
    v.smokePositions[i * 3 + 1] = y;
    v.smokePositions[i * 3 + 2] = z;
    const shade = 0.5 + s3 * 0.12;
    v.smokeColors[i * 3 + 0] = shade;
    v.smokeColors[i * 3 + 1] = shade * 0.86;
    v.smokeColors[i * 3 + 2] = shade * 0.7;
    v.smokeSizes[i] = size;
    v.smokeAngles[i] = s3 * Math.PI * 2 + local * 0.5;
    v.smokeAlphas[i] = alpha;
  }

  // 5) Taş parçaları: güç toplarken çevrede süzülen taşçıklar, isabette dışa saçılan parçalar
  for (let i = 0; i < DETAIL_COUNT; i++) {
    const s0 = v.seeds[i * 4 + 0];
    const s1 = v.seeds[i * 4 + 1];
    const s2 = v.seeds[i * 4 + 2];
    const s3 = v.seeds[i * 4 + 3];
    let x = casterPos.x;
    let y = casterPos.y;
    let z = casterPos.z;
    let alpha = 0;
    if (local < chargeEnd) {
      const u = clamp(local / chargeEnd, 0, 1);
      const a = s2 * Math.PI * 2 + local * (0.8 + s0);
      const r = 0.5 + s1 * 0.5;
      x += Math.cos(a) * r;
      z += Math.sin(a) * r;
      y += 0.1 + u * (0.4 + s0 * 0.8) + Math.sin(local * 4 + s3 * 6) * 0.05;
      alpha = u * 0.9;
    } else if (local >= impactOffset) {
      const t = local - impactOffset;
      const a = s2 * Math.PI * 2;
      const speed = 2.2 + s0 * 2.4;
      const vy = 3.0 + s1 * 3.0;
      x = end.x + Math.cos(a) * speed * t;
      z = end.z + Math.sin(a) * speed * t;
      y = Math.max(end.y, end.y + 0.3 + vy * t - 4.9 * t * t);
      alpha = clamp(1 - t / 1.1, 0, 1);
    }
    v.detailPositions[i * 3 + 0] = x;
    v.detailPositions[i * 3 + 1] = y;
    v.detailPositions[i * 3 + 2] = z;
    v.detailColors[i * 3 + 0] = 0.45 + s3 * 0.15;
    v.detailColors[i * 3 + 1] = 0.38 + s3 * 0.12;
    v.detailColors[i * 3 + 2] = 0.3 + s3 * 0.1;
    v.detailSizes[i] = 0.07 + s0 * 0.09;
    v.detailAngles[i] = s2 * Math.PI * 2 + local * (2 + s1 * 4);
    v.detailAlphas[i] = alpha;
  }
}
