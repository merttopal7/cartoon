import * as THREE from 'three';
import type { Heightfield } from './terrain';

/**
 * Çamın yerel boyutları (ağacın kendi uzayında, ölçeksiz). Blender'da "Pine 2" mesh'inden ölçüldü:
 * gövde 1.5 m'ye kadar çıplak, taç 1.5 m'den tepeye (15 m) uzanır; %90'lık yarıçap 9 m'ye kadar ~3 m,
 * tepede ~2 m.
 */
const TREE = { height: 15, trunkRadius: 0.3, canopyBase: 1.5, canopyRadius: 3.0, canopyTopRadius: 2.0, taperFrom: 9 };
/** Gizlenen ağaçların taşındığı katman: ana kamera görmez, güneşin gölge kamerası görür (gölgesi kalır). */
const HIDDEN_LAYER = 1;
/** Kameranın taçtan ve gövdeden uzak kalması gereken pay (m); yakın planda dal ekrana dayanmasın. */
const CAMERA_MARGIN = 1.0;
/** Görüş hattında tacın yalnızca yoğun çekirdeği engel sayılır; seyrek dış dallar arasından bakılabilir. */
const SIGHT_CORE = 0.7;
const SIGHT_STEP = 0.4;
/**
 * Kameranın önündeki ilk metrelerde görüş hattının etrafı da taranır (uzaklıkla genişleyen koni):
 * kameraya çok yakın bir taç, hedefi örtmese bile kadrajın büyük kısmını kaplar.
 */
const NEAR_DEPTH = 8;
const NEAR_CONE = 0.3;
/** Kameranın arazinin üstünde kalacağı en az yükseklik (m). */
const GROUND_CLEARANCE = 0.6;
/** Çekim boyunca kamera yolunun örneklenme aralığı (sn). */
export const CLEARANCE_SAMPLE_STEP = 0.1;

export interface ClearanceTree {
  id: string;
  node: THREE.Object3D;
  /** Hiç gizlenmez (yeteneklerin devirdiği/diktiği ağaçlar: hikâyenin parçası, kesmede kaybolmamalı). */
  keep?: boolean;
}

export interface CameraSample {
  camera: THREE.Vector3;
  aim: THREE.Vector3;
}

interface TreeState {
  tree: ClearanceTree;
  /** Dünya → ağacın yerel uzayı. */
  inverse: THREE.Matrix4;
  /** Gövdenin dünyadaki kökü ve ölçeği (ön eleme için). */
  base: THREE.Vector3;
  scale: number;
}

/**
 * Kameranın ağaçların içine girmesini ve hedefi ağaçların arkasında bırakmasını önler.
 * Kadrajı değiştirmek yerine, set ekibinin yaptığı gibi o çekimde kameraya engel olan ağaçları kaldırır:
 * her çekimin (ve formatın) kamera yolu bir kez örneklenir, engel olan ağaçlar çekimin tamamında gizlenir.
 * Ağaç ancak kesmede kaybolup geri geldiği için izleyici fark etmez; sonuç yalnızca çekime ve formata
 * bağlıdır, kareler deterministik kalır.
 */
export class CameraClearance {
  private readonly cache = new Map<string, Set<ClearanceTree>>();
  private hidden = new Set<ClearanceTree>();

  constructor(
    private readonly trees: ClearanceTree[],
    private readonly terrain: Heightfield | null,
    shadowCamera: THREE.Camera,
  ) {
    shadowCamera.layers.enable(HIDDEN_LAYER);
  }

  /** Kamerayı arazinin üstünde tutar; yükseltildiyse true döner (kamera yeniden hedefe çevrilmeli). */
  liftAboveGround(pos: THREE.Vector3): boolean {
    const ground = this.terrain?.heightAt(pos.x, pos.z);
    if (ground == null || pos.y >= ground + GROUND_CLEARANCE) return false;
    pos.y = ground + GROUND_CLEARANCE;
    return true;
  }

  /** `key` (çekim + format) için engel ağaçları bir kez hesaplar ve gizler; öncekileri geri getirir. */
  apply(key: string, sample: () => CameraSample[]): number {
    let next = this.cache.get(key);
    if (!next) {
      next = this.blockers(sample(), this.trees.filter((t) => !t.keep).map(state));
      this.cache.set(key, next);
    }
    if (next !== this.hidden) {
      for (const t of this.hidden) if (!next.has(t)) setLayer(t.node, 0);
      for (const t of next) if (!this.hidden.has(t)) setLayer(t.node, HIDDEN_LAYER);
      this.hidden = next;
    }
    return next.size;
  }

  private blockers(samples: CameraSample[], trees: TreeState[]): Set<ClearanceTree> {
    const out = new Set<ClearanceTree>();
    const p = new THREE.Vector3();
    for (const { camera, aim } of samples) {
      const len = camera.distanceTo(aim);
      const steps = Math.max(1, Math.ceil(len / SIGHT_STEP));
      for (const st of trees) {
        if (out.has(st.tree)) continue;
        const reach = TREE.canopyRadius * st.scale + 2 * CAMERA_MARGIN;
        if (distanceToSegmentXZ(st.base, camera, aim) > reach) continue;
        if (inside(st, camera, CAMERA_MARGIN, 1)) {
          out.add(st.tree);
          continue;
        }
        // Hedefe varmadan biraz önce durulur: hedefin hemen arkasındaki ağaç engel değildir
        for (let i = 1; i < steps * 0.95; i++) {
          const depth = (i / steps) * len;
          const blocked =
            inside(st, p.lerpVectors(camera, aim, i / steps), 0.1, SIGHT_CORE) ||
            (depth < NEAR_DEPTH && inside(st, p, depth * NEAR_CONE, 1));
          if (blocked) {
            out.add(st.tree);
            break;
          }
        }
      }
    }
    return out;
  }
}

function state(tree: ClearanceTree): TreeState {
  tree.node.updateWorldMatrix(true, false);
  const m = tree.node.matrixWorld;
  return {
    tree,
    inverse: m.clone().invert(),
    base: new THREE.Vector3().setFromMatrixPosition(m),
    scale: new THREE.Vector3().setFromMatrixScale(m).x,
  };
}

const local = new THREE.Vector3();

/** Dünya noktası p ağacın (gövde + taç) içinde mi? `margin` dünya biriminde dışa pay, `core` taç yarıçapı çarpanı. */
function inside(st: TreeState, p: THREE.Vector3, margin: number, core: number): boolean {
  local.copy(p).applyMatrix4(st.inverse);
  const m = margin / st.scale;
  const y = local.y;
  if (y < -m || y > TREE.height + m) return false;
  const d = Math.hypot(local.x, local.z);
  if (d < TREE.trunkRadius + m) return true;
  if (y < TREE.canopyBase - m) return false;
  const r =
    y <= TREE.taperFrom
      ? TREE.canopyRadius
      : THREE.MathUtils.lerp(TREE.canopyRadius, TREE.canopyTopRadius, (y - TREE.taperFrom) / (TREE.height - TREE.taperFrom));
  return d < r * core + m;
}

function distanceToSegmentXZ(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const l2 = abx * abx + abz * abz;
  const k = l2 > 0 ? THREE.MathUtils.clamp(((p.x - a.x) * abx + (p.z - a.z) * abz) / l2, 0, 1) : 0;
  return Math.hypot(p.x - (a.x + abx * k), p.z - (a.z + abz * k));
}

/** Ağacın tüm mesh'lerini (bütün LOD seviyeleri dahil) katmana taşır; LOD düğümü katman 0'da kalır ki seviye seçimi sürsün. */
function setLayer(node: THREE.Object3D, layer: number) {
  node.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.layers.set(layer);
  });
}
