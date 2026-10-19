import * as THREE from 'three';

/** LOD1, LOD2… seviyelerinin başladığı kamera uzaklıkları (m). */
const LOD_DISTANCES = [35, 80];
const LOD_SUFFIX = /_LOD(\d+)$/;

/**
 * Modelde "<ad>_LOD1", "<ad>_LOD2" adlı alt nesneleri olan düğümleri THREE.LOD'a çevirir
 * (tools/blender/pine_lods.py üretir). Düğümün kendi mesh'leri LOD0 olur; düğümün adı ve dönüşümü
 * korunur, böylece ağaç devirme gibi düğümü hareket ettiren kodlar aynen çalışır.
 * Seviye yalnızca o karedeki kamera uzaklığına bağlıdır (histerezis yok), kareler deterministik kalır.
 */
export function setupLods(root: THREE.Object3D): number {
  const owners = new Map<THREE.Object3D, THREE.Object3D[]>();
  root.traverse((o) => {
    const m = LOD_SUFFIX.exec(o.name);
    if (m && o.parent && o.name === `${o.parent.name}${m[0]}`) {
      const list = owners.get(o.parent) ?? [];
      list[Number(m[1])] = o;
      owners.set(o.parent, list);
    }
  });

  for (const [owner, levels] of owners) {
    const lod = new THREE.LOD();
    lod.name = `${owner.name}_lod`;
    const base = new THREE.Group();
    base.name = `${owner.name}_LOD0`;
    for (const child of [...owner.children]) if (!levels.includes(child)) base.add(child);
    lod.addLevel(base, 0);
    levels.forEach((level, i) => {
      if (i > 0 && level) lod.addLevel(level, LOD_DISTANCES[i - 1] ?? LOD_DISTANCES[LOD_DISTANCES.length - 1] * i);
    });
    owner.add(lod);
  }
  return owners.size;
}

/**
 * Ağaç ayrıntı seviyelerini çekim boyunca sabitler. THREE.LOD seviyeyi her karede kamera uzaklığına göre seçer;
 * kamera hareket ederken (kuş uçuşu, takip) ağaçların modeli çekimin ortasında değişiyor, ağaçlar kaybolup geri
 * geliyormuş gibi görünüyordu (açılışın kuş uçuşunda 4 sn'de ~100 değişim). Her çekimde ağacın seviyesi, o çekimin
 * kamera yolunun ağaca en yakın noktasına göre bir kez seçilir (çekim boyunca hiç kaba görünmez); değişim yalnızca
 * kesmelerde olur. Sonuç yalnızca çekime ve formata bağlıdır, kareler deterministik kalır.
 */
export class LodLock {
  private readonly lods: THREE.LOD[] = [];
  private readonly cache = new Map<string, Uint8Array>();
  private readonly pos: THREE.Vector3[] = [];

  constructor(root: THREE.Object3D) {
    root.traverse((o) => {
      if ((o as THREE.LOD).isLOD) {
        const lod = o as THREE.LOD;
        lod.autoUpdate = false;
        this.lods.push(lod);
      }
    });
  }

  get count() {
    return this.lods.length;
  }

  /** key: çekim + format; cameras: çekim boyunca kamera konumları (yalnızca ilk kez istenir). */
  apply(key: string, cameras: () => THREE.Vector3[]) {
    if (!this.lods.length) return;
    let levels = this.cache.get(key);
    if (!levels) {
      const cams = cameras();
      levels = new Uint8Array(this.lods.length);
      this.lods.forEach((lod, i) => {
        const p = (this.pos[i] ??= new THREE.Vector3());
        lod.getWorldPosition(p);
        let d = Infinity;
        for (const c of cams) d = Math.min(d, c.distanceTo(p));
        let level = 0;
        for (let k = 1; k < lod.levels.length; k++) if (d >= lod.levels[k].distance) level = k;
        levels![i] = level;
      });
      this.cache.set(key, levels);
    }
    this.lods.forEach((lod, i) => {
      const level = levels![i];
      lod.levels.forEach((l, k) => (l.object.visible = k === level));
      (lod as unknown as { _currentLevel: number })._currentLevel = level;
    });
  }
}
