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
import { SR } from './dsp';
import * as S from './sounds';

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
    let gain = mode === 'near' ? THREE.MathUtils.clamp(6 / d, 0.06, 1) : THREE.MathUtils.clamp(Math.sqrt(9 / d), 0.35, 1);
    let pan = THREE.MathUtils.clamp(x / (Math.max(z, 0.5) * l.tanHalf), -1, 1) * 0.6;
    if (z < 0) {
      gain *= 0.5;
      pan *= 0.5;
    }
    return { gain, pan };
  };
  let n = 0;
  const add = (key: string, make: () => Float32Array, start: number, gain: number, pan = 0) => {
    if (gain <= 0.005 || start >= film.duration) return;
    pending.push({ cue: { id: `sfx${n++}`, kind: key.split('|')[0], start: Math.max(0, start), gain: gain * cfg.volume, pan }, key, make });
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
      pendingAmb.push({
        cue: { start: sc.start, end: sc.start + sc.duration, gain: cfg.ambience * cfg.volume },
        key: `amb|${preset}`,
        make: () => S.ambience(7, preset),
      });
    }

    // --- Ayak sesleri ve düşüşler
    for (const [id, ch] of sc.characters) {
      for (const ev of ch.motionEvents()) {
        const t = filmT(ev.time);
        const pos = ch.positionAt(ev.time, new THREE.Vector3());
        if (ev.kind === 'step') {
          if (!cfg.footsteps) continue;
          const v = variant(t + id.length, 4);
          at(t, pos, 'near', `step|${ev.run ? 1 : 0}|${v}`, () => S.step(100 + v, ev.run), (ev.run ? 0.32 : 0.22) * ev.weight);
        } else {
          const v = variant(t, 2);
          at(t, pos, 'wide', `land|${v}`, () => S.bodyLand(200 + v), 0.6 * ev.weight);
        }
      }
    }

    // --- Yetenekler (çoklu hedefte güç toplama ve fırlatma bir kez, isabet her hedefte)
    for (const a of sc.abilities?.allUses() ?? []) {
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
          if (first) at(t0, caster.clone().lerp(target, 0.4), 'wide', `tornado|${c}|${i}|${total}`, () => S.tornado(41, c, i, total), 0.6);
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
