/**
 * Ses efekti zaman çizelgesi: derlenmiş filmden (yetenekler, ayak sesleri, düşüşler, ekran yazıları,
 * geçişler) ses olaylarını çıkarır, sesleri sentezler ve kameraya göre konumlandırır.
 *
 * Zamanlama: karakterler ve efektler hit-stop'lu zamanda (wt) akar, sesler gerçek zamanda; her olayın wt
 * anı gerçek zamana çevrilir ki ses görüntüyle aynı karede duyulsun.
 * Konum: ses kaynağı kameradan uzaklaştıkça kısılır, ekranda solda/sağda olduğu yöne kayar (pan).
 */
import * as THREE from 'three';
import type { Film } from '../film';
import { tornadoCenter } from '../ability-fx/tornado';
import { rockLiftTimes, waveTimes } from '../ability-fx/showcase';

/** Birlikte yürüyüşte iki ayak sesi arasındaki en kısa süre (sn): daha yakın düşen (uzaktaki karakterin) adımı çalmaz. */
const STEP_GAP = 0.2;
const STEP_GAP_RUN = 0.12;
import { SR } from './dsp';
import * as S from './sounds';

/**
 * Doppler için abartılı "ses hızı" (m/sn): gerçek 343 m/sn'de birkaç m/sn'lik hortum duyulur bir perde kayması
 * yapmaz; çizgi film dilinde yaklaşırken incelip uzaklaşırken kalınlaşması duyulsun diye küçük tutulur.
 */
const DOPPLER_C = 16;
/** Perde kaymasının sınırları (frekans çarpanı; ~±5 yarım ton). */
const DOPPLER_MIN = 0.75;
const DOPPLER_MAX = 1.33;
/** Hareketli seslerin kazanç/pan eğrisi örnekleme hızı (Hz). */
const AUTO_HZ = 40;


export interface SfxCue {
  id: string;
  /** Sesin türü (fireI, step, pop…); zaman çizelgesi ve testler için */
  kind: string;
  /** Film zamanı (sn) */
  start: number;
  buffer: AudioBuffer;
  gain: number;
  /** -1 sol … 1 sağ */
  pan: number;
  /**
   * Hareketli kaynak (hortum): sesin başından itibaren hz örnek/sn kazanç çarpanı ve pan eğrileri; varsa sabit pan
   * yerine kullanılır, kazanç gain ile çarpılır.
   */
  auto?: { hz: number; gain: Float32Array; pan: Float32Array; /** Doppler perde çarpanı eğrisi (sese işlenmiş; tanı ve test için) */ rate?: Float32Array };
}

export interface AmbienceCue {
  start: number;
  end: number;
  buffer: AudioBuffer;
  gain: number;
}

export interface SfxConfig {
  enabled: boolean;
  /** Efekt kanalının seviyesi (0–1.5) */
  volume: number;
  /** Ortam sesi (orman, kuşlar) seviyesi; 0 = kapalı */
  ambience: number;
  footsteps: boolean;
  /** Ekran yazıları ve geçiş sesleri */
  ui: boolean;
}

export const DEFAULT_SFX: SfxConfig = { enabled: true, volume: 1, ambience: 0.3, footsteps: true, ui: false };

/** Ağaç sesinin, devrilmenin başladığı andan (chargeEnd) ne kadar önce başladığı: kılıç dalgasının fırlayışı. */
export const TREE_SOUND_LEAD = 0.53;

/** Konumlandırma için kullanılan kadraj (16:9); dikey formatlarda pan biraz farklı olsa da sorun değil. */
const LISTEN_FORMAT = { id: 'sfx', label: 'sfx', width: 1920, height: 1080 };

/** Sentezlenmiş sesler (aynı ses + tohum bir kez üretilir; sahne yeniden yüklenince de yeniden kullanılır). */
const cache = new Map<string, AudioBuffer>();

function buffer(key: string, make: Make): AudioBuffer {
  let b = cache.get(key);
  if (!b) {
    const data = make();
    const chans = Array.isArray(data) ? data : [data];
    b = new AudioBuffer({ length: chans[0].length, sampleRate: SR, numberOfChannels: chans.length });
    chans.forEach((c, i) => b!.copyToChannel(c, i));
    cache.set(key, b);
  }
  return b;
}

/** Deterministik küçük tamsayı (aynı olay her derlemede aynı varyantı seçer). */
const variant = (x: number, n: number) => Math.abs(Math.floor(Math.sin(x * 12.9898 + 4.1414) * 43758.5453)) % n;

type Make = () => Float32Array | [Float32Array, Float32Array];

/**
 * Filmin ses efektlerini üretir. Önce olaylar toplanır, sonra sesler sentezlenir; sentez arasında tarayıcıya
 * nefes payı verilir (ilk yüklemede ~1–2 sn sürebilir, arayüz donmaz). Sesler önbellekte kalır.
 */
export async function buildSfx(
  film: Film,
  presets: S.AmbiencePreset[],
  cfg: SfxConfig,
  /** Sahne başına rüzgâr gücü (0 = rüzgâr kapalı, hafif esinti; 0.5 varsayılan; 1 sert) */
  winds: number[] = [],
): Promise<{ cues: SfxCue[]; ambience: AmbienceCue[] }> {
  const pending: { cue: Omit<SfxCue, 'buffer'>; key: string; make: Make }[] = [];
  const pendingAmb: { cue: Omit<AmbienceCue, 'buffer'>; key: string; make: Make }[] = [];
  if (!cfg.enabled) return { cues: [], ambience: [] };

  const listeners = new Map<number, ReturnType<Film['listenerAt']>>();
  const listener = (t: number) => {
    const k = Math.round(t * 20);
    let l = listeners.get(k);
    if (!l) listeners.set(k, (l = film.listenerAt(k / 20, LISTEN_FORMAT)));
    return l;
  };
  /**
   * Kaynağın kazancı ve pan'ı. near: ayak sesi gibi küçük sesler uzakta hızla kaybolur;
   * wide: yetenekler gibi büyük sesler uzakta da duyulur.
   */
  const place = (t: number, pos: THREE.Vector3, mode: 'near' | 'wide') => {
    const l = listener(t);
    const rel = pos.clone().sub(l.position);
    const d = Math.max(0.5, rel.length());
    const x = rel.dot(l.right);
    const z = rel.dot(l.forward);
    let gain = mode === 'near' ? THREE.MathUtils.clamp(4 / d, 0.03, 1) : THREE.MathUtils.clamp(Math.sqrt(9 / d), 0.35, 1);
    let pan = THREE.MathUtils.clamp(x / (Math.max(z, 0.5) * l.tanHalf), -1, 1) * 0.6;
    if (z < 0) {
      gain *= 0.5;
      pan *= 0.5;
    }
    return { gain, pan };
  };
  let n = 0;
  const add = (key: string, make: () => Float32Array, start: number, gain: number, pan = 0, auto?: SfxCue['auto']) => {
    if (gain <= 0.005 || start >= film.duration) return;
    pending.push({ cue: { id: `sfx${n++}`, kind: key.split('|')[0], start: Math.max(0, start), gain: gain * cfg.volume, pan, auto }, key, make });
  };
  const at = (t: number, pos: THREE.Vector3, mode: 'near' | 'wide', key: string, make: () => Float32Array, level: number) => {
    const p = place(t, pos, mode);
    add(key, make, t, level * p.gain, p.pan);
  };

  film.scenes.forEach((sc, si) => {
    /** Karakter zamanı (wt) → film zamanı: hit-stop'un tersi (warp tekdüze artan; ikiye bölme). */
    const filmT = (wt: number) => {
      if (!sc.impact) return sc.start + wt;
      let lo = wt;
      let hi = wt + 0.3;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (sc.actionTime(mid) < wt) lo = mid;
        else hi = mid;
      }
      return sc.start + hi;
    };
    const posOf = (id: string, wt: number) => sc.characters.get(id)?.positionAt(wt, new THREE.Vector3()) ?? new THREE.Vector3();

    // --- Ortam sesi: sahne boyunca döngülü
    if (cfg.ambience > 0) {
      const preset = presets[si] ?? 'day';
      // Rüzgâr gücü 0.1 adımlarla (aynı güçteki sahneler aynı sesi paylaşır); güçlü rüzgâr biraz daha yüksek
      const wind = Math.round(THREE.MathUtils.clamp(winds[si] ?? 0, 0, 1) * 10) / 10;
      pendingAmb.push({
        cue: { start: sc.start, end: sc.start + sc.duration, gain: cfg.ambience * cfg.volume * (0.85 + 0.4 * wind) },
        key: `amb|${preset}|${wind}`,
        make: () => S.ambience(7, preset, wind),
      });
    }

    // --- Ayak sesleri ve düşüşler
    // Ayak sesi arka planda kalmalı: konuşma sırasında yarıya iner. Birlikte yürüyen karakterlerin adımları (üç kişide
    // saniyede ~5 adım) takırtıya dönüyordu: kameraya en yakın yürüyen tam seste, diğerleri belirgin kısık; bir adıma
    // STEP_GAP'ten yakın düşen adım hiç çalmaz (önce yakındakiler yerleşir, uzaktakiler aralara girebilirse girer).
    const steps: { t: number; pos: THREE.Vector3; id: string; run: boolean; weight: number; dist: number }[] = [];
    for (const [id, ch] of sc.characters) {
      for (const ev of ch.motionEvents()) {
        const t = filmT(ev.time);
        const pos = ch.positionAt(ev.time, new THREE.Vector3());
        if (ev.kind === 'step') {
          if (!cfg.footsteps) continue;
          steps.push({ t, pos, id, run: !!ev.run, weight: ev.weight, dist: pos.distanceTo(listener(t).position) });
        } else {
          const v = variant(t, 2);
          at(t, pos, 'wide', `land|${v}`, () => S.bodyLand(200 + v), 0.6 * ev.weight);
        }
      }
    }
    const kept: number[] = [];
    for (const st of [...steps].sort((x, y) => x.dist - y.dist)) {
      if (kept.some((k) => Math.abs(k - st.t) < (st.run ? STEP_GAP_RUN : STEP_GAP))) continue;
      kept.push(st.t);
      // O anda adım atan diğer karakterler (±0.45 sn): biri kameraya daha yakınsa bu adım arka plandadır
      const others = steps.filter((o) => o.id !== st.id && Math.abs(o.t - st.t) < 0.45);
      const lead = others.every((o) => o.dist >= st.dist);
      const crowd = others.length === 0 ? 1 : lead ? 0.85 : 0.4;
      const v = variant(st.t + st.id.length, 4);
      const duck = (film.audio.isVoiceActive(st.t) ? 0.5 : 1) * crowd;
      at(st.t, st.pos, 'near', `step|${st.run ? 1 : 0}|${v}`, () => S.step(100 + v, st.run), (st.run ? 0.17 : 0.12) * st.weight * duck);
    }

    // --- Yetenekler (çoklu hedefte güç toplama ve fırlatma bir kez, isabet her hedefte)
    for (const a of sc.abilities?.allUses() ?? []) {
      // Sahne başından beri devrik duran ağacın devrilme sesi yok
      if (a.prefallen) continue;
      const r = a.recipe;
      const first = (a.groupIndex ?? 0) === 0;
      // Çoklu hedefte isabetler aynı anda; her kol başka varyant ve birkaç ms kayık çalar, yoksa aynı dalgalar
      // üst üste binip genliği katlıyordu
      const many = (a.groupSize ?? 1) > 1 ? 0.55 : 1;
      const arm = a.groupIndex ?? 0;
      const t0 = filmT(a.start);
      const tCharge = r.chargeEnd;
      const tRelease = filmT(a.start + r.chargeEnd);
      const tImpact = filmT(a.start + r.impactOffset) + arm * 0.013;
      const caster = posOf(a.who, a.start);
      const target = a.impactPos;
      const seed = Math.round(a.start * 100) + arm;
      const cd = Math.round(tCharge * 100) / 100;
      const hitBody = () => {
        if (r.targetKind === 'character') at(tImpact, target, 'wide', `hit|${seed % 2}`, () => S.bodyHit(300 + (seed % 2)), 0.5 * many);
      };
      switch (r.effectType) {
        case 'fire':
          if (first) {
            at(t0, caster, 'wide', `fireC|${cd}`, () => S.fireCharge(11, cd), 0.42);
            at(tRelease, caster, 'wide', `fireL|${seed % 3}`, () => S.fireLaunch(12 + (seed % 3)), 0.6);
          }
          at(tImpact, target, 'wide', `fireI|${seed % 3}`, () => S.fireImpact(13 + (seed % 3)), 0.85 * many);
          hitBody();
          break;
        case 'earth': {
          if (first) at(t0, caster, 'wide', `earthC|${cd}`, () => S.earthCharge(21, cd), 0.5);
          // Dalga dikenleri earth.ts ile aynı anlarda: chargeEnd + (i + 0.5)/10 × uçuş
          const flight = r.impactOffset - r.chargeEnd;
          for (let i = 0; i < 10; i++) {
            const f = (i + 0.5) / 10;
            const pos = caster.clone().lerp(target, f);
            const q = Math.round(f * 3) / 3;
            at(filmT(a.start + r.chargeEnd + f * flight), pos, 'wide', `spike|${i % 2}|${q}`, () => S.earthSpike(30 + (i % 2), q), 0.3 + 0.15 * f);
          }
          at(tImpact, target, 'wide', `earthI|${seed % 3}`, () => S.earthImpact(23 + (seed % 3)), 0.9 * many);
          hitBody();
          break;
        }
        case 'tornado': {
          const c = Math.round(r.chargeEnd * 100) / 100;
          const i = Math.round(r.impactOffset * 100) / 100;
          const total = Math.round(r.totalDuration * 100) / 100;
          if (first) {
            // Hortum Defne'den hedefe giderken ses onunla hareket eder: kameraya uzaklığa göre kısılır, ekrandaki
            // yerine göre kayar ve kameraya yaklaşma/uzaklaşma hızından Doppler perde kayması alır (yaklaşırken
            // ince, uzaklaşırken kalın). Perde sentezde kaydırılır; zamanlama değişmez.
            const n = Math.ceil(total * AUTO_HZ) + 2;
            const gain = new Float32Array(n);
            const pan = new Float32Array(n);
            const rate = new Float32Array(n);
            const centre = (lw: number) =>
              tornadoCenter(lw, posOf(a.who, a.start + lw), target, posOf(a.target, a.start + lw), c, i, total, new THREE.Vector3()).setY(target.y + 1.3);
            for (let k = 0; k < n; k++) {
              const lw = k / AUTO_HZ;
              const t = filmT(a.start + Math.min(lw, total));
              const p = centre(lw);
              const pl = place(t, p, 'wide');
              gain[k] = pl.gain;
              pan[k] = pl.pan;
              // Kaynağın dinleyiciden uzaklaşma hızı (kameranın kendi hareketi sayılmaz; çekim kesmelerinde sıçramasın)
              const vel = centre(lw + 0.01).sub(p).divideScalar(0.01);
              const away = p.clone().sub(listener(t).position).normalize();
              rate[k] = THREE.MathUtils.clamp(DOPPLER_C / (DOPPLER_C + vel.dot(away)), DOPPLER_MIN, DOPPLER_MAX);
            }
            // Fırlatma anındaki hız sıçramasını yumuşat (±0.05 sn)
            const smoothRate = rate.map((_, k) => {
              let s = 0;
              let w = 0;
              for (let d = -2; d <= 2; d++) {
                const j = Math.min(n - 1, Math.max(0, k + d));
                s += rate[j];
                w++;
              }
              return s / w;
            });
            add(
              `tornado|${c}|${i}|${total}|${a.who}@${a.start}`,
              () => S.tornado(41, c, i, total, smoothRate, AUTO_HZ),
              t0,
              0.6,
              0,
              { hz: AUTO_HZ, gain, pan, rate: smoothRate },
            );
          }
          hitBody();
          break;
        }
        case 'rain': {
          if (first) {
            at(t0, caster, 'wide', `waterC|${cd}`, () => S.waterCharge(51, cd), 0.4);
            // Bırakış + isabete kadar uçan okun ıslığı
            const flight = Math.round((r.impactOffset - r.chargeEnd) * 100) / 100;
            at(tRelease, caster.clone().lerp(target, 0.3), 'wide', `arrow|${seed % 2}|${flight}`, () => S.arrowRelease(52 + (seed % 2), flight), 0.55);
          }
          // Su patlaması, şimşek ve gök gürültüsü, sağanak: hepsi tek ses (linger boyunca)
          const linger = Math.round((r.totalDuration - r.impactOffset) * 100) / 100;
          at(tImpact, target, 'wide', `storm|${seed % 2}|${linger}`, () => S.stormImpact(53 + (seed % 2), linger), 0.85 * many);
          hitBody();
          break;
        }
        case 'shadow':
          if (first) {
            at(t0, caster, 'wide', `shadowC|${cd}`, () => S.shadowCharge(61, cd), 0.42);
            at(tRelease, caster, 'wide', `shadowL|${seed % 3}`, () => S.whoosh(62 + (seed % 3), 0.55, 250, 1600), 0.5);
          }
          at(tImpact, target, 'wide', `shadowI|${seed % 3}`, () => S.shadowImpact(63 + (seed % 3)), 0.8 * many);
          hitBody();
          break;
        case 'tree_fall': {
          // tree-fall.ts: kılıç dalgası chargeEnd − 0.53'te fırlar; ses bu andan başlayıp vuruşu, kırılmayı,
          // devrilmeyi, çarpmayı (impactOffset) ve sürüklenmeyi tek parça taşır
          const fall = Math.round((r.impactOffset - r.chargeEnd) * 100) / 100;
          at(filmT(a.start + r.chargeEnd - TREE_SOUND_LEAD), target, 'wide', `tree|${seed % 2}|${fall}`, () => S.treeFell(71 + (seed % 2), fall), 0.95);
          // Devrik gövde itilip sürüklendikçe toprakta sürtünme
          for (const p of a.treePushes ?? []) {
            const k = variant(p.time, 2);
            at(filmT(p.time), target, 'wide', `treeDrag|${k}`, () => S.whoosh(77 + k, 0.75, 90, 420, 0.7), 0.45);
          }
          break;
        }
        case 'whirl': {
          // Gösteri hortumu: Defne'nin içinde büyür, yanına süzülüp orada döner (yerinde; Doppler yok), sonda söner
          const c = Math.round(r.chargeEnd * 100) / 100;
          const i = Math.round(r.impactOffset * 100) / 100;
          const total = Math.round(r.totalDuration * 100) / 100;
          at(t0, target, 'wide', `whirl|${c}|${i}|${total}`, () => S.tornado(42, c, i, total, undefined, AUTO_HZ, true), 0.3);
          break;
        }
        case 'rock_rise': {
          // Güç toplama gümbürtüsü, kaya yükselişi (çatırtı → sürtünme → tepeye oturma), sonda kısık batış
          const lt = rockLiftTimes(r);
          const rise = Math.round((lt.riseEnd - lt.riseStart) * 100) / 100;
          const sink = Math.round((lt.sinkEnd - lt.sinkStart) * 100) / 100;
          at(t0, caster, 'wide', `earthC|${cd}`, () => S.earthCharge(21, cd), 0.25);
          at(filmT(a.start + lt.riseStart), target, 'wide', `rockUp|${rise}`, () => S.rockRise(24, rise), 0.35);
          at(filmT(a.start + lt.sinkStart), target, 'wide', `rockDown|${sink}`, () => S.rockRise(25, sink, true), 0.2);
          break;
        }
        case 'wave': {
          // Su toplama, sonra dalga: kabarma, akış (replik boyunca kısık), çöküş
          const wt = waveTimes(r);
          const rise = Math.round((wt.riseEnd - wt.riseStart) * 100) / 100;
          const hold = Math.round((wt.crashStart - wt.riseEnd) * 100) / 100;
          const crash = Math.round((wt.end - wt.crashStart) * 100) / 100;
          at(t0, caster, 'wide', `waterC|${cd}`, () => S.waterCharge(51, cd), 0.35);
          at(filmT(a.start + wt.riseStart), target, 'wide', `wave|${rise}|${hold}|${crash}`, () => S.waveSurge(55, rise, hold, crash), 0.38);
          break;
        }
        case 'tree_lift': {
          // Rüzgâr toplanır (dönüş), ağaç havalanırken yükselen uğultu; kütüğe oturunca tok gümleme ve şifa çınlaması
          const charge = Math.round(r.chargeEnd * 10) / 10;
          const lift = Math.round((r.impactOffset - r.chargeEnd) * 10) / 10;
          at(t0, caster, 'wide', `liftC|${charge}`, () => S.whoosh(75, charge + 0.4, 160, 900, 0.8), 0.4);
          at(tRelease, target, 'wide', `liftU|${lift}`, () => S.whoosh(76, lift + 0.3, 220, 1800, 0.9), 0.5);
          at(tImpact, target, 'wide', 'liftL', () => S.bodyLand(205), 0.55);
          at(tImpact + 0.08, target, 'wide', 'liftChime', () => S.chime(88), 0.3);
          break;
        }
      }
    }

    // --- Ekran yazıları
    if (cfg.ui) {
      for (const o of sc.overlays) {
        const t = sc.start + o.at;
        const k = variant(t, 3);
        if (o.type === 'comic_pop') add(`pop|${k}`, () => S.pop(80 + k), t + 0.05, 0.32);
        else if (o.type === 'title_card' || o.type === 'interstitial') {
          add(`swish|${k}`, () => S.whoosh(85 + k, 0.35, 1200, 5000, 1), t, 0.22);
          add('chime', () => S.chime(88), t + 0.2, 0.28);
        } else if (o.type === 'lower_third') add(`swish|${k}`, () => S.whoosh(85 + k, 0.35, 1200, 5000, 1), t, 0.2);
      }
    }
  });

  // --- Kamera geçişleri (iris, şeritler): geçişin ortasına denk gelen vuuş
  if (cfg.ui) {
    for (const tc of film.transitionCues) {
      const k = variant(tc.time, 3);
      add(`trans|${k}`, () => S.whoosh(90 + k, 0.6, 250, 2500, 1.2), tc.time - 0.4, 0.3);
    }
  }

  let last = performance.now();
  const get = async (key: string, make: Make) => {
    if (!cache.has(key) && performance.now() - last > 40) {
      await new Promise((r) => setTimeout(r, 0));
      last = performance.now();
    }
    return buffer(key, make);
  };
  const cues: SfxCue[] = [];
  for (const p of pending) cues.push({ ...p.cue, buffer: await get(p.key, p.make) });
  const ambience: AmbienceCue[] = [];
  for (const p of pendingAmb) ambience.push({ ...p.cue, buffer: await get(p.key, p.make) });
  cues.sort((a, b) => a.start - b.start);
  return { cues, ambience };
}
