import * as THREE from 'three';

/**
 * Arazi yükseklik haritası. Arazi mesh'inin üçgenleri yukarıdan bir ızgaraya rasterize
 * edilir (her hücrede en üstteki yüzey); çalışma anında yükseklik çift doğrusal
 * ara değerle okunur. Kare başına ışın atmaz, sonuç deterministiktir.
 */
export class Heightfield {
  private readonly heights: Float32Array;
  private readonly cols: number;
  private readonly rows: number;
  private readonly minX: number;
  private readonly minZ: number;

  private constructor(
    box: THREE.Box3,
    private readonly cell: number,
    triangles: Float32Array,
  ) {
    this.minX = box.min.x;
    this.minZ = box.min.z;
    this.cols = Math.max(2, Math.ceil((box.max.x - box.min.x) / cell) + 1);
    this.rows = Math.max(2, Math.ceil((box.max.z - box.min.z) / cell) + 1);
    this.heights = new Float32Array(this.cols * this.rows).fill(NaN);
    this.rasterize(triangles);
    this.fillHoles();
  }

  /**
   * Bir modelden arazi çıkarır. Arazi = düz (yukarı bakan) üçgenlerinin yatay alanı en büyük,
   * saydam olmayan mesh. Saydam/kesik dokulu malzemeler (ağaç, çalı, çimen kartları) elenir;
   * yoksa karakter çalıların tepesine basar.
   */
  static fromObject(root: THREE.Object3D, cell = 0.25, names?: string[], skip?: (mesh: THREE.Mesh) => boolean): Heightfield | null {
    root.updateMatrixWorld(true);
    if (names) return Heightfield.fromNamed(root, cell, names);
    const parts: Float32Array[] = [];
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh || skip?.(mesh)) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (mats.some((m) => m && (m.alphaTest > 0 || m.transparent))) return;
      const isProp = /fence|wood_log|barrier/i.test(mesh.name) || mats.some((m) => m && /fence|wood_log|barrier/i.test(m.name));
      if (isProp) return;
      const tris = worldTriangles(mesh);
      const area = flatArea(tris);
      if (area > 0.5) parts.push(tris);
    });
    if (!parts.length) return null;
    const tris = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let off = 0;
    for (const p of parts) {
      tris.set(p, off);
      off += p.length;
    }
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (let i = 0; i < tris.length; i += 3) box.expandByPoint(v.set(tris[i], tris[i + 1], tris[i + 2]));
    return new Heightfield(box, cell, tris);
  }

  /** Adı (malzeme ya da mesh) listede olan tüm parçalardan, en üstteki yüzeyle arazi kurar. */
  private static fromNamed(root: THREE.Object3D, cell: number, names: string[]): Heightfield | null {
    const wanted = new Set(names.map((n) => n.toLowerCase()));
    const parts: Float32Array[] = [];
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (wanted.has(mesh.name.toLowerCase()) || mats.some((m) => wanted.has(m.name.toLowerCase()))) parts.push(worldTriangles(mesh));
    });
    if (!parts.length) return null;
    const tris = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let off = 0;
    for (const p of parts) {
      tris.set(p, off);
      off += p.length;
    }
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (let i = 0; i < tris.length; i += 3) box.expandByPoint(v.set(tris[i], tris[i + 1], tris[i + 2]));
    return new Heightfield(box, cell, tris);
  }

  /** (x, z) noktasındaki arazi yüksekliği; arazinin dışındaysa null. */
  heightAt(x: number, z: number): number | null {
    const fx = (x - this.minX) / this.cell;
    const fz = (z - this.minZ) / this.cell;
    if (fx < 0 || fz < 0 || fx > this.cols - 1 || fz > this.rows - 1) return null;
    const x0 = Math.min(this.cols - 2, Math.floor(fx));
    const z0 = Math.min(this.rows - 2, Math.floor(fz));
    const tx = fx - x0;
    const tz = fz - z0;
    const h = (c: number, r: number) => this.heights[r * this.cols + c];

    const h00 = h(x0, z0);
    const h10 = h(x0 + 1, z0);
    const h01 = h(x0, z0 + 1);
    const h11 = h(x0 + 1, z0 + 1);

    // 4 köşe de geçerliyse standart çift doğrusal ara değerleme
    if (Number.isFinite(h00) && Number.isFinite(h10) && Number.isFinite(h01) && Number.isFinite(h11)) {
      const a = h00 + (h10 - h00) * tx;
      const b = h01 + (h11 - h01) * tx;
      return a + (b - a) * tz;
    }

    // Kenar hücrelerde NaN varsa geçerli köşelerin ağırlıklı ortalaması
    let sum = 0;
    let weight = 0;
    const w00 = (1 - tx) * (1 - tz);
    const w10 = tx * (1 - tz);
    const w01 = (1 - tx) * tz;
    const w11 = tx * tz;

    if (Number.isFinite(h00)) { sum += h00 * w00; weight += w00; }
    if (Number.isFinite(h10)) { sum += h10 * w10; weight += w10; }
    if (Number.isFinite(h01)) { sum += h01 * w01; weight += w01; }
    if (Number.isFinite(h11)) { sum += h11 * w11; weight += w11; }

    return weight > 1e-4 ? sum / weight : null;
  }

  private rasterize(t: Float32Array) {
    const { cell, cols, rows, minX, minZ, heights } = this;
    for (let i = 0; i < t.length; i += 9) {
      const ax = t[i], ay = t[i + 1], az = t[i + 2];
      const bx = t[i + 3], by = t[i + 4], bz = t[i + 5];
      const cx = t[i + 6], cy = t[i + 7], cz = t[i + 8];
      const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(det) < 1e-12) continue; // dikey üçgen
      const c0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - minX) / cell));
      const c1 = Math.min(cols - 1, Math.ceil((Math.max(ax, bx, cx) - minX) / cell));
      const r0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - minZ) / cell));
      const r1 = Math.min(rows - 1, Math.ceil((Math.max(az, bz, cz) - minZ) / cell));
      for (let r = r0; r <= r1; r++) {
        const pz = minZ + r * cell;
        for (let c = c0; c <= c1; c++) {
          const px = minX + c * cell;
          const w0 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / det;
          const w1 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / det;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
          const y = w0 * ay + w1 * by + w2 * cy;
          const k = r * cols + c;
          if (!(heights[k] >= y)) heights[k] = y; // NaN ise de yaz
        }
      }
    }
  }

  /** Boş hücreleri komşu ortalamasıyla doldurur (birkaç geçiş). */
  private fillHoles() {
    const { cols, rows, heights } = this;
    for (let pass = 0; pass < 12; pass++) {
      let filled = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const k = r * cols + c;
          if (!Number.isNaN(heights[k])) continue;
          let sum = 0;
          let n = 0;
          for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const cc = c + dc;
            const rr = r + dr;
            if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
            const v = heights[rr * cols + cc];
            if (!Number.isNaN(v)) {
              sum += v;
              n++;
            }
          }
          if (n) {
            heights[k] = sum / n;
            filled++;
          }
        }
      }
      if (!filled) break;
    }
  }
}

function worldTriangles(mesh: THREE.Mesh): Float32Array {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const index = geo.index;
  const count = index ? index.count : pos.count;
  const out = new Float32Array(count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    v.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld);
    out[i * 3] = v.x;
    out[i * 3 + 1] = v.y;
    out[i * 3 + 2] = v.z;
  }
  return out;
}

/** Normali yukarıya yakın (eğimi ~45°'den az) üçgenlerin yatay izdüşüm alanı. */
function flatArea(t: Float32Array): number {
  let area = 0;
  for (let i = 0; i < t.length; i += 9) {
    const ux = t[i + 3] - t[i], uy = t[i + 4] - t[i + 1], uz = t[i + 5] - t[i + 2];
    const vx = t[i + 6] - t[i], vy = t[i + 7] - t[i + 1], vz = t[i + 8] - t[i + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 0 && Math.abs(ny) / len > 0.7) area += Math.abs(ny) / 2;
  }
  return area;
}
