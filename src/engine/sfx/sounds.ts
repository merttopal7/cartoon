/**
 * Yordamsal ses efektleri: hepsi koddan sentezlenir (indirilen dosya yok → telif sorunu yok).
 * Her üreteç tohuma bağlıdır; aynı tohum aynı sesi verir. Çıkış mono, tepe 1'e normalize; seviyeler
 * miksajda (cues.ts) ayarlanır.
 *
 * Katmanlar önce kendi başına RMS 1'e getirilir (rmsTex), sonra zarf ve ağırlıkla karıştırılır; böylece
 * farklı filtrelerden geçen gürültülerin oranı filtre bant genişliğine bağlı kalmaz.
 */
import { Biquad, OnePole, SR, TAU, brown, clamp01, drive, edgeFade, hit, lerp, mixInto, normalize, render, rng, samples, smooth } from './dsp';

/** Durağan bir dokuyu (filtrelenmiş gürültü vb.) RMS 1 olacak şekilde üretir. */
function rmsTex(dur: number, fn: (t: number, i: number) => number): Float32Array {
  const buf = render(dur, fn);
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  const rms = Math.sqrt(s / buf.length);
  if (rms > 1e-9) for (let i = 0; i < buf.length; i++) buf[i] /= rms;
  return buf;
}

/** Seyrek taneli çıtırtı (ateş, çakıl, kaya kırıntısı): tetiklenen kısa gürültü taneleri. */
function grains(r: () => number, dur: number, rate: (t: number) => number, tau: number, filter: Biquad): Float32Array {
  const k = Math.exp(-1 / (tau * SR));
  let env = 0;
  return render(dur, (t) => {
    if (r() < rate(t) / SR) env = Math.max(env, 0.35 + 0.65 * r());
    env *= k;
    return filter.process((r() * 2 - 1) * env);
  });
}

const white = (r: () => number) => () => r() * 2 - 1;
const finish = (buf: Float32Array, fadeOut = 0.02) => edgeFade(normalize(buf), 0.002, fadeOut);

// ---------------------------------------------------------------------------------------------------
// HAREKET
// ---------------------------------------------------------------------------------------------------

/**
 * Ayak sesi: yumuşak toprak/orman zemininde topuk + parmak ucu. Tok gövde öne çıkar; çakıl çıtırtısı hafif ve
 * kısık (yüksek frekanslı keskin tıkırtı uzun sahnelerde rahatsız ediyordu). Koşuda biraz daha kısa.
 */
export function step(seed: number, run = false): Float32Array {
  const r = rng(seed);
  const n = white(r);
  const dur = 0.2;
  const bp = new Biquad('bandpass', lerp(380, 760, r()), 0.7);
  const scuff = rmsTex(dur, () => bp.process(n()));
  const toe = lerp(0.022, 0.04, r());
  const grit = grains(r, dur, (t) => (t < 0.06 ? 90 : 0), 0.003, new Biquad('bandpass', 2400, 1.1));
  const thumpF = lerp(65, 90, r());
  const decay = run ? 0.022 : 0.03;
  const soft = new OnePole(3200);
  return finish(
    render(dur, (t, i) => {
      const e = hit(t, 0.004, decay) + 0.45 * hit(t - toe, 0.004, decay * 0.8);
      const x = scuff[i] * e * 0.55 + grit[i] * 0.22 + Math.sin(TAU * thumpF * t) * hit(t, 0.004, 0.035) * 0.6;
      return soft.process(x);
    }),
  );
}

/** Rüzgâr hışırtısı (whoosh): bant geçiren filtre frekansı yükselip iner. */
export function whoosh(seed: number, dur = 0.45, lo = 300, hi = 2200, q = 1.3): Float32Array {
  const r = rng(seed);
  const n = white(r);
  const bp = new Biquad('bandpass', lo, q);
  const peak = lerp(0.45, 0.6, r());
  return finish(
    render(dur, (t) => {
      const u = t / dur;
      const shape = u < peak ? (u / peak) ** 2 : (1 - (u - peak) / (1 - peak)) ** 1.6;
      bp.set(lo * (hi / lo) ** shape, q);
      return bp.process(n()) * shape;
    }),
    0.03,
  );
}

/** Darbe: savrulan karaktere isabet (yumruk benzeri tok vuruş + kumaş). */
export function bodyHit(seed: number): Float32Array {
  const r = rng(seed);
  const n = white(r);
  const dur = 0.32;
  const lp = new Biquad('lowpass', 1600);
  const thud = rmsTex(dur, () => lp.process(n()));
  const hp = new Biquad('highpass', 2200);
  const cloth = rmsTex(dur, () => hp.process(n()));
  let ph = 0;
  return finish(
    render(dur, (t, i) => {
      ph += (TAU * (70 + 90 * Math.exp(-t / 0.03))) / SR;
      const body = drive(Math.sin(ph) * hit(t, 0.002, 0.07) * 1.4, 2);
      return thud[i] * hit(t, 0.001, 0.022) * 0.45 + body * 0.8 + cloth[i] * hit(t, 0.004, 0.05) * 0.12;
    }),
  );
}

/** Yere düşüş: gövdenin toprağa inişi, küçük sekme ve toz. */
export function bodyLand(seed: number): Float32Array {
  const r = rng(seed);
  const n = white(r);
  const dur = 0.6;
  const lp = new Biquad('lowpass', 1100);
  const dirt = rmsTex(dur, () => lp.process(n()));
  const grit = grains(r, dur, (t) => (t < 0.18 ? 120 : 0), 0.004, new Biquad('highpass', 2400));
  const bounce = lerp(0.08, 0.12, r());
  let ph = 0;
  return finish(
    render(dur, (t, i) => {
      ph += (TAU * (45 + 45 * Math.exp(-t / 0.04))) / SR;
      const e = hit(t, 0.003, 0.1) + 0.35 * hit(t - bounce, 0.003, 0.07);
      return drive(Math.sin(ph) * e * 1.3, 2) * 0.8 + dirt[i] * (hit(t, 0.002, 0.07) + 0.3 * hit(t - bounce, 0.002, 0.05)) * 0.4 + grit[i] * 0.6;
    }),
    0.05,
  );
}

// ---------------------------------------------------------------------------------------------------
// ATEŞ
// ---------------------------------------------------------------------------------------------------

/** Ateş toplama: gittikçe büyüyen alev uğultusu ve çıtırtı. */
export function fireCharge(seed: number, dur: number): Float32Array {
  const r = rng(seed);
  const b = brown(r);
  const lp = new Biquad('lowpass', 300);
  const roar = rmsTex(dur, (t) => {
    lp.set(lerp(250, 900, t / dur));
    return lp.process(b());
  });
  const crackle = grains(r, dur, (t) => lerp(8, 70, t / dur), 0.0025, new Biquad('highpass', 1800));
  return finish(
    render(dur, (t, i) => {
      const u = smooth(t / dur);
      return roar[i] * (0.08 + 0.42 * u) + crackle[i] * (0.3 + 0.7 * u);
    }),
    0.08,
  );
}

/**
 * Alevin elden çıkışı: gaz tutuşması gibi keskin bir "fuuum". Gürültü yüksek frekanstan hızla iner (tutuşma),
 * alev gövdesinin tok rezonansı (~260 Hz) kabarır, türbülans titremesi (~23–37 Hz) ve kısa çıtırtılar eşlik eder;
 * sonda uçan alevin uzaklaşan uğultusu. (Eskisi genel bir "vuuş" ve alçak sinüs "güm"üydü.)
 */
export function fireLaunch(seed: number): Float32Array {
  const r = rng(seed);
  const n = white(r);
  const dur = 0.9;
  // Tutuşma: alçak geçiren 7 kHz'ten 700 Hz'e iner
  const sweep = new Biquad('lowpass', 7000, 0.8);
  const ignite = render(dur, (t) => {
    sweep.set(700 + 6300 * Math.exp(-t / 0.09), 0.8);
    return sweep.process(n());
  });
  // Alev gövdesi: dar bant gürültü (tok "fuum")
  const bodyBp = new Biquad('bandpass', 260, 1.4);
  const body = rmsTex(dur, () => bodyBp.process(n()));
  // Uzaklaşan uğultu: orta bant, merkez yavaşça iner
  const tailBp = new Biquad('bandpass', 900, 0.9);
  const tail = rmsTex(dur, (t) => {
    tailBp.set(1100 - 500 * (t / dur), 0.9);
    return tailBp.process(n());
  });
  const crackle = grains(r, dur, (t) => 140 * Math.exp(-t / 0.18), 0.002, new Biquad('highpass', 2600));
  const ph1 = r() * TAU;
  const ph2 = r() * TAU;
  return finish(
    render(dur, (t, i) => {
      const turb = 0.72 + 0.18 * Math.sin(TAU * 23 * t + ph1) + 0.1 * Math.sin(TAU * 37 * t + ph2);
      return (
        ignite[i] * hit(t, 0.006, 0.12) * 1.3 * turb +
        body[i] * hit(t - 0.01, 0.025, 0.2) * 0.55 * turb +
        tail[i] * hit(t - 0.08, 0.12, 0.35) * 0.22 +
        crackle[i] * 0.45
      );
    }),
    0.12,
  );
}

/** Ateş isabeti: patlama (alçak gümbürtü + yayılan gürültü), çıtırdayan alev kuyruğu. */
export function fireImpact(seed: number): Float32Array {
  const r = rng(seed);
  const n = white(r);
  const dur = 1.9;
  const lp = new Biquad('lowpass', 6000);
  const blast = render(dur, (t) => {
    lp.set(250 + 6000 * Math.exp(-t / 0.15));
    return lp.process(n());
  });
  const b = brown(r);
  const lp2 = new Biquad('lowpass', 500);
  const roar = rmsTex(dur, () => lp2.process(b()));
  const crackle = grains(r, dur, (t) => 60 * Math.exp(-t / 0.6), 0.002, new Biquad('highpass', 2000));
  let ph = 0;
  return finish(
    render(dur, (t, i) => {
      ph += (TAU * (38 + 60 * Math.exp(-t / 0.12))) / SR;
      const boom = drive(Math.sin(ph) * hit(t, 0.002, 0.3) * 1.5, 2.5);
      return boom * 0.9 + blast[i] * hit(t, 0.002, 0.22) * 1.6 + crackle[i] * 0.5 + roar[i] * hit(t, 0.05, 0.7) * 0.18;
    }),
    0.15,
  );
}

// ---------------------------------------------------------------------------------------------------
// TOPRAK
// ---------------------------------------------------------------------------------------------------

/** Toprak toplama: yerin altından yükselen gümbürtü, titreyen çakıllar. */
export function earthCharge(seed: number, dur: number): Float32Array {
  const r = rng(seed);
  const b = brown(r);
  const lp = new Biquad('lowpass', 140);
  const rumble = rmsTex(dur, () => lp.process(b()));
  const pebbles = grains(r, dur, (t) => lerp(3, 28, t / dur), 0.003, new Biquad('bandpass', 2500, 1.4));
  return finish(
    render(dur, (t, i) => {
      const u = smooth(t / dur);
      return rumble[i] * u * 0.45 + Math.sin(TAU * 42 * t + Math.sin(TAU * 3 * t)) * u * 0.35 + pebbles[i] * (0.2 + 0.6 * u);
    }),
    0.06,
  );
}

/** Yerden fırlayan tek kaya diken: çatırtı + tok vuruş + dökülen kırıntı. size 0..1 (büyüdükçe pes). */
export function earthSpike(seed: number, size = 0.5): Float32Array {
  const r = rng(seed);
  const n = white(r);
  const dur = 0.5;
  const bp = new Biquad('bandpass', lerp(2200, 1300, size), 1.2);
  const crack = rmsTex(dur, () => bp.process(n()));
  const b = brown(r);
  const lp = new Biquad('lowpass', 420);
  const grind = rmsTex(dur, () => lp.process(b()));
  const rubble = grains(r, dur, (t) => 80 * Math.exp(-t / 0.15), 0.003, new Biquad('bandpass', 3000, 1.2));
  const f = lerp(120, 75, size);
  let ph = 0;
  return finish(
    render(dur, (t, i) => {
      ph += (TAU * f * (1 + 0.6 * Math.exp(-t / 0.03))) / SR;
      const e = hit(t, 0.001, 0.012) + 0.6 * hit(t - 0.018, 0.001, 0.01) + 0.4 * hit(t - 0.035, 0.001, 0.014);
      return (
        crack[i] * e * 0.45 +
        drive(Math.sin(ph) * hit(t, 0.002, 0.06) * 1.3, 2) * lerp(0.55, 0.9, size) +
        grind[i] * hit(t, 0.005, 0.08) * 0.25 +
        rubble[i] * 0.45
      );
    }),
    0.05,
  );
}

/** Toprak isabeti: hedefin altında üç büyük diken, derin gümbürtü, dökülen moloz ve toz. */
export function earthImpact(seed: number): Float32Array {
  const r = rng(seed);
  const dur = 1.7;
  const lpN = new Biquad('lowpass', 1500);
  const n = white(r);
  const dust = rmsTex(dur, () => lpN.process(n()));
  const rubble = grains(r, dur, (t) => 55 * Math.exp(-t / 0.5), 0.003, new Biquad('bandpass', 2600, 1));
  let ph = 0;
  let out = render(dur, (t, i) => {
    ph += (TAU * (34 + 50 * Math.exp(-t / 0.1))) / SR;
    return drive(Math.sin(ph) * hit(t, 0.003, 0.35) * 1.5, 2.5) * 0.8 + rubble[i] * 0.5 + dust[i] * hit(t, 0.02, 0.5) * 0.08;
  });
  for (let k = 0; k < 3; k++) out = mixInto(out, earthSpike(seed + 11 * (k + 1), 1), k * 0.065, 0.85 - k * 0.15);
  return finish(out, 0.15);
}

/**
 * Toprak'ı kaldıran kaya sütunu (rise: yükselme süresi): ilk anda yerden kopan çatırtı, yükselirken taş sürtünmesi
 * ve gümbürtü, dökülen çakıl, tepeye oturunca tok bir vuruş. sink: kaya geri batarken daha kısık, yumuşak sürtünme.
 */
export function rockRise(seed: number, dur: number, sink = false): Float32Array {
  const r = rng(seed);
  const n = white(r);
  const b = brown(r);
  const total = dur + 0.6;
  const lp = new Biquad('lowpass', 240);
  const rumble = rmsTex(total, () => lp.process(b()));
  const bp = new Biquad('bandpass', 600, 0.9);
  const grind = rmsTex(total, (t, i) => {
    if (i % 16 === 0) bp.set(sink ? 700 - 300 * clamp01(t / dur) : 450 + 550 * clamp01(t / dur), 0.9);
    return bp.process(n());
  });
  const pebbles = grains(r, total, (t) => (t < dur ? (sink ? 14 : 38) : 38 * Math.exp(-(t - dur) / 0.25)), 0.003, new Biquad('bandpass', 2600, 1.2));
  let out = render(total, (t, i) => {
    const e = sink ? Math.sin(Math.PI * clamp01(t / dur)) : smooth(t / 0.06) * (1 - smooth((t - dur) / 0.3));
    const settle = sink ? 0 : drive(Math.sin(TAU * 58 * t) * hit(t - dur, 0.003, 0.16) * 1.4, 2) * 0.6;
    return rumble[i] * e * 0.45 + grind[i] * e * (sink ? 0.22 : 0.3) + pebbles[i] * 0.3 + settle;
  });
  if (!sink) out = mixInto(out, earthSpike(seed + 7, 0.9), 0, 0.75);
  return finish(out, 0.12);
}

// ---------------------------------------------------------------------------------------------------
// HAVA
// ---------------------------------------------------------------------------------------------------

/**
 * Hortum: yeteneğin tamamı boyunca uğuldayan, ıslık çalan rüzgâr. Güç toplarken büyür, uçuşta tam güç,
 * isabette sert bir esinti, sonra söner.
 *
 * pitch (isteğe bağlı, hz örnek/sn): Doppler perde çarpanı. Ses gürültüden sentezlendiği için perde, filtre
 * frekansları çarpılarak kaydırılır; zamanlama hiç değişmez (isabet esintisi yerinde kalır).
 */
export function tornado(
  seed: number,
  chargeEnd: number,
  impact: number,
  total: number,
  pitch?: Float32Array,
  pitchHz = 40,
  /** Gösteri hortumu: isabet esintisi yok; yerinde dönerken kısık sürer (replik duyulsun), son 1.2 sn'de söner */
  hold = false,
): Float32Array {
  const pitchAt = (t: number) => {
    if (!pitch) return 1;
    const k = t * pitchHz;
    const k0 = Math.min(pitch.length - 1, Math.floor(k));
    const k1 = Math.min(pitch.length - 1, k0 + 1);
    return pitch[k0] + (pitch[k1] - pitch[k0]) * (k - Math.floor(k));
  };
  const r = rng(seed);
  const n = white(r);
  const dur = total + 0.1;
  const ph1 = r() * TAU;
  const ph2 = r() * TAU;
  const bp1 = new Biquad('bandpass', 600, 5);
  const bp2 = new Biquad('bandpass', 1200, 6);
  let c1 = 600;
  let c2 = 1200;
  const level = (t: number) => {
    let e: number;
    if (t < chargeEnd) e = 0.7 * smooth(t / chargeEnd);
    else if (t < impact) e = 0.7 + 0.3 * smooth((t - chargeEnd) / Math.max(0.05, impact - chargeEnd));
    else if (hold) e = (0.3 + 0.7 * (1 - smooth((t - impact) / 0.8))) * (1 - smooth((t - (total - 1.2)) / 1.2));
    else e = 1 - smooth((t - impact) / Math.max(0.05, total - impact));
    return e;
  };
  const whistle = rmsTex(dur, (t, i) => {
    if (i % 16 === 0) {
      const e = level(t);
      const p = pitchAt(t);
      c1 = (420 + 260 * Math.sin(TAU * 0.9 * t + ph1) + 380 * e) * p;
      c2 = (1000 + 380 * Math.sin(TAU * 1.37 * t + ph2) + 500 * e) * p;
      bp1.set(c1, 5);
      bp2.set(c2, 6);
    }
    const x = n();
    return bp1.process(x) + 0.6 * bp2.process(x);
  });
  const b = brown(r);
  const lp = new Biquad('lowpass', 320);
  const roar = rmsTex(dur, (t, i) => {
    if (pitch && i % 16 === 0) lp.set(320 * pitchAt(t));
    return lp.process(b());
  });
  const hp = new Biquad('bandpass', 700, 0.7);
  const gust = rmsTex(dur, (t, i) => {
    if (pitch && i % 16 === 0) hp.set(700 * pitchAt(t), 0.7);
    return hp.process(n());
  });
  // Fırlatma: hortum Defne'den kopup çıkarken yükselen kalın bir "vuuş"
  const launch = whoosh(seed + 5, 0.55, 220, 1400, 1.1);
  const L0 = Math.round((chargeEnd - 0.08) * SR);
  return finish(
    render(dur, (t, i) => {
      const e = level(t);
      const j = i - L0;
      const ln = j >= 0 && j < launch.length ? launch[j] * 0.55 : 0;
      return whistle[i] * e * 0.35 + roar[i] * e * 0.35 + (hold ? 0 : gust[i] * hit(t - impact, 0.03, 0.3) * 0.45) + ln;
    }),
    0.1,
  );
}

// ---------------------------------------------------------------------------------------------------
// SU (Meşe'nin Sağanak Oku)
// rain.ts: toplarken bilekteki mavi oku saran dönen su parçacıkları; bırakınca ok dönerek uçar; isabette ok
// buluta yükselir, fırtına bulutu büyür, şimşek çakar ve hedefin üstüne sağanak yağar (son 0.55 sn söner).
// ---------------------------------------------------------------------------------------------------

/**
 * Sıvı çalkantısı: merkez frekansı rastgele hedefler arasında yumuşakça gezinen bant geçiren gürültü.
 * Akan/dönen su dokusu verir; sinüs kabarcıkların elektronik "bip" tınısı yoktur.
 */
function babble(r: () => number, dur: number, lo: number, hi: number, rate: number, q = 2.5): Float32Array {
  const n = white(r);
  const bp = new Biquad('bandpass', lo, q);
  const glide = new OnePole(rate * 1.5);
  let target = lo * (hi / lo) ** r();
  for (let k = 0; k < 4000; k++) glide.process(target);
  let next = 0;
  return rmsTex(dur, (t, i) => {
    if (t >= next) {
      target = lo * (hi / lo) ** r();
      next = t + (0.5 + r()) / rate;
    }
    const f = glide.process(target);
    if (i % 8 === 0) bp.set(f, q);
    return bp.process(n());
  });
}

/** Damlalar: üç bantta seyrek, çok kısa gürültü taneleri (yağmur, sıçrayan su). */
function droplets(r: () => number, dur: number, rate: (t: number) => number, bands = [1300, 2500, 4300]): Float32Array {
  const parts = bands.map((f) => grains(r, dur, (t) => rate(t) / bands.length, lerp(0.0011, 0.0022, r()), new Biquad('bandpass', f, 1.3)));
  return render(dur, (_, i) => parts.reduce((s, p) => s + p[i], 0));
}

/** Su toplama: oku saran, dönen ve çalkalanan su; uca doğru ince su parıltıları. */
export function waterCharge(seed: number, dur: number): Float32Array {
  const r = rng(seed);
  const n = white(r);
  const swirl = babble(r, dur, 500, 2400, 14);
  const ph = r() * TAU;
  const bp = new Biquad('bandpass', 1000, 1.2);
  const whirl = rmsTex(dur, (t, i) => {
    if (i % 8 === 0) bp.set(900 + 600 * Math.sin(TAU * 0.9 * t + ph), 1.2);
    return bp.process(n());
  });
  const sparkle = grains(r, dur, (t) => lerp(4, 30, t / dur), 0.0015, new Biquad('bandpass', 6500, 2));
  return finish(
    render(dur, (t, i) => {
      const u = smooth(t / dur);
      const sw = 0.75 + 0.25 * Math.sin(TAU * 0.9 * t + ph);
      return (swirl[i] * 0.3 + whirl[i] * 0.22 * sw) * (0.15 + 0.85 * u) + sparkle[i] * 0.25 * u;
    }),
    0.08,
  );
}

/**
 * Meşe'nin dalgası: su kütlesi kabarıp yükselir (frekansı yükselen gürül), tepede akarken çalkantı, köpük
 * hışırtısı ve kopan damlalar; çöküşte yere vuran su, yoğun sıçrama. Zamanlar showcase.ts:waveTimes ile aynı.
 */
export function waveSurge(seed: number, rise: number, hold: number, crash: number): Float32Array {
  const r = rng(seed);
  const n = white(r);
  const tCrash = rise + hold;
  const tHit = tCrash + crash * 0.5;
  const dur = tCrash + crash + 0.6;
  const bp = new Biquad('bandpass', 260, 0.8);
  const surge = rmsTex(dur, (t, i) => {
    if (i % 16 === 0) bp.set(240 + 800 * smooth(t / rise), 0.8);
    return bp.process(n());
  });
  const churn = babble(r, dur, 300, 1500, 8);
  const hp = new Biquad('highpass', 1800);
  const lpF = new Biquad('lowpass', 7000);
  const foam = rmsTex(dur, () => lpF.process(hp.process(n())));
  const drops = droplets(r, dur, (t) => (t < tHit ? 25 + 45 * smooth(t / rise) : 1000 * Math.exp(-(t - tHit) / 0.25) + 30));
  const lpC = new Biquad('lowpass', 1100);
  const crashN = rmsTex(dur, () => lpC.process(n()));
  return finish(
    render(dur, (t, i) => {
      const body = t < tCrash ? smooth(t / rise) : 1 - smooth((t - tCrash) / (crash + 0.4));
      const swell = 0.8 + 0.2 * Math.sin(TAU * 0.35 * t);
      // Tepede akarken kısılır: Meşe'nin repliği bu sırada
      const surging = t < rise ? 1 : 0.22 + 0.78 * Math.exp(-(t - rise) / 0.5);
      const slam = hit(t - tHit, 0.03, 0.45);
      return (
        surge[i] * body * surging * swell * 0.4 +
        churn[i] * body * (t < rise ? 0.18 : 0.08) +
        foam[i] * body * swell * 0.05 +
        drops[i] * 0.3 +
        crashN[i] * slam * 0.75 +
        foam[i] * slam * 0.22
      );
    }),
    0.2,
  );
}

/**
 * Ok bırakılışı ve uçuş: kiriş çatlaması (kısa, sönümlü), sonra isabete kadar dönen okun ıslığı ve su
 * serpintisi. Ok sn'de ~2.9 tur döndüğü için ıslık o hızda dalgalanır.
 */
export function arrowRelease(seed: number, flight = 0.63): Float32Array {
  const r = rng(seed);
  const n = white(r);
  const dur = flight + 0.25;
  const bp = new Biquad('bandpass', 1600, 1.2);
  const snap = rmsTex(dur, () => bp.process(n()));
  // Kısa kiriş titreşimi (Karplus-Strong, hızlı sönüm: "boing" değil "tak")
  const f = lerp(170, 210, r());
  const N = Math.round(SR / f);
  const line = new Float32Array(N);
  for (let i = 0; i < N; i++) line[i] = r() * 2 - 1;
  let p = 0;
  const string = normalize(
    render(dur, (t) => {
      const a = line[p];
      line[p] = 0.5 * (a + line[(p + 1) % N]) * 0.93;
      p = (p + 1) % N;
      return a * hit(t, 0.0005, 0.05);
    }),
  );
  const bp2 = new Biquad('bandpass', 2500, 2.5);
  const air = rmsTex(dur, (t, i) => {
    if (i % 8 === 0) bp2.set(lerp(3200, 1800, clamp01(t / flight)), 2.5);
    return bp2.process(n());
  });
  const spray = grains(r, dur, (t) => (t < flight ? 220 : 0), 0.0012, new Biquad('highpass', 3500));
  let ph = 0;
  return finish(
    render(dur, (t, i) => {
      ph += (TAU * lerp(190, 120, clamp01(t / 0.04))) / SR;
      const fly = smooth(t / 0.05) * (1 - smooth((t - flight) / 0.12));
      const flutter = 0.65 + 0.35 * Math.sin(TAU * 2.9 * t);
      return (
        snap[i] * hit(t, 0.0005, 0.007) * 0.6 +
        Math.sin(ph) * hit(t, 0.001, 0.025) * 0.5 +
        string[i] * 0.25 +
        air[i] * fly * flutter * 0.28 +
        spray[i] * fly * 0.3
      );
    }),
    0.05,
  );
}

/**
 * Sağanak Oku isabeti (tek ses, linger boyunca): su patlaması ve sıçrayan damlalar, buluta yükselen ok,
 * şimşek çatırtısı ve yuvarlanan gök gürültüsü, ardından yoğun sağanak (görüntüyle birlikte son 0.55 sn söner).
 */
export function stormImpact(seed: number, linger: number): Float32Array {
  const r = rng(seed);
  const n = white(r);
  const dur = linger + 0.4;
  // 1) Su patlaması: parlak başlayıp hızla kararan gürültü + yoğun damla saçılması
  const lp = new Biquad('lowpass', 8000);
  const burst = rmsTex(dur, (t) => {
    lp.set(900 + 7000 * Math.exp(-t / 0.06));
    return lp.process(n());
  });
  const splash = droplets(r, dur, (t) => 1500 * Math.exp(-t / 0.07));
  // 2) Buluta yükselen ok (0 – 0.22 sn)
  const bpR = new Biquad('bandpass', 600, 1.5);
  const rise = rmsTex(dur, (t, i) => {
    if (i % 8 === 0) bpR.set(600 * (2500 / 600) ** clamp01(t / 0.22), 1.5);
    return bpR.process(n());
  });
  // 3) Şimşek: kuru çatırtı, sonra düzensiz yuvarlanan alçak gürleme (iki dalga)
  const crack = grains(r, dur, (t) => (t > 0.01 && t < 0.13 ? 2500 : 0), 0.0008, new Biquad('highpass', 400));
  const b = brown(r);
  const lpT = new Biquad('lowpass', 220);
  const rumble = rmsTex(dur, () => lpT.process(b()));
  const roll = new OnePole(4);
  // 4) Sağanak: geniş bantlı hışırtı + yoğun damlalar
  const hp = new Biquad('highpass', 900);
  const lp2 = new Biquad('lowpass', 7000);
  const hiss = rmsTex(dur, () => lp2.process(hp.process(n())));
  const rain = droplets(r, dur, () => 420);
  return finish(
    render(dur, (t, i) => {
      const rainEnv = smooth((t - 0.1) / 0.35) * (1 - smooth((t - (linger - 0.55)) / 0.55));
      const rolling = Math.min(1.6, 0.5 + 4 * Math.abs(roll.process(r() * 2 - 1)));
      const thunder = rumble[i] * (hit(t - 0.02, 0.06, 0.55) + 0.5 * hit(t - 0.45, 0.1, 0.5)) * rolling;
      return (
        burst[i] * hit(t, 0.002, 0.09) * 0.9 +
        splash[i] * 1.2 +
        rise[i] * Math.sin(Math.PI * clamp01(t / 0.24)) * 0.15 +
        crack[i] * 1.3 +
        thunder * 0.6 +
        (hiss[i] * 0.07 + rain[i] * 0.3) * rainEnv
      );
    }),
    0.1,
  );
}

// ---------------------------------------------------------------------------------------------------
// GÖLGE (elementsiz eski yetenekler)
// ---------------------------------------------------------------------------------------------------

export function shadowCharge(seed: number, dur: number): Float32Array {
  const r = rng(seed);
  const n = white(r);
  const lp = new Biquad('lowpass', 400);
  const bp = new Biquad('bandpass', 400, 1);
  const swell = rmsTex(dur, (t) => {
    bp.set(lerp(200, 1200, t / dur), 1);
    return bp.process(n());
  });
  const det = [55, 55.7, 82.4];
  return finish(
    render(dur, (t, i) => {
      const u = smooth(t / dur);
      let saw = 0;
      for (const f of det) for (let h = 1; h <= 6; h++) saw += Math.sin(TAU * f * h * t) / h;
      return lp.process(saw * 0.3) * u + swell[i] * u * u * 0.25;
    }),
    0.06,
  );
}

export function shadowImpact(seed: number): Float32Array {
  const dur = 0.9;
  let ph = 0;
  const base = render(dur, (t) => {
    ph += (TAU * (40 + 50 * Math.exp(-t / 0.08))) / SR;
    return drive(Math.sin(ph) * hit(t, 0.003, 0.25) * 1.4, 2.2);
  });
  return finish(mixInto(base, whoosh(seed, 0.5, 1800, 250, 1.2), 0, 0.5), 0.1);
}

// ---------------------------------------------------------------------------------------------------
// AĞAÇ (Karabey'in Ağaç Devirme yeteneği)
// ---------------------------------------------------------------------------------------------------

/** Ahşap gövde rezonansları: düşük Q (çabuk söner, ksilofon gibi çınlamaz). */
function woodBank(r: () => number, freqs: number[], q: number) {
  const bank = freqs.map((f) => new Biquad('bandpass', f * lerp(0.92, 1.08, r()), q));
  return (x: number) => bank.reduce((s, b, k) => s + b.process(x) / (k + 1), 0);
}

/** Çatırtı dizisi: verilen anlarda kısa gürültü darbeleri, ahşap rezonansından geçer (kırılan lif, kopan dal). */
function crackTrain(r: () => number, dur: number, events: { t: number; a: number }[], body: (x: number) => number): Float32Array {
  const ex = new Float32Array(samples(dur));
  for (const e of events) {
    const off = Math.round(e.t * SR);
    const len = samples(lerp(0.002, 0.005, r()));
    for (let j = 0; j < len && off + j < ex.length; j++) ex[off + j] += (r() * 2 - 1) * e.a * Math.exp(-j / (len * 0.35));
  }
  return normalize(render(dur, (_, i) => body(ex[i])));
}

/**
 * Ağaç devirme, tek ses (tree-fall.ts anları; 0 = kılıç dalgasının fırladığı an):
 *   0.00  kılıç dalgası: keskin hışırtı
 *   0.26  dalga gövdeye çarpar: tok ahşap vuruşu; kesik akkor olur → ateş cızırtısı
 *   0.26–0.53  gövde titrer: sıklaşan çatırtılar; 0.53'te kırılma
 *   0.53–çarpma  ağaç hızlanarak devrilir: dalların havayı yarması, yaprak hışırtısı
 *   çarpma  ağır gümleme, kırılan dallar, 0.33 sn sonra sekme; yapraklar yatışır
 *   çarpma–2.08  ağaç yerde sürüklenerek durur: sürtünme
 */
export function treeFell(seed: number, fall: number): Float32Array {
  const r = rng(seed);
  const n = white(r);
  const HIT = 0.26;
  const BREAK = 0.53;
  const IMPACT = BREAK + fall;
  const SLIDE_START = 0.63;
  const SLIDE_END = 2.08;
  const dur = IMPACT + 1.7;

  // Vuruş: geniş bantlı darbe ahşap gövdeden geçer + kısa alçak tokluk
  const knockBody = woodBank(r, [170, 330, 600, 1050], 4);
  const knock = crackTrain(r, dur, [{ t: HIT, a: 1 }, { t: HIT + 0.004, a: 0.6 }], knockBody);
  // Yanan kesik: ateş çıtırtısı + ince cızırtı
  const sizzle = grains(r, dur, (t) => (t > HIT && t < BREAK + 0.7 ? 90 : 0), 0.0018, new Biquad('highpass', 2500));
  const hhp = new Biquad('highpass', 4000);
  const hiss = rmsTex(dur, () => hhp.process(n()));
  // Kırılma: vuruştan sonra sıklaşan lif çatırtıları, 0.53'te büyük çatlama, devrilmenin başında seyrelerek sürer
  const fibres: { t: number; a: number }[] = [];
  for (let t = HIT + 0.05; t < BREAK; t += 1 / lerp(8, 60, (t - HIT) / (BREAK - HIT)) * lerp(0.6, 1.4, r())) fibres.push({ t, a: lerp(0.2, 0.6, r()) });
  fibres.push({ t: BREAK, a: 1.6 }, { t: BREAK + 0.012, a: 1.1 }, { t: BREAK + 0.03, a: 0.8 });
  for (let t = BREAK + 0.05; t < BREAK + 0.4; t += 1 / lerp(40, 6, (t - BREAK) / 0.4) * lerp(0.6, 1.4, r())) fibres.push({ t, a: lerp(0.15, 0.5, r()) });
  const cracks = crackTrain(r, dur, fibres, woodBank(r, [650, 1250, 2300], 3));
  // Devrilme: hızlanan gövdenin yarattığı hava akımı ve dal/yaprak hışırtısı (hız ∝ u^0.85)
  const bpF = new Biquad('bandpass', 400, 0.9);
  const air = rmsTex(dur, (t, i) => {
    if (i % 8 === 0) bpF.set(350 + 900 * clamp01((t - BREAK) / fall), 0.9);
    return bpF.process(n());
  });
  const lhp = new Biquad('highpass', 3000);
  const leaves = rmsTex(dur, () => lhp.process(n()));
  const rustle = new OnePole(8);
  // Çarpma: alçak geçiren gürültü gümlemesi + kısa alçak sinüs, kopan dallar
  const lpI = new Biquad('lowpass', 500);
  const thud = rmsTex(dur, () => lpI.process(n()));
  const snapsEv = Array.from({ length: 18 }, () => ({ t: IMPACT + 0.45 * r() ** 1.6, a: lerp(0.3, 1, r()) }));
  const snaps = crackTrain(r, dur, snapsEv, woodBank(r, [900, 1800, 3200], 2.5));
  // Sürüklenme: pürüzlü sürtünme, ağaç yavaşladıkça söner
  const lpS = new Biquad('lowpass', 900);
  const scrape = rmsTex(dur, () => lpS.process(n()));
  const grit = grains(r, dur, () => 140, 0.003, new Biquad('bandpass', 1800, 1));
  const whoosh0 = whoosh(seed + 1, 0.32, 900, 4200, 1.6);
  const BOUNCE = 0.33;

  let ph = 0;
  let ph2 = 0;
  const out = render(dur, (t, i) => {
    const u = clamp01((t - BREAK) / fall);
    const falling = t > BREAK && t < IMPACT ? Math.pow(u, 0.85) : t >= IMPACT ? Math.exp(-(t - IMPACT) / 0.05) : 0;
    const di = t - IMPACT;
    ph += (TAU * (40 + 25 * Math.exp(-Math.max(0, di) / 0.05))) / SR;
    ph2 += (TAU * lerp(120, 70, clamp01((t - HIT) / 0.05))) / SR;
    const burn = t > HIT ? smooth((t - HIT) / 0.05) * (1 - smooth((t - BREAK - 0.3) / 0.4)) : 0;
    const slideX = clamp01((t - SLIDE_START) / (SLIDE_END - SLIDE_START));
    const slideAmp = di > 0 ? Math.pow(1 - slideX, 1.35) * smooth(di / 0.06) : 0;
    const rs = 0.5 + 3 * Math.abs(rustle.process(r() * 2 - 1));
    return (
      knock[i] * 1.0 +
      Math.sin(ph2) * hit(t - HIT, 0.002, 0.05) * 0.5 +
      (sizzle[i] * 0.25 + hiss[i] * 0.04) * burn +
      cracks[i] * 0.85 +
      (air[i] * 0.2 + leaves[i] * 0.08 * rs) * falling +
      thud[i] * (hit(di, 0.003, 0.12) + 0.35 * hit(di - BOUNCE, 0.003, 0.08)) * 1.0 +
      drive(Math.sin(ph) * (hit(di, 0.003, 0.18) + 0.3 * hit(di - BOUNCE, 0.003, 0.1)) * 1.4, 2) * 0.9 +
      snaps[i] * 0.9 +
      leaves[i] * rs * hit(di, 0.01, 0.7) * 0.18 +
      (scrape[i] * 0.25 + grit[i] * 0.6) * slideAmp
    );
  });
  return finish(mixInto(out, whoosh0, 0, 0.5), 0.2);
}

// ---------------------------------------------------------------------------------------------------
// EKRAN (yazılar, geçişler)
// ---------------------------------------------------------------------------------------------------

/** Çizgi film "pop": yükselen kısa tını + tık. Çizgi roman balonları için. */
export function pop(seed: number): Float32Array {
  const r = rng(seed);
  const n = white(r);
  const dur = 0.2;
  const f0 = lerp(300, 380, r());
  const hp = new Biquad('highpass', 3000);
  let ph = 0;
  return finish(
    render(dur, (t) => {
      ph += (TAU * f0 * 3 ** Math.min(1, t / 0.07)) / SR;
      return Math.sin(ph) * hit(t, 0.002, 0.045) + hp.process(n()) * hit(t, 0.0005, 0.004) * 0.3;
    }),
  );
}

/** Başlık kartı zili: iki notalı çan (glockenspiel kısmi sesleri). */
export function chime(seed: number): Float32Array {
  const r = rng(seed);
  const dur = 2.2;
  const notes = [
    { at: 0, f: 1046.5 },
    { at: lerp(0.11, 0.14, r()), f: 1568 },
  ];
  const partials = [
    { k: 1, d: 0.9, a: 1 },
    { k: 2.76, d: 0.35, a: 0.4 },
    { k: 5.4, d: 0.15, a: 0.2 },
  ];
  return finish(
    render(dur, (t) => {
      let s = 0;
      for (const nt of notes) {
        const u = t - nt.at;
        if (u < 0) continue;
        for (const p of partials) s += Math.sin(TAU * nt.f * p.k * u) * p.a * hit(u, 0.002, p.d);
      }
      return s;
    }),
    0.1,
  );
}

// ---------------------------------------------------------------------------------------------------
// ORTAM
// ---------------------------------------------------------------------------------------------------

export type AmbiencePreset = 'day' | 'sunset' | 'night';

/** Kuş ötüşü: üç tür (cıvıltı dizisi, ıslık, tril). Doğrudan stereo tampona yazılır. */
function bird(r: () => number, L: Float32Array, R: Float32Array, at: number, amp: number, pan: number) {
  const kind = r();
  const gl = amp * Math.cos(((pan + 1) * Math.PI) / 4);
  const gr = amp * Math.sin(((pan + 1) * Math.PI) / 4);
  const notes: { at: number; dur: number; f0: number; f1: number; vib: number }[] = [];
  if (kind < 0.5) {
    const count = 3 + Math.floor(r() * 4);
    const base = lerp(2800, 4200, r());
    for (let k = 0; k < count; k++) notes.push({ at: at + k * lerp(0.1, 0.14, r()), dur: 0.05, f0: base * 1.15, f1: base * 0.85, vib: 0 });
  } else if (kind < 0.8) {
    const base = lerp(1900, 2600, r());
    notes.push({ at, dur: 0.24, f0: base, f1: base * 1.18, vib: 6 });
    notes.push({ at: at + 0.32, dur: 0.3, f0: base * 1.18, f1: base * 0.92, vib: 6 });
  } else {
    const base = lerp(4000, 5200, r());
    for (let k = 0; k < 14; k++) notes.push({ at: at + k * 0.028, dur: 0.02, f0: base, f1: base * 0.97, vib: 0 });
  }
  for (const nt of notes) {
    const off = Math.round(nt.at * SR);
    const len = samples(nt.dur);
    let ph = 0;
    for (let j = 0; j < len && off + j < L.length; j++) {
      const u = j / len;
      const f = lerp(nt.f0, nt.f1, u) * (1 + 0.02 * Math.sin(TAU * nt.vib * (j / SR)));
      ph += (TAU * f) / SR;
      const e = Math.sin(Math.PI * u) ** 2;
      const s = Math.sin(ph) * e;
      L[off + j] += s * gl;
      R[off + j] += s * gr;
    }
  }
}

/** Cırcır böceği: ~4.4 kHz kısa vuruş üçlüleri, düzenli aralıklarla. */
function cricket(r: () => number, L: Float32Array, R: Float32Array, amp: number, pan: number) {
  const gl = amp * Math.cos(((pan + 1) * Math.PI) / 4);
  const gr = amp * Math.sin(((pan + 1) * Math.PI) / 4);
  const f = lerp(4100, 4700, r());
  const period = lerp(0.55, 0.9, r());
  for (let at = r() * period; at < L.length / SR; at += period * lerp(0.95, 1.05, r())) {
    for (let k = 0; k < 3; k++) {
      const off = Math.round((at + k * 0.033) * SR);
      const len = samples(0.016);
      for (let j = 0; j < len && off + j < L.length; j++) {
        const s = Math.sin((TAU * f * j) / SR) * Math.sin((Math.PI * j) / len);
        L[off + j] += s * gl;
        R[off + j] += s * gr;
      }
    }
  }
}

/**
 * Yavaş değişen tohumlu değer gürültüsü (0..1): hz sıklıkta rastgele düğümler, kosinüsle yumuşak geçiş.
 * Rüzgârın esinti zarfı için birkaç oktavı toplanır.
 */
function valueNoise(r: () => number, hz: number, dur: number): (t: number) => number {
  const knots = Array.from({ length: Math.ceil(dur * hz) + 2 }, () => r());
  return (t) => {
    const x = t * hz;
    const i = Math.floor(x);
    const k = (1 - Math.cos(Math.PI * (x - i))) / 2;
    return lerp(knots[i], knots[i + 1], k);
  };
}

/**
 * Gerçekçi rüzgâr (mono kanal): esinti zarfı (0.07/0.19/0.5 Hz değer gürültüsü) her şeyi sürer.
 * - gövde: yumuşatılmış beyaz gürültü, merkezi esintiyle 350 → 1450 Hz kayan bant geçiren ("vuuuş" kabarması)
 * - ıslık: dar bant (Q 12), yalnızca sert esintilerde, frekansı yavaşça kayar (güçlü rüzgârda)
 * - yaprak hışırtısı: 2.5–5 kHz sürekli doku, esintiyle kabarır (ağaçlar esintide hışırdar)
 * wind: 0 = rüzgâr kapalı sahne (hafif esinti), 0.5 = varsayılan, 1 = sert.
 */
function windLayer(r: () => number, dur: number, wind: number): Float32Array {
  const g1 = valueNoise(r, 0.07, dur);
  const g2 = valueNoise(r, 0.19, dur);
  const g3 = valueNoise(r, 0.5, dur);
  const strength = 0.4 + 1.2 * wind;
  // Esinti zarfı kontrol hızında (32 örnekte bir) önceden hesaplanır; her örnekte üç kosinüs pahalıydı
  const CTRL = 32;
  const env = new Float32Array(Math.ceil((dur * SR) / CTRL) + 2);
  for (let k = 0; k < env.length; k++) {
    const t = (k * CTRL) / SR;
    // Esinti ancak yavaş gürültü ortalamasını belirgin aşınca eser: zamanın yaklaşık yarısı sakin, esintiler birkaç
    // saniyede kabarıp söner (eşik ortalamanın altındayken rüzgâr hiç dinmiyor, sürekli uğulduyordu)
    const v = 0.55 * g1(t) + 0.3 * g2(t) + 0.15 * g3(t);
    env[k] = clamp01(smooth((v - 0.45) / 0.22) * strength);
  }
  const gust = (t: number) => {
    const x = (t * SR) / CTRL;
    const k = Math.floor(x);
    return env[k] + (env[k + 1] - env[k]) * (x - k);
  };
  const n = white(r);
  // Gövde: yumuşatılmış beyaz gürültü, merkezi esintiyle 350 → 1450 Hz kayan bant. Kahverengi gürültü ve ayrı alçak
  // uğultu katmanı yok: enerjileri 30 Hz altında toplanıp arka planda sürekli uğultu/basınç gibi duyuluyordu
  const soft = new OnePole(2500);
  const bodyBp = new Biquad('bandpass', 400, 0.9);
  let gNow = 0;
  const body = rmsTex(dur, (t, i) => {
    if (i % 32 === 0) {
      gNow = gust(t);
      bodyBp.set(350 + 1100 * Math.pow(gNow, 1.3), 0.9);
    }
    return bodyBp.process(soft.process(n()));
  });
  const drift = valueNoise(r, 0.11, dur);
  const whistleBp = new Biquad('bandpass', 800, 12);
  const whistle = rmsTex(dur, (t, i) => {
    if (i % 32 === 0) whistleBp.set(620 + 380 * drift(t) + 220 * gust(t), 12);
    return whistleBp.process(n());
  });
  // Yaprak hışırtısı: tanesiz, sürekli gürültü dokusu (2.5–5 kHz); yaprakların titreşimi gibi hafif dalgalanır.
  // Tek tek taneler (taneli sentez) seyrekken film boyunca "çıtı çıtı" tıkırtı gibi duyuluyordu
  const leafBp = new Biquad('bandpass', 3600, 0.6);
  const flutterA = valueNoise(r, 7, dur);
  const flutterB = valueNoise(r, 13, dur);
  const leavesN = rmsTex(dur, (t) => leafBp.process(n()) * (0.7 + 0.2 * flutterA(t) + 0.1 * flutterB(t)));
  // Gerçek orman ortamında 200 Hz altında neredeyse ses yok: çıkış iki kat yüksek geçirenden (24 dB/oktav) geçer
  const hp1 = new Biquad('highpass', 200);
  const hp2 = new Biquad('highpass', 200);
  return render(dur, (t, i) => {
    const g = gust(t);
    const whistleAmt = wind > 0.3 ? 0.18 * smooth((g - 0.6) / 0.35) : 0;
    // Mutlak seviyeler (katmanlar RMS 1): tam esintide gövde ≈ −24 dBFS; sakin anda neredeyse sessiz
    const x = body[i] * Math.pow(g, 1.8) * 0.07 + whistle[i] * whistleAmt * 0.025 + leavesN[i] * (0.003 + 0.03 * g);
    return hp2.process(hp1.process(x));
  });
}

/**
 * Döngülü orman ortamı (stereo): gerçekçi rüzgâr (iki kanal ayrı tohumlu: geniş stereo), kuşlar (gece cırcır
 * böcekleri). Sonu başına çapraz geçişle bağlanır; döngü noktasında dikiş duyulmaz.
 */
export function ambience(
  seed: number,
  preset: AmbiencePreset,
  wind = 0,
  loop = 24,
  /** all: hepsi; base: kuşlar hariç (rüzgâr, gece cırcır böcekleri); birds: yalnızca kuşlar (senaryoda açılıp kapanır) */
  layer: 'all' | 'base' | 'birds' = 'all',
): [Float32Array, Float32Array] {
  const r = rng(seed);
  const xf = 3;
  const dur = loop + xf;
  const chan = (s: number) => (layer === 'birds' ? new Float32Array(samples(dur)) : windLayer(rng(s), dur, wind));
  const L = chan(seed * 7 + 1);
  const R = chan(seed * 7 + 2);
  if (preset === 'night') {
    if (layer !== 'birds') for (let k = 0; k < 4; k++) cricket(r, L, R, lerp(0.03, 0.07, r()), lerp(-0.8, 0.8, r()));
  } else if (layer !== 'base') {
    const rate = preset === 'day' ? 0.45 : 0.22;
    for (let t = 0.5; t < dur - 1; t += 0.1) {
      if (r() < rate * 0.1) bird(r, L, R, t, lerp(0.05, 0.16, r()), lerp(-0.9, 0.9, r()));
    }
  }
  // Döngü: [loop, loop+xf) aralığı başa eşit güçle karışır
  const n = samples(loop);
  const x = samples(xf);
  const out: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
  [L, R].forEach((src, c) => {
    out[c].set(src.subarray(0, n));
    for (let i = 0; i < x; i++) {
      const k = i / x;
      out[c][i] = src[i] * Math.sin((k * Math.PI) / 2) + src[n + i] * Math.cos((k * Math.PI) / 2);
    }
  });
  // Seviye mutlak (katman ağırlıklarından): tepeye göre ölçeklemek sakin sahneyi de rüzgârlı sahne kadar yükseltiyordu.
  // Yalnızca taşmaya karşı güvenlik
  let peak = 0;
  for (const ch of out) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  if (peak > 0.95) for (const ch of out) for (let i = 0; i < ch.length; i++) ch[i] *= 0.95 / peak;
  return out;
}
