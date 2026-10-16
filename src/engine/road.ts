import * as THREE from 'three';

/** Yolun orta çizgisindeki bir nokta (dünya x, z) ve o noktadaki yol genişliği (m). */
interface RoadPoint {
  x: number;
  z: number;
  width: number;
}

/** Şeridin yol kenarından en az uzaklığı (m): karakter çalılığa girmesin. */
const EDGE_MARGIN = 0.5;
/** Birbirine bundan yakın rota noktaları birleştirilir (m). */
const MIN_STEP = 0.3;

/**
 * Haritanın yol orta çizgisi. `walk_to: { road: true }` karakteri bulunduğu yerden yola sokar, orta çizgiyi
 * (istenirse bir şeritte) izletir ve hedefte yoldan çıkarır; koordinatları elle yazmaya gerek kalmaz.
 * Dosya biçimi: { points: [[x, z, genişlik, yükseklik], …] } (tools/blender/road_centerline.py üretir).
 */
export class RoadPath {
  private readonly cum: number[] = [0];
  readonly length: number;

  constructor(private readonly points: RoadPoint[]) {
    for (let i = 1; i < points.length; i++) {
      this.cum.push(this.cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
    }
    this.length = this.cum[this.cum.length - 1];
  }

  /** Yol dosyasını yükler ve haritanın sahnedeki yerleşimine (konum, y dönüşü, ölçek) göre dönüştürür. */
  static async load(url: string, at: [number, number, number], rotationDeg = 0, scale = 1): Promise<RoadPath> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Yol dosyası yüklenemedi: ${url} (${res.status})`);
    const data = (await res.json()) as { points?: number[][] };
    if (!Array.isArray(data.points) || data.points.length < 2) throw new Error(`Yol dosyası geçersiz: ${url} (points en az 2 nokta olmalı)`);
    const r = THREE.MathUtils.degToRad(rotationDeg);
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    return new RoadPath(
      data.points.map(([x, z, width = 4]) => ({
        // three.js y ekseni dönüşü: x' = x cos + z sin, z' = −x sin + z cos
        x: at[0] + (x * cos + z * sin) * scale,
        z: at[2] + (-x * sin + z * cos) * scale,
        width: width * scale,
      })),
    );
  }

  /** (x, z)'nin yola en yakın izdüşümünün yol başından mesafesi. */
  project(x: number, z: number): number {
    let best = 0;
    let bestD = Infinity;
    for (let i = 1; i < this.points.length; i++) {
      const a = this.points[i - 1];
      const b = this.points[i];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const l2 = abx * abx + abz * abz;
      const k = l2 > 0 ? THREE.MathUtils.clamp(((x - a.x) * abx + (z - a.z) * abz) / l2, 0, 1) : 0;
      const d = Math.hypot(x - (a.x + abx * k), z - (a.z + abz * k));
      if (d < bestD) {
        bestD = d;
        best = this.cum[i - 1] + k * (this.cum[i] - this.cum[i - 1]);
      }
    }
    return best;
  }

  /** Yol başından s mesafedeki nokta, genişlik ve (artan s yönünde) birim teğet. */
  sample(s: number): { x: number; z: number; width: number; tx: number; tz: number } {
    const n = this.points.length;
    s = THREE.MathUtils.clamp(s, 0, this.length);
    let i = 1;
    while (i < n - 1 && this.cum[i] < s) i++;
    const a = this.points[i - 1];
    const b = this.points[i];
    const seg = this.cum[i] - this.cum[i - 1];
    const k = seg > 0 ? (s - this.cum[i - 1]) / seg : 0;
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return {
      x: a.x + (b.x - a.x) * k,
      z: a.z + (b.z - a.z) * k,
      width: a.width + (b.width - a.width) * k,
      tx: (b.x - a.x) / len,
      tz: (b.z - a.z) / len,
    };
  }

  /**
   * `from`'dan `to`'ya yol üzerinden rota: girişte yola izdüşüm, aradaki orta çizgi noktaları, çıkışta `to`.
   * `lane`: yürüme yönüne göre sağa (+) / sola (−) metre; yol genişliğinin içinde tutulur.
   * Dönen noktalar walk_to'nun `to` listesidir ([x, z]); başlangıç noktası (from) dahil değildir.
   */
  route(from: THREE.Vector3, to: THREE.Vector3, lane = 0): [number, number][] {
    const s0 = this.project(from.x, from.z);
    const s1 = this.project(to.x, to.z);
    const dir = Math.sign(s1 - s0);
    if (Math.abs(s1 - s0) < 0.5) return [[to.x, to.z]];

    // İzdüşümler ve aradaki köşe noktaları, yürüme sırasıyla
    const along = [s0];
    for (const c of dir > 0 ? this.cum : [...this.cum].reverse()) {
      if ((c - s0) * dir > MIN_STEP && (s1 - c) * dir > MIN_STEP) along.push(c);
    }
    along.push(s1);

    const out: [number, number][] = [];
    for (const s of along) {
      const p = this.sample(s);
      // Yürüme yönünün sağı: (−tz, tx)·yön (y yukarı, sağ el kuralı)
      const half = Math.max(0, p.width / 2 - EDGE_MARGIN);
      const off = THREE.MathUtils.clamp(lane, -half, half);
      const pt: [number, number] = [p.x - p.tz * dir * off, p.z + p.tx * dir * off];
      const last = out[out.length - 1];
      if (!last || Math.hypot(pt[0] - last[0], pt[1] - last[1]) > MIN_STEP) out.push(pt);
    }
    out.push([to.x, to.z]);
    return out;
  }
}
