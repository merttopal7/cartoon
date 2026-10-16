import * as THREE from 'three';
import type { Character } from '../character';
import { clamp } from '../math';
import { DETAIL_COUNT, SMOKE_COUNT, type AbilityVisual } from './visual';

/**
 * 3. DEFNE'NİN GERÇEKÇİ 3B HACİMSEL RÜZGAR HORTUMU YETENEĞİ
 * - Partikül kalabalığı yerine çift katmanlı 3B trompet huni (İç Yoğuşma Çekirdeği + Dış Helisel Rüzgar Kılıfı)
 * - Yalnızca çok az sayıda ince uçuşan yaprak/dal ve taban toz sisi içerir.
 */
export function updateTornado(
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

  const casterPos = caster.positionAt(lt, new THREE.Vector3());
  const endGround = v.ability.impactPos.clone();
  const tornadoPos = new THREE.Vector3();

  let scaleXZ = 1.0;
  let scaleY = 1.0;
  let alpha = 1.0;

  let outerAlpha = 1.0;

  if (local < chargeEnd) {
    // Tornado oluşma evresi (2.25 sn): Hurricane Kick.fbx dönerken tornado doğrudan Defne'nin içinde (casterPos) oluşur
    const u = clamp(local / chargeEnd, 0, 1);
    const easedGrow = u * u * (3 - 2 * u);
    tornadoPos.copy(casterPos);
    scaleXZ = 0.22 + Math.pow(u, 1.10) * 0.82;
    scaleY = 0.14 + Math.pow(u, 1.02) * 0.94;
    alpha = clamp(local / 0.95, 0, 1) * (0.45 + 0.55 * easedGrow);
    outerAlpha = clamp((local - 0.18) / 1.20, 0, 1) * easedGrow;
  } else if (local < impactOffset) {
    // Sonraki tekme animasyonu (flying_kick / kick) başladığında tornado Defne'nin içinden hedefe doğru fırlatılır
    const u = clamp((local - chargeEnd) / (impactOffset - chargeEnd), 0, 1);
    const eased = 1 - Math.pow(1 - u, 1.45);
    tornadoPos.lerpVectors(casterPos, endGround, eased);
    scaleXZ = 1.04 + u * 0.24;
    scaleY = 1.08 + u * 0.18;
    alpha = 1.0;
    outerAlpha = 1.0;
  } else {
    const u = clamp((local - impactOffset) / (totalDuration - impactOffset), 0, 1);
    const targetNow = target.positionAt(lt, new THREE.Vector3());
    tornadoPos.lerpVectors(endGround, targetNow, Math.min(1, u * 1.35));
    tornadoPos.y = endGround.y;
    scaleXZ = 1.28 + u * 0.72;
    scaleY = 1.26 + u * 0.28;
    alpha = Math.max(0, 1 - Math.pow(u, 1.35));
    outerAlpha = alpha;
  }

  // 1. İç Yoğuşma Hunisi (3B Trompet Gövde)
  v.vortexMesh.position.copy(tornadoPos);
  v.vortexMesh.scale.set(scaleXZ, scaleY, scaleXZ);
  v.vortexMat.uniforms.uOpacity.value = 0.95 * alpha;

  // 2. Dış Helisel Rüzgar Kılıfı ve Taban Toz Etekliği
  v.outerVortexMesh.position.copy(tornadoPos);
  v.outerVortexMesh.scale.set(scaleXZ, scaleY, scaleXZ);
  v.outerVortexMat.uniforms.uOpacity.value = 0.82 * outerAlpha;

  v.light.position.set(tornadoPos.x, tornadoPos.y + 1.6, tornadoPos.z);
  v.light.intensity = 2.4 * alpha;

  // Minimal taban toz sisi ve tepe mezosiklon bulut yumuşatması (sadece 36 yumuşak FBM bulutçuk)
  for (let i = 0; i < SMOKE_COUNT; i++) {
    const s0 = v.seeds[i * 4 + 0];
    const s1 = v.seeds[i * 4 + 1];
    const s2 = v.seeds[i * 4 + 2];
    const s3 = v.seeds[i * 4 + 3];

    const isBaseFoot = i < 20;
    const h = isBaseFoot ? s0 * 0.12 : 0.82 + s0 * 0.16;
    const swayAmp = 0.10 + 0.28 * Math.pow(h, 1.35);
    const swayX = Math.sin(h * 4.2 - local * 5.8) * swayAmp * scaleXZ;
    const swayZ = Math.cos(h * 3.6 - local * 5.1) * swayAmp * scaleXZ;

    const r = isBaseFoot ? (0.45 + s2 * 0.75) * scaleXZ : (0.75 + s2 * 0.85) * scaleXZ;
    const angle = local * (isBaseFoot ? 9.5 : 5.5) + s3 * Math.PI * 2;

    v.smokePositions[i * 3 + 0] = tornadoPos.x + swayX + Math.cos(angle) * r;
    v.smokePositions[i * 3 + 1] = tornadoPos.y + h * 3.25 * scaleY;
    v.smokePositions[i * 3 + 2] = tornadoPos.z + swayZ + Math.sin(angle) * r;

    if (isBaseFoot) {
      v.smokeColors[i * 3 + 0] = 0.42;
      v.smokeColors[i * 3 + 1] = 0.35;
      v.smokeColors[i * 3 + 2] = 0.27;
      v.smokeSizes[i] = (0.55 + s1 * 0.38) * scaleXZ;
      v.smokeAlphas[i] = 0.42 * alpha;
    } else {
      v.smokeColors[i * 3 + 0] = 0.24;
      v.smokeColors[i * 3 + 1] = 0.28;
      v.smokeColors[i * 3 + 2] = 0.34;
      v.smokeSizes[i] = (0.78 + s1 * 0.55) * scaleXZ;
      v.smokeAlphas[i] = 0.46 * alpha;
    }
    v.smokeAngles[i] = s3 * Math.PI * 2 + local * 2.2;
  }

  // Minimal fiziksel detaylar (sadece 48 ince rüzgar akım çizgisi ve küçük yaprak/dal)
  for (let i = 0; i < DETAIL_COUNT; i++) {
    const s0 = v.seeds[i * 4 + 0];
    const s1 = v.seeds[i * 4 + 1];
    const s2 = v.seeds[i * 4 + 2];
    const s3 = v.seeds[i * 4 + 3];

    const h = (s0 + local * (1.25 + s2 * 0.85)) % 1;
    const baseFoot = Math.exp(-h * 10.5) * 0.45;
    const midColumn = 0.15 + 0.36 * Math.pow(h, 1.28);
    const topTrumpet = 0.96 * Math.pow(Math.max(0, (h - 0.40) / 0.60), 2.35);
    const funnelR = (midColumn + topTrumpet + baseFoot) * (1.05 + s2 * 0.38) * scaleXZ;

    const swayAmp = 0.10 + 0.28 * Math.pow(h, 1.35);
    const swayX = Math.sin(h * 4.2 - local * 5.8) * swayAmp * scaleXZ;
    const swayZ = Math.cos(h * 3.6 - local * 5.1) * swayAmp * scaleXZ;
    const angle = local * (12.5 + s3 * 4.0) + h * 14.0 + s1 * Math.PI * 2;

    v.detailPositions[i * 3 + 0] = tornadoPos.x + swayX + Math.cos(angle) * funnelR;
    v.detailPositions[i * 3 + 1] = tornadoPos.y + 0.08 + h * 3.20 * scaleY;
    v.detailPositions[i * 3 + 2] = tornadoPos.z + swayZ + Math.sin(angle) * funnelR;

    if (s1 < 0.15) {
      // Küçük koyu orman yaprağı
      v.detailColors[i * 3 + 0] = 0.20 + s2 * 0.18;
      v.detailColors[i * 3 + 1] = 0.38 + s3 * 0.22;
      v.detailColors[i * 3 + 2] = 0.14;
      v.detailSizes[i] = 0.11 + s0 * 0.07;
      v.detailAngles[i] = s3 * Math.PI * 2 + local * 9.0;
      v.detailAlphas[i] = Math.sin(h * Math.PI) * 0.72 * alpha;
    } else if (s1 < 0.36) {
      // İnce dal kıymığı / toprak zerresi
      v.detailColors[i * 3 + 0] = 0.30;
      v.detailColors[i * 3 + 1] = 0.23;
      v.detailColors[i * 3 + 2] = 0.16;
      v.detailSizes[i] = 0.09 + s0 * 0.06;
      v.detailAngles[i] = s2 * Math.PI * 2 + local * 7.0;
      v.detailAlphas[i] = Math.sin(h * Math.PI) * 0.65 * alpha;
    } else {
      // Huninin etrafını yatay/helisel saran ince rüzgar filamenti
      v.detailColors[i * 3 + 0] = 0.62;
      v.detailColors[i * 3 + 1] = 0.70;
      v.detailColors[i * 3 + 2] = 0.78;
      v.detailSizes[i] = (0.28 + h * 0.26) * scaleXZ;
      v.detailAngles[i] = 0.22 * Math.cos(angle) + (s2 - 0.5) * 0.18;
      v.detailAlphas[i] = Math.sin(h * Math.PI) * 0.42 * alpha;
    }
  }
}
