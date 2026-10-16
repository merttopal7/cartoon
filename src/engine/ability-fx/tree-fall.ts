import * as THREE from 'three';
import type { Character } from '../character';
import { clamp } from '../math';
import { DETAIL_COUNT, SMOKE_COUNT, type AbilityVisual } from './visual';
import { TREE_REF_RELEASE, type MapTreeRecord } from '../abilities';

/**
 * 5. KARABEY'İN HARİTA AĞACI DEVİRME YETENEĞİ (Haritadaki Gerçek Çam Ağacını Kesip Yere Devirme)
 * - Bu yetenek karakterlere hasar vermez; haritadaki gerçek bir çam ağacını (Realistic_Pine_*)
 *   kesip devirir ve ağaç yerde devrilmiş halde kalır (daha sonra Defne tarafından düzeltilebilir).
 * - Evre 1 (0 .. chargeEnd = 1.65s): Karabey haritadaki ağaca döner, güç toplar ve yatay kılıç
 *   darbesini (slash_2) savurduğunda (1.15s .. 1.65s) kılıcından çıkan kızıl-altın kesim hilali
 *   ağacın gövdesine saplanarak gövdeyi keser; talaş ve odun kıymıkları saçılır.
 * - Evre 2 (chargeEnd .. impactOffset = 1.65s .. 2.38s): Haritadaki gerçek çam ağacı yerçekimi
 *   ivmesiyle (u^1.85) hızlanarak (~82°) yol kenarına devrilir; kökünde taze kesilmiş kütük kalır.
 * - Evre 3 (impactOffset .. totalDuration = 2.38s .. 3.70s ve sonrası): Ağaç yere çarpar, hafifçe
 *   sekip yerde kalıcı olarak yatık vaziyette kalır; çarpma anında gövde boyunca toz ve çam iğneleri yükselir.
 */
export function updateTreeFall(
  v: AbilityVisual,
  local: number,
  lt: number,
  caster: Character,
  chargeEnd: number,
  impactOffset: number,
  totalDuration: number,
  /** Devrilen haritadaki ağaç (yoksa yedek ağaç modeli kullanılır) */
  mapTree: MapTreeRecord | undefined,
) {
  const shift = chargeEnd - TREE_REF_RELEASE;
  local -= shift;
  chargeEnd -= shift;
  impactOffset -= shift;
  totalDuration -= shift;

  v.fireCoreMesh.visible = false;
  v.fireCoronaMesh.visible = false;
  v.vortexMesh.visible = false;
  v.outerVortexMesh.visible = false;
  v.lightningLine.visible = false;
  v.arrowGroup.visible = false;

  const casterPos = caster.positionAt(lt, new THREE.Vector3());
  const treeBasePos = mapTree ? mapTree.worldPos : v.ability.impactPos;

  // Karabey'den harita ağacına doğru yatay yön vektörü
  const dirToTreeXZ = new THREE.Vector3(treeBasePos.x - casterPos.x, 0, treeBasePos.z - casterPos.z);
  const distToTree = Math.max(0.001, dirToTreeXZ.length());
  dirToTreeXZ.divideScalar(distToTree);

  // Ağacın devrilme yönü (yolun açık kısmına doğru)
  const fallDirXZ = v.ability.fallDirXZ
    ? v.ability.fallDirXZ.clone().normalize()
    : new THREE.Vector3(-dirToTreeXZ.x, 0, -dirToTreeXZ.z).normalize();
  const rightXZ = new THREE.Vector3(-fallDirXZ.z, 0, fallDirXZ.x);

  const treeScale = mapTree ? mapTree.origScale.x : 1.0;
  const stumpAppear = clamp((local - 1.18) / 0.25, 0, 1);

  // Kılıç kesiği kor parlaklığı: kılıç dalgası ağaca ulaştığında (1.35s .. 1.65s) zirve yapar, sonra yavaşça soğur
  let cutGlow = 0.0;
  if (local >= 1.32 && local < chargeEnd) {
    cutGlow = clamp((local - 1.32) / Math.max(0.01, chargeEnd - 1.32), 0, 1);
  } else if (local >= chargeEnd) {
    cutGlow = Math.max(0, 1.0 - (local - chargeEnd) * 0.85);
  }

  // Devrilme açısı (radyan):
  // Evre 1 sonunda (1.35s .. 1.65s) kesik açılınca hafifçe (0 -> 7°) bel verir,
  // Evre 2'de (1.65s .. 2.38s) yerçekimi ivmesiyle (u^1.85) hızlanarak 82° (1.43 rad) açıyla yere çarpar,
  // Evre 3'te (2.38s .. 3.70s) çarpma anında ağır gövde sekmesi (bounce) yapar ve sonrasında yerde kalıcı olarak yatar.
  let tiltAngle = 0.0;
  let trunkShudderX = 0.0;
  let trunkShudderZ = 0.0;
  const maxFallAngle = 1.43; // ~82 derece

  if (local < chargeEnd) {
    if (local > 1.32) {
      const cutU = clamp((local - 1.32) / Math.max(0.01, chargeEnd - 1.32), 0, 1);
      tiltAngle = cutU * cutU * 0.12;
      const shudder = Math.sin(local * 62.0) * 0.045 * Math.sin(cutU * Math.PI);
      trunkShudderX = shudder;
      trunkShudderZ = Math.cos(local * 48.0) * 0.035 * Math.sin(cutU * Math.PI);
    }
  } else if (local < impactOffset) {
    const u = clamp((local - chargeEnd) / Math.max(0.01, impactOffset - chargeEnd), 0, 1);
    const gravityCurve = Math.pow(u, 1.85);
    tiltAngle = 0.12 + gravityCurve * (maxFallAngle - 0.12);
  } else if (local <= totalDuration) {
    const impactDt = local - impactOffset;
    const bounce = Math.abs(Math.sin(impactDt * 9.5)) * Math.exp(-impactDt * 4.6) * 0.075;
    tiltAngle = maxFallAngle - bounce;
  } else {
    tiltAngle = maxFallAngle;
  }

  // 1) Haritadaki gerçek çam ağacını (Realistic_Pine_*) Karabey'e doğru devir ve Karabey'in yanına kadar yerde sürükle
  const slideTarget = v.ability.slideTargetPos ?? treeBasePos;
  const rawSlide = local <= 1.75 ? 0 : clamp((local - 1.75) / (3.20 - 1.75), 0, 1);
  const slideU = local > 3.20 ? 1.0 : 1 - Math.pow(1 - rawSlide, 2.35);
  const curTreeBase = new THREE.Vector3().lerpVectors(
    treeBasePos,
    slideTarget,
    slideU,
  );

  if (mapTree) {
    // Sağ el kuralına göre: Dünya +Y eksenini (0,1,0) doğrudan fallDirXZ (Karabey) yönüne yatıran eksen = U x F = (fallDirXZ.z, 0, -fallDirXZ.x)
    const worldFallAxis = new THREE.Vector3(fallDirXZ.z, 0, -fallDirXZ.x).normalize();
    const worldTiltQuat = new THREE.Quaternion().setFromAxisAngle(worldFallAxis, tiltAngle);
    mapTree.node.quaternion
      .copy(mapTree.parentWorldQuatInv)
      .multiply(worldTiltQuat)
      .multiply(mapTree.origWorldQuat);

    const cutLift = Math.sin(Math.min(1, tiltAngle / 0.5)) * 0.46 * (1 - slideU * 0.45);
    const cutSlide = Math.sin(tiltAngle) * 0.42 * (1 - slideU);
    // Sürüklenme sırasında zemin sürtünmesi titreşimi
    const dragRumble =
      rawSlide > 0 && rawSlide < 1
        ? Math.sin(local * 44.0) * 0.05 * (1 - rawSlide)
        : 0;
    const targetWorldPos = new THREE.Vector3(
      curTreeBase.x + fallDirXZ.x * cutSlide + trunkShudderX + rightXZ.x * dragRumble,
      curTreeBase.y + cutLift,
      curTreeBase.z + fallDirXZ.z * cutSlide + trunkShudderZ + rightXZ.z * dragRumble,
    );
    if (mapTree.node.parent) {
      mapTree.node.parent.worldToLocal(targetWorldPos);
    }
    mapTree.node.position.copy(targetWorldPos);
    v.treePivotGroup.visible = false;
  } else {
    v.treePivotGroup.visible = true;
    v.treePivotGroup.position.set(
      curTreeBase.x - treeBasePos.x + trunkShudderX,
      0.68,
      curTreeBase.z - treeBasePos.z + trunkShudderZ,
    );
    v.treePivotGroup.rotation.set(tiltAngle, 0, 0);
  }

  // 2) Kesilen ağacın kök noktasında kalan taze kesilmiş kütük (ağaç Karabey'in yanına sürüklense de kütük orijinal kök yerinde kalır)
  v.treeGroup.visible = stumpAppear > 0.01;
  v.treeGroup.position.copy(treeBasePos);
  v.treeGroup.rotation.set(0, Math.atan2(fallDirXZ.x, fallDirXZ.z), 0);
  v.treeStumpGroup.scale.set(treeScale * stumpAppear, stumpAppear, treeScale * stumpAppear);

  for (let m = 0; m < v.treeMats.length; m++) {
    v.treeMats[m].uniforms.uTime.value = local;
    v.treeMats[m].uniforms.uOpacity.value = 1.0;
    v.treeMats[m].uniforms.uCutGlow.value = cutGlow;
  }

  // Yetenek süresi tamamlandıktan sonra ağaç Karabey'in yanında yatık halde ve kütük kök yerinde kalır; duman, kıymık ve ışık efektleri kapanır
  if (local > totalDuration) {
    v.treeSlashMesh.visible = false;
    v.smokePoints.visible = false;
    v.detailPoints.visible = false;
    v.light.intensity = 0;
    return;
  }

  v.smokePoints.visible = true;
  v.detailPoints.visible = true;

  const cutWorldPos = new THREE.Vector3(treeBasePos.x, treeBasePos.y + 0.72, treeBasePos.z);
  const swordStartPos = new THREE.Vector3(
    casterPos.x + dirToTreeXZ.x * 0.85,
    casterPos.y + 1.05,
    casterPos.z + dirToTreeXZ.z * 0.85,
  );

  // 3) Kılıç Kesiği Enerji Hilali (1.12s .. 1.78s arasında Karabey'in kılıcından ağacın gövdesine uçar ve gövdeyi biçer)
  if (local >= 1.12 && local <= 1.78) {
    const flightU = clamp((local - 1.12) / 0.26, 0, 1);
    const slashFade =
      local < 1.20
        ? clamp((local - 1.12) / 0.08, 0, 1)
        : local > 1.58
          ? clamp((1.78 - local) / 0.20, 0, 1)
          : 1.0;
    v.treeSlashMesh.visible = true;
    v.treeSlashMesh.position.lerpVectors(swordStartPos, cutWorldPos, flightU);
    v.treeSlashMesh.rotation.set(0, Math.atan2(dirToTreeXZ.x, dirToTreeXZ.z), (local - 1.12) * 8.5);
    const sScale = (0.85 + flightU * 0.65) * treeScale;
    v.treeSlashMesh.scale.set(sScale, sScale, 1);
    v.treeMats[3].uniforms.uCutGlow.value = slashFade;
    v.treeMats[3].uniforms.uOpacity.value = slashFade;
  } else {
    v.treeSlashMesh.visible = false;
  }

  const fadeOut = local > totalDuration - 0.55 ? clamp((totalDuration - local) / 0.55, 0, 1) : 1.0;
  const fallMidPos = new THREE.Vector3(
    curTreeBase.x + fallDirXZ.x * 5.0,
    curTreeBase.y + 0.85,
    curTreeBase.z + fallDirXZ.z * 5.0,
  );

  // 4) Dinamik ışık: kesim anında kılıç dalgasında ve kütükte, devrilme ve sürüklenme anında gövde boyunca parlar
  if (local < chargeEnd) {
    v.light.position.copy(local < 1.35 ? v.treeSlashMesh.position : cutWorldPos);
    v.light.intensity = 2.0 + cutGlow * 7.5;
  } else {
    const impactU = clamp((local - chargeEnd) / Math.max(0.01, impactOffset - chargeEnd), 0, 1);
    v.light.position.lerpVectors(cutWorldPos, fallMidPos, impactU);
    v.light.intensity = 4.5 * fadeOut;
  }

  const sinTilt = Math.sin(tiltAngle);
  const cosTilt = Math.cos(tiltAngle);
  const trunkLength = 12.5 * treeScale;

  // 5) KATMAN A: Kılıç kesim talaş dumanı, devrilme hava akımı ve Karabey'in yanına sürüklenirken yükselen yoğun toprak tozu
  for (let i = 0; i < SMOKE_COUNT; i++) {
    const s0 = v.seeds[i * 4 + 0];
    const s1 = v.seeds[i * 4 + 1];
    const s2 = v.seeds[i * 4 + 2];
    const s3 = v.seeds[i * 4 + 3];

    if (local < chargeEnd) {
      const activeCenter = local < 1.32 ? swordStartPos : cutWorldPos;
      const cycle = (s0 + local * (1.2 + s1 * 0.8)) % 1;
      const angle = s2 * Math.PI * 2 + local * 2.5;
      const r = 0.25 + cycle * 0.65;
      v.smokePositions[i * 3 + 0] = activeCenter.x + Math.cos(angle) * r;
      v.smokePositions[i * 3 + 1] = activeCenter.y - 0.35 + s3 * 0.65 + cycle * 0.35;
      v.smokePositions[i * 3 + 2] = activeCenter.z + Math.sin(angle) * r;

      v.smokeColors[i * 3 + 0] = 0.44;
      v.smokeColors[i * 3 + 1] = 0.34;
      v.smokeColors[i * 3 + 2] = 0.24;
      v.smokeSizes[i] = 0.35 + cycle * 0.42;
      v.smokeAngles[i] = s3 * Math.PI * 2 + local * 1.5;
      v.smokeAlphas[i] = Math.sin(cycle * Math.PI) * (0.18 + cutGlow * 0.32);
    } else if (local < impactOffset) {
      // Harita ağacı devrilirken ve sürüklenmeye başlarken 12m'lik gövde boyunca oluşan hava akımı ve toz izi
      const trunkDist = 1.0 + s0 * trunkLength;
      const px = curTreeBase.x + fallDirXZ.x * (trunkDist * sinTilt);
      const py = curTreeBase.y + 0.68 + trunkDist * cosTilt;
      const pz = curTreeBase.z + fallDirXZ.z * (trunkDist * sinTilt);
      const spread = (s1 - 0.5) * 1.55;

      v.smokePositions[i * 3 + 0] = px + rightXZ.x * spread;
      v.smokePositions[i * 3 + 1] = py + (s2 - 0.3) * 0.55;
      v.smokePositions[i * 3 + 2] = pz + rightXZ.z * spread;

      v.smokeColors[i * 3 + 0] = 0.44;
      v.smokeColors[i * 3 + 1] = 0.36;
      v.smokeColors[i * 3 + 2] = 0.26;
      v.smokeSizes[i] = 0.62 + s3 * 0.60;
      v.smokeAngles[i] = s2 * Math.PI * 2 + local * 2.2;
      v.smokeAlphas[i] = 0.40;
    } else {
      // Ağaç yere çarpıp Karabey'in yanına kadar sürüklenirken gövde ve sürüklenme izi boyunca yayılan yoğun toz bulutu
      const dt = local - impactOffset;
      const u = clamp(dt / Math.max(0.01, totalDuration - impactOffset), 0, 1);
      const drag = 1 - Math.exp(-dt * 2.6);
      const alongTrunk = 0.8 + s0 * trunkLength;
      // Parçacıkların bir kısmı sürüklenen ağacın anlık konumunda, bir kısmı da kütükten Karabey'e uzanan sürüklenme izinde kalır
      const trailLerp = s2 < 0.55 ? slideU : slideU * (0.25 + 0.75 * s2);
      const trailOriginX = THREE.MathUtils.lerp(treeBasePos.x, slideTarget.x, trailLerp);
      const trailOriginZ = THREE.MathUtils.lerp(treeBasePos.z, slideTarget.z, trailLerp);
      const baseX = trailOriginX + fallDirXZ.x * alongTrunk;
      const baseZ = trailOriginZ + fallDirXZ.z * alongTrunk;
      const angle = s3 * Math.PI * 2;
      const rad = (0.40 + s1 * 2.10) * drag;

      v.smokePositions[i * 3 + 0] = baseX + Math.cos(angle) * rad;
      v.smokePositions[i * 3 + 1] = treeBasePos.y + 0.18 + s2 * 0.85 * drag + dt * 0.48;
      v.smokePositions[i * 3 + 2] = baseZ + Math.sin(angle) * rad;

      v.smokeColors[i * 3 + 0] = 0.48;
      v.smokeColors[i * 3 + 1] = 0.39;
      v.smokeColors[i * 3 + 2] = 0.28;
      v.smokeSizes[i] = 0.85 + u * 1.05 + s1 * 0.50;
      v.smokeAngles[i] = s3 * Math.PI * 2 + local * 1.4;
      v.smokeAlphas[i] = (1 - u * 0.82) * 0.62 * fadeOut;
    }
  }

  // 6) KATMAN B: Kılıç kesiğinden fırlayan odun kıymıkları ve sürüklenme sırasında saçılan çam iğneleri/dallar
  const groundY = treeBasePos.y + 0.05;
  for (let i = 0; i < DETAIL_COUNT; i++) {
    const s0 = v.seeds[i * 4 + 0];
    const s1 = v.seeds[i * 4 + 1];
    const s2 = v.seeds[i * 4 + 2];
    const s3 = v.seeds[i * 4 + 3];
    const isPineNeedle = s1 < 0.45;

    if (local < chargeEnd) {
      const chipActive = clamp((local - 1.25) / Math.max(0.01, chargeEnd - 1.25), 0, 1);
      const cycle = (s0 + local * (2.8 + s2 * 1.8)) % 1;
      const angle = s3 * Math.PI * 2;
      const speed = (0.30 + cycle * 1.35) * chipActive;

      v.detailPositions[i * 3 + 0] = cutWorldPos.x + Math.cos(angle) * speed;
      v.detailPositions[i * 3 + 1] = cutWorldPos.y + (s1 - 0.3) * 0.55 - cycle * cycle * 0.45;
      v.detailPositions[i * 3 + 2] = cutWorldPos.z + Math.sin(angle) * speed;

      if (s2 < 0.65) {
        v.detailColors[i * 3 + 0] = 0.82;
        v.detailColors[i * 3 + 1] = 0.58;
        v.detailColors[i * 3 + 2] = 0.32;
      } else {
        v.detailColors[i * 3 + 0] = 1.0;
        v.detailColors[i * 3 + 1] = 0.65;
        v.detailColors[i * 3 + 2] = 0.22;
      }
      v.detailSizes[i] = 0.09 + s0 * 0.08;
      v.detailAngles[i] = s3 * Math.PI * 2 + local * 8.0;
      v.detailAlphas[i] = Math.sin(cycle * Math.PI) * chipActive * 0.90;
    } else if (local < impactOffset) {
      const trunkDist = 1.2 + s0 * trunkLength;
      const px = curTreeBase.x + fallDirXZ.x * (trunkDist * sinTilt);
      const py = curTreeBase.y + 0.68 + trunkDist * cosTilt;
      const pz = curTreeBase.z + fallDirXZ.z * (trunkDist * sinTilt);
      const spread = (s2 - 0.5) * 1.95;

      v.detailPositions[i * 3 + 0] = px + rightXZ.x * spread;
      v.detailPositions[i * 3 + 1] = py + (s3 - 0.2) * 0.75;
      v.detailPositions[i * 3 + 2] = pz + rightXZ.z * spread;

      if (isPineNeedle) {
        v.detailColors[i * 3 + 0] = 0.16;
        v.detailColors[i * 3 + 1] = 0.42;
        v.detailColors[i * 3 + 2] = 0.15;
      } else {
        v.detailColors[i * 3 + 0] = 0.68;
        v.detailColors[i * 3 + 1] = 0.46;
        v.detailColors[i * 3 + 2] = 0.24;
      }
      v.detailSizes[i] = 0.10 + s0 * 0.08;
      v.detailAngles[i] = s3 * Math.PI * 2 + local * 9.0;
      v.detailAlphas[i] = 0.85;
    } else {
      const dt = local - impactOffset;
      const alongTrunk = 1.0 + s0 * trunkLength;
      const baseX = curTreeBase.x + fallDirXZ.x * alongTrunk;
      const baseZ = curTreeBase.z + fallDirXZ.z * alongTrunk;
      const angle = s1 * Math.PI * 2;
      const speed = 1.4 + s2 * 3.2;
      const drag = 1 - Math.exp(-dt * 2.2);
      const vy = 1.8 + s3 * 2.6;

      let py = treeBasePos.y + 0.35 + vy * drag * 0.65 - 4.6 * dt * dt;
      if (py < groundY) {
        py = groundY + Math.abs(py - groundY) * 0.30 * Math.exp(-dt * 3.0);
      }

      v.detailPositions[i * 3 + 0] = baseX + Math.cos(angle) * speed * drag * 0.65;
      v.detailPositions[i * 3 + 1] = py;
      v.detailPositions[i * 3 + 2] = baseZ + Math.sin(angle) * speed * drag * 0.65;

      if (isPineNeedle) {
        v.detailColors[i * 3 + 0] = 0.18;
        v.detailColors[i * 3 + 1] = 0.44;
        v.detailColors[i * 3 + 2] = 0.16;
      } else {
        v.detailColors[i * 3 + 0] = 0.72;
        v.detailColors[i * 3 + 1] = 0.48;
        v.detailColors[i * 3 + 2] = 0.25;
      }
      v.detailSizes[i] = 0.11 + s3 * 0.09;
      v.detailAngles[i] = s2 * Math.PI * 2 + local * 6.5;
      v.detailAlphas[i] = fadeOut * 0.88;
    }
  }
}
