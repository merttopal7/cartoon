import * as THREE from 'three';
import type { Character } from '../character';
import { clamp } from '../math';
import { DETAIL_COUNT, SMOKE_COUNT, type AbilityVisual } from './visual';

const handBones = new WeakMap<THREE.Object3D, { hand?: THREE.Object3D; fore?: THREE.Object3D }>();

/**
 * Kullananın sağ avucunun dünya konumu (bilekten avuca 8 cm ileri): alev bu noktada büyür ve buradan fırlar.
 * Sağ el kemiği yoksa null.
 */
export function handPoint(caster: Character, out: THREE.Vector3): THREE.Vector3 | null {
  const root = caster.rig.root;
  let b = handBones.get(root);
  if (!b) {
    b = {};
    root.traverse((o) => {
      if (!b!.hand && /righthand$/i.test(o.name)) b!.hand = o;
      else if (!b!.fore && /rightforearm$/i.test(o.name)) b!.fore = o;
    });
    handBones.set(root, b);
  }
  if (!b.hand) return null;
  b.hand.updateWorldMatrix(true, false);
  b.hand.getWorldPosition(out);
  if (b.fore) {
    const fore = b.fore.getWorldPosition(new THREE.Vector3());
    const dir = out.clone().sub(fore);
    if (dir.lengthSq() > 1e-6) out.addScaledVector(dir.normalize(), 0.08);
  }
  return out;
}

const smooth = (x: number) => {
  const k = clamp(x, 0, 1);
  return k * k * (3 - 2 * k);
};

/**
 * KARABEY'İN ALEV BÜYÜSÜ / ATEŞ TOPU (3B magma çekirdeği + alev koronası/kuyruğu + kıvılcım ve duman)
 * - Güç toplama: alev, kullananın sağ avucunda (büyüde havaya kaldırdığı elde) küçük bir korla başlar, büyür ve
 *   savuruş boyunca eli izler. Çoklu hedefte tek top toplanır (yalnız ilk kol çizer; üç top üst üste parlamasın).
 * - Fırlatma: el en öne uzandığı an (launchPos: fırlatma anındaki avuç) kısa bir alev patlaması; her hedefe bir
 *   alev dağılır. Alevler küçük çıkıp ilk 0.15 sn'de büyür, uzun ve titreyen bir alev kuyruğuyla uçar.
 * - İsabet: patlama, yayılan duman ve sıçrayan kıvılcımlar.
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

  // El kemiği yoksa eski tahmini nokta (göğüs önü, sağ)
  const fallbackHand = startPoint.clone().addScaledVector(tmpDir, 0.58).addScaledVector(tmpRight, 0.26);
  const ballPos = new THREE.Vector3();
  const firstArm = (v.ability.groupIndex ?? 0) === 0;

  if (local < chargeEnd) {
    // Çoklu hedefte yalnız ilk kol toplar
    if (!firstArm) {
      v.fireCoreMesh.visible = false;
      v.fireCoronaMesh.visible = false;
      v.light.intensity = 0;
      for (let i = 0; i < SMOKE_COUNT; i++) v.smokeAlphas[i] = 0;
      for (let i = 0; i < DETAIL_COUNT; i++) v.detailAlphas[i] = 0;
      return;
    }
    const u = clamp(local / chargeEnd, 0, 1);
    // Avucun hemen üstünde (havaya kaldırılmış elde alev yukarı tüter)
    if (!handPoint(caster, ballPos)) ballPos.copy(fallbackHand);
    ballPos.y += 0.06 + 0.08 * u;

    const coreScale = 0.12 + Math.pow(u, 1.2) * 0.7;
    const flicker = 1 + Math.sin(local * 41) * 0.05 + Math.sin(local * 67) * 0.03;
    v.fireCoreMesh.visible = true;
    v.fireCoreMesh.position.copy(ballPos);
    v.fireCoreMesh.scale.setScalar(coreScale * flicker);
    v.fireCoreMat.uniforms.uOpacity.value = clamp(u * 1.6, 0, 1);

    // Korona yukarı doğru uzun bir alev dili (kor elde yanıyor)
    v.fireCoronaMesh.visible = true;
    v.fireCoronaMesh.position.copy(ballPos).add(new THREE.Vector3(0, coreScale * 0.25, 0));
    v.fireCoronaMesh.quaternion.identity();
    v.fireCoronaMesh.scale.set(coreScale * 1.1, coreScale * (1.5 + 0.2 * Math.sin(local * 23)), coreScale * 1.1);
    v.fireCoronaMat.uniforms.uOpacity.value = clamp(u * 1.3, 0, 1);

    v.light.position.copy(ballPos);
    v.light.intensity = 2.0 + u * 6.5;

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
    // Alev fırlatma anındaki avuçtan çıkar (yükleme sırasında hesaplandı; kare atlansa da yol aynı)
    const launch = v.ability.launchPos ?? fallbackHand;
    ballPos.lerpVectors(launch, endPoint, eased);
    ballPos.y += Math.sin(u * Math.PI) * 0.22;
    tmpDir.subVectors(endPoint, launch).normalize();
    tmpRight.crossVectors(tmpDir, new THREE.Vector3(0, 1, 0)).normalize();

    // Küçük çıkıp ilk 0.15 sn'de büyür: üç alev elden dağılırken üst üste binip patlama gibi görünmesin
    const grow = 0.45 + 0.55 * smooth((local - chargeEnd) / 0.15);
    const flicker = 1 + Math.sin(local * 38) * 0.05 + Math.sin(local * 71) * 0.03;
    v.fireCoreMesh.visible = true;
    v.fireCoreMesh.position.copy(ballPos);
    v.fireCoreMesh.scale.setScalar(0.9 * grow * flicker);
    v.fireCoreMat.uniforms.uOpacity.value = 1.0;

    // Alev koronası uçuş yönünün tersine uzun, titreyen bir alev kuyruğu
    v.fireCoronaMesh.visible = true;
    v.fireCoronaMesh.position.copy(ballPos).addScaledVector(tmpDir, -0.42 * grow);
    v.fireCoronaMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), tmpDir);
    v.fireCoronaMesh.scale.set(0.95 * grow, (2.7 + 0.35 * Math.sin(local * 29)) * grow, 0.95 * grow);
    v.fireCoronaMat.uniforms.uOpacity.value = 0.95;

    // Fırlatma anında elde kısa bir alev parlaması (ışık), sonra uçan alevle gider
    const flash = firstArm ? Math.max(0, 1 - (local - chargeEnd) / 0.18) : 0;
    v.light.position.copy(ballPos);
    v.light.intensity = 8.5 + Math.sin(local * 45) * 1.5 + flash * 9;

    const trailMaxLen = Math.min(3.6, totalDist * eased + 0.3);

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
