import * as THREE from 'three';
import { Heightfield } from './terrain';
import { rng } from './sfx/dsp';

export interface WindConfig {
  enabled?: boolean;
  speed?: number;
  strength?: number;
  direction?: [number, number];
  leaves?: boolean;
}

export const windUniforms = {
  uTime: { value: 0 },
  uWindSpeed: { value: 1.0 },
  uWindStrength: { value: 0.5 },
  uWindDir: { value: new THREE.Vector2(1.0, 0.3).normalize() },
};

const VEGETATION_PATTERN = /(pine|trunk|tree|birch|oak|bush|foliage|leaves|needle|grass|vegetation|atlas)/i;
const NON_VEGETATION_PATTERN = /(road|ground|dirt|rock|cliff|stone|log|wood_log|fence|wall|puddle|cobble|fallen|terrain|metal|aerial)/i;

export function isVegetation(name?: string): boolean {
  if (!name) return false;
  if (NON_VEGETATION_PATTERN.test(name)) return false;
  return VEGETATION_PATTERN.test(name);
}

/**
 * Rüzgarda salınan bitki mesh'i mi? Adı opak "grass" olan yüzeyler (ör. Grass_Close) çimen kartı değil, çimen
 * dokulu zemin katmanıdır: sallanmaz, zemin sayılır. Çimen ve yaprak kartları saydam/kesik dokuludur.
 */
function isVegetationMesh(mesh: THREE.Mesh): boolean {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  if (!isVegetation(mesh.name) && !mats.some((m) => isVegetation(m?.name))) return false;
  const named = `${mesh.name} ${mats.map((m) => m?.name ?? '').join(' ')}`;
  const opaque = mats.every((m) => m && !(m.alphaTest > 0) && !m.transparent);
  return !(opaque && /grass/i.test(named) && !/(bush|tree|pine|foliage|leaves|vegetation)/i.test(named));
}

/**
 * Malzemeye rüzgar vertex shader kancasını bağlar.
 * aWind özniteliği 0 olan noktalarda (kökler ve zemin) kesinlikle 0 hareket üretir.
 */
export function applyWindShader(material: THREE.Material) {
  if (material.userData.__hasWindShader) return;
  material.userData.__hasWindShader = true;

  const prev = material.onBeforeCompile;
  // Aynı ayarlı rüzgarsız malzemeyle aynı shader programını paylaşmasın
  const innerKey = material.customProgramCacheKey();
  material.customProgramCacheKey = () => `${innerKey}|wind`;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);

    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWindSpeed = windUniforms.uWindSpeed;
    shader.uniforms.uWindStrength = windUniforms.uWindStrength;
    shader.uniforms.uWindDir = windUniforms.uWindDir;

    shader.vertexShader = `
      attribute float aWind;
      uniform float uTime;
      uniform float uWindSpeed;
      uniform float uWindStrength;
      uniform vec2 uWindDir;
      ${shader.vertexShader}
    `;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      
      // SADECE aWind > 0 OLAN YUKARIDAKİ NOKTALAR HAREKET EDER:
      // Köklerde aWind == 0 olduğu için zemin konumu DEĞİŞMEZ.
      if (aWind > 0.001) {
        mat4 toWorld = modelMatrix;
        #ifdef USE_INSTANCING
          toWorld = modelMatrix * instanceMatrix;
        #endif
        vec4 worldP = toWorld * vec4(position, 1.0);
        
        // 1. Ana Salınım (Sway): Rüzgar yönünde dalgalı eğilme
        float phase = uTime * (uWindSpeed * 2.0) + (worldP.x * uWindDir.x + worldP.z * uWindDir.y) * 0.12;
        float gust = sin(phase) * 0.72 + sin(phase * 2.2 + 0.8) * 0.28;
        
        // aWind ile ölçeklenir (kök = 0, gövde ortası = 0.2, tepe = 1.0)
        float sway = gust * (uWindStrength * 0.42) * aWind;
        
        // 2. Yaprak ve Uç Dal Titremesi (High-frequency Leaf Flutter):
        float flutterPhase = uTime * (uWindSpeed * 5.0) + worldP.x * 4.0 + worldP.y * 3.0 + worldP.z * 2.0;
        float flutter = sin(flutterPhase) * (0.045 * uWindStrength * aWind);

        // Kayma dünya uzayında (metre, rüzgar yönünde) hesaplanır ve yerel uzaya çevrilir: döndürülmüş ya da
        // ölçeklenmiş örnekler de aynı yöne, aynı miktarda eğilir (döndürme + eşit ölçek için tersi = devrik / s²)
        vec3 offW = vec3(uWindDir.x * sway + flutter, -abs(sway) * 0.06 * aWind, uWindDir.y * sway + flutter * 0.6);
        mat3 m3 = mat3(toWorld);
        transformed += (offW * m3) / dot(m3[0], m3[0]);
      }
      `
    );
  };
  material.needsUpdate = true;
}

/**
 * Sahnedeki bitki ve ağaçları tarayıp zemin üstündeki yüksekliğe göre aWind ağırlığını hesaplar.
 * Kök kısımları (zemine yakın vertexler) kesinlikle 0 alır ve konumları değişmez; tepe ve yapraklar salınır.
 * Yükseklik her noktada gerçek zeminden ölçülür (eğimdeki çalıların ve çalı kümelerinin kökleri yerinde kalır;
 * kendi en alt noktasından ölçülünce yokuş yukarıdaki kökler de sallanıyordu). Birden çok örneğin paylaştığı
 * geometride (ör. 171 çam) ağırlık tek olduğundan yükseklik kendi tabanından ölçülür; zemin bilinmeyen noktada tek
 * bitki de öyle, haritaya yayılmış örtü ise hiç hareket etmez.
 */
export function setupVegetationWind(root: THREE.Object3D, terrain?: Heightfield | null) {
  const v = new THREE.Vector3();
  const size = new THREE.Vector3();
  const box = new THREE.Box3();
  // Bitki ve karakter dışındaki opak, düz yüzeylerden zemin haritası (yalnızca birleşik örtü için, ilk gerektiğinde)
  let ground: Heightfield | null | undefined;
  const groundAt = (x: number, z: number) => {
    if (ground === undefined) {
      ground = Heightfield.fromObject(root, 0.5, undefined, isVegetationMesh);
    }
    return ground?.heightAt(x, z) ?? terrain?.heightAt(x, z) ?? null;
  };

  // Geometri kaç bitki örneğinde kullanılıyor (paylaşılan geometride zemine göre ağırlık örnekten örneğe yanlış olur)
  const uses = new Map<THREE.BufferGeometry, number>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry && isVegetationMesh(mesh)) uses.set(mesh.geometry, (uses.get(mesh.geometry) ?? 0) + 1);
  });

  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;

    if (!isVegetationMesh(mesh)) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

    const geo = mesh.geometry;
    const posAttr = geo.attributes.position;
    if (!posAttr) return;
    // Paylaşılan geometri (ör. 171 çam örneği) bir kez hesaplanır; her örnekte baştan hesaplamak yüklemeyi uzatıyordu
    if (geo.attributes.aWind) {
      for (const m of mats) applyWindShader(m);
      return;
    }
    mesh.updateMatrixWorld(true);

    geo.computeBoundingBox();
    const localMinY = geo.boundingBox ? geo.boundingBox.min.y : 0;
    const scaleY = mesh.matrixWorld.getMaxScaleOnAxis();
    // Örnekli (instanced) bitki de paylaşımlıdır: tek geometri birçok konumda
    const shared = (mesh as THREE.InstancedMesh).isInstancedMesh === true || (uses.get(geo) ?? 1) > 1;
    // Haritaya yayılmış örtüde zemin bilinmeyen nokta hareket etmez (kendi en alt noktası anlamsız)
    box.copy(geo.boundingBox ?? box.makeEmpty()).applyMatrix4(mesh.matrixWorld).getSize(size);
    const spread = Math.max(size.x, size.z) >= 20;

    const count = posAttr.count;
    const weights = new Float32Array(count);

    const nameStr = `${mesh.name} ${mats.map((m) => m.name).join(' ')}`.toLowerCase();
    const isTrunk = nameStr.includes('trunk');
    const isBush = nameStr.includes('bush');
    const isGrass = nameStr.includes('grass');

    // Gövde ~10m, çalı ~1.5m, çimen ~0.45m referans tepe boyu
    const maxRefH = isTrunk ? 10.0 : isBush ? 1.5 : isGrass ? 0.45 : 12.0;
    // Kök / taban payı: Bu yüksekliğin altındaki vertexler %100 SABİTTİR (0 hareket)
    const baseOffset = isGrass ? 0.06 : isBush ? 0.15 : 0.3;
    // Kısa bitkilerde tepe kayması boyuyla orantılı kalsın (ağaç tepesi ~23 cm; çimen ~4, çalı ~6 cm)
    // Yerdeki çalı ve otlar az salınır: tepe kayması çalıda ~6, otta ~4 cm (0.6 / 0.35'te kayıyormuş gibi görünüyordu)
    const amp = isGrass ? 0.15 : isBush ? 0.25 : 1.0;
    // Alçak bitkide eğilme uca toplanır (alt kısım yerinde kalır, bütün bitki kaymaz)
    const curve = isGrass || isBush ? 3 : 2;

    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(posAttr, i);
      const local = (v.y - localMinY) * scaleY;
      let h = local;
      if (!shared) {
        v.applyMatrix4(mesh.matrixWorld);
        const g = groundAt(v.x, v.z);
        h = g !== null ? Math.max(0, v.y - g) : spread ? 0 : local;
      }

      if (h <= baseOffset) {
        // Zemin ve kök noktaları: KESİNLİKLE 0 (konum değişemez)
        weights[i] = 0.0;
      } else {
        const norm = Math.min(1.0, (h - baseOffset) / maxRefH);
        weights[i] = Math.pow(norm, curve) * amp; // uca doğru artan esneme
      }
    }

    geo.setAttribute('aWind', new THREE.BufferAttribute(weights, 1));

    for (const m of mats) {
      applyWindShader(m);
    }
  });
}

/**
 * Havada süzülen yapraklar. Kameranın çevresindeki bir hacimde (16 × 8 × 16 m) yaşarlar: dünyada sabit konumlarda
 * süzülürler, hacimden çıkan yaprak karşı kenardan geri girer; böylece kamera nereye giderse gitsin çevresi yapraklıdır.
 * Konumlar yalnızca t ve kameraya bağlıdır (tohumlu başlangıç), aynı kare her zaman aynı görüntüyü verir.
 */
/** Yaprak türleri (dokudaki hücre sırası): meşe (loblu), akçaağaç (yıldız), kayın (oval, ince dişli), kestane (uzun, dişli). */
const LEAF_KINDS = 4;
const LEAF_CELL = 128;

/**
 * Yaprak dokusu (4 hücre yan yana): beyaz-gri tonlu yaprak biçimi; renk örnek başına (instanceColor) bununla
 * çarpılır. Ortası açık, kenarlara doğru koyulaşan dolgu, orta damar ve yan damarlar, sap ve birkaç yaşlılık lekesi.
 * Saydam arka plan alphaTest ile kesilir.
 */
function leafAtlas(): THREE.CanvasTexture {
  const W = LEAF_CELL * LEAF_KINDS;
  const H = LEAF_CELL;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  const r = rng(0x1ea7);
  const c = LEAF_CELL;

  // Yaprak ana hattı: sap hücrenin altında (y=0.92c), uç üstte (y=0.08c); s boyunca yarı genişlik w(s)
  const outline = (cx: number, halfWidth: (s: number) => number, tip = 0.08, base = 0.86) => {
    const pts: [number, number][] = [];
    const n = 60;
    for (let k = 0; k <= n; k++) {
      const s = k / n;
      pts.push([cx + halfWidth(s) * c, (base - (base - tip) * s) * c]);
    }
    for (let k = n; k >= 0; k--) {
      const s = k / n;
      pts.push([cx - halfWidth(s) * c, (base - (base - tip) * s) * c]);
    }
    return pts;
  };
  const shapes: [number, number][][] = [];
  // 0) Meşe: dalgalı loblar
  shapes.push(outline(c * 0.5, (s) => Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.05)), 0.75) * 0.27 * (0.78 + 0.22 * Math.cos(s * Math.PI * 9))));
  // 1) Akçaağaç: beş sivri uçlu yıldız (kutupsal), dişli kenar
  {
    const cx = c * 1.5;
    const cy = c * 0.52;
    const pts: [number, number][] = [];
    for (let k = 0; k <= 200; k++) {
      const th = (k / 200) * Math.PI * 2;
      // Uçlar yukarı ve yanlara; alt (sap) tarafı içe
      const lobe = Math.pow(Math.abs(Math.cos(2.5 * (th + Math.PI / 2))), 0.55);
      const bottom = 1 - 0.55 * Math.pow(Math.max(0, Math.sin(th)), 6);
      const tooth = 1 + 0.05 * Math.sin(th * 40);
      const rr = c * 0.4 * (0.42 + 0.58 * lobe) * bottom * tooth;
      pts.push([cx + Math.cos(th) * rr, cy - Math.sin(th) * rr]);
    }
    shapes.push(pts);
  }
  // 2) Kayın: oval, sivri uç, ince dişler
  shapes.push(outline(c * 2.5, (s) => Math.sin(Math.PI * Math.pow(s, 0.8)) * 0.22 * (1 + 0.04 * Math.sin(s * 70))));
  // 3) Kestane: uzun, belirgin dişli
  shapes.push(outline(c * 3.5, (s) => Math.sin(Math.PI * Math.pow(s, 0.9)) * 0.15 * (1 + 0.1 * Math.max(0, Math.sin(s * 48)))));

  shapes.forEach((pts, kind) => {
    const cx = c * (kind + 0.5);
    g.save();
    g.beginPath();
    pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    // Dolgu: ortası açık, kenara doğru koyulaşır
    const grd = g.createRadialGradient(cx, c * 0.5, c * 0.05, cx, c * 0.5, c * 0.45);
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(0.7, '#e6e6e6');
    grd.addColorStop(1, '#bdbdbd');
    g.fillStyle = grd;
    g.fill();
    g.clip();
    // Yaşlılık lekeleri ve hafif doku
    for (let k = 0; k < 14; k++) {
      g.fillStyle = `rgba(120,110,100,${0.12 + r() * 0.18})`;
      g.beginPath();
      g.arc(cx + (r() - 0.5) * c * 0.6, c * (0.15 + r() * 0.7), 1.5 + r() * 4, 0, Math.PI * 2);
      g.fill();
    }
    // Damarlar: sapın üstünden uca orta damar, iki yana kavisli yan damarlar
    g.strokeStyle = 'rgba(110,104,96,0.75)';
    g.lineCap = 'round';
    const top = kind === 1 ? c * 0.14 : c * 0.1;
    const root = kind === 1 ? c * 0.62 : c * 0.86;
    g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(cx, root);
    g.lineTo(cx, top);
    g.stroke();
    g.lineWidth = 1.1;
    if (kind === 1) {
      // Akçaağaç: sap noktasından her uca bir damar
      for (const th of [Math.PI * 0.5, Math.PI * 0.1, Math.PI * 0.9, -Math.PI * 0.1, Math.PI * 1.1]) {
        g.beginPath();
        g.moveTo(cx, root);
        g.lineTo(cx + Math.cos(th) * c * 0.36, root - Math.sin(th) * c * 0.36 - c * 0.1);
        g.stroke();
      }
    } else {
      for (let k = 1; k <= 7; k++) {
        const y = root - ((root - top) * k) / 8;
        const len = c * (kind === 3 ? 0.12 : 0.2) * Math.sin((Math.PI * k) / 8);
        for (const side of [-1, 1]) {
          g.beginPath();
          g.moveTo(cx, y);
          g.quadraticCurveTo(cx + side * len * 0.5, y - len * 0.15, cx + side * len, y - len * 0.45);
          g.stroke();
        }
      }
    }
    g.restore();
    // Sap
    g.strokeStyle = '#8a8178';
    g.lineWidth = 2.4;
    g.beginPath();
    g.moveTo(cx, root - 2);
    g.lineTo(cx + 2, c * 0.98);
    g.stroke();
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Tek yaprak geometrisi: kare düzlem (ışıkta yumuşak dursun diye 4×6 bölüt), orta damar boyunca hafif V katlanmış ve
 * uca doğru kıvrık; uv tek doku hücresine düşer. Merkez yaprağın ortası; boy 1 (örnek ölçeğiyle boyutlanır).
 */
function leafGeometry(kind: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1, 4, 6);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  const fold = kind === 1 ? 0.06 : 0.12;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    pos.setZ(i, fold * Math.pow(Math.abs(x) * 2, 1.3) * 0.5 + 0.08 * (y + 0.5) * (y + 0.5));
    uv.setX(i, (kind + uv.getX(i)) / LEAF_KINDS);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Kameranın çevresinde düşen yapraklar. Her yaprak iki gerçekçi düşüşten birini yapar:
 * - salınım (çoğunluk): sarkaç gibi iki yana süzülür, savruldukça ön kenarı kalkar, uçlarda yavaşlar;
 * - takla: uzun ekseni çevresinde döner, dar bir sarmal çizerek daha hızlı düşer.
 * Üstüne rüzgârla sürüklenir. Konum kameranın çevresindeki hacimde sarılır (kamera kıpırdayınca yapraklar dünyada
 * yerinde kalır); kameraya çok yakın ve hacmin kenarındaki yapraklar küçülerek kaybolur. Hepsi t'ye bağlı (belirli).
 */
export class LeavesParticleSystem {
  readonly object = new THREE.Group();
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly perKind = 40;
  private readonly count = this.perKind * LEAF_KINDS;
  private readonly offsets: Float32Array;
  /** Yaprak başına: düşüş hızı, salınım açısal hızı, salınım genliği, salınım yönü, faz, takla mı (1/0), takla hızı, sarmal yarıçapı */
  private readonly motion: Float32Array;
  private readonly sizes: Float32Array;
  private readonly spins: Float32Array;
  private readonly dummy = new THREE.Object3D();
  private readonly qYaw = new THREE.Quaternion();
  private readonly qTilt = new THREE.Quaternion();
  private readonly qFlat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  private readonly qSpin = new THREE.Quaternion();
  private readonly axisX = new THREE.Vector3(1, 0, 0);
  private readonly axisY = new THREE.Vector3(0, 1, 0);
  private readonly axisZ = new THREE.Vector3(0, 0, 1);
  /** Kamera çevresindeki hacim (m): yatay kenar, yükseklik ve kameranın altında kalan pay */
  private readonly span = 16;
  private readonly height = 8;
  private readonly below = 2.5;

  constructor() {
    const atlas = leafAtlas();
    const mat = new THREE.MeshToonMaterial({ map: atlas, side: THREE.DoubleSide, alphaTest: 0.5 });
    // Gölge de yaprak biçiminde (kare değil)
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlas, alphaTest: 0.5, side: THREE.DoubleSide });

    this.offsets = new Float32Array(this.count * 3);
    this.motion = new Float32Array(this.count * 8);
    this.sizes = new Float32Array(this.count);
    this.spins = new Float32Array(this.count);

    // Sonbahar ormanı: kızıl, turuncu, kehribar, sarı, kahve ve az sayıda yeşil
    const palette = ['#b03a1f', '#c9551d', '#dd7a22', '#e8a33a', '#d6b43c', '#9a6430', '#7a4a25', '#86a02e', '#5c8a30'].map((h) => new THREE.Color(h));
    const weights = [1.1, 1.3, 1.4, 1.2, 0.9, 1.0, 0.6, 0.6, 0.45];
    const wSum = weights.reduce((x, y) => x + y, 0);
    const r = rng(0x1eaf);
    const range = (a: number, b: number) => a + (b - a) * r();
    const pick = () => {
      let v = r() * wSum;
      for (let k = 0; k < palette.length; k++) if ((v -= weights[k]) <= 0) return palette[k];
      return palette[0];
    };
    const hsl = { h: 0, s: 0, l: 0 };

    for (let kind = 0; kind < LEAF_KINDS; kind++) {
      const mesh = new THREE.InstancedMesh(leafGeometry(kind), mat, this.perKind);
      mesh.customDepthMaterial = depth;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      // Örnekler kamerayla birlikte yer değiştirir; sınır küresi her karede yeniden hesaplanmasın
      mesh.frustumCulled = false;
      const colors = new Float32Array(this.perKind * 3);
      const col = new THREE.Color();
      for (let k = 0; k < this.perKind; k++) {
        col.copy(pick()).getHSL(hsl);
        col.setHSL(hsl.h + range(-0.02, 0.02), Math.min(1, hsl.s * range(0.85, 1.1)), hsl.l * range(0.85, 1.12));
        colors.set([col.r, col.g, col.b], k * 3);
      }
      mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
      this.meshes.push(mesh);
      this.object.add(mesh);
    }

    for (let i = 0; i < this.count; i++) {
      this.offsets[i * 3 + 0] = range(0, this.span);
      this.offsets[i * 3 + 1] = range(0, this.height);
      this.offsets[i * 3 + 2] = range(0, this.span);
      const tumble = r() < 0.3;
      const m = i * 8;
      this.motion[m + 0] = tumble ? range(0.8, 1.2) : range(0.4, 0.75); // düşüş (m/sn)
      this.motion[m + 1] = range(1.6, 2.8); // salınım açısal hızı
      this.motion[m + 2] = range(0.25, 0.6); // salınım genliği (m)
      this.motion[m + 3] = r() * Math.PI * 2; // salınım yönü
      this.motion[m + 4] = r() * Math.PI * 2; // faz
      this.motion[m + 5] = tumble ? 1 : 0;
      this.motion[m + 6] = range(3.5, 7) * (r() < 0.5 ? -1 : 1); // takla hızı
      this.motion[m + 7] = range(0.08, 0.2); // sarmal yarıçapı
      this.sizes[i] = range(0.14, 0.22);
      this.spins[i] = r() * Math.PI * 2; // yaprağın kendi düzlemindeki yönü
    }
  }

  update(t: number, speed: number, strength: number, dir: THREE.Vector2, camera: THREE.Vector3) {
    const { span, height } = this;
    // Hacmin alt köşesi; konum bu köşeye göre sarılır (kamera kıpırdadıkça yapraklar dünyada yerinde kalır)
    const x0 = camera.x - span / 2;
    const y0 = camera.y - this.below;
    const z0 = camera.z - span / 2;
    const wrap = (v: number, lo: number, n: number) => lo + ((((v - lo) % n) + n) % n);
    const windDrift = t * speed * strength * 2.2;
    const windYaw = Math.atan2(dir.x, dir.y);

    for (let i = 0; i < this.count; i++) {
      const m = i * 8;
      const fall = this.motion[m] * (0.7 + strength * 0.3);
      const w = this.motion[m + 1] * (0.8 + 0.2 * speed);
      const amp = this.motion[m + 2] * (0.8 + strength * 0.4);
      const swingYaw = this.motion[m + 3];
      const ph = t * w + this.motion[m + 4];
      let px: number;
      let pz: number;
      let py: number;
      if (this.motion[m + 5] > 0.5) {
        // Takla: dar sarmal, uzun eksen çevresinde dönüş
        const rad = this.motion[m + 7];
        px = Math.cos(ph) * rad;
        pz = Math.sin(ph) * rad;
        py = -t * fall;
        this.qYaw.setFromAxisAngle(this.axisY, ph * 0.5 + windYaw);
        this.qTilt.setFromAxisAngle(this.axisX, t * this.motion[m + 6]);
      } else {
        // Salınım: sarkaç gibi iki yana; ön kenar savrulma yönünde kalkar, uçlarda hafifçe yükselip yavaşlar
        const sw = Math.sin(ph);
        px = Math.sin(swingYaw) * amp * sw;
        pz = Math.cos(swingYaw) * amp * sw;
        py = -t * fall + 0.06 * Math.cos(2 * ph);
        this.qYaw.setFromAxisAngle(this.axisY, swingYaw + 0.25 * Math.sin(ph * 0.37));
        this.qTilt.setFromAxisAngle(this.axisX, -0.75 * Math.cos(ph));
        this.qSpin.setFromAxisAngle(this.axisZ, 0.35 * Math.sin(ph * 0.5));
        this.qTilt.multiply(this.qSpin);
      }

      const x = wrap(this.offsets[i * 3 + 0] + dir.x * windDrift + px, x0, span);
      const y = wrap(this.offsets[i * 3 + 1] + py, y0, height);
      const z = wrap(this.offsets[i * 3 + 2] + dir.y * windDrift + pz, z0, span);

      // Kameranın dibindeki yaprak ekranı kaplamasın; hacmin kenarındaki yaprak birden belirmesin
      const d = Math.hypot(x - camera.x, y - camera.y, z - camera.z);
      const edge = Math.min(x - x0, x0 + span - x, z - z0, z0 + span - z, y - y0, y0 + height - y);
      const fade = THREE.MathUtils.smoothstep(d, 1.5, 4.0) * THREE.MathUtils.smoothstep(edge, 0, 1.2);

      // yön = sarkaç/sarmal yönü × savrulma eğimi × düz yatış × yaprağın kendi düzlemindeki yönü
      this.qSpin.setFromAxisAngle(this.axisZ, this.spins[i]);
      this.dummy.quaternion.copy(this.qYaw).multiply(this.qTilt).multiply(this.qFlat).multiply(this.qSpin);
      this.dummy.position.set(x, y, z);
      this.dummy.scale.setScalar(this.sizes[i] * fade);
      this.dummy.updateMatrix();
      this.meshes[Math.floor(i / this.perKind)].setMatrixAt(i % this.perKind, this.dummy.matrix);
    }
    for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    const mat = this.meshes[0]?.material as THREE.MeshToonMaterial | undefined;
    mat?.map?.dispose();
    mat?.dispose();
    this.meshes[0]?.customDepthMaterial?.dispose();
    for (const mesh of this.meshes) mesh.geometry.dispose();
  }
}

/** Sahne ortamına bağlı çalışan rüzgar yöneticisi */
export class WindSystem {
  private readonly dir: THREE.Vector2;
  private readonly speed: number;
  private readonly strength: number;
  private readonly leavesSystem?: LeavesParticleSystem;

  constructor(
    readonly group: THREE.Group,
    readonly config: WindConfig = {},
  ) {
    const d = config.direction ?? [1.0, 0.3];
    this.dir = new THREE.Vector2(d[0], d[1]).normalize();
    this.speed = config.speed ?? 1.0;
    this.strength = config.strength ?? 0.6;

    if (config.leaves !== false) {
      this.leavesSystem = new LeavesParticleSystem();
      this.group.add(this.leavesSystem.object);
    }
  }

  /** t anının rüzgarı (önizlemede de); ortak uniform'lar her karede bu sahnenin ayarlarıyla doldurulur. */
  update(t: number, camera: THREE.Vector3) {
    windUniforms.uTime.value = t;
    windUniforms.uWindSpeed.value = this.speed;
    windUniforms.uWindStrength.value = this.strength;
    windUniforms.uWindDir.value.copy(this.dir);
    this.leavesSystem?.update(t, this.speed, this.strength, this.dir, camera);
  }

  dispose() {
    this.leavesSystem?.dispose();
  }
}
