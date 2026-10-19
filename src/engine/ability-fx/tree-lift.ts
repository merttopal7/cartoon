import * as THREE from 'three';
import type { Character } from '../character';
import { clamp } from '../math';
import { DETAIL_COUNT, SMOKE_COUNT, type AbilityVisual } from './visual';
import { restingFallPose } from './tree-fall';
import type { MapTreeRecord, ScheduledAbility } from '../abilities';

const smooth = (x: number) => {
  const k = clamp(x, 0, 1);
  return k * k * (3 - 2 * k);
};

/** Ağacın havada süzüldüğü yükseklik (m) ve taşınma sırasındaki ek kavis. */
const HOVER = 1.3;
const HOVER_ARC = 0.6;
/** Kaldırma evreleri (fırlatma → isabet aralığının oranı): yükselme, dikilerek kütüğe süzülme, iniş. */
const RISE_END = 0.22;
const SWING_END = 0.86;

/**
 * DEFNE'NİN RÜZGÂRLA AĞAÇ DİKME YETENEĞİ (Karabey'in devirdiği harita ağacını kütüğüne geri diker)
 * - Evre 1 (0 .. chargeEnd): Defne dönerek (Hurricane Kick) rüzgârı çağırır; devrik gövdenin çevresinde rüzgâr
 *   burgaçları dolanır, yerdeki yapraklar havalanır, ağaç titrer.
 * - Evre 2 (chargeEnd .. impactOffset): kollar havadayken ağacın altında bir rüzgâr sütunu (hortum hunisi)
 *   yükselir; ağaç havalanır, havada dikilerek kütüğünün üstüne süzülür ve yerçekimiyle oturur.
 * - Evre 3 (impactOffset .. totalDuration): oturma anında kütük ve gövde kaynaşır (yeşil ışık, kütük kaybolur),
 *   tepe yaylanarak durulur, taçtan yapraklar süzülür; ağaç kalıcı olarak ilk hâline döner.
 * Ağaç önceden devrilmemişse (dik duruyorsa) yerinde hafifçe havalanıp yeniden oturur.
 */
export function updateTreeLift(
  v: AbilityVisual,
  local: number,
  _lt: number,
  _caster: Character,
  chargeEnd: number,
  impactOffset: number,
  totalDuration: number,
  mapTree: MapTreeRecord | undefined,
  /** Bu ağacı daha önce deviren yetenek ve görseli (kütük onun görselinde) */
  fall: { ability: ScheduledAbility; visual: AbilityVisual } | undefined,
) {
  v.fireCoreMesh.visible = false;
  v.fireCoronaMesh.visible = false;
  v.lightningLine.visible = false;
  v.arrowGroup.visible = false;
  v.treeGroup.visible = false;
  v.treeSlashMesh.visible = false;

  const stump = mapTree ? mapTree.worldPos.clone() : v.ability.impactPos.clone();
  const scale = mapTree ? mapTree.origScale.x : 1;
  const trunkLength = 12.5 * scale;
  const rest = fall && mapTree ? restingFallPose(fall.ability, mapTree, v.ability.start + chargeEnd) : null;
  const startBase = rest ? rest.base : stump.clone();
  const axis = rest ? rest.axis : new THREE.Vector3(1, 0, 0);
  const startAngle = rest ? rest.angle : 0;

  // --- Ağacın pozu (dünya): kök konumu, yatış açısı (devrilme ekseni etrafında) ve hafif dönüş (rüzgâr)
  const base = startBase.clone();
  let angle = startAngle;
  let yaw = 0;
  let wobble = 0;
  const lift = impactOffset - chargeEnd;
  const p = (local - chargeEnd) / Math.max(0.01, lift);
  if (local < chargeEnd) {
    // Rüzgâr toplanırken ağaç yerde titrer, son anda hafifçe kalkar
    const u = clamp(local / Math.max(0.01, chargeEnd), 0, 1);
    wobble = Math.sin(local * 31) * 0.025 * u;
    base.y += smooth((local - (chargeEnd - 0.4)) / 0.4) * 0.12;
  } else if (p < RISE_END) {
    const k = smooth(p / RISE_END);
    base.y += 0.12 + (HOVER - 0.12) * k;
    angle = startAngle - 0.08 * k;
    wobble = Math.sin(local * 19) * 0.02 * (1 - k);
  } else if (p < SWING_END) {
    const q = smooth((p - RISE_END) / (SWING_END - RISE_END));
    base.lerpVectors(startBase, stump, q);
    base.y = THREE.MathUtils.lerp(startBase.y, stump.y, q) + HOVER + HOVER_ARC * Math.sin(Math.PI * q);
    angle = (startAngle - 0.08) * (1 - q);
    yaw = 0.22 * Math.sin(Math.PI * q);
  } else if (local < impactOffset) {
    // Kütüğün üstünden yerçekimiyle iniş (ivmelenerek)
    const d = clamp((p - SWING_END) / (1 - SWING_END), 0, 1);
    base.copy(stump);
    base.y += HOVER * (1 - d * d);
    angle = 0;
  } else {
    base.copy(stump);
    angle = 0;
    const dt = local - impactOffset;
    // Oturma: tepe yaylanır ve durulur
    wobble = dt < 1.6 ? Math.sin(dt * 9.5) * 0.05 * Math.exp(-dt * 3.2) : 0;
  }

  const tiltQuat = new THREE.Quaternion().setFromAxisAngle(axis, angle + wobble);
  if (!rest && wobble) tiltQuat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), wobble);
  const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  if (mapTree) {
    if (local > totalDuration + 1.6) {
      // Yetenek bitti: ağaç kalıcı olarak ilk hâlinde (devrik pozu ezilir)
      mapTree.node.position.copy(mapTree.origPosition);
      mapTree.node.quaternion.copy(mapTree.origQuaternion);
    } else {
      mapTree.node.quaternion.copy(mapTree.parentWorldQuatInv).multiply(tiltQuat).multiply(yawQuat).multiply(mapTree.origWorldQuat);
      const pos = base.clone();
      if (mapTree.node.parent) mapTree.node.parent.worldToLocal(pos);
      mapTree.node.position.copy(pos);
    }
  }
  // Kesik kaynaştı: devirmenin bıraktığı kütük ağaç oturunca kaybolur
  if (fall && local >= impactOffset) fall.visual.treeGroup.visible = false;

  if (local > totalDuration) {
    v.smokePoints.visible = false;
    v.detailPoints.visible = false;
    v.vortexMesh.visible = false;
    v.outerVortexMesh.visible = false;
    v.light.intensity = 0;
    return;
  }
  v.smokePoints.visible = true;
  v.detailPoints.visible = true;

  // Gövde ekseni (kökten tepeye, dünya) ve ona dik iki yön: burgaçlar gövdenin çevresinde döner
  const trunkDir = new THREE.Vector3(0, 1, 0).applyQuaternion(tiltQuat);
  const side1 = new THREE.Vector3().crossVectors(trunkDir, new THREE.Vector3(0, 1, 0));
  if (side1.lengthSq() < 1e-4) side1.set(1, 0, 0);
  side1.normalize();
  const side2 = new THREE.Vector3().crossVectors(trunkDir, side1).normalize();
  const mid = base.clone().addScaledVector(trunkDir, trunkLength * 0.5);

  // --- Rüzgâr sütunu (hortum hunisi): kaldırma boyunca ağacın altında, oturunca söner
  const columnIn = smooth((local - (chargeEnd - 0.5)) / 0.7);
  const columnOut = 1 - smooth((local - impactOffset) / 0.6);
  const column = columnIn * columnOut;
  v.vortexMesh.visible = column > 0.01;
  v.outerVortexMesh.visible = column > 0.01;
  if (column > 0.01) {
    const ground = new THREE.Vector3(base.x, Math.min(base.y, stump.y), base.z);
    // Devrikken gövdenin ortasının altında, dikilirken köke kayar
    const under = new THREE.Vector3().lerpVectors(new THREE.Vector3(mid.x, ground.y, mid.z), ground, smooth(p / SWING_END));
    const sXZ = 1.5 + 0.4 * column;
    const sY = 0.9 + 0.5 * column;
    v.vortexMesh.position.copy(under);
    v.vortexMesh.scale.set(sXZ, sY, sXZ);
    v.vortexMat.uniforms.uOpacity.value = 0.55 * column;
    v.outerVortexMesh.position.copy(under);
    v.outerVortexMesh.scale.set(sXZ * 1.15, sY, sXZ * 1.15);
    v.outerVortexMat.uniforms.uOpacity.value = 0.45 * column;
  }

  // --- Işık: gövde boyunca yumuşak gökyüzü mavisi; oturma anında kütükte yeşil şifa parlaması
  const heal = local >= impactOffset ? Math.exp(-(local - impactOffset) * 2.4) : 0;
  v.light.color.setRGB(THREE.MathUtils.lerp(0.75, 0.55, heal), THREE.MathUtils.lerp(0.9, 1.0, heal), THREE.MathUtils.lerp(1.0, 0.55, heal));
  if (heal > 0.01) {
    v.light.position.set(stump.x, stump.y + 1.0, stump.z);
    v.light.intensity = 1.5 + 6 * heal;
  } else {
    v.light.position.copy(mid);
    v.light.intensity = 2.6 * smooth(local / 0.8) * (local < impactOffset ? 1 : 0);
  }

  const fade = local > totalDuration - 0.5 ? clamp((totalDuration - local) / 0.5, 0, 1) : 1;

  // --- KATMAN A: rüzgâr burgaçları (açık mavi-beyaz), oturmada kökte toz halkası
  for (let i = 0; i < SMOKE_COUNT; i++) {
    const s0 = v.seeds[i * 4 + 0];
    const s1 = v.seeds[i * 4 + 1];
    const s2 = v.seeds[i * 4 + 2];
    const s3 = v.seeds[i * 4 + 3];
    let x: number, y: number, z: number;
    if (local < impactOffset) {
      // Gövde boyunca dolanan sarmal: kalkışta hızlanır
      const along = s0 * trunkLength;
      const speed = 2.2 + s1 * 2.4 + (local > chargeEnd ? 2.5 : 0);
      const a = s2 * Math.PI * 2 + local * speed;
      const r = (0.9 + s3 * 1.1) * scale * (0.6 + 0.4 * smooth(local / 0.9));
      const c = base.clone().addScaledVector(trunkDir, along);
      x = c.x + (side1.x * Math.cos(a) + side2.x * Math.sin(a)) * r;
      y = c.y + (side1.y * Math.cos(a) + side2.y * Math.sin(a)) * r + 0.3;
      z = c.z + (side1.z * Math.cos(a) + side2.z * Math.sin(a)) * r;
      v.smokeColors[i * 3 + 0] = 0.86;
      v.smokeColors[i * 3 + 1] = 0.93;
      v.smokeColors[i * 3 + 2] = 1.0;
      v.smokeSizes[i] = 0.55 + s1 * 0.5;
      v.smokeAlphas[i] = (0.1 + 0.16 * Math.sin(((local * speed) / 6 + s0) * Math.PI) ** 2) * smooth(local / 0.6);
    } else {
      const dt = local - impactOffset;
      const a = s2 * Math.PI * 2;
      const r = (0.4 + s1 * 1.6) * (1 - Math.exp(-dt * 3.5));
      x = stump.x + Math.cos(a) * r * 1.6;
      y = stump.y + 0.15 + s3 * 0.5 + dt * 0.35;
      z = stump.z + Math.sin(a) * r * 1.6;
      v.smokeColors[i * 3 + 0] = 0.55;
      v.smokeColors[i * 3 + 1] = 0.47;
      v.smokeColors[i * 3 + 2] = 0.36;
      v.smokeSizes[i] = 0.7 + s0 * 0.8 + dt * 0.5;
      v.smokeAlphas[i] = 0.45 * Math.exp(-dt * 1.6) * fade;
    }
    v.smokePositions[i * 3 + 0] = x;
    v.smokePositions[i * 3 + 1] = y;
    v.smokePositions[i * 3 + 2] = z;
    v.smokeAngles[i] = s3 * Math.PI * 2 + local * 1.8;
  }

  // --- KATMAN B: yapraklar — yerden havalanıp gövdenin çevresinde döner; oturmada taçtan süzülür.
  // Bir kısmı kökte yeşil şifa kıvılcımı.
  for (let i = 0; i < DETAIL_COUNT; i++) {
    const s0 = v.seeds[i * 4 + 0];
    const s1 = v.seeds[i * 4 + 1];
    const s2 = v.seeds[i * 4 + 2];
    const s3 = v.seeds[i * 4 + 3];
    const spark = i % 6 === 0;
    let x: number, y: number, z: number;
    let alpha: number;
    if (local < impactOffset) {
      const along = (0.15 + s0 * 0.85) * trunkLength;
      const a = s1 * Math.PI * 2 + local * (3 + s2 * 3);
      const rise = smooth((local - s3 * 0.6) / 1.2);
      const r = (1.2 + s2 * 1.6) * scale;
      const c = base.clone().addScaledVector(trunkDir, along * rise + 0.2);
      x = c.x + (side1.x * Math.cos(a) + side2.x * Math.sin(a)) * r;
      y = c.y + (side1.y * Math.cos(a) + side2.y * Math.sin(a)) * r * 0.6 + 0.1;
      z = c.z + (side1.z * Math.cos(a) + side2.z * Math.sin(a)) * r;
      alpha = spark ? 0 : 0.9 * rise;
    } else {
      const dt = local - impactOffset;
      if (spark) {
        // Şifa kıvılcımları: kesik hizasından yükselen yeşil-altın noktalar
        const a = s1 * Math.PI * 2 + dt * 2;
        x = stump.x + Math.cos(a) * (0.35 + s2 * 0.3);
        y = stump.y + 0.5 + dt * (0.8 + s3 * 0.8);
        z = stump.z + Math.sin(a) * (0.35 + s2 * 0.3);
        alpha = Math.exp(-dt * 1.4) * fade;
      } else {
        // Taçtan süzülen yapraklar
        const h = (5 + s0 * 8) * scale;
        const a = s1 * Math.PI * 2;
        const drift = dt * (0.6 + s2 * 0.6);
        x = stump.x + Math.cos(a) * (1.5 + s3 * 1.5) + Math.sin(dt * 2.4 + s0 * 6) * 0.4 + drift * 0.7;
        y = Math.max(stump.y + 0.05, stump.y + h - dt * (1.6 + s3 * 1.2));
        z = stump.z + Math.sin(a) * (1.5 + s3 * 1.5) + Math.cos(dt * 2.1 + s1 * 6) * 0.4;
        alpha = 0.9 * fade;
      }
    }
    v.detailPositions[i * 3 + 0] = x;
    v.detailPositions[i * 3 + 1] = y;
    v.detailPositions[i * 3 + 2] = z;
    if (spark) {
      v.detailColors[i * 3 + 0] = 0.75;
      v.detailColors[i * 3 + 1] = 1.0;
      v.detailColors[i * 3 + 2] = 0.45;
    } else if (s3 < 0.5) {
      v.detailColors[i * 3 + 0] = 0.2;
      v.detailColors[i * 3 + 1] = 0.5;
      v.detailColors[i * 3 + 2] = 0.18;
    } else {
      v.detailColors[i * 3 + 0] = 0.55;
      v.detailColors[i * 3 + 1] = 0.62;
      v.detailColors[i * 3 + 2] = 0.22;
    }
    v.detailSizes[i] = spark ? 0.08 : 0.1 + s0 * 0.08;
    v.detailAngles[i] = s2 * Math.PI * 2 + local * 5;
    v.detailAlphas[i] = alpha;
  }
}
