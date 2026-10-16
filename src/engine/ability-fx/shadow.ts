import * as THREE from 'three';
import type { Character } from '../character';
import { clamp } from '../math';
import { DETAIL_COUNT, SMOKE_COUNT, type AbilityVisual } from './visual';

/**
 * 1. KARABEY'İN GERÇEKÇİ SİYAH DUMAN YETENEĞİ (Çift Katmanlı 3B Hacimsel Duman + Minimal Sis)
 * - Siyaha çok yakın yoğun is/gölge dumanı, kesinlikle patlamaz.
 * - Karabey'in içinden değil, KAFASININ BİRAZ ÜSTÜNDEN başlayarak yoğunlaşır,
 *   ardından çoklu hedef varsa 3 kola ayrılarak eş zamanlı biçimde DÜŞMANLARIN İÇİNE gider
 *   ve düşman gövdelerinin içine doğru emilir.
 */
export function updateShadow(
  v: AbilityVisual,
  local: number,
  lt: number,
  caster: Character,
  target: Character,
  chargeEnd: number,
  impactOffset: number,
  totalDuration: number,
) {
  v.fireCoreMesh.visible = false;
  v.fireCoronaMesh.visible = false;
  v.lightningLine.visible = false;
  v.arrowGroup.visible = false;
  v.treeGroup.visible = false;
  v.vortexMesh.visible = true;
  v.outerVortexMesh.visible = true;

  const groupIndex = v.ability.groupIndex ?? 0;
  const groupSize = Math.max(1, v.ability.groupSize ?? 1);
  const groupPhase = (groupIndex / groupSize) * Math.PI * 2;

  const casterPos = caster.positionAt(lt, new THREE.Vector3());
  const targetNow = target.positionAt(lt, new THREE.Vector3());

  // Başlangıç noktası: Karabey'in kafasının biraz üstü (içinden değil!)
  const startAboveHead = new THREE.Vector3(
    casterPos.x,
    casterPos.y + caster.rig.height + 0.18,
    casterPos.z,
  );
  // Varış noktası: Düşmanın göğüs/gövde merkezi (düşmanın içine gider)
  const impactBodyBase = new THREE.Vector3(
    v.ability.impactPos.x,
    v.ability.impactPos.y + target.rig.height * 0.22,
    v.ability.impactPos.z,
  );
  const targetBodyNow = new THREE.Vector3(
    targetNow.x,
    targetNow.y + target.rig.height * 0.22,
    targetNow.z,
  );

  const center = new THREE.Vector3();
  let radiusScale = 0.65;
  let heightScale = 0.95;
  let fade = 1.0;
  let flightProgress = 0.0;
  let absorbProgress = 0.0;
  // Çoklu hedefte kafa üstünde toplanırken üst üste binen bulutların yoğunluğunu dengele, uçuşta tam yoğunluğa çıkar
  let groupDensityScale = 1.0;

  if (local < chargeEnd) {
    // EVRE 1: Karabey'in kafasının biraz üstünde toplanan yoğun siyah duman bulutu
    const u = clamp(local / chargeEnd, 0, 1);
    center.copy(startAboveHead);
    if (groupSize > 1 && u > 0.75) {
      // Fırlatmadan hemen önce her kol kendi hedefine doğru hafifçe yönelir
      const preSplit = clamp((u - 0.75) / 0.25, 0, 1);
      center.lerp(impactBodyBase, preSplit * 0.06);
    }
    radiusScale = 0.42 + 0.34 * Math.sin(u * Math.PI * 0.5);
    heightScale = 0.68 + 0.32 * u;
    fade = clamp(local / 0.22, 0, 1);
    groupDensityScale = groupSize > 1 ? 1.0 / Math.sqrt(groupSize) : 1.0;
  } else if (local < impactOffset) {
    // EVRE 2: Kafasının üstünden aşağı/ileri doğru süzülerek eş zamanlı biçimde tüm hedeflerin içine akış
    const u = clamp((local - chargeEnd) / (impactOffset - chargeEnd), 0, 1);
    flightProgress = u;
    const eased = u * u * (3 - 2 * u);
    center.lerpVectors(startAboveHead, impactBodyBase, eased);
    center.y += Math.sin(u * Math.PI) * 0.22;
    radiusScale = THREE.MathUtils.lerp(0.74, 0.58, eased);
    heightScale = THREE.MathUtils.lerp(0.98, target.rig.height * 0.68, eased);
    fade = 1.0;
    const splitBlend = clamp(u / 0.25, 0, 1);
    groupDensityScale = groupSize > 1 ? THREE.MathUtils.lerp(1.0 / Math.sqrt(groupSize), 1.0, splitBlend) : 1.0;
  } else {
    // EVRE 3: Her hedefin etrafını sarıp gövdesinin İÇİNE doğru emilerek nüfuz etme (patlamaz)
    const surroundDuration = totalDuration - impactOffset;
    const u = clamp((local - impactOffset) / surroundDuration, 0, 1);
    absorbProgress = u;
    center.copy(targetBodyNow);
    center.y += target.rig.height * 0.14 * u;
    // Yarıçap dıştan düşmanın gövdesinin içine doğru daralır (düşmanın içine girer)
    radiusScale = 0.68 * (1.0 - u * 0.68);
    heightScale = target.rig.height * (0.68 - u * 0.30);
    fade = u < 0.72 ? 1.0 : clamp((1.0 - u) / 0.28, 0, 1);
    groupDensityScale = 1.0;
  }

  v.vortexMesh.position.copy(center);
  v.vortexMesh.rotation.y = groupPhase;
  v.vortexMesh.scale.set(radiusScale, heightScale / 2.05, radiusScale);
  v.vortexMat.uniforms.uOpacity.value = 0.94 * fade * groupDensityScale;

  v.outerVortexMesh.position.copy(center);
  v.outerVortexMesh.rotation.y = -groupPhase;
  v.outerVortexMesh.scale.set(radiusScale * 1.12, heightScale / 1.95, radiusScale * 1.12);
  v.outerVortexMat.uniforms.uOpacity.value = 0.80 * fade * groupDensityScale;

  v.light.position.set(center.x, center.y + heightScale * 0.5, center.z);
  v.light.intensity = (1.1 * fade) / groupSize;

  for (let i = 0; i < SMOKE_COUNT; i++) {
    const s0 = v.seeds[i * 4 + 0];
    const s1 = v.seeds[i * 4 + 1];
    const s2 = v.seeds[i * 4 + 2];
    const s3 = v.seeds[i * 4 + 3];

    const hFrac = (s0 + local * (0.42 + s1 * 0.30)) % 1;
    const angle = groupPhase + s3 * Math.PI * 2 + local * (2.2 + s1 * 1.4) + hFrac * 2.4;

    if (local >= chargeEnd && local < impactOffset) {
      // Uçuş evresinde kafa üstünden her bir düşmanın içine uzanan akışkan duman kuyruğu
      const streamLag = s0 * 0.35;
      const streamU = clamp(flightProgress - streamLag, 0, 1);
      const streamEased = streamU * streamU * (3 - 2 * streamU);
      const px = THREE.MathUtils.lerp(startAboveHead.x, impactBodyBase.x, streamEased);
      const py =
        THREE.MathUtils.lerp(startAboveHead.y + 0.35, impactBodyBase.y + target.rig.height * 0.32, streamEased) +
        Math.sin(streamU * Math.PI) * 0.22;
      const pz = THREE.MathUtils.lerp(startAboveHead.z, impactBodyBase.z, streamEased);
      const streamR = (0.24 + (1.0 - streamU) * 0.25) * (0.6 + s2 * 0.6);

      v.smokePositions[i * 3 + 0] = px + Math.cos(angle) * streamR;
      v.smokePositions[i * 3 + 1] = py + (s1 - 0.5) * 0.35;
      v.smokePositions[i * 3 + 2] = pz + Math.sin(angle) * streamR;
    } else {
      // Kafa üstünde toplanma veya düşmanın içine doğru sarmal emilme
      const inwardPull = local >= impactOffset ? Math.max(0.08, 1.0 - hFrac * 0.55 - absorbProgress * 0.45) : 1.0;
      const ringRadius = (0.36 + Math.sin(hFrac * Math.PI) * 0.32 + (s2 - 0.5) * 0.16) * radiusScale * inwardPull;
      const y = 0.05 + hFrac * heightScale * 0.92;

      v.smokePositions[i * 3 + 0] = center.x + Math.cos(angle) * ringRadius;
      v.smokePositions[i * 3 + 1] = center.y + y;
      v.smokePositions[i * 3 + 2] = center.z + Math.sin(angle) * ringRadius;
    }

    const shade = 0.015 + s1 * 0.035;
    v.smokeColors[i * 3 + 0] = shade;
    v.smokeColors[i * 3 + 1] = shade;
    v.smokeColors[i * 3 + 2] = shade + 0.010;

    v.smokeSizes[i] = (0.55 + Math.sin(hFrac * Math.PI) * 0.38) * Math.max(0.45, radiusScale);
    v.smokeAngles[i] = groupPhase + s3 * Math.PI * 2 + local * (s0 > 0.5 ? 1.0 : -1.0);
    v.smokeAlphas[i] = Math.sin(hFrac * Math.PI) * 0.48 * fade * groupDensityScale;
  }

  for (let i = 0; i < DETAIL_COUNT; i++) {
    const s0 = v.seeds[i * 4 + 0];
    const s1 = v.seeds[i * 4 + 1];
    const s2 = v.seeds[i * 4 + 2];
    const s3 = v.seeds[i * 4 + 3];

    const hFrac = (s1 + local * (0.50 + s0 * 0.35)) % 1;
    const angle = groupPhase + s3 * Math.PI * 2 - local * (2.6 + s0 * 1.4) + hFrac * 2.8;

    if (local >= chargeEnd && local < impactOffset) {
      const streamLag = s1 * 0.30;
      const streamU = clamp(flightProgress - streamLag, 0, 1);
      const streamEased = streamU * streamU * (3 - 2 * streamU);
      const px = THREE.MathUtils.lerp(startAboveHead.x, impactBodyBase.x, streamEased);
      const py =
        THREE.MathUtils.lerp(startAboveHead.y + 0.35, impactBodyBase.y + target.rig.height * 0.32, streamEased) +
        Math.sin(streamU * Math.PI) * 0.22;
      const pz = THREE.MathUtils.lerp(startAboveHead.z, impactBodyBase.z, streamEased);
      const streamR = (0.18 + s2 * 0.25) * (1.0 - streamU * 0.35);

      v.detailPositions[i * 3 + 0] = px + Math.cos(angle) * streamR;
      v.detailPositions[i * 3 + 1] = py + (s0 - 0.5) * 0.28;
      v.detailPositions[i * 3 + 2] = pz + Math.sin(angle) * streamR;
    } else {
      const inwardPull = local >= impactOffset ? Math.max(0.05, 1.0 - hFrac * 0.65 - absorbProgress * 0.50) : 1.0;
      const ringRadius = (0.28 + s2 * 0.36) * radiusScale * inwardPull;
      const y = 0.04 + hFrac * heightScale * 0.88;

      v.detailPositions[i * 3 + 0] = center.x + Math.cos(angle) * ringRadius;
      v.detailPositions[i * 3 + 1] = center.y + y;
      v.detailPositions[i * 3 + 2] = center.z + Math.sin(angle) * ringRadius;
    }

    const dark = 0.012 + s2 * 0.028;
    v.detailColors[i * 3 + 0] = dark;
    v.detailColors[i * 3 + 1] = dark;
    v.detailColors[i * 3 + 2] = dark + 0.012;

    v.detailSizes[i] = 0.38 + s0 * 0.28;
    v.detailAngles[i] = groupPhase + s2 * Math.PI * 2 - local * 1.4;
    v.detailAlphas[i] = Math.sin(hFrac * Math.PI) * 0.42 * fade * groupDensityScale;
  }
}
