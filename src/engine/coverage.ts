/**
 * Kurgu kapsaması (coverage): bir kamera girişini, o aralıktaki konuşmalara ve vuruşlara göre kısa çekimlere böler.
 * Çizgi filmlerde çekimler 2–4 sn sürer; uzun tek kameralı sahneler yerine konuşana, dinleyenin tepkisine ve
 * vurulanın yüzüne kesilir. Yalnızca derlenmiş zaman çizelgesine (konum, yön, replik ve isabet zamanları) bağlıdır.
 *
 * - dialogue: her replikte konuşan, dinleyenin tarafından çekilir (omuz üstü açısı); 180° kuralı korunur: kamera
 *   kapsama boyunca konuşanlar arasındaki çizginin hep aynı tarafında kalır. Uzun repliklerin ortasına dinleyenin
 *   kısa tepki çekimi girer. Kameraya konuşan (look_at: camera) ya da karşısında kimse olmayan karakterde orta
 *   plan → yakın plan kesmesi yapılır.
 * - fight: her isabetten hemen sonra vurulanın kısa yakın planı (yetenek kamera odağı bu çekimde kapalı).
 * Replik ya da isabet olmayan aralıklarda girişin kendi kamerası (hareketi o aralığa göre bölünmüş) kalır.
 */
import type { CameraDef } from '../schema';

export type CoverageKind = 'dialogue' | 'fight';

export interface CoverageShot {
  start: number;
  duration: number;
  camera: CameraDef;
}

export interface CoverageLine {
  who: string;
  start: number;
  end: number;
  /** Replik sırasında kameraya bakıyor (tanıtım konuşması) */
  toCamera: boolean;
}

export interface CoverageImpact {
  time: number;
  caster: string;
  targets: string[];
}

export interface CoverageWorld {
  ids: string[];
  pos(id: string, t: number): { x: number; z: number };
  /** Kök yönü (radyan, 0 = +Z): niyet (kime dönük) */
  facing(id: string, t: number): number;
  /** Yüzün o anki pozdaki gerçek yönü (radyan); dövüş/yay duruşunda kök yönünden farklı olabilir */
  bodyFacing(id: string, t: number): number;
  height(id: string): number;
  /** (x, z) noktası t anında kameranın giremeyeceği bir engelin (devrik ağaç tacı) içinde mi */
  blocked?(x: number, z: number, t: number): boolean;
}

/** Konuşanın çekimi replikten bu kadar önce başlar (nefes alışı, ağız hazırlığı görünsün). */
const LEAD = 0.3;
/** Bu süreden uzun repliklere dinleyen tepkisi girer; tepki çekiminin süresi. */
const REACTION_AFTER = 4.0;
const REACTION_LEN = 1.2;
/** Omuz üstü açısı: kamera konuşan–dinleyen çizgisinden bu kadar yana açılır (derece). */
const OTS = 30;
/** Bundan kısa kalan "ara" kamera parçası ayrı çekim yapılmaz, komşu çekime katılır (sn). */
const MIN_PIECE = 0.9;
/** Vuruş tepki çekimi: isabetten sonra başlangıcı, süresi ve iki tepki arasındaki en kısa süre. */
const HIT_DELAY = 0.1;
const HIT_LEN = 0.95;
const HIT_GAP = 2.2;

const deg = (r: number) => (r * 180) / Math.PI;
const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
const azimuth = (from: { x: number; z: number }, to: { x: number; z: number }) => deg(Math.atan2(to.x - from.x, to.z - from.z));

type Num = number | { from: number; to: number };
const at = (v: Num | undefined, k: number, fallback: number) =>
  v === undefined ? fallback : typeof v === 'number' ? v : v.from + (v.to - v.from) * k;
const EASE = {
  linear: (k: number) => k,
  in: (k: number) => k * k,
  out: (k: number) => 1 - (1 - k) * (1 - k),
  inOut: (k: number) => (k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k)),
};

/** Girişin kendi kamerasının [a, b] parçası: hareket o parçaya düşen kısma göre yeniden ölçeklenir. */
function slice(base: CameraDef, start: number, duration: number, a: number, b: number): CameraDef {
  const ease = EASE[base.ease ?? 'inOut'];
  const ka = ease(Math.min(1, Math.max(0, (a - start) / duration)));
  const kb = ease(Math.min(1, Math.max(0, (b - start) / duration)));
  const part = (v: Num | undefined, fb: number) => (typeof v === 'object' ? { from: at(v, ka, fb), to: at(v, kb, fb) } : v);
  const size = base.size;
  return {
    ...base,
    ease: 'linear',
    angle: part(base.angle as Num | undefined, 0),
    elevation: part(base.elevation as Num | undefined, 6),
    size: typeof size === 'object' && size !== null && 'from' in size && typeof size.from === 'number' && typeof size.to === 'number'
      ? { from: at(size as Num, ka, 1), to: at(size as Num, kb, 1) }
      : size,
  } as CameraDef;
}

/** Kapsama girişini alt çekimlere böler. */
export function expandCoverage(
  entry: { start: number; duration: number; camera: CameraDef; kinds: CoverageKind[] },
  lines: CoverageLine[],
  impacts: CoverageImpact[],
  world: CoverageWorld,
): CoverageShot[] {
  const t0 = entry.start;
  const t1 = entry.start + entry.duration;
  // Her öğe [a, b, kamera]; sonradan kısa ara parçalar komşuya katılır
  const pieces: { a: number; b: number; camera: CameraDef | null }[] = [];
  // Girişin kamerası belirgin yüksekten bakıyorsa (8°'den fazla; ör. yol kenarı uzun otlu yer) kapsama çekimleri de
  // en az o kadar yüksekten çeker: göz hizasındaki omuz üstü çekimde otlar kadrajı kapatıyordu
  const baseElev = entry.camera.elevation;
  const minElev = typeof baseElev === 'number' ? baseElev : baseElev && typeof baseElev === 'object' ? Math.min(baseElev.from, baseElev.to) : 0;
  const floor = minElev > 8 ? minElev : 0;
  const push = (a: number, b: number, camera: CameraDef | null) => {
    a = Math.max(a, t0);
    b = Math.min(b, t1);
    if (camera && floor > 0) {
      const e = camera.elevation;
      if (typeof e === 'number' || e === undefined) camera = { ...camera, elevation: Math.max(e ?? 6, floor) };
      else camera = { ...camera, elevation: { from: Math.max(e.from, floor), to: Math.max(e.to, floor) } };
    }
    if (b - a > 0.05) pieces.push({ a, b, camera });
  };

  if (entry.kinds.includes('dialogue')) {
    const ls = lines.filter((l) => l.end > t0 + 0.2 && l.start < t1 - 0.2).sort((p, q) => p.start - q.start);
    // 180° kuralı: kapsama boyunca tek taraf. Taraf, konuşanların yüzünü en çok gösteren taraftır (gövdenin gerçek
    // yönüne göre); eşitse girişin kamerasına yakın olan
    let side = chooseSide(ls, entry, world);
    ls.forEach((l, i) => {
      const next = ls[i + 1];
      const a = l.start - LEAD;
      const b = Math.min(t1, next ? next.start - LEAD : l.end + 0.4);
      const listeners = l.toCamera ? [] : listenersOf(l.who, l.start, world);
      if (listeners.length === 0) {
        // Kameraya konuşma: orta plan, uzunsa yakın plana kesme (açı değişir ki kesme sıçrama gibi görünmesin)
        const h = world.height(l.who);
        const mid = l.toCamera && b - a > 3.2 ? a + (b - a) * 0.5 : b;
        // Önden açı; kamera bir engelin (devrik ağaç tacı) içine düşüyorsa yana kayar
        const p = world.pos(l.who, l.start);
        const face = deg(world.facing(l.who, l.start));
        const freeAngle = (base: number, size: number) => {
          const dist = camDist(size * h);
          for (const d of [0, 25, -25, 45, -45, 70, -70, 95, -95, 120, -120]) {
            const az = ((face + base + d) * Math.PI) / 180;
            if (!world.blocked?.(p.x + Math.sin(az) * dist, p.z + Math.cos(az) * dist, l.start)) return base + d;
          }
          return base;
        };
        const a1 = freeAngle(-7, 0.66 * scaleFor(h));
        push(a, mid, { target: l.who, size: 0.66 * scaleFor(h), angle: { from: a1 - 3, to: a1 + 3 }, elevation: 4.5, relative: true, ease: 'inOut' });
        if (mid < b) {
          const a2 = freeAngle(16, 0.52 * scaleFor(h));
          push(mid, b, { target: l.who, size: 0.52 * scaleFor(h), angle: { from: a2 + 2, to: a2 - 2 }, elevation: 3.5, relative: true, ease: 'inOut' });
        }
        return;
      }
      const sp = world.pos(l.who, l.start);
      const lc = centroid(listeners.map((id) => world.pos(id, l.start)));
      const toListener = azimuth(sp, lc);
      if (side === 0) side = 1;
      const h = world.height(l.who);
      const sizeK = 1.05 * scaleFor(h);
      // Açı seçimi: tercihen 180° tarafı; önü kapalıysa omuz üstü açısı büyür, yüz görünmüyorsa ya da o taraf
      // tamamen kapalıysa bu replikte karşı taraf
      const { side: lineSide, off } = pickAngle(l, toListener, side, sizeK * h, world);
      const speakerCam = (from: number): CameraDef => ({
        target: l.who,
        // Konuşana yakın plan (göğüs üstü; omuz üstünden dinleyenin omzu kadraj kenarında)
        size: { from: 0.74 * scaleFor(h), to: 0.66 * scaleFor(h) },
        angle: { from: toListener + lineSide * off, to: toListener + lineSide * (off - 4) },
        elevation: 4.8,
        relative: false,
        ease: from > 0 ? 'out' : 'inOut',
      });
      const reactionCam = (): CameraDef => {
        const back = azimuth(lc, sp);
        const group = listeners.length > 1;
        const lh = Math.max(...listeners.map((id) => world.height(id)));
        return {
          target: group ? listeners : listeners[0],
          size: group ? 1.3 * scaleFor(lh) : 0.74 * scaleFor(lh),
          // Ters açı: konuşanın tarafından, aynı yanda (180° kuralı)
          angle: back - lineSide * OTS,
          elevation: 5,
          relative: false,
          ease: 'linear',
        };
      };
      // Tepkiden önce konuşana en az 1.5 sn, sonra en az 1 sn kalmalı (göz kırpması gibi kısa çekim olmasın)
      const ra = Math.min(l.start + (l.end - l.start) * 0.55, b - REACTION_LEN - 1.0);
      if (l.end - l.start > REACTION_AFTER && ra - a >= 1.5) {
        push(a, ra, speakerCam(0));
        push(ra, ra + REACTION_LEN, reactionCam());
        push(ra + REACTION_LEN, b, speakerCam(1));
      } else {
        push(a, b, speakerCam(0));
        // Replikten sonra boşluk varsa (cevap beklenirken) dinleyenin yüzüne kesilir
        if (next && next.start - LEAD - l.end > 1.2) push(l.end + 0.15, next.start - LEAD, reactionCam());
      }
    });
  }

  // Kapsamanın konuşma dışında kalan aralıkları girişin kendi kamerası
  const covered = [...pieces].sort((p, q) => p.a - q.a);
  const filled: typeof pieces = [];
  let cursor = t0;
  for (const p of covered) {
    if (p.a > cursor) filled.push({ a: cursor, b: p.a, camera: null });
    filled.push(p);
    cursor = Math.max(cursor, p.b);
  }
  if (cursor < t1) filled.push({ a: cursor, b: t1, camera: null });

  // Vuruş tepki çekimleri, yalnızca girişin kendi kamerası olan (konuşma dışı) aralıklara
  let result = filled;
  if (entry.kinds.includes('fight')) {
    let last = -Infinity;
    for (const imp of impacts.filter((i) => i.time > t0 && i.time + HIT_DELAY + HIT_LEN < t1).sort((p, q) => p.time - q.time)) {
      const a = imp.time + HIT_DELAY;
      const b = a + HIT_LEN;
      if (a - last < HIT_GAP) continue;
      const host = result.findIndex((p) => p.camera === null && p.a <= a && p.b >= b);
      if (host < 0) continue;
      last = a;
      const tp = centroid(imp.targets.map((id) => world.pos(id, imp.time)));
      const cp = world.pos(imp.caster, imp.time);
      const group = imp.targets.length > 1;
      const th = Math.max(...imp.targets.map((id) => world.height(id)));
      const cam: CameraDef = {
        target: group ? imp.targets : imp.targets[0],
        size: { from: (group ? 1.7 : 1.15) * scaleFor(th), to: (group ? 1.85 : 1.3) * scaleFor(th) },
        // Vurulanı saldıranın tarafından, hafif yandan: yüzündeki şaşkınlık görünsün
        angle: azimuth(tp, cp) + 24,
        elevation: 5,
        relative: false,
        ease: 'out',
        focus: false,
      };
      const h = result[host];
      result = [...result.slice(0, host), { a: h.a, b: a, camera: null }, { a, b, camera: cam }, { a: b, b: h.b, camera: null }, ...result.slice(host + 1)];
    }
  }

  // Çok kısa ara parçaları komşuya kat
  const merged: typeof pieces = [];
  for (const p of result) {
    if (p.b - p.a < 0.02) continue;
    const prev = merged[merged.length - 1];
    if (p.camera === null && p.b - p.a < MIN_PIECE && prev) prev.b = p.b;
    else merged.push({ ...p });
  }
  if (merged.length > 1 && merged[0].camera === null && merged[0].b - merged[0].a < MIN_PIECE) {
    merged[1].a = merged[0].a;
    merged.shift();
  }

  return merged.map((p) => ({
    start: p.a,
    duration: p.b - p.a,
    camera: p.camera ?? slice(entry.camera, t0, entry.duration, p.a, p.b),
  }));
}

/** Plan boyu (karakter boyu katı) 1.7 m'ye göre: çok uzun karakter (Karabey) kadrajdan taşmasın diye hafif ölçek. */
const scaleFor = (h: number) => Math.min(1.15, Math.max(0.9, h / 1.7));

const centroid = (ps: { x: number; z: number }[]) => ({
  x: ps.reduce((s, p) => s + p.x, 0) / ps.length,
  z: ps.reduce((s, p) => s + p.z, 0) / ps.length,
});

/** Konuşanın baktığı yöndeki (±40°, 14 m içinde) karakterler: dinleyenler. */
function listenersOf(who: string, t: number, world: CoverageWorld): string[] {
  const p = world.pos(who, t);
  const f = deg(world.facing(who, t));
  return world.ids.filter((id) => {
    if (id === who) return false;
    const q = world.pos(id, t);
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    return d > 0.5 && d < 14 && Math.abs(wrap(azimuth(p, q) - f)) < 40;
  });
}

/** Kamera mesafesi (yaklaşık): plan yüksekliği / (2·tan(15°)). */
const camDist = (frameHeight: number) => frameHeight / 2 / Math.tan((15 * Math.PI) / 180);

/**
 * Konuşan çekiminin tarafı ve omuz üstü açısı. Adaylar: tercih edilen taraf, sonra karşı taraf; açılar OTS ve
 * çevresi. Kabul: kameranın görüş alanında konuşandan önde başka karakter yok ve yüz kameradan 100°'den fazla dönük
 * değil. Tercih edilen tarafta kabul edilen ilk aday; yoksa yüzü en iyi gösteren temiz aday; o da yoksa en az kapanan.
 */
function pickAngle(l: CoverageLine, toListener: number, prefer: number, frameHeight: number, world: CoverageWorld): { side: number; off: number } {
  const t = l.start;
  const p = world.pos(l.who, t);
  const dist = camDist(frameHeight);
  const face = deg(world.bodyFacing(l.who, (l.start + l.end) / 2));
  const cands: { side: number; off: number; clear: number; facing: number }[] = [];
  for (const side of [prefer, -prefer]) {
    for (const off of [OTS, OTS + 14, OTS + 26, OTS - 12, OTS + 40]) {
      const camAz = toListener + side * off;
      const az = (camAz * Math.PI) / 180;
      const c = { x: p.x + Math.sin(az) * dist, z: p.z + Math.cos(az) * dist };
      const toSub = azimuth(c, p);
      // En yakın engelin görüş eksenine açısı (büyük = temiz); kamera bir engelin içindeyse hiç temiz değil
      let clear = world.blocked?.(c.x, c.z, t) ? 0 : 90;
      for (const id of world.ids) {
        if (id === l.who) continue;
        const q = world.pos(id, t);
        const dq = Math.hypot(q.x - c.x, q.z - c.z);
        if (dq > dist - 0.3) continue;
        clear = Math.min(clear, dq < 1.2 ? 0 : Math.abs(wrap(azimuth(c, q) - toSub)));
      }
      cands.push({ side, off, clear, facing: Math.cos(((face - camAz) * Math.PI) / 180) });
    }
  }
  const ok = (c: (typeof cands)[number]) => c.clear >= 32 && c.facing > -0.17;
  const first = cands.find((c) => c.side === prefer && ok(c));
  if (first) return first;
  const clean = cands.filter((c) => c.clear >= 32).sort((x, y) => y.facing - x.facing)[0];
  if (clean) return clean;
  return cands.sort((x, y) => y.clear - x.clear)[0];
}

/** 180° tarafı: konuşanların gövdesinin (gerçek yönünün) kameraya en dönük olduğu taraf. */
function chooseSide(ls: CoverageLine[], entry: { start: number; duration: number; camera: CameraDef }, world: CoverageWorld): number {
  let score = 0;
  let any = false;
  for (const l of ls) {
    if (l.toCamera) continue;
    const ln = listenersOf(l.who, l.start, world);
    if (!ln.length) continue;
    any = true;
    const sp = world.pos(l.who, l.start);
    const toL = azimuth(sp, centroid(ln.map((id) => world.pos(id, l.start))));
    const body = deg(world.bodyFacing(l.who, Math.max(l.start, (l.start + l.end) / 2)));
    // Yüz kameraya ne kadar dönük: cos(gövde − kamera yönü)
    const face = (s: number) => Math.cos(((body - (toL + s * OTS)) * Math.PI) / 180);
    score += face(1) - face(-1);
  }
  if (!any) return 0;
  if (Math.abs(score) > 0.15) return score > 0 ? 1 : -1;
  const l = ls.find((x) => !x.toCamera)!;
  const sp = world.pos(l.who, l.start);
  const ln = listenersOf(l.who, l.start, world);
  const toL = azimuth(sp, centroid(ln.map((id) => world.pos(id, l.start))));
  const baseAz = baseAzimuth(entry.camera, entry.start, entry.duration, l.start, world);
  return Math.abs(wrap(toL + OTS - baseAz)) <= Math.abs(wrap(toL - OTS - baseAz)) ? 1 : -1;
}

/** Girişin kendi kamerasının t anındaki yatay açısı (dünya, derece). */
function baseAzimuth(cam: CameraDef, start: number, duration: number, t: number, world: CoverageWorld): number {
  const k = EASE[cam.ease ?? 'inOut'](Math.min(1, Math.max(0, (t - start) / duration)));
  const a = at(cam.angle as Num | undefined, k, 0);
  if (!cam.relative) return a;
  const first = typeof cam.target === 'string' ? cam.target : Array.isArray(cam.target) && typeof cam.target[0] === 'string' ? cam.target[0] : null;
  return first && world.ids.includes(first) ? a + deg(world.facing(first, t)) : a;
}
