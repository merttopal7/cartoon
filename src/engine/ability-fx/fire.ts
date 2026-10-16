import * as THREE from 'three';
import type { Character } from '../character';
import { clamp } from '../math';
import { DETAIL_COUNT, SMOKE_COUNT, type AbilityVisual } from './visual';

/**
 * 2. TOPRAK'IN GERÇEKÇİ ATEŞ TOPU YETENEĞİ (3B Magma Çekirdeği + 3B Alev Koronası/Kuyruğu + Minimal Kıvılcım)
 */
export function updateFireball(
  v: AbilityVisual,
  local: number,
  lt: number,
  caster: Character,
  target: Character,
  chargeEnd: number,
  impactOffset: number,
  totalDuration: number,
) {
  v.vortexMesh.visible = false;
  v.outerVortexMesh.visible = false;
  v.lightningLine.visible = false;
  v.arrowGroup.visible = false;
  v.treeGroup.visible = false;

  const tmpCaster = caster.positionAt(lt, new THREE.Vector3());
  const startPoint = new THREE.Vector3(tmpCaster.x, tmpCaster.y + caster.rig.height * 0.62, tmpCaster.z);
  const endPoint = v.ability.impactPos.clone();
  endPoint.y += target.rig.height * 0.56;

  const tmpDir = new THREE.Vector3().subVectors(endPoint, startPoint);
  const totalDist = Math.max(0.001, tmpDir.length());
  tmpDir.divideScalar(totalDist);
  const tmpRight = new THREE.Vector3().crossVectors(tmpDir, new THREE.Vector3(0, 1, 0)).normalize();

  const handOrigin = startPoint.clone().addScaledVector(tmpDir, 0.58).addScaledVector(tmpRight, 0.26);
  const ballPos = new THREE.Vector3();

  if (local < chargeEnd) {
    const u = clamp(local / chargeEnd, 0, 1);
    const swingForward = u < 0.72 ? -0.30 * Math.sin((u / 0.72) * Math.PI * 0.5) : ((u - 0.72) / 0.28) * 0.62;
    ballPos.copy(handOrigin).addScaledVector(tmpDir, swingForward);

    const coreScale = 0.22 + Math.pow(u, 1.3) * 0.85;
    v.fireCoreMesh.visible = true;
    v.fireCoreMesh.position.copy(ballPos);
    v.fireCoreMesh.scale.setScalar(coreScale);
    v.fireCoreMat.uniforms.uOpacity.value = clamp(u * 1.3, 0, 1);

    v.fireCoronaMesh.visible = true;
    v.fireCoronaMesh.position.copy(ballPos);
    v.fireCoronaMesh.rotation.set(0, 0, 0);
    v.fireCoronaMesh.scale.setScalar(coreScale * 1.15);
    v.fireCoronaMat.uniforms.uOpacity.value = clamp(u * 1.1, 0, 1);

    v.light.position.copy(ballPos);
    v.light.intensity = 2.5 + u * 7.0;

    for (let i = 0; i < SMOKE_COUNT; i++) {
      const s0 = v.seeds[i * 4 + 0];
      const s1 = v.seeds[i * 4 + 1];
      const s2 = v.seeds[i * 4 + 2];
      const s3 = v.seeds[i * 4 + 3];
      const rise = (s0 + local * (1.2 + s1)) % 1;
      const r = (0.08 + rise * 0.28) * u;
      const a = local * 3.8 + s2 * Math.PI * 2;

      v.smokePositions[i * 3 + 0] = ballPos.x + Math.cos(a) * r;
      v.smokePositions[i * 3 + 1] = ballPos.y + 0.14 + rise * 0.65 * u;
      v.smokePositions[i * 3 + 2] = ballPos.z + Math.sin(a) * r;

      const g = 0.14 + (1 - rise) * 0.14;
      v.smokeColors[i * 3 + 0] = g + 0.06 * (1 - rise);
      v.smokeColors[i * 3 + 1] = g;
      v.smokeColors[i * 3 + 2] = g * 0.88;

      v.smokeSizes[i] = (0.28 + rise * 0.42) * u;
      v.smokeAngles[i] = s3 * Math.PI * 2 + local * 1.4;
      v.smokeAlphas[i] = Math.sin(rise * Math.PI) * 0.35 * u;
    }

    for (let i = 0; i < DETAIL_COUNT; i++) {
      const s0 = v.seeds[i * 4 + 0];
      const s1 = v.seeds[i * 4 + 1];
      const s2 = v.seeds[i * 4 + 2];
      const s3 = v.seeds[i * 4 + 3];

      const cycle = (local * (2.6 + s0 * 1.8) + s1) % 1;
      const radius = (0.18 + cycle * 0.35) * u;
      const angle = local * (7.0 + s2 * 5.0) + s3 * Math.PI * 2;
      const elev = (s1 - 0.5) * Math.PI;

      v.detailPositions[i * 3 + 0] = ballPos.x + Math.cos(angle) * Math.cos(elev) * radius;
      v.detailPositions[i * 3 + 1] = ballPos.y + Math.sin(elev) * radius + cycle * 0.25;
      v.detailPositions[i * 3 + 2] = ballPos.z + Math.sin(angle) * Math.cos(elev) * radius;

      v.detailColors[i * 3 + 0] = 1.0;
      v.detailColors[i * 3 + 1] = 0.90;
      v.detailColors[i * 3 + 2] = 0.78;

      v.detailSizes[i] = (0.06 + s2 * 0.08) * u;
      v.detailAngles[i] = s3 * Math.PI * 2 + local * 3.0;
      v.detailAlphas[i] = Math.sin(cycle * Math.PI) * 0.75 * u;
    }
  } else if (local < impactOffset) {
    const u = clamp((local - chargeEnd) / (impactOffset - chargeEnd), 0, 1);
    const eased = 1 - Math.pow(1 - u, 1.55);
    ballPos.lerpVectors(handOrigin, endPoint, eased);
    ballPos.y += Math.sin(u * Math.PI) * 0.22;

    v.fireCoreMesh.visible = true;
    v.fireCoreMesh.position.copy(ballPos);
    v.fireCoreMesh.scale.setScalar(1.18 + Math.sin(local * 38) * 0.06);
    v.fireCoreMat.uniforms.uOpacity.value = 1.0;

    // 3B Alev Koronası uçuş yönünün tersine doğru damla/kuyruklu yıldız gibi uzar
    v.fireCoronaMesh.visible = true;
    v.fireCoronaMesh.position.copy(ballPos).addScaledVector(tmpDir, -0.28);
    v.fireCoronaMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tmpDir);
    v.fireCoronaMesh.scale.set(1.15, 2.15, 1.15);
    v.fireCoronaMat.uniforms.uOpacity.value = 0.95;

    v.light.position.copy(ballPos);
    v.light.intensity = 9.5 + Math.sin(local * 45) * 1.5;

    const trailMaxLen = Math.min(3.2, totalDist * eased + 0.35);

    for (let i = 0; i < SMOKE_COUNT; i++) {
      const s0 = v.seeds[i * 4 + 0];
      const s1 = v.seeds[i * 4 + 1];
      const s2 = v.seeds[i * 4 + 2];
      const s3 = v.seeds[i * 4 + 3];

      const tailFrac = (s0 + local * (2.2 + s1 * 1.4)) % 1;
      const backDist = 0.35 + tailFrac * trailMaxLen;
      const spread = (0.08 + tailFrac * 0.32) * (0.4 + s2 * 0.6);
      const swirl = local * 7.5 + s3 * Math.PI * 2;

      v.smokePositions[i * 3 + 0] = ballPos.x - tmpDir.x * backDist + tmpRight.x * Math.cos(swirl) * spread;
      v.smokePositions[i * 3 + 1] =
        ballPos.y - tmpDir.y * backDist + Math.sin(swirl) * spread * 0.6 + tailFrac * 0.42;
      v.smokePositions[i * 3 + 2] = ballPos.z - tmpDir.z * backDist + tmpRight.z * Math.cos(swirl) * spread;

      const warmth = Math.max(0, 1 - tailFrac * 1.8);
      v.smokeColors[i * 3 + 0] = 0.14 + warmth * 0.32;
      v.smokeColors[i * 3 + 1] = 0.12 + warmth * 0.12;
      v.smokeColors[i * 3 + 2] = 0.11;

      v.smokeSizes[i] = 0.35 + tailFrac * 0.68;
      v.smokeAngles[i] = s3 * Math.PI * 2 + local * 1.8;
      v.smokeAlphas[i] = Math.sin(tailFrac * Math.PI) * 0.48;
    }

    for (let i = 0; i < DETAIL_COUNT; i++) {
      const s0 = v.seeds[i * 4 + 0];
      const s1 = v.seeds[i * 4 + 1];
      const s2 = v.seeds[i * 4 + 2];
      const s3 = v.seeds[i * 4 + 3];

      const tailFrac = (s0 + local * (3.2 + s1 * 2.0)) % 1;
      const backDist = 0.15 + tailFrac * trailMaxLen * 0.75;
      const spread = (0.05 + tailFrac * 0.24) * (0.35 + s2 * 0.65);
      const swirl = local * 12.0 + s3 * Math.PI * 2;

      v.detailPositions[i * 3 + 0] = ballPos.x - tmpDir.x * backDist + tmpRight.x * Math.cos(swirl) * spread;
      v.detailPositions[i * 3 + 1] = ballPos.y - tmpDir.y * backDist + Math.sin(swirl) * spread + tailFrac * 0.14;
      v.detailPositions[i * 3 + 2] = ballPos.z - tmpDir.z * backDist + tmpRight.z * Math.cos(swirl) * spread;

      v.detailColors[i * 3 + 0] = 1.0;
      v.detailColors[i * 3 + 1] = 0.92 - tailFrac * 0.35;
      v.detailColors[i * 3 + 2] = 0.80 - tailFrac * 0.60;

      v.detailSizes[i] = 0.07 + s2 * 0.09;
      v.detailAngles[i] = s3 * Math.PI * 2 + local * 4.0;
      v.detailAlphas[i] = (1.0 - Math.pow(tailFrac, 1.3)) * 0.82;
    }
  } else {
    const dt = local - impactOffset;
    const u = clamp(dt / (totalDuration - impactOffset), 0, 1);
    const fade = Math.max(0, 1 - Math.pow(u, 1.25));
    ballPos.copy(endPoint);

    if (u < 0.34) {
      const fu = u / 0.34;
      v.fireCoreMesh.visible = true;
      v.fireCoreMesh.position.copy(ballPos);
      v.fireCoreMesh.scale.setScalar(1.25 + fu * 1.45);
      v.fireCoreMat.uniforms.uOpacity.value = 1.0 - fu;

      v.fireCoronaMesh.visible = true;
      v.fireCoronaMesh.position.copy(ballPos);
      v.fireCoronaMesh.rotation.set(0, local * 4.0, 0);
      v.fireCoronaMesh.scale.setScalar(1.35 + fu * 1.95);
      v.fireCoronaMat.uniforms.uOpacity.value = (1.0 - fu) * 0.9;
    } else {
      v.fireCoreMesh.visible = false;
      v.fireCoronaMesh.visible = false;
    }

    v.light.position.copy(ballPos);
    v.light.intensity = Math.max(0, (1 - u) * (1 - u) * 12.0);

    for (let i = 0; i < SMOKE_COUNT; i++) {
      const s0 = v.seeds[i * 4 + 0];
      const s1 = v.seeds[i * 4 + 1];
      const s2 = v.seeds[i * 4 + 2];
      const s3 = v.seeds[i * 4 + 3];

      const theta = s0 * Math.PI * 2;
      const phi = Math.acos(2 * s1 - 1);
      const speed = 1.2 + s2 * 2.4;
      const drag = 1 - Math.exp(-dt * 2.1);

      v.smokePositions[i * 3 + 0] = ballPos.x + (Math.sin(phi) * Math.cos(theta) * speed + tmpDir.x * 1.2) * drag * 0.65;
      v.smokePositions[i * 3 + 1] = ballPos.y + Math.abs(Math.cos(phi)) * speed * drag * 0.55 + dt * (0.95 + s3 * 0.55);
      v.smokePositions[i * 3 + 2] = ballPos.z + (Math.sin(phi) * Math.sin(theta) * speed + tmpDir.z * 1.2) * drag * 0.65;

      const warmth = Math.max(0, 1 - u * 2.4);
      v.smokeColors[i * 3 + 0] = 0.14 + warmth * 0.32;
      v.smokeColors[i * 3 + 1] = 0.12 + warmth * 0.12;
      v.smokeColors[i * 3 + 2] = 0.11;

      v.smokeSizes[i] = 0.58 + u * 0.95 + s2 * 0.35;
      v.smokeAngles[i] = s3 * Math.PI * 2 + local * 1.2;
      v.smokeAlphas[i] = fade * 0.55;
    }

    const groundY = v.ability.impactPos.y + 0.06;
    for (let i = 0; i < DETAIL_COUNT; i++) {
      const s0 = v.seeds[i * 4 + 0];
      const s1 = v.seeds[i * 4 + 1];
      const s2 = v.seeds[i * 4 + 2];
      const s3 = v.seeds[i * 4 + 3];

      const theta = s0 * Math.PI * 2;
      const phi = Math.acos(2 * s1 - 1);
      const speed = 2.8 + s2 * 5.2;
      const drag = 1 - Math.exp(-dt * 1.9);

      const vx = Math.sin(phi) * Math.cos(theta) * speed + tmpDir.x * (1.4 + s3 * 1.8);
      const vy = Math.abs(Math.cos(phi)) * speed * 0.85 + 1.6;
      const vz = Math.sin(phi) * Math.sin(theta) * speed + tmpDir.z * (1.4 + s3 * 1.8);

      let py = ballPos.y + vy * drag * 0.65 - 4.8 * dt * dt;
      if (py < groundY) {
        py = groundY + Math.abs(py - groundY) * 0.35 * Math.exp(-dt * 2.5);
      }

      v.detailPositions[i * 3 + 0] = ballPos.x + vx * drag * 0.65;
      v.detailPositions[i * 3 + 1] = py;
      v.detailPositions[i * 3 + 2] = ballPos.z + vz * drag * 0.65;

      v.detailColors[i * 3 + 0] = 1.0;
      v.detailColors[i * 3 + 1] = 0.85 - u * 0.45;
      v.detailColors[i * 3 + 2] = 0.65 - u * 0.55;

      v.detailSizes[i] = 0.07 + s3 * 0.09;
      v.detailAngles[i] = s3 * Math.PI * 2 + local * 3.5;
      v.detailAlphas[i] = Math.max(0, 1 - u * (0.8 + s3 * 0.35)) * 0.88;
    }
  }
}
