import * as THREE from 'three';
import type { Character } from './character';
import { clamp } from './math';
import type { ClearanceTree } from './camera-clearance';
import { impactStrengthFor, type ImpactEvent } from './impact';
import { buildVisual, type AbilityVisual } from './ability-fx/visual';
import { updateShadow } from './ability-fx/shadow';
import { updateFireball } from './ability-fx/fire';
import { updateTornado } from './ability-fx/tornado';
import { updateRain } from './ability-fx/rain';
import { updateTreeFall } from './ability-fx/tree-fall';
import { updateEarth, type GroundFn } from './ability-fx/earth';

/** Devrilen ağacın yere çarpışının vuruş gücü. */
const TREE_IMPACT = 0.9;
/**
 * Ağaç devirme efektinin (kılıç kesiği, devrilme, sürüklenme, kamera) zamanları 1.65 sn'lik kesik anına göre
 * yazıldı. Tanımdaki kesik anı (release) farklıysa efekt zamanı o kadar kaydırılır; animasyonla senkron kalır.
 */
export const TREE_REF_RELEASE = 1.65;

/** Yetenek adı veya takma adı; geçerli adlar src/data/abilities.yaml'den gelir. */
export type AbilityName = string;

export type AbilityEffectType = 'fire' | 'tornado' | 'rain' | 'shadow' | 'tree_fall' | 'earth';

/**
 * Bir yetenek kullanımının zaman çizelgesi (yerel saniye). src/data/abilities.yaml'deki tanımdan,
 * kullananın gerçek klip süreleriyle ability-registry.ts:buildRecipe üretir.
 */
export interface AbilityRecipe {
  /** Kanonik yetenek kimliği (takma ad değil) */
  id: string;
  effectType: AbilityEffectType;
  /** Hedef türü: karakter ya da haritadaki ağaç */
  targetKind: 'character' | 'map_tree';
  /** Karakterin sırayla oynatacağı klipler */
  clips: { name: string; duration: number; loop?: boolean; /** Bu klibe geçiş süresi (sn); varsayılan 0.3 */ fade?: number }[];
  /** Güç toplama evresinin bitip efektin hedefe yöneldiği an (fırlatma) */
  chargeEnd: number;
  /** Efektin hedefe ulaştığı an (isabet) */
  impactOffset: number;
  /** Efektin tamamen sönümlendiği an */
  totalDuration: number;
  /** Hedefin savrulurken çizeceği en büyük yay yüksekliği (m) */
  arcHeight: number;
  /** Hedefin savrulma süresi (sn) */
  knockbackDuration: number;
  /** Hedefin varsayılan tepki/düşüş animasyonu */
  defaultImpactClip: string;
}

export interface MapTreeRecord {
  id: string;
  node: THREE.Object3D;
  worldPos: THREE.Vector3;
  origPosition: THREE.Vector3;
  origQuaternion: THREE.Quaternion;
  origScale: THREE.Vector3;
  origWorldQuat: THREE.Quaternion;
  parentWorldQuatInv: THREE.Quaternion;
}

export interface ScheduledAbility {
  who: string;
  target: string;
  name: AbilityName;
  recipe: AbilityRecipe;
  start: number;
  knockback: number;
  /** Vuruş anında hedefin başlangıç konumu (savrulma öncesi zemin konumu veya devrilecek harita ağacının kök konumu). */
  impactPos: THREE.Vector3;
  /** Çoklu hedefli yeteneklerde bu kolun sıra indeksi (0..groupSize-1) */
  groupIndex?: number;
  /** Çoklu hedefli yeteneklerde toplam eş zamanlı hedef sayısı */
  groupSize?: number;
  /** Ağaç devirme / düzeltme yeteneklerinde haritadaki gerçek ağaç düğümünün kimliği (ör. Realistic_Pine_057) */
  mapTreeId?: string;
  /** Harita ağacının devrileceği yatay yön vektörü */
  fallDirXZ?: THREE.Vector3;
  /** Devrilen harita ağacının yerde sürüklenerek Karabey'in yanında duracağı kök hedef konumu */
  slideTargetPos?: THREE.Vector3;
  /** Vuruş hissi gücü (sarsıntı + hit-stop); verilmezse savrulmadan hesaplanır. */
  impact?: number;
}

export interface ActiveAbilityFocus {
  casterId: string;
  targetId: string;
  zoomWeight: number;
  effectCenter: THREE.Vector3;
  suggestedSize: number;
  /** Kuş uçuşu (yukarıdan bakış) kamera açısı ağırlığı (0..1) */
  birdEyeWeight?: number;
  /** Kuş uçuşu kamera eğim açısı (derece) */
  elevationOverride?: number;
  /**
   * Yandan bakış ağırlığı (0..1): yerden ilerleyen efektlerde (yer dikenleri) kamera saldırı çizgisini yandan
   * görecek şekilde döner; arkadan bakınca dalga kullananın arkasında üst üste biniyordu.
   */
  sideWeight?: number;
  /** Saldırı çizgisinin yatay yönü (radyan, kamera açısıyla aynı kural: atan2(dx, dz)) */
  lineAngle?: number;
}

export interface ActiveAbilityHUDInfo {
  who: string;
  target: string;
  name: AbilityName;
  recipe: AbilityRecipe;
  start: number;
  localTime: number;
  progress: number;
  phase: 'charge' | 'flight' | 'impact';
  casterWorldPos: THREE.Vector3;
}

/** Aynı anda sahneyi aydınlatabilecek yetenek ışığı sayısı. */
const LIGHT_POOL_SIZE = 2;

/**
 * Karakter hedefli efektler: her biri ability-fx/ altında kendi dosyasında. Yeni bir efekt için dosyayı ekleyip
 * buraya kaydetmek ve src/data/abilities.yaml'de `effect` olarak kullanmak yeterli.
 */
type EffectUpdate = (
  v: AbilityVisual,
  local: number,
  lt: number,
  caster: Character,
  target: Character,
  chargeEnd: number,
  impactOffset: number,
  totalDuration: number,
  ground?: GroundFn,
) => void;
const CHARACTER_EFFECTS: Record<Exclude<AbilityEffectType, 'tree_fall'>, EffectUpdate> = {
  shadow: updateShadow,
  tornado: updateTornado,
  rain: updateRain,
  fire: updateFireball,
  earth: updateEarth,
};

export class AbilitySystem {
  readonly group = new THREE.Group();
  private readonly visuals: AbilityVisual[] = [];
  private readonly mapTrees = new Map<string, MapTreeRecord>();
  private readonly assignedFallTrees = new Set<string>();
  /**
   * Sahnede her zaman duran sabit ışık havuzu. three.js görünmeyen ışıkları saymaz; ışık sayısı her
   * değiştiğinde sahnedeki tüm aydınlatılan malzemeler yeniden derlenir (yetenek başlarında ~1.5 sn donma).
   * Her yeteneğin kendi ışığı sahneye eklenmez, yalnızca değerleri tutar; en parlak olanlar havuza kopyalanır.
   */
  private readonly lightPool: THREE.PointLight[] = [];
  /** Arazi yüksekliği (yerden çıkan efektler için, ör. yer dikenleri); yoksa kullanan/hedef yüksekliği. */
  private ground?: GroundFn;

  setGround(ground: GroundFn) {
    this.ground = ground;
  }

  constructor() {
    this.group.name = 'ability_effects_group';
    this.group.userData.isAbility = true;
  }

  /**
   * Harita prop'ları sahneye eklendikten sonra haritadaki gerçek çam ağaçlarını (Realistic_Pine_*)
   * bularak başlangıç konum/dönüş/ölçek bilgilerini kaydeder.
   */
  bindSceneTrees(sceneGroup: THREE.Object3D) {
    sceneGroup.updateMatrixWorld(true);
    sceneGroup.traverse((o) => {
      if (/^Realistic_Pine_\d+$/i.test(o.name)) {
        const worldPos = new THREE.Vector3();
        o.getWorldPosition(worldPos);
        const origWorldQuat = new THREE.Quaternion();
        o.getWorldQuaternion(origWorldQuat);
        const parentWorldQuat = new THREE.Quaternion();
        if (o.parent) {
          o.parent.getWorldQuaternion(parentWorldQuat);
        }
        const parentWorldQuatInv = parentWorldQuat.clone().invert();
        this.mapTrees.set(o.name, {
          id: o.name,
          node: o,
          origPosition: o.position.clone(),
          origQuaternion: o.quaternion.clone(),
          origScale: o.scale.clone(),
          worldPos,
          origWorldQuat,
          parentWorldQuatInv,
        });
        // Görüş alanı ayıklaması açık kalır: devrilen ağacın sınır küresi dünya matrisiyle birlikte döner.
        // Ağaçlar aynı geometriyi paylaşır; rüzgar salınımı kenarda kırpılmasın diye küreye bir kez pay eklenir.
        o.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (!mesh.isMesh || mesh.geometry.userData.windMargin) return;
          if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
          mesh.geometry.boundingSphere!.radius *= 1.1;
          mesh.geometry.userData.windMargin = true;
        });
      }
    });
  }

  /** Yetenek isabet anları (çoklu hedefli kollar tek isabet sayılır; devrilen ağaç yere çarptığı an). */
  impactEvents(): ImpactEvent[] {
    const byCast = new Map<string, ImpactEvent>();
    for (const v of this.visuals) {
      const a = v.ability;
      const isTree = a.recipe.effectType === 'tree_fall';
      const strength = a.impact ?? (isTree ? TREE_IMPACT : impactStrengthFor(a.knockback));
      if (strength <= 0) continue;
      const key = `${a.who}@${a.start.toFixed(3)}`;
      const prev = byCast.get(key);
      if (!prev || strength > prev.strength) byCast.set(key, { time: a.start + a.recipe.impactOffset, strength });
    }
    return [...byCast.values()];
  }

  /** Kamera açıklığı için haritadaki ağaçlar; devrilenlerde devrilmenin bittiği sahne zamanı da verilir. */
  clearanceTrees(): ClearanceTree[] {
    const fallEnds = new Map<string, number>();
    for (const v of this.visuals) {
      const id = v.ability.mapTreeId;
      if (!id) continue;
      const end = v.ability.start + v.ability.recipe.totalDuration;
      fallEnds.set(id, Math.max(fallEnds.get(id) ?? -Infinity, end));
    }
    return [...this.mapTrees.values()].map((t) => ({
      id: t.id,
      node: t.node,
      fallEnd: this.assignedFallTrees.has(t.id) ? (fallEnds.get(t.id) ?? Infinity) : undefined,
    }));
  }

  /**
   * Ağaç Devirme yeteneği için haritadaki gerçek ağaçlardan birini seçer;
   * ağacın doğrudan Karabey'e doğru devrilme yönünü ve Karabey'in yanına kadar sürüklenme hedefini hesaplar.
   */
  selectMapTreeForFall(
    casterPos: THREE.Vector3,
    _characters: Map<string, Character>,
    _lt: number,
    preferredId?: string,
  ): { tree: MapTreeRecord; fallDirXZ: THREE.Vector3; slideTargetPos: THREE.Vector3 } | null {
    if (this.mapTrees.size === 0) return null;

    let chosen: MapTreeRecord | undefined;
    if (preferredId && this.mapTrees.has(preferredId)) {
      chosen = this.mapTrees.get(preferredId);
    } else {
      let bestDist = Infinity;
      for (const tree of this.mapTrees.values()) {
        if (this.assignedFallTrees.has(tree.id)) continue;
        const d = Math.hypot(tree.worldPos.x - casterPos.x, tree.worldPos.z - casterPos.z);
        if (d < bestDist) {
          bestDist = d;
          chosen = tree;
        }
      }
      if (!chosen) {
        for (const tree of this.mapTrees.values()) {
          const d = Math.hypot(tree.worldPos.x - casterPos.x, tree.worldPos.z - casterPos.z);
          if (d < bestDist) {
            bestDist = d;
            chosen = tree;
          }
        }
      }
    }

    if (!chosen) return null;
    const fallOrder = this.assignedFallTrees.size;
    this.assignedFallTrees.add(chosen.id);

    // Ağaç doğrudan Karabey'e (hemen yanındaki noktaya) doğru devrilir
    const zSide = chosen.worldPos.z < casterPos.z ? -1 : 1;
    const sideOffset = (1.35 + fallOrder * 1.05) * zSide;
    const besideCaster = new THREE.Vector3(
      casterPos.x,
      casterPos.y,
      casterPos.z + sideOffset,
    );

    const fallDirXZ = new THREE.Vector3(
      besideCaster.x - chosen.worldPos.x,
      0,
      besideCaster.z - chosen.worldPos.z,
    );
    if (fallDirXZ.lengthSq() > 0.001) {
      fallDirXZ.normalize();
    } else {
      fallDirXZ.set(0, 0, 1);
    }

    // Ağaç Karabey'e doğru devrilirken yerde sürüklenir ve gövdesi Karabey'in hemen yanında duracak şekilde kayar
    const slideTargetPos = new THREE.Vector3(
      besideCaster.x - fallDirXZ.x * 4.2,
      chosen.worldPos.y,
      besideCaster.z - fallDirXZ.z * 4.2,
    );

    return { tree: chosen, fallDirXZ, slideTargetPos };
  }

  add(ability: ScheduledAbility) {
    if (this.lightPool.length === 0) {
      for (let i = 0; i < LIGHT_POOL_SIZE; i++) {
        const pooled = new THREE.PointLight(0xffffff, 0, 15, 1.5);
        pooled.name = `ability_light_${i}`;
        this.lightPool.push(pooled);
        this.group.add(pooled);
      }
    }
    const v = buildVisual(ability);
    this.group.add(v.root);
    this.visuals.push(v);
  }

  getActiveCameraFocus(lt: number, characters: Map<string, Character>): ActiveAbilityFocus | null {
    // Aynı yetenek kullanımının çoklu hedefli kollarını tek bir odak kaydında birleştir
    const groupedByCast = new Map<
      string,
      {
        casterId: string;
        targetId: string;
        zoomWeight: number;
        centerSum: THREE.Vector3;
        sizeSum: number;
        count: number;
        birdEyeWeight?: number;
        elevationOverride?: number;
        sideWeight?: number;
        lineAngle?: number;
      }
    >();

    for (const v of this.visuals) {
      const { chargeEnd, impactOffset, totalDuration, effectType } = v.ability.recipe;
      const local = lt - v.ability.start;
      const zoomStart = -0.55;
      const zoomFull = 0.65;
      const zoomHoldEnd =
        effectType === 'shadow'
          ? Math.min(1.45, chargeEnd * 0.68)
          : effectType === 'tree_fall'
            ? impactOffset + 0.85
            : chargeEnd + 0.25;
      const zoomReleaseEnd = Math.min(
        totalDuration,
        effectType === 'shadow'
          ? chargeEnd + 0.85
          : effectType === 'tree_fall'
            ? totalDuration
            : impactOffset + 0.95,
      );
      if (local < zoomStart || local > zoomReleaseEnd) continue;

      const caster = characters.get(v.ability.who);
      const target = characters.get(v.ability.target);
      if (!caster || (!target && effectType !== 'tree_fall')) continue;

      const casterPos = caster.positionAt(lt, new THREE.Vector3());
      const targetPos = target ? target.positionAt(lt, new THREE.Vector3()) : v.ability.impactPos.clone();

      let zoomWeight = 0;
      if (local >= zoomStart && local < zoomFull) {
        const u = clamp((local - zoomStart) / (zoomFull - zoomStart), 0, 1);
        zoomWeight = 0.5 - 0.5 * Math.cos(u * Math.PI);
      } else if (local >= zoomFull && local <= zoomHoldEnd) {
        zoomWeight = 1.0;
      } else if (local > zoomHoldEnd && local < zoomReleaseEnd) {
        const u = clamp((local - zoomHoldEnd) / Math.max(0.01, zoomReleaseEnd - zoomHoldEnd), 0, 1);
        zoomWeight = 0.5 + 0.5 * Math.cos(u * Math.PI);
      }

      if (zoomWeight <= 0.001) continue;

      const dir = new THREE.Vector3().subVectors(targetPos, casterPos);
      const dist = Math.max(0.001, dir.length());
      dir.divideScalar(dist);

      const rawLaunchU = local <= chargeEnd ? 0 : clamp((local - chargeEnd) / Math.max(0.01, impactOffset - chargeEnd), 0, 1);
      const smoothLaunchU = rawLaunchU * rawLaunchU * (3 - 2 * rawLaunchU);

      let birdEyeWeight: number | undefined;
      let elevationOverride: number | undefined;

      const effectCenter = casterPos.clone();
      if (effectType === 'rain') {
        effectCenter.addScaledVector(dir, 0.45);
        effectCenter.lerp(targetPos, smoothLaunchU * 0.52);
        effectCenter.y += caster.rig.height * 0.78;
      } else if (effectType === 'tornado') {
        effectCenter.lerp(targetPos, smoothLaunchU * 0.42);
        effectCenter.y += caster.rig.height * 0.78;
      } else if (effectType === 'shadow') {
        effectCenter.addScaledVector(dir, 0.30);
        effectCenter.lerp(targetPos, smoothLaunchU * 0.35);
        effectCenter.y += caster.rig.height * 0.86;
      } else if (effectType === 'tree_fall') {
        // Efekt zamanları kesik anına (TREE_REF_RELEASE) göre; tl bu zaman çizelgesindeki yerel saniye
        const tl = local - (chargeEnd - TREE_REF_RELEASE);
        const fallDir = v.ability.fallDirXZ ?? dir;
        const slideTarget = v.ability.slideTargetPos ?? targetPos;
        const rawSlide = tl <= 1.75 ? 0 : clamp((tl - 1.75) / (3.20 - 1.75), 0, 1);
        const slideU = 1 - Math.pow(1 - rawSlide, 2.35);

        const curBase = new THREE.Vector3().lerpVectors(targetPos, slideTarget, slideU);
        const curTreeMid = new THREE.Vector3(
          curBase.x + fallDir.x * (3.2 * smoothLaunchU),
          curBase.y,
          curBase.z + fallDir.z * (3.2 * smoothLaunchU),
        );
        // Devrilen ağaç ile sahnedeki tüm karakterlerin ortası: yeteneğin hedef karakteri yok; yalnızca
        // Karabey ile ağaca bakınca kahramanlar yüksek açıda kadrajın alt kenarından taşıyordu
        const fighters = new THREE.Vector3();
        for (const c of characters.values()) fighters.add(c.positionAt(lt, new THREE.Vector3()));
        fighters.divideScalar(Math.max(1, characters.size));
        effectCenter.copy(fighters).lerp(curTreeMid, 0.4);
        effectCenter.y += caster.rig.height * 0.85;

        // Yüksek açıdan bakış: ağaç kesilirken (0.65s .. 1.35s) yükselir, devrilme ve Karabey'in yanına
        // sürüklenme boyunca (1.35s .. 3.20s) 35°'den izletir, ardından yumuşakça iner.
        // (54° ve 7.4'lük kadraj kamerayı 45 m yükseltip kesintisiz savaşın ritmini bölüyordu.)
        if (tl >= 0.65 && tl < 1.35) {
          const u = clamp((tl - 0.65) / 0.70, 0, 1);
          birdEyeWeight = 0.5 - 0.5 * Math.cos(u * Math.PI);
        } else if (tl >= 1.35 && local <= zoomHoldEnd) {
          birdEyeWeight = 1.0;
        } else if (local > zoomHoldEnd && local < zoomReleaseEnd) {
          const u = clamp((local - zoomHoldEnd) / Math.max(0.01, zoomReleaseEnd - zoomHoldEnd), 0, 1);
          birdEyeWeight = 0.5 + 0.5 * Math.cos(u * Math.PI);
        } else {
          birdEyeWeight = 0;
        }
        elevationOverride = 35;
      } else {
        effectCenter.addScaledVector(dir, 0.55);
        effectCenter.lerp(targetPos, smoothLaunchU * 0.38);
        effectCenter.y += caster.rig.height * 0.62;
      }

      // Yer dikenleri: güç toplarken kamera yana döner, isabetten sonra geri gelir
      let sideWeight: number | undefined;
      let lineAngle: number | undefined;
      if (effectType === 'earth') {
        const turnIn = clamp((local - (chargeEnd - 0.9)) / 0.9, 0, 1);
        const turnOut = clamp((local - (impactOffset + 0.5)) / 0.8, 0, 1);
        const k = turnIn * (1 - turnOut);
        sideWeight = k * k * (3 - 2 * k);
        lineAngle = Math.atan2(dir.x, dir.z);
      }

      const groupSize = v.ability.groupSize ?? 1;
      const suggestedSize =
        effectType === 'tree_fall'
          ? 6.2
          : groupSize > 1
            ? 3.45
            : effectType === 'rain'
              ? 3.25
              : effectType === 'tornado'
                ? 3.15
                : effectType === 'shadow'
                  ? 3.25
                  : caster.rig.height > 1.8
                    ? 2.85
                    : 2.65;

      const castKey = `${v.ability.who}@${v.ability.start.toFixed(3)}`;
      const existing = groupedByCast.get(castKey);
      if (existing) {
        existing.centerSum.add(effectCenter);
        existing.sizeSum += suggestedSize;
        existing.count += 1;
      } else {
        groupedByCast.set(castKey, {
          casterId: v.ability.who,
          targetId: v.ability.target,
          zoomWeight,
          centerSum: effectCenter,
          sizeSum: suggestedSize,
          count: 1,
          birdEyeWeight,
          elevationOverride,
          sideWeight,
          lineAngle,
        });
      }
    }

    const activeList: ActiveAbilityFocus[] = [];
    for (const g of groupedByCast.values()) {
      activeList.push({
        casterId: g.casterId,
        targetId: g.targetId,
        zoomWeight: g.zoomWeight,
        effectCenter: g.centerSum.divideScalar(g.count),
        suggestedSize: g.sizeSum / g.count,
        birdEyeWeight: g.birdEyeWeight,
        elevationOverride: g.elevationOverride,
        sideWeight: g.sideWeight,
        lineAngle: g.lineAngle,
      });
    }

    if (activeList.length === 0) return null;
    if (activeList.length === 1) return activeList[0];

    // Ardışık yetenekler arasında kameranın sıçramaması ve geri-ileri savrulmaması için yumuşak ağırlıklı geçiş (crossfade)
    const combinedCenter = new THREE.Vector3();
    let totalW = 0;
    let combinedSize = 0;
    let invProd = 1;
    let maxBirdEye = 0;
    let birdEyeElev: number | undefined;
    let maxSide = 0;
    let sideLine: number | undefined;
    for (const f of activeList) {
      if (f.sideWeight !== undefined && f.sideWeight > maxSide) {
        maxSide = f.sideWeight;
        sideLine = f.lineAngle;
      }
      combinedCenter.addScaledVector(f.effectCenter, f.zoomWeight);
      combinedSize += f.suggestedSize * f.zoomWeight;
      totalW += f.zoomWeight;
      invProd *= 1 - clamp(f.zoomWeight, 0, 1);
      if (f.birdEyeWeight !== undefined && f.birdEyeWeight > maxBirdEye) {
        maxBirdEye = f.birdEyeWeight;
        birdEyeElev = f.elevationOverride;
      }
    }
    if (totalW > 0) {
      combinedCenter.divideScalar(totalW);
      combinedSize /= totalW;
    }

    return {
      casterId: activeList[activeList.length - 1].casterId,
      targetId: activeList[activeList.length - 1].targetId,
      zoomWeight: 1 - invProd,
      effectCenter: combinedCenter,
      suggestedSize: combinedSize,
      birdEyeWeight: maxBirdEye > 0 ? maxBirdEye : undefined,
      sideWeight: maxSide > 0 ? maxSide : undefined,
      lineAngle: sideLine,
      elevationOverride: birdEyeElev,
    };
  }

  /** Tüm yetenek kullanımları, çoklu hedefte her kol ayrı (ses efektleri: isabet her hedefte duyulur). */
  allUses(): ScheduledAbility[] {
    return this.visuals.map((v) => v.ability);
  }

  /** Sahnedeki tüm yetenek kullanımlarını (çoklu hedefli kolları tekilleştirerek) döndürür. */
  getScheduledCasts(): ScheduledAbility[] {
    const seen = new Set<string>();
    const list: ScheduledAbility[] = [];
    for (const v of this.visuals) {
      const key = `${v.ability.who}@${v.ability.start.toFixed(3)}@${v.ability.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push(v.ability);
    }
    return list;
  }

  /** Sahne yerel zamanı lt'de aktif olarak kullanılan yeteneklerin HUD bilgilerini döndürür. */
  getActiveAbilities(lt: number, characters: Map<string, Character>): ActiveAbilityHUDInfo[] {
    const seen = new Set<string>();
    const active: ActiveAbilityHUDInfo[] = [];
    for (const v of this.visuals) {
      const { chargeEnd, impactOffset, totalDuration } = v.ability.recipe;
      const local = lt - v.ability.start;
      if (local < 0 || local > totalDuration) continue;

      const key = `${v.ability.who}@${v.ability.start.toFixed(3)}@${v.ability.name}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const caster = characters.get(v.ability.who);
      const casterPos = caster ? caster.positionAt(lt, new THREE.Vector3()) : new THREE.Vector3();
      const casterHeight = caster ? caster.rig.height : 1.75;
      const casterWorldPos = new THREE.Vector3(casterPos.x, casterPos.y + casterHeight + 0.35, casterPos.z);

      let phase: 'charge' | 'flight' | 'impact' = 'charge';
      if (local >= impactOffset) {
        phase = 'impact';
      } else if (local >= chargeEnd) {
        phase = 'flight';
      }

      active.push({
        who: v.ability.who,
        target: v.ability.target,
        name: v.ability.name,
        recipe: v.ability.recipe,
        start: v.ability.start,
        localTime: local,
        progress: clamp(local / Math.max(0.01, totalDuration), 0, 1),
        phase,
        casterWorldPos,
      });
    }
    return active;
  }

  update(lt: number, characters: Map<string, Character>) {
    // Zaman çizelgesinde ileri-geri sarıldığında deterministik olması için harita ağaçlarını önce dik konuma sıfırla
    for (const tree of this.mapTrees.values()) {
      tree.node.position.copy(tree.origPosition);
      tree.node.quaternion.copy(tree.origQuaternion);
      tree.node.scale.copy(tree.origScale);
    }

    for (const v of this.visuals) {
      const { chargeEnd, impactOffset, totalDuration, effectType } = v.ability.recipe;
      const local = lt - v.ability.start;

      if (effectType === 'tree_fall') {
        if (local < 0) {
          v.root.visible = false;
          continue;
        }
        const caster = characters.get(v.ability.who);
        if (!caster) {
          v.root.visible = false;
          continue;
        }
        v.root.visible = true;
        v.smokeMat.uniforms.uTime.value = local;
        v.detailMat.uniforms.uTime.value = local;
        updateTreeFall(v, local, lt, caster, chargeEnd, impactOffset, totalDuration, v.ability.mapTreeId ? this.mapTrees.get(v.ability.mapTreeId) : undefined);

        if (local <= totalDuration) {
          (v.smokePoints.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
          (v.smokePoints.geometry.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
          (v.smokePoints.geometry.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
          (v.smokePoints.geometry.getAttribute('aAngle') as THREE.BufferAttribute).needsUpdate = true;
          (v.smokePoints.geometry.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;

          (v.detailPoints.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
          (v.detailPoints.geometry.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
          (v.detailPoints.geometry.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
          (v.detailPoints.geometry.getAttribute('aAngle') as THREE.BufferAttribute).needsUpdate = true;
          (v.detailPoints.geometry.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
        }
        continue;
      }

      if (local < 0 || local > totalDuration) {
        v.root.visible = false;
        continue;
      }

      const caster = characters.get(v.ability.who);
      const target = characters.get(v.ability.target);
      if (!caster || !target) {
        v.root.visible = false;
        continue;
      }

      v.root.visible = true;
      v.smokePoints.visible = true;
      v.detailPoints.visible = true;
      v.smokeMat.uniforms.uTime.value = local;
      v.detailMat.uniforms.uTime.value = local;
      v.fireCoreMat.uniforms.uTime.value = local;
      v.fireCoronaMat.uniforms.uTime.value = local;
      v.vortexMat.uniforms.uTime.value = local;
      v.outerVortexMat.uniforms.uTime.value = local;

      CHARACTER_EFFECTS[effectType as keyof typeof CHARACTER_EFFECTS](v, local, lt, caster, target, chargeEnd, impactOffset, totalDuration, this.ground);

      (v.smokePoints.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (v.smokePoints.geometry.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
      (v.smokePoints.geometry.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
      (v.smokePoints.geometry.getAttribute('aAngle') as THREE.BufferAttribute).needsUpdate = true;
      (v.smokePoints.geometry.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;

      (v.detailPoints.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (v.detailPoints.geometry.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
      (v.detailPoints.geometry.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
      (v.detailPoints.geometry.getAttribute('aAngle') as THREE.BufferAttribute).needsUpdate = true;
      (v.detailPoints.geometry.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
    }

    this.assignPooledLights();
  }

  /** O karede en parlak yetenek ışıklarını sabit havuza kopyalar; artanlar sönük kalır. */
  private assignPooledLights() {
    const lit = this.visuals
      .filter((v) => v.root.visible && v.light.intensity > 0.001)
      .sort((a, b) => b.light.intensity - a.light.intensity);
    this.lightPool.forEach((pooled, i) => {
      const src = lit[i]?.light;
      if (!src) {
        pooled.intensity = 0;
        return;
      }
      pooled.position.copy(src.position);
      pooled.color.copy(src.color);
      pooled.intensity = src.intensity;
      pooled.distance = src.distance;
      pooled.decay = src.decay;
    });
  }

  /**
   * Shader ısıtma için tüm yetenek görsellerini geçici olarak görünür yapar; geri alma fonksiyonu döndürür.
   * Böylece ateş, hortum, ok ve duman shader'ları ilk kullanıldıkları karede değil, yüklemede derlenir.
   */
  revealAllForWarmup(): () => void {
    const hidden: THREE.Object3D[] = [];
    this.group.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
    return () => {
      for (const o of hidden) o.visible = false;
    };
  }
}
