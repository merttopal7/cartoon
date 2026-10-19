import * as THREE from 'three';
import type { Character, SceneContext } from './character';
import { clamp } from './math';
import type { ClearanceTree } from './camera-clearance';
import { impactStrengthFor, type ImpactEvent } from './impact';
import { buildVisual, type AbilityVisual } from './ability-fx/visual';
import { updateShadow } from './ability-fx/shadow';
import { handPoint, updateFireball } from './ability-fx/fire';
import { updateTornado } from './ability-fx/tornado';
import { updateRain } from './ability-fx/rain';
import { updateTreeFall } from './ability-fx/tree-fall';
import { updateTreeLift } from './ability-fx/tree-lift';
import { updateEarth, type GroundFn } from './ability-fx/earth';
import { updateRockRise, updateWave, updateWhirl } from './ability-fx/showcase';

/** Devrilen ağacın yere çarpışının vuruş gücü. */
const TREE_IMPACT = 0.9;
/** Dikilen ağacın kütüğüne oturuşunun vuruş gücü (hafif). */
const TREE_LIFT_IMPACT = 0.3;
/**
 * Ağaç devirme efektinin (kılıç kesiği, devrilme, sürüklenme, kamera) zamanları 1.65 sn'lik kesik anına göre
 * yazıldı. Tanımdaki kesik anı (release) farklıysa efekt zamanı o kadar kaydırılır; animasyonla senkron kalır.
 */
export const TREE_REF_RELEASE = 1.65;

/** Yetenek adı veya takma adı; geçerli adlar src/data/abilities.yaml'den gelir. */
export type AbilityName = string;

export type AbilityEffectType =
  | 'fire'
  | 'tornado'
  | 'rain'
  | 'shadow'
  | 'tree_fall'
  | 'tree_lift'
  | 'earth'
  /** Hedefsiz element gösterileri (açılış klibi): Defne'nin yanında dönen hortum, Toprak'ı kaldıran kaya, Meşe'nin dalgası */
  | 'whirl'
  | 'rock_rise'
  | 'wave';

/** Haritadaki ağaca yönelik efektler (hedef karakter yok; ağacın pozu yetenek bittikten sonra da sürer). */
const isTreeEffect = (e: AbilityEffectType) => e === 'tree_fall' || e === 'tree_lift';

/**
 * Bir yetenek kullanımının zaman çizelgesi (yerel saniye). src/data/abilities.yaml'deki tanımdan,
 * kullananın gerçek klip süreleriyle ability-registry.ts:buildRecipe üretir.
 */
export interface AbilityRecipe {
  /** Kanonik yetenek kimliği (takma ad değil) */
  id: string;
  effectType: AbilityEffectType;
  /** Hedef türü: karakter, haritadaki ağaç ya da kullananın kendisi (hasar vermeyen element gösterisi) */
  targetKind: 'character' | 'map_tree' | 'self';
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
  /** Ağaç dikmede: ağacı daha önce deviren yetenek (devrik pozu ve kütüğü ondan) */
  liftFrom?: ScheduledAbility;
  /**
   * Ağaç devirmede: devrik ağacın sonradan itilip sürüklenmesi (sahne zamanı, dünya ötelemesi). Karabey'e isabet
   * eden her yetenekte gövde ondan uzağa kayar; Karabey açıkta kalır. planTreePushes doldurur.
   */
  treePushes?: TreePush[];
  /** Ateş büyüsünde alevin elden çıktığı dünya noktası (fırlatma anındaki el konumu; planLaunchPoints doldurur) */
  launchPos?: THREE.Vector3;
  /** Sahne başından beri devrik duran ağaç (fallen_trees): devirmesi görünmez, sesi ve vuruş hissi yoktur */
  prefallen?: boolean;
  /** Vuruş hissi gücü (sarsıntı + hit-stop); verilmezse savrulmadan hesaplanır. */
  impact?: number;
  /** Element gösterilerinde kullananın fırlatma anındaki yönü (radyan; dalga arkasına, hortum yanına kurulur) */
  facing?: number;
}

export interface TreePush {
  /** İtmenin başladığı sahne zamanı (isabet anı) */
  time: number;
  /** Bu itmenin ağaca eklediği öteleme (dünya, m; arazi yüksekliği farkı dahil) */
  offset: THREE.Vector3;
}

/** Karabey gövde ekseninin bu kadar yakınındaysa (m, ağaç ölçeğiyle) devrik ağacın "içinde" sayılır (taç yarıçapı). */
const TREE_INSIDE = 2.6;
/** İtilen gövdenin Karabey'den açılacağı en az mesafe (m). */
const TREE_PUSH_CLEAR = 3.5;

/** Devrik ağacın bir itmede sürüklenme süresi (sn). */
export const TREE_PUSH_TIME = 0.7;

/** Devrik ağacın t anındaki toplam itme ötelemesi (her itme TREE_PUSH_TIME içinde yavaşlayarak tamamlanır). */
export function treePushOffset(pushes: TreePush[] | undefined, t: number, out = new THREE.Vector3()): THREE.Vector3 {
  out.set(0, 0, 0);
  for (const p of pushes ?? []) {
    const u = clamp((t - p.time) / TREE_PUSH_TIME, 0, 1);
    if (u <= 0) continue;
    out.addScaledVector(p.offset, 1 - Math.pow(1 - u, 2.4));
  }
  return out;
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
  /**
   * Belirli bir bakış yönü ağırlığı (0..1) ve yönü (radyan; konudan kameraya, atan2(dx, dz)): ağaç dikmede kamera
   * kullananın arkasına geçer, ağaç hiçbir zaman kamerayla kullananın arasına girmez.
   */
  viewWeight?: number;
  viewAngle?: number;
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

/** Önceden devrik ağaç için kullanan yerine geçen yer tutucu: konumu kütük (devrik pozda yalnızca konum okunur). */
function stumpCaster(a: ScheduledAbility): Character {
  return { positionAt: (_t: number, out: THREE.Vector3) => out.copy(a.impactPos) } as unknown as Character;
}

/** İki yatay doğru parçası arasındaki en kısa mesafe (XZ düzleminde, örnekleyerek). */
function segmentGap(a0: THREE.Vector3, a1: THREE.Vector3, b0: THREE.Vector3, b1: THREE.Vector3): number {
  let best = Infinity;
  for (let i = 0; i <= 16; i++) {
    const ax = a0.x + (a1.x - a0.x) * (i / 16);
    const az = a0.z + (a1.z - a0.z) * (i / 16);
    for (let j = 0; j <= 16; j++) {
      const bx = b0.x + (b1.x - b0.x) * (j / 16);
      const bz = b0.z + (b1.z - b0.z) * (j / 16);
      best = Math.min(best, Math.hypot(ax - bx, az - bz));
    }
  }
  return best;
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
const CHARACTER_EFFECTS: Record<Exclude<AbilityEffectType, 'tree_fall' | 'tree_lift'>, EffectUpdate> = {
  shadow: updateShadow,
  tornado: updateTornado,
  rain: updateRain,
  fire: updateFireball,
  earth: updateEarth,
  // Gösteriler: hedef kullananın kendisi (target = who)
  whirl: updateWhirl,
  rock_rise: updateRockRise,
  wave: updateWave,
};

export class AbilitySystem {
  readonly group = new THREE.Group();
  private readonly visuals: AbilityVisual[] = [];
  private readonly mapTrees = new Map<string, MapTreeRecord>();
  private readonly assignedFallTrees = new Set<string>();
  /** Şu anda devrik duran ağaçlar → onları deviren yetenek (dikilince silinir) */
  private readonly fallenBy = new Map<string, ScheduledAbility>();
  /** Bir yeteneğin devirdiği ya da diktiği ağaçlar: kamera açıklığı bunları hiç gizlemez */
  private readonly touchedTrees = new Set<string>();
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
      if (a.prefallen || a.recipe.targetKind === 'self') continue;
      const isTree = a.recipe.effectType === 'tree_fall';
      const strength =
        a.impact ?? (isTree ? TREE_IMPACT : a.recipe.effectType === 'tree_lift' ? TREE_LIFT_IMPACT : impactStrengthFor(a.knockback));
      if (strength <= 0) continue;
      const key = `${a.who}@${a.start.toFixed(3)}`;
      const prev = byCast.get(key);
      if (!prev || strength > prev.strength) byCast.set(key, { time: a.start + a.recipe.impactOffset, strength });
    }
    return [...byCast.values()];
  }

  /**
   * Kamera açıklığı için haritadaki ağaçlar. Yeteneklerin devirdiği/diktiği ağaçlar hikâyenin parçasıdır:
   * kameraya engel olsalar da gizlenmezler (keep).
   */
  /**
   * Kameranın giremeyeceği engeller (kurgu kapsaması için): t anında devrik yatan ağaçların tacı, yerde yatan bir
   * kapsül (gövde ekseni boyunca, tacın yarıçapıyla). Bu ağaçlar hikâyenin parçası olduğundan kamera açıklığı onları
   * gizlemez; kapsama çekimi kamerayı içlerine koymamalı. (x, z) bu engellerden birinin içindeyse true.
   */
  insideFallenCrown(x: number, z: number, t: number): boolean {
    for (const v of this.visuals) {
      const a = v.ability;
      if (a.recipe.effectType !== 'tree_fall' || !a.fallDirXZ || !a.mapTreeId) continue;
      const tree = this.mapTrees.get(a.mapTreeId);
      if (!tree) continue;
      // Yatış: isabetten (yere çarpma) dikilene kadar
      if (t < a.start + a.recipe.impactOffset) continue;
      const lift = this.visuals.find((o) => o.ability.liftFrom === a);
      if (lift && t > lift.ability.start + lift.ability.recipe.chargeEnd) continue;
      const s = tree.origScale.x;
      const base = a.slideTargetPos ?? tree.worldPos;
      const len = 15 * s;
      const r = 3.0 * s + 0.6;
      const dx = x - base.x;
      const dz = z - base.z;
      const along = clamp(dx * a.fallDirXZ.x + dz * a.fallDirXZ.z, 1.5 * s, len);
      const px = base.x + a.fallDirXZ.x * along;
      const pz = base.z + a.fallDirXZ.z * along;
      if (Math.hypot(x - px, z - pz) < r) return true;
    }
    return false;
  }

  clearanceTrees(): ClearanceTree[] {
    return [...this.mapTrees.values()].map((t) => ({ id: t.id, node: t.node, keep: this.touchedTrees.has(t.id) }));
  }

  /**
   * Devrik ağaçların itilmesini planlar (tüm yetenekler zamanlandıktan sonra bir kez). Karabey ağacı devirip içine
   * siper alır; ağaç devrik dururken ona isabet eden bir yetenek anında Karabey ağacın içindeyse (tacın hacminde)
   * gövde dövüş hattının (Karabey → rakiplerin ortası) dışına, bulunduğu taraftan itilir ve Karabey'in savrulup
   * durduğu yerden en az TREE_PUSH_CLEAR açılır; Karabey açığa çıkar. İçinde değilse ağaç itilmez.
   */
  planTreePushes(characters: Map<string, Character>) {
    const falls = this.visuals.map((v) => v.ability).filter((a) => a.recipe.effectType === 'tree_fall' && a.mapTreeId && a.fallDirXZ);
    const p = new THREE.Vector3();
    for (const fall of falls) {
      const tree = this.mapTrees.get(fall.mapTreeId!)!;
      const fallen = fall.start + fall.recipe.totalDuration;
      const lift = this.visuals.find((v) => v.ability.liftFrom === fall)?.ability;
      const liftAt = lift ? lift.start + lift.recipe.chargeEnd : Infinity;
      const victim = characters.get(fall.who);
      if (!victim) continue;
      const seen = new Set<string>();
      const hits = this.visuals
        .map((v) => v.ability)
        .filter((a) => a.recipe.targetKind === 'character' && a.target === fall.who)
        .map((a) => ({ a, time: a.start + a.recipe.impactOffset }))
        .filter(({ a, time }) => {
          const key = `${a.who}@${a.start.toFixed(3)}`;
          if (seen.has(key) || time <= fallen || time >= liftAt) return false;
          seen.add(key);
          return true;
        })
        .sort((x, y) => x.time - y.time);
      const dir = fall.fallDirXZ!.clone().setY(0).normalize();
      const length = 12.5 * tree.origScale.x;
      const base = (fall.slideTargetPos ?? tree.worldPos).clone();
      fall.treePushes = [];
      for (const { a, time } of hits) {
        // İsabet anında Karabey tacın içinde mi (gövde ekseninde tacın başladığı yerden tepeye)
        const hitPos = victim.positionAt(time, new THREE.Vector3());
        const crown0 = base.clone().addScaledVector(dir, 1.5 * tree.origScale.x);
        const crown1 = base.clone().addScaledVector(dir, length);
        if (segmentGap(crown0, crown1, hitPos, hitPos) > TREE_INSIDE * tree.origScale.x) continue;
        // Savrulup durduğu yer ve rakiplerinin ortası: aradaki doğru parçası dövüş hattı
        const settle = time + a.recipe.knockbackDuration;
        const at = victim.positionAt(settle, new THREE.Vector3());
        const foes = new THREE.Vector3();
        let n = 0;
        for (const [id, c] of characters) {
          if (id === fall.who) continue;
          foes.add(c.positionAt(settle, new THREE.Vector3()));
          n++;
        }
        if (n) foes.divideScalar(n);
        else foes.copy(at).add(new THREE.Vector3(1, 0, 0));
        const line = new THREE.Vector3(foes.x - at.x, 0, foes.z - at.z).normalize();
        const perp = new THREE.Vector3(-line.z, 0, line.x);
        // Gövdenin Karabey'e en yakın noktası; ağaç hattın hangi tarafındaysa o yöne itilir
        const k = clamp(p.subVectors(at, base).dot(dir), 0, length);
        const nearest = base.clone().addScaledVector(dir, k);
        const mid = base.clone().addScaledVector(dir, length / 2);
        const side = Math.sign(perp.dot(p.subVectors(nearest, at)) || perp.dot(p.subVectors(mid, at)) || 1);
        const away = perp.clone().multiplyScalar(side);
        const d = segmentGap(base, crown1, at, at);
        const dist = clamp(TREE_PUSH_CLEAR - d, 0.8, TREE_PUSH_CLEAR);
        const next = base.clone().addScaledVector(away, dist);
        const g = this.ground?.(next.x, next.z);
        if (g != null) next.y = g;
        fall.treePushes.push({ time, offset: next.clone().sub(base) });
        base.copy(next);
      }
    }
  }

  /**
   * Sahne başında devrik duran bir harita ağacı ekler (fallen_trees): ağaç kütüğünün yanında `toward` [x, z]
   * noktasına doğru yatar, kütük görünür. Devirme, sahneden çok önce bitmiş bir Ağaç Devirme olarak kaydedilir; böylece
   * aynı poz, kütük ve Ağaç Dikme ile kaldırılma yolu kullanılır. Ağaç bulunamazsa false.
   */
  addFallenTree(id: string, toward: [number, number], recipe: AbilityRecipe): boolean {
    const tree = this.mapTrees.get(id);
    if (!tree) return false;
    const fallDirXZ = new THREE.Vector3(toward[0] - tree.worldPos.x, 0, toward[1] - tree.worldPos.z);
    if (fallDirXZ.lengthSq() < 1e-4) fallDirXZ.set(1, 0, 0);
    fallDirXZ.normalize();
    // Gövde kütüğün hemen yanından başlar (kütüğün içinden geçmesin)
    const slideTargetPos = tree.worldPos.clone().addScaledVector(fallDirXZ, 0.8);
    this.assignedFallTrees.add(id);
    this.touchedTrees.add(id);
    this.add({
      who: '',
      target: id,
      name: recipe.id,
      recipe,
      start: -1000,
      knockback: 0,
      impactPos: tree.worldPos.clone(),
      groupIndex: 0,
      groupSize: 1,
      mapTreeId: id,
      fallDirXZ,
      slideTargetPos,
      prefallen: true,
    });
    return true;
  }

  /**
   * Ateş büyülerinde alevin elden çıkacağı noktayı bir kez hesaplar: kullanan fırlatma anına pozlanır ve sağ elinin
   * dünya konumu kaydedilir. Uçuş yolu bu noktadan başlar; hangi kare çizilirse çizilsin aynıdır.
   */
  planLaunchPoints(characters: Map<string, Character>, ctx: SceneContext) {
    const byCast = new Map<string, THREE.Vector3>();
    for (const v of this.visuals) {
      const a = v.ability;
      if (a.recipe.effectType !== 'fire') continue;
      const key = `${a.who}@${a.start.toFixed(3)}`;
      let p = byCast.get(key);
      if (!p) {
        const caster = characters.get(a.who);
        if (!caster) continue;
        caster.computeBody(a.start + a.recipe.chargeEnd, ctx);
        caster.rig.apply(caster.pose);
        p = handPoint(caster, new THREE.Vector3()) ?? undefined;
        if (!p) continue;
        byCast.set(key, p);
      }
      a.launchPos = p.clone();
    }
  }

  /**
   * Ağaç Dikme için ağacı seçer: verilen kimlik (yoksa kullanana en yakın devrik ağaç) ve onu deviren yetenek.
   * Ağaç devrik değilse `fall` boştur (yerinde havalanıp yeniden oturur).
   */
  selectMapTreeForLift(casterPos: THREE.Vector3, preferredId?: string): { tree: MapTreeRecord; fall?: ScheduledAbility } | null {
    let chosen = preferredId ? this.mapTrees.get(preferredId) : undefined;
    if (!chosen) {
      let best = Infinity;
      for (const id of this.fallenBy.keys()) {
        const tree = this.mapTrees.get(id)!;
        const d = Math.hypot(tree.worldPos.x - casterPos.x, tree.worldPos.z - casterPos.z);
        if (d < best) {
          best = d;
          chosen = tree;
        }
      }
    }
    if (!chosen) return null;
    const fall = this.fallenBy.get(chosen.id);
    this.fallenBy.delete(chosen.id);
    this.touchedTrees.add(chosen.id);
    return { tree: chosen, fall };
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
    this.touchedTrees.add(chosen.id);

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
    // Gövde Karabey'in içinden geçmesin: en az 2 m açıklık (yetmiyorsa gövdeye dik yönde kaydırılır)
    const length = 12.5 * chosen.origScale.x;
    const along = clamp(new THREE.Vector3().subVectors(casterPos, slideTargetPos).dot(fallDirXZ), 0, length);
    const nearest = slideTargetPos.clone().addScaledVector(fallDirXZ, along);
    const gap = new THREE.Vector3(nearest.x - casterPos.x, 0, nearest.z - casterPos.z);
    const CLEAR = 2.0;
    if (gap.length() < CLEAR) {
      const out = gap.lengthSq() > 1e-4 ? gap.normalize() : new THREE.Vector3(-fallDirXZ.z, 0, fallDirXZ.x).multiplyScalar(zSide);
      slideTargetPos.addScaledVector(out, CLEAR - Math.hypot(nearest.x - casterPos.x, nearest.z - casterPos.z));
    }

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
    if (ability.recipe.effectType === 'tree_fall' && ability.mapTreeId) this.fallenBy.set(ability.mapTreeId, ability);
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
        viewWeight?: number;
        viewAngle?: number;
      }
    >();

    for (const v of this.visuals) {
      const { chargeEnd, impactOffset, totalDuration, effectType } = v.ability.recipe;
      // Gösterilerde kamera senaryonun çekimindedir (konuşan karakterin orta planı)
      if (v.ability.recipe.targetKind === 'self') continue;
      const local = lt - v.ability.start;
      const zoomStart = -0.55;
      const zoomFull = 0.65;
      const zoomHoldEnd =
        effectType === 'shadow'
          ? Math.min(1.45, chargeEnd * 0.68)
          : isTreeEffect(effectType)
            ? impactOffset + 0.85
            : chargeEnd + 0.25;
      const zoomReleaseEnd = Math.min(
        totalDuration,
        effectType === 'shadow'
          ? chargeEnd + 0.85
          : isTreeEffect(effectType)
            ? totalDuration
            : impactOffset + 0.95,
      );
      if (local < zoomStart || local > zoomReleaseEnd) continue;

      const caster = characters.get(v.ability.who);
      const target = characters.get(v.ability.target);
      if (!caster || (!target && !isTreeEffect(effectType))) continue;

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
      let viewWeight: number | undefined;
      let viewAngle: number | undefined;

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
      } else if (effectType === 'tree_lift') {
        // Kamera Defne'nin arkasında (hafif omuz üstü), ağaca bakar: Defne ön planda, ağaç karşıda dikilir ve
        // kamerayla Defne'nin arasına hiç girmez (devrik/dikilen ağaç gizlenmez). Ağaç dikildikçe kadraj yükselir
        // ve genişler; açı yüksekten (devrik gövde okunsun) göz hizasına iner.
        const stump = v.ability.impactPos;
        const standing = clamp((local - chargeEnd) / Math.max(0.01, impactOffset - chargeEnd), 0, 1);
        const s = standing * standing * (3 - 2 * standing);
        effectCenter.lerpVectors(casterPos, stump, 0.55);
        effectCenter.y = casterPos.y + caster.rig.height * 0.8 + 4.2 * s;
        birdEyeWeight = zoomWeight;
        elevationOverride = 24 - 12 * s;
        viewWeight = zoomWeight;
        viewAngle = Math.atan2(casterPos.x - stump.x, casterPos.z - stump.z) + (25 * Math.PI) / 180;
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
          : effectType === 'tree_lift'
            ? 6.5 + 3.5 * clamp((local - chargeEnd) / Math.max(0.01, impactOffset - chargeEnd), 0, 1)
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
          viewWeight,
          viewAngle,
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
        viewWeight: g.viewWeight,
        viewAngle: g.viewAngle,
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
    let maxView = 0;
    let viewDir: number | undefined;
    for (const f of activeList) {
      if (f.viewWeight !== undefined && f.viewWeight > maxView) {
        maxView = f.viewWeight;
        viewDir = f.viewAngle;
      }
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
      viewWeight: maxView > 0 ? maxView : undefined,
      viewAngle: viewDir,
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

      if (isTreeEffect(effectType)) {
        if (local < 0) {
          v.root.visible = false;
          continue;
        }
        // Önceden devrik ağacın kullananı yok: konumu kütükte duran bir yer tutucu (yalnızca devrik poz çizilir)
        const caster = characters.get(v.ability.who) ?? (v.ability.prefallen ? stumpCaster(v.ability) : undefined);
        if (!caster) {
          v.root.visible = false;
          continue;
        }
        v.root.visible = true;
        v.smokeMat.uniforms.uTime.value = local;
        v.detailMat.uniforms.uTime.value = local;
        const mapTree = v.ability.mapTreeId ? this.mapTrees.get(v.ability.mapTreeId) : undefined;
        if (effectType === 'tree_fall') {
          updateTreeFall(v, local, lt, caster, chargeEnd, impactOffset, totalDuration, mapTree);
        } else {
          // Devirme görseli dizide daha önce: dikme onun pozunu ve kütüğünü (aynı karede) ezer
          v.vortexMat.uniforms.uTime.value = local;
          v.outerVortexMat.uniforms.uTime.value = local;
          const fallVisual = v.ability.liftFrom ? this.visuals.find((o) => o.ability === v.ability.liftFrom) : undefined;
          updateTreeLift(v, local, lt, caster, chargeEnd, impactOffset, totalDuration, mapTree, fallVisual && { ability: fallVisual.ability, visual: fallVisual });
        }

        if (local <= totalDuration || v.smokePoints.visible) {
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
