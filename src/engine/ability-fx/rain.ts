import * as THREE from 'three';
import type { Character } from '../character';
import { clamp } from '../math';
import { DETAIL_COUNT, SMOKE_COUNT, type AbilityVisual } from './visual';

/**
 * Erika'nın (veya yayı kullanan karakterin) sol bileğinin (mixamorigLeftHand) o andaki gerçek 3B dünya
 * konumunu (outPos) ve sol bilek ile sol dirsek (mixamorigLeftForeArm) arasındaki önkol doğrultusunu (outDir) döndürür.
 * Böylece okun ucu bilekte dururken mavi ok gövdesi tam bilekten dirseğe doğru uzanır ve sol kol nasıl hareket ederse
 * ok da çıkana kadar birebir öyle hareket eder.
 */
function getCasterLeftHandTransform(
  caster: Character,
  fallbackDirXZ: THREE.Vector3,
  outPos: THREE.Vector3,
  outDir: THREE.Vector3,
): void {
  caster.rig.root.updateMatrixWorld(true);
  let leftWrist: THREE.Object3D | undefined;
  let leftElbow: THREE.Object3D | undefined;
  caster.rig.root.traverse((obj) => {
    if (!leftWrist && /lefthand$/i.test(obj.name)) {
      leftWrist = obj;
    } else if (!leftElbow && /leftforearm$/i.test(obj.name)) {
      leftElbow = obj;
    }
  });
  if (leftWrist) {
    leftWrist.getWorldPosition(outPos);
    if (leftElbow) {
      const elbowPos = leftElbow.getWorldPosition(new THREE.Vector3());
      // Sol bilek (mixamorigLeftHand) ile sol dirsek (mixamorigLeftForeArm) arasındaki doğrultu:
      // +Y ekseni dirsekten bileğe (okun sivri ucu bilekte ileriye),
      // -Y ekseni (okun gövdesi ve kanatçıkları) ise tam BİLEKTEN DİRSEĞE DOĞRU uzanır.
      outDir.subVectors(outPos, elbowPos);
      if (outDir.lengthSq() > 1e-6) {
        outDir.normalize();
        return;
      }
    }
    const handQuat = leftWrist.getWorldQuaternion(new THREE.Quaternion());
    outDir.set(0, 1, 0).applyQuaternion(handQuat).normalize();
    return;
  }
  const casterPos = caster.pose.position;
  outPos.set(
    casterPos.x + fallbackDirXZ.x * 0.68,
    casterPos.y + caster.rig.height * 0.79,
    casterPos.z + fallbackDirXZ.z * 0.68,
  );
  outDir.copy(fallbackDirXZ);
}

/**
 * 4. ERİKA'NIN (MEŞE'NİN) 3B BÜYÜLÜ YAĞMUR OKU VE FIRTINA YAĞMURU YETENEĞİ
 * - Evre 1 (0 .. chargeEnd = 2.15s): Mavi büyülü ok doğrudan Erika'nın SOL BİLEĞİNDEN SOL DİRSEĞİNE DOĞRU
 *   (mixamorigLeftHand -> mixamorigLeftForeArm) bağlıdır; sol el/önkol nasıl hareket edip dönüyorsa mavi ok da
 *   çıkana kadar bilekten dirseğe doğru hizalı olarak hareket eder. (Henüz yağmur yağmaz)
 * - Evre 2 (chargeEnd .. impactOffset = 2.15s .. 2.80s): Erika yay kirişini bıraktığında (aim_recoil)
 *   3B Büyülü Ok doğrudan Erika'nın SOL ELİNDEN çıkarak yüksek hızla hedefe fırlar. (Henüz yağmur yağmaz)
 * - Evre 3 (impactOffset .. totalDuration = 2.80s .. 4.70s): Büyülü ok hedefe çarptığı anda hedefin tepesinde
 *   3B Fırtına Bulutu patlar, şimşek çakar ve hedefin üzerine sağanak yağmur yağmaya başlar.
 */
export function updateRain(
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
  v.treeGroup.visible = false;

  const casterPos = caster.positionAt(lt, new THREE.Vector3());
  const targetNow = target.positionAt(lt, new THREE.Vector3());

  const toTargetXZ = new THREE.Vector3(
    v.ability.impactPos.x - casterPos.x,
    0,
    v.ability.impactPos.z - casterPos.z,
  );
  const distXZ = Math.max(0.001, toTargetXZ.length());
  toTargetXZ.divideScalar(distXZ);

  // Erika'nın SOL BİLEĞİNİN (mixamorigLeftHand) 3B konumu ve BİLEK-DİRSEK (mixamorigLeftForeArm) doğrultusu
  const leftHandPos = new THREE.Vector3();
  const leftHandDir = new THREE.Vector3();
  getCasterLeftHandTransform(caster, toTargetXZ, leftHandPos, leftHandDir);

  // Büyülü okun hedefe saplanacağı göğüs/üst gövde noktası
  const impactPoint = new THREE.Vector3(
    v.ability.impactPos.x,
    v.ability.impactPos.y + target.rig.height * 0.68,
    v.ability.impactPos.z,
  );

  const upAxis = new THREE.Vector3(0, 1, 0);

  if (local < chargeEnd) {
    // ======================================================================
    // EVRE 1: MAVİ OKUN ERİKA'NIN SOL BİLEĞİNDEN DİRSEĞİNE DOĞRU BAĞLI HAREKET ETMESİ (0 .. 2.15s)
    // Sol el ve önkol nasıl hareket ederse mavi ok da çıkana kadar bilekten dirseğe doğru hizalı hareket eder.
    // ======================================================================
    v.vortexMesh.visible = false;
    v.outerVortexMesh.visible = false;
    v.lightningLine.visible = false;
    v.arrowGroup.visible = true;

    // Sol bileğin son konumunu fırlatma başlangıç noktası olarak kaydet (ok tam sol elden çıkacak)
    v.launchOrigin.copy(leftHandPos);

    const appear = clamp(local / 0.08, 0, 1);
    const chargeProgress = clamp(local / Math.max(0.01, chargeEnd), 0, 1);
    const pulse = 1.0 + Math.sin(local * 12.0) * 0.04 * chargeProgress;

    // Okun konumu sol bileğe (leftHandPos), gövdesi ise bilekten dirseğe doğru (-leftHandDir) kilitlenir
    v.arrowGroup.position.copy(leftHandPos);
    v.arrowGroup.quaternion.setFromUnitVectors(upAxis, leftHandDir);
    // Elde tutulurken ok matkap gibi dönmez; 3B su sarmalları kendi shader'ı içinde akar
    v.arrowSpinGroup.rotation.y = Math.sin(local * 3.5) * 0.12;

    const chargeScale = (0.92 + 0.14 * appear) * pulse;
    v.arrowGroup.scale.set(chargeScale, chargeScale, chargeScale);

    for (let m = 0; m < v.arrowMats.length; m++) {
      v.arrowMats[m].uniforms.uTime.value = local;
      v.arrowMats[m].uniforms.uOpacity.value = appear;
      v.arrowMats[m].uniforms.uFlight.value = chargeProgress * 0.35;
    }

    // Işık ve su/şimşek enerjisi doğrudan Erika'nın sol bileğiyle birlikte hareket eder
    v.light.position.copy(leftHandPos);
    v.light.intensity = (2.8 + chargeProgress * 4.8) * appear;

    // Okun üstünü örtmeyen, yalnızca ok gövdesi ve temreni etrafında çok ince su buharı halesi
    const horizAngle = Math.atan2(leftHandDir.x, leftHandDir.y);
    for (let i = 0; i < SMOKE_COUNT; i++) {
      const s0 = v.seeds[i * 4 + 0];
      const s1 = v.seeds[i * 4 + 1];
      const s2 = v.seeds[i * 4 + 2];
      const s3 = v.seeds[i * 4 + 3];

      const cycle = (s0 + local * (1.5 + s1)) % 1;
      const r = (0.045 * (1 - cycle * 0.65) + 0.012) * appear;
      const a = local * 5.5 + s2 * Math.PI * 2;
      // 0.20m (temren ucu) ile -0.36m (dirsekteki kanatçıklar) arasında tam bilekten dirseğe dizilim
      const along = (0.20 - s3 * 0.56) * chargeScale;

      v.smokePositions[i * 3 + 0] = leftHandPos.x + leftHandDir.x * along + Math.cos(a) * r;
      v.smokePositions[i * 3 + 1] = leftHandPos.y + leftHandDir.y * along + Math.sin(a) * r;
      v.smokePositions[i * 3 + 2] = leftHandPos.z + leftHandDir.z * along + Math.sin(a + 1.2) * r;

      v.smokeColors[i * 3 + 0] = 0.28;
      v.smokeColors[i * 3 + 1] = 0.72;
      v.smokeColors[i * 3 + 2] = 0.98;

      v.smokeSizes[i] = (0.07 + (1 - cycle) * 0.06) * appear;
      v.smokeAngles[i] = s3 * Math.PI * 2 + local * 2.5;
      v.smokeAlphas[i] = Math.sin(cycle * Math.PI) * 0.14 * appear;
    }

    // Bilekten dirseğe uzanan ok gövdesine doğru yoğunlaşan ince kristal su damlacıkları
    for (let i = 0; i < DETAIL_COUNT; i++) {
      const s0 = v.seeds[i * 4 + 0];
      const s1 = v.seeds[i * 4 + 1];
      const s2 = v.seeds[i * 4 + 2];
      const s3 = v.seeds[i * 4 + 3];

      const cycle = (s0 + local * (2.6 + s2 * 1.4)) % 1;
      const spiralR = (1 - cycle) * (0.025 + s1 * 0.045) * appear;
      const angle = local * (12.0 + s3 * 5.0) + s2 * Math.PI * 2;
      // -0.36m (dirsek) ile +0.23m (bilek önü temren ucu) arasında akış
      const shaftOffset = (-0.36 + ((s1 + cycle * 0.45) % 1) * 0.59) * chargeScale;

      v.detailPositions[i * 3 + 0] = leftHandPos.x + leftHandDir.x * shaftOffset + Math.cos(angle) * spiralR;
      v.detailPositions[i * 3 + 1] = leftHandPos.y + leftHandDir.y * shaftOffset + Math.sin(angle) * spiralR;
      v.detailPositions[i * 3 + 2] = leftHandPos.z + leftHandDir.z * shaftOffset + Math.cos(angle + 1.57) * spiralR;

      v.detailColors[i * 3 + 0] = 0.45 + cycle * 0.45;
      v.detailColors[i * 3 + 1] = 0.86 + cycle * 0.14;
      v.detailColors[i * 3 + 2] = 1.0;

      v.detailSizes[i] = (0.045 + s0 * 0.045) * appear;
      v.detailAngles[i] = horizAngle;
      v.detailAlphas[i] = Math.sin(cycle * Math.PI) * 0.68 * appear;
    }
  } else if (local < impactOffset) {
    // ======================================================================
    // EVRE 2: BÜYÜLÜ YAĞMUR OKUNUN DOĞRUDAN ERİKA'NIN SOL ELİNDEN ÇIKIP HEDEFE UÇUŞU
    // ======================================================================
    v.vortexMesh.visible = false;
    v.outerVortexMesh.visible = false;
    v.lightningLine.visible = false;
    v.arrowGroup.visible = true;

    // Zaman çizelgesinde doğrudan bu kareye atlandıysa sol el konumunu yedekle
    if (v.launchOrigin.lengthSq() < 0.001) {
      v.launchOrigin.copy(leftHandPos);
    }
    const startHandPos = v.launchOrigin;

    const rawU = clamp((local - chargeEnd) / Math.max(0.01, impactOffset - chargeEnd), 0, 1);
    // Yaydan çıkan okun gergin, hızlı ve gerçekçi okçu yörüngesi (hafif kavis: 0.18m)
    const flightU = 1 - Math.pow(1 - rawU, 1.45);
    const arcLift = 0.18;

    const arrowPos = new THREE.Vector3().lerpVectors(startHandPos, impactPoint, flightU);
    arrowPos.y += Math.sin(flightU * Math.PI) * arcLift;

    // Anlık teğet vektörü (okun çentikli elmas ucu daima uçuş eğrisinin teğetine bakar)
    const tangent = new THREE.Vector3().subVectors(impactPoint, startHandPos);
    tangent.y += Math.cos(flightU * Math.PI) * Math.PI * arcLift;
    tangent.normalize();

    v.arrowGroup.position.copy(arrowPos);
    v.arrowGroup.quaternion.setFromUnitVectors(upAxis, tangent);
    v.arrowSpinGroup.rotation.y = (local - chargeEnd) * 18.0;
    v.arrowGroup.scale.set(1.18, 1.38, 1.18);

    for (let m = 0; m < v.arrowMats.length; m++) {
      v.arrowMats[m].uniforms.uTime.value = local;
      v.arrowMats[m].uniforms.uOpacity.value = 1.0;
      v.arrowMats[m].uniforms.uFlight.value = 1.0;
    }

    v.light.position.copy(arrowPos);
    v.light.intensity = 6.5;

    // Uçan okun arkasında bıraktığı ince, yüksek hızlı hidrodinamik su/buhar izi
    const trailAngle = Math.atan2(tangent.x, tangent.y);
    for (let i = 0; i < SMOKE_COUNT; i++) {
      const s0 = v.seeds[i * 4 + 0];
      const s1 = v.seeds[i * 4 + 1];
      const s2 = v.seeds[i * 4 + 2];
      const s3 = v.seeds[i * 4 + 3];

      const lagFrac = (i / SMOKE_COUNT) * 0.50 + s0 * 0.12;
      const trailU = clamp(flightU - lagFrac * 0.55, 0, flightU);
      const px = THREE.MathUtils.lerp(startHandPos.x, impactPoint.x, trailU);
      const py =
        THREE.MathUtils.lerp(startHandPos.y, impactPoint.y, trailU) + Math.sin(trailU * Math.PI) * arcLift;
      const pz = THREE.MathUtils.lerp(startHandPos.z, impactPoint.z, trailU);

      const swirlAngle = local * 18.0 + i * 0.75 + s3 * Math.PI * 2;
      const spread = (0.015 + lagFrac * 0.075) * (0.5 + s1 * 0.5);

      v.smokePositions[i * 3 + 0] = px + Math.cos(swirlAngle) * spread;
      v.smokePositions[i * 3 + 1] = py + Math.sin(swirlAngle) * spread;
      v.smokePositions[i * 3 + 2] = pz + Math.cos(swirlAngle + 1.57) * spread;

      v.smokeColors[i * 3 + 0] = 0.25;
      v.smokeColors[i * 3 + 1] = 0.72;
      v.smokeColors[i * 3 + 2] = 0.98;

      v.smokeSizes[i] = 0.09 + lagFrac * 0.16;
      v.smokeAngles[i] = s2 * Math.PI * 2 + local * 4.0;
      v.smokeAlphas[i] = (1 - lagFrac) * 0.34;
    }

    // Uçan okun kanatçıklarından saçılan ince su damlacıkları ve keskin su çizgileri
    for (let i = 0; i < DETAIL_COUNT; i++) {
      const s0 = v.seeds[i * 4 + 0];
      const s1 = v.seeds[i * 4 + 1];
      const s2 = v.seeds[i * 4 + 2];
      const s3 = v.seeds[i * 4 + 3];

      const lagFrac = ((s0 + local * 3.8) % 1) * 0.55;
      const trailU = clamp(flightU - lagFrac * 0.48, 0, flightU);
      const px = THREE.MathUtils.lerp(startHandPos.x, impactPoint.x, trailU);
      const py =
        THREE.MathUtils.lerp(startHandPos.y, impactPoint.y, trailU) + Math.sin(trailU * Math.PI) * arcLift;
      const pz = THREE.MathUtils.lerp(startHandPos.z, impactPoint.z, trailU);

      const swirlAngle = local * 24.0 + s3 * Math.PI * 2;
      const spread = (0.012 + lagFrac * 0.065) * (0.4 + s2 * 0.6);

      v.detailPositions[i * 3 + 0] = px + Math.cos(swirlAngle) * spread;
      v.detailPositions[i * 3 + 1] = py + Math.sin(swirlAngle) * spread;
      v.detailPositions[i * 3 + 2] = pz + Math.sin(swirlAngle + 1.2) * spread;

      v.detailColors[i * 3 + 0] = 0.42 + s1 * 0.38;
      v.detailColors[i * 3 + 1] = 0.88;
      v.detailColors[i * 3 + 2] = 1.0;

      v.detailSizes[i] = 0.07 + (1 - lagFrac) * 0.09;
      v.detailAngles[i] = trailAngle;
      v.detailAlphas[i] = (1 - lagFrac) * 0.88;
    }
  } else {
    // ======================================================================
    // EVRE 3: OK HEDEFE ÇARPINCA GÖĞE YÜKSELİR, FIRTINA BULUTU OLUŞUR, ÇATALLI ŞİMŞEK ÇAKAR VE YAĞMUR YAĞAR
    // ======================================================================
    v.vortexMesh.visible = true;
    v.outerVortexMesh.visible = true;

    const rainLocal = local - impactOffset;
    const cloudCenter = new THREE.Vector3(
      v.ability.impactPos.x * 0.25 + targetNow.x * 0.75,
      v.ability.impactPos.y + 3.25,
      v.ability.impactPos.z * 0.25 + targetNow.z * 0.75,
    );

    // Çarpma anındaki ilk 0.22 saniyede büyülü ok hedeften gökyüzündeki bulut merkezine yükselerek bulutu oluşturur
    if (rainLocal < 0.22) {
      const ascendU = clamp(rainLocal / 0.22, 0, 1);
      v.arrowGroup.visible = true;
      v.arrowGroup.position.lerpVectors(impactPoint, cloudCenter, ascendU);
      v.arrowGroup.quaternion.identity();
      v.arrowSpinGroup.rotation.y = local * 24.0;
      const burstScale = 1.15 * (1 - ascendU * 0.55);
      v.arrowGroup.scale.set(burstScale, burstScale * 1.45, burstScale);
      for (let m = 0; m < v.arrowMats.length; m++) {
        v.arrowMats[m].uniforms.uTime.value = local;
        v.arrowMats[m].uniforms.uOpacity.value = 1.0 - ascendU;
        v.arrowMats[m].uniforms.uFlight.value = 1.0;
      }
    } else {
      v.arrowGroup.visible = false;
    }

    const fadeOut = local > totalDuration - 0.55 ? clamp((totalDuration - local) / 0.55, 0, 1) : 1.0;
    // Ok çarptığı anda (rainLocal: 0 -> 0.28s) fırtına bulutu hızla büyür
    const grow = clamp(rainLocal / 0.28, 0, 1);

    // Çarpma anında güçlü ilk şimşek çakması + sağanak boyunca çakan şimşekler
    const impactBurstFlash = rainLocal < 0.24 ? 1.0 - rainLocal / 0.24 : 0;
    const stormFlash =
      local < totalDuration - 0.35
        ? Math.max(0, Math.sin(rainLocal * 31 + 1.2) * Math.sin(rainLocal * 13 + 0.8))
        : 0;
    const lightningFlash = Math.max(impactBurstFlash, stormFlash);

    // 3B Hacimsel Fırtına Bulutu Kubbesi
    v.vortexMesh.position.copy(cloudCenter);
    v.vortexMesh.scale.setScalar(grow);
    v.vortexMat.uniforms.uOpacity.value = 0.95 * grow * fadeOut;
    v.vortexMat.uniforms.uLightning.value = lightningFlash;

    v.outerVortexMesh.position.copy(cloudCenter);
    v.outerVortexMesh.scale.setScalar(grow);
    v.outerVortexMat.uniforms.uOpacity.value = 0.80 * grow * fadeOut;
    v.outerVortexMat.uniforms.uLightning.value = lightningFlash;

    // 3B Çatallı Şimşek Güncellemesi (12 segment ana gövde + 6 segment iki yan çatal kol)
    if (lightningFlash > 0.38) {
      v.lightningLine.visible = true;
      v.lightningMat.opacity = clamp((lightningFlash - 0.34) * 1.85 * fadeOut, 0, 1);
      const boltStep = Math.floor(local * 24);
      const mainSegments = 12;
      let curX = cloudCenter.x + Math.sin(boltStep * 7.3) * 0.22;
      let curY = cloudCenter.y - 0.12;
      let curZ = cloudCenter.z + Math.cos(boltStep * 5.1) * 0.22;
      const segH = 3.05 / mainSegments;

      let fork1X = curX;
      let fork1Y = curY;
      let fork1Z = curZ;
      let fork2X = curX;
      let fork2Y = curY;
      let fork2Z = curZ;

      for (let i = 0; i < mainSegments; i++) {
        const nextY = curY - segH;
        const jx = Math.sin(boltStep * 13.7 + i * 4.9) * 0.25 * (1 - i / mainSegments);
        const jz = Math.cos(boltStep * 9.3 + i * 6.1) * 0.25 * (1 - i / mainSegments);
        const nextX = cloudCenter.x + jx;
        const nextZ = cloudCenter.z + jz;

        const idx = i * 6;
        v.lightningPositions[idx + 0] = curX;
        v.lightningPositions[idx + 1] = curY;
        v.lightningPositions[idx + 2] = curZ;
        v.lightningPositions[idx + 3] = nextX;
        v.lightningPositions[idx + 4] = nextY;
        v.lightningPositions[idx + 5] = nextZ;

        if (i === 3) {
          fork1X = nextX;
          fork1Y = nextY;
          fork1Z = nextZ;
        } else if (i === 6) {
          fork2X = nextX;
          fork2Y = nextY;
          fork2Z = nextZ;
        }

        curX = nextX;
        curY = nextY;
        curZ = nextZ;
      }

      // Yan Çatal 1 (segment 12..14)
      let bx = fork1X;
      let by = fork1Y;
      let bz = fork1Z;
      for (let f = 0; f < 3; f++) {
        const nx = bx + (0.18 + 0.08 * Math.sin(boltStep * 3.1 + f)) * (boltStep % 2 === 0 ? 1 : -1);
        const ny = by - segH * 0.85;
        const nz = bz + 0.14 * Math.cos(boltStep * 4.7 + f);
        const idx = (mainSegments + f) * 6;
        v.lightningPositions[idx + 0] = bx;
        v.lightningPositions[idx + 1] = by;
        v.lightningPositions[idx + 2] = bz;
        v.lightningPositions[idx + 3] = nx;
        v.lightningPositions[idx + 4] = ny;
        v.lightningPositions[idx + 5] = nz;
        bx = nx;
        by = ny;
        bz = nz;
      }

      // Yan Çatal 2 (segment 15..17)
      bx = fork2X;
      by = fork2Y;
      bz = fork2Z;
      for (let f = 0; f < 3; f++) {
        const nx = bx + (0.16 + 0.07 * Math.cos(boltStep * 5.3 + f)) * (boltStep % 2 === 0 ? -1 : 1);
        const ny = by - segH * 0.80;
        const nz = bz - 0.15 * Math.sin(boltStep * 6.1 + f);
        const idx = (mainSegments + 3 + f) * 6;
        v.lightningPositions[idx + 0] = bx;
        v.lightningPositions[idx + 1] = by;
        v.lightningPositions[idx + 2] = bz;
        v.lightningPositions[idx + 3] = nx;
        v.lightningPositions[idx + 4] = ny;
        v.lightningPositions[idx + 5] = nz;
        bx = nx;
        by = ny;
        bz = nz;
      }

      (v.lightningLine.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    } else {
      v.lightningLine.visible = false;
    }

    v.light.position.set(cloudCenter.x, cloudCenter.y - 1.0, cloudCenter.z);
    v.light.intensity = (3.5 + lightningFlash * 10.0) * grow * fadeOut;

    for (let i = 0; i < SMOKE_COUNT; i++) {
      const s0 = v.seeds[i * 4 + 0];
      const s1 = v.seeds[i * 4 + 1];
      const s2 = v.seeds[i * 4 + 2];
      const s3 = v.seeds[i * 4 + 3];

      if (i < 24) {
        // Bulut kenarlarını yumuşatan büyük FBM fırtına bulutu katmanları
        const angle = s0 * Math.PI * 2 + local * 0.15;
        const rx = (0.65 + s1 * 0.95) * grow;
        const rz = (0.55 + s2 * 0.85) * grow;
        const ry = (s3 - 0.5) * 0.45 * grow;

        v.smokePositions[i * 3 + 0] = cloudCenter.x + Math.cos(angle) * rx;
        v.smokePositions[i * 3 + 1] = cloudCenter.y + ry;
        v.smokePositions[i * 3 + 2] = cloudCenter.z + Math.sin(angle) * rz;

        const baseShade = 0.16 + s3 * 0.16 + (lightningFlash > 0.38 ? 0.32 * (1 - s1 * 0.5) : 0);
        v.smokeColors[i * 3 + 0] = baseShade * 0.80;
        v.smokeColors[i * 3 + 1] = baseShade * 0.88;
        v.smokeColors[i * 3 + 2] = baseShade * 1.04;

        v.smokeSizes[i] = (1.05 + (1 - s1) * 0.65) * grow;
        v.smokeAngles[i] = s2 * Math.PI * 2 + local * 0.25;
        v.smokeAlphas[i] = 0.58 * grow * fadeOut;
      } else {
        // Zeminde ince yağmur sıçrama buharı
        const splashCycle = (s0 + rainLocal * (1.8 + s1)) % 1;
        const r = Math.sqrt(s2) * 1.25;
        const a = s3 * Math.PI * 2;
        v.smokePositions[i * 3 + 0] = cloudCenter.x + Math.cos(a) * r;
        v.smokePositions[i * 3 + 1] = v.ability.impactPos.y + 0.08 + splashCycle * 0.25;
        v.smokePositions[i * 3 + 2] = cloudCenter.z + Math.sin(a) * r;

        v.smokeColors[i * 3 + 0] = 0.55;
        v.smokeColors[i * 3 + 1] = 0.66;
        v.smokeColors[i * 3 + 2] = 0.76;

        v.smokeSizes[i] = 0.52 + s1 * 0.32;
        v.smokeAngles[i] = s3 * Math.PI * 2 + local * 0.6;
        v.smokeAlphas[i] = Math.sin(splashCycle * Math.PI) * 0.35 * grow * fadeOut;
      }
    }

    // Ok hedefe çarptığı andan itibaren yoğun sağanak yağmur yağışı ve zemin su halkaları
    const rainActive = clamp(rainLocal / 0.16, 0, 1);
    for (let i = 0; i < DETAIL_COUNT; i++) {
      const s0 = v.seeds[i * 4 + 0];
      const s1 = v.seeds[i * 4 + 1];
      const s2 = v.seeds[i * 4 + 2];
      const s3 = v.seeds[i * 4 + 3];

      const isSplash = s1 > 0.78;
      const fallFrac = (s0 + rainLocal * (3.8 + s2 * 1.9)) % 1;
      const radius = Math.sqrt(s2) * 1.32 * grow;
      const angle = s3 * Math.PI * 2;

      const rx = cloudCenter.x + Math.cos(angle) * radius;
      const rz = cloudCenter.z + Math.sin(angle) * radius;
      const ry = isSplash
        ? v.ability.impactPos.y + 0.05 + Math.sin(fallFrac * Math.PI) * 0.14
        : cloudCenter.y - 0.16 - fallFrac * 3.12 * rainActive;

      v.detailPositions[i * 3 + 0] = rx;
      v.detailPositions[i * 3 + 1] = ry;
      v.detailPositions[i * 3 + 2] = rz;

      const b = (0.76 + (1 - fallFrac) * 0.24) * rainActive * fadeOut;
      v.detailColors[i * 3 + 0] = b * 0.72;
      v.detailColors[i * 3 + 1] = b * 0.90;
      v.detailColors[i * 3 + 2] = b;

      v.detailSizes[i] = isSplash ? 0.24 + fallFrac * 0.26 : 0.48 + s0 * 0.20;
      v.detailAngles[i] = -0.06;
      v.detailAlphas[i] = (isSplash ? 1.0 - fallFrac : 0.88) * rainActive * fadeOut;
    }
  }
}
