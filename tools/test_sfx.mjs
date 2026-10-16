// Ses efektleri testleri: sentezlenen seslerin sağlığı (NaN, taşma), zamanlamanın görüntüyle örtüşmesi
// (isabetler, diken dalgası, ayak basışları), dışa aktarım miksi; dinlemek için WAV dosyaları üretir.
// Kullanım: node tools/test_sfx.mjs [çıktı klasörü]   (dev sunucusu açık olmalı: http://localhost:5174)
//   Çıktı: sfx_galeri.wav (her ses sırayla), <senaryo>_kesit.wav (filmden miks kesiti)
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const URL = process.env.ENGINE_URL ?? 'http://localhost:5174/';
const BROWSER = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = process.argv[2];

const browser = await puppeteer.launch({ executablePath: BROWSER, headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'], protocolTimeout: 900000 });
try {
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__engine?.THREE, { timeout: 120000 });
  const results = await page.evaluate(async (wantWav) => {
    const { parseScenario } = await import('/src/schema.ts');
    const { buildFilm } = await import('/src/engine/film.ts');
    const { AssetLibrary } = await import('/src/engine/assets.ts');
    const { audioBufferToWav } = await import('/src/engine/audio.ts');
    const S = await import('/src/engine/sfx/sounds.ts');
    const out = [];
    const wavs = {};
    const check = (name, ok, detail = '') => out.push({ name, ok, detail });
    const lib = new AssetLibrary();
    const toB64 = async (blob) => {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    };
    const health = (data) => {
      let peak = 0;
      let bad = 0;
      for (const ch of data) for (let i = 0; i < ch.length; i++) {
        const v = ch[i];
        if (!Number.isFinite(v)) bad++;
        else peak = Math.max(peak, Math.abs(v));
      }
      return { peak, bad };
    };

    // 1) Galeri: her ses tek başına (sentez süresi, sağlık) ve dinlemek için art arda
    const gallery = [
      ['adım (yürüme)', () => S.step(1)], ['adım (koşu)', () => S.step(2, true)], ['darbe', () => S.bodyHit(3)], ['yere düşüş', () => S.bodyLand(4)],
      ['ateş: toplama', () => S.fireCharge(5, 2.1)], ['ateş: fırlatma', () => S.fireLaunch(6)], ['ateş: isabet', () => S.fireImpact(7)],
      ['toprak: toplama', () => S.earthCharge(8, 1.35)], ['toprak: diken', () => S.earthSpike(9, 0.5)], ['toprak: isabet', () => S.earthImpact(10)],
      ['hava: hortum', () => S.tornado(11, 2.25, 3.05, 4.35)],
      ['su: toplama', () => S.waterCharge(12, 2.15)], ['su: ok ve uçuş', () => S.arrowRelease(13, 0.63)], ['su: isabet, şimşek, sağanak', () => S.stormImpact(14, 1.9)],
      ['ağaç devirme', () => S.treeFell(16, 0.73)],
      ['pop', () => S.pop(19)], ['zil', () => S.chime(20)], ['geçiş', () => S.whoosh(21, 0.6, 250, 2500, 1.2)],
    ];
    const parts = [];
    let worst = { peak: 0, bad: 0 };
    let totalMs = 0;
    for (const [name, make] of gallery) {
      const t0 = performance.now();
      const buf = make();
      const ms = performance.now() - t0;
      totalMs += ms;
      const h = health([buf]);
      if (h.bad || h.peak > 1.0001) worst = { peak: Math.max(worst.peak, h.peak), bad: worst.bad + h.bad, name };
      parts.push(buf);
    }
    check('galeri sesleri sağlıklı (NaN yok, tepe ≤ 1)', worst.bad === 0 && worst.peak <= 1.0001, worst.name ?? '');
    check('galeri sentezi toplam 2 sn altında', totalMs < 2000, `${totalMs.toFixed(0)} ms`);
    const t0 = performance.now();
    const amb = S.ambience(7, 'day');
    const ambMs = performance.now() - t0;
    check('orman ortamı (24 sn stereo) 1.5 sn altında', ambMs < 1500 && health(amb).bad === 0, `${ambMs.toFixed(0)} ms`);
    // Döngü dikişi: son örnek ile ilk örnek arası sıçrama, sıradan örnek farkından büyük olmamalı
    const seam = Math.max(...amb.map((c) => Math.abs(c[0] - c[c.length - 1])));
    check('ortam döngüsünde dikiş yok', seam < 0.05, `sıçrama ${seam.toFixed(4)}`);
    if (wantWav) {
      const gap = Math.round(0.45 * 44100);
      const total = parts.reduce((s, p) => s + p.length + gap, 0) + 6 * 44100;
      const g = new AudioBuffer({ length: total, sampleRate: 44100, numberOfChannels: 2 });
      const L = g.getChannelData(0);
      const R = g.getChannelData(1);
      let off = 0;
      for (const p of parts) {
        for (let i = 0; i < p.length; i++) {
          L[off + i] = p[i] * 0.8;
          R[off + i] = p[i] * 0.8;
        }
        off += p.length + gap;
      }
      for (let i = 0; i < 6 * 44100; i++) {
        L[off + i] = amb[0][i] * 0.6;
        R[off + i] = amb[1][i] * 0.6;
      }
      wavs['sfx_galeri.wav'] = await toB64(audioBufferToWav(g));
      // Sağanak Oku ve Ağaç Devirme, yetenekteki gerçek anlarıyla (toplama → bırakış 2.15 → isabet 2.78; ağaç)
      const seq = [
        [0, S.waterCharge(51, 2.15), 0.4], [2.15, S.arrowRelease(52, 0.63), 0.55], [2.78, S.stormImpact(53, 1.9), 0.85],
        [6.0, S.treeFell(71, 0.73), 0.95],
      ];
      const len = Math.round(10.5 * 44100);
      const q = new AudioBuffer({ length: len, sampleRate: 44100, numberOfChannels: 2 });
      for (const [at, buf, gain] of seq) {
        const off = Math.round(at * 44100);
        for (const c of [0, 1]) {
          const ch = q.getChannelData(c);
          for (let i = 0; i < buf.length && off + i < len; i++) ch[off + i] += buf[i] * gain;
        }
      }
      wavs['sagnak_oku_ve_agac.wav'] = await toB64(audioBufferToWav(q));
    }

    // 2) Senaryolar
    const sections = { 'bolum-2-karabeyin-golgesi': [30, 52], 'test-dort-element': [17, 47], 'bolum-1-ormanin-bekcileri': [0, 24] };
    for (const id of Object.keys(sections)) {
      const p = parseScenario(await (await fetch(`scenarios/${id}.yaml`)).text());
      const tb = performance.now();
      const { film } = await buildFilm(p.scenario, lib);
      const buildMs = performance.now() - tb;
      const cues = film.audio.getSfxCues();
      const count = {};
      for (const c of cues) count[c.kind] = (count[c.kind] ?? 0) + 1;
      check(`${id}: efektler üretildi`, cues.length > 0, `${cues.length} efekt, derleme ${(buildMs / 1000).toFixed(1)} sn · ` + Object.entries(count).map(([k, v]) => `${k}:${v}`).join(' '));
      const uiKinds = ['pop', 'swish', 'chime', 'trans'].filter((k) => count[k]);
      check(`${id}: ekran (HUD) sesleri varsayılan kapalı`, uiKinds.length === 0, uiKinds.join(','));

      // İsabet sesleri görüntüdeki isabet anıyla aynı (hit-stop zamanı → gerçek zaman)
      const sc = film.scenes[0];
      const uses = sc.abilities?.allUses() ?? [];
      // Ağaç sesi tek parça: kılıç dalgasıyla başlar, çarpma sesin içinde (TREE_SOUND_LEAD + düşüş) sonra
      const { TREE_SOUND_LEAD } = await import('/src/engine/sfx/cues.ts');
      const impactKinds = { fire: 'fireI', earth: 'earthI', rain: 'storm', shadow: 'shadowI', tree_fall: 'tree' };
      let miss = [];
      for (const a of uses) {
        const kind = impactKinds[a.recipe.effectType];
        if (!kind) continue;
        const t = sc.start + a.start + a.recipe.impactOffset;
        const lead = kind === 'tree' ? TREE_SOUND_LEAD + Math.round((a.recipe.impactOffset - a.recipe.chargeEnd) * 100) / 100 : 0;
        if (!cues.some((c) => c.kind === kind && Math.abs(c.start + lead - t) < 0.006)) miss.push(`${a.name}@${t.toFixed(2)}`);
      }
      check(`${id}: isabet sesleri isabet anında`, miss.length === 0, miss.join(', '));

      // Ayak sesleri: yürüyen her karakterin adım aralığı makul (0.22–0.8 sn) ve gerçek ayak basışına yakın
      const steps = cues.filter((c) => c.kind === 'step').map((c) => c.start);
      if (steps.length) {
        const gaps = steps.slice(1).map((t, i) => t - steps[i]).filter((g) => g > 0.05);
        const med = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? 0;
        check(`${id}: adım aralığı`, med > 0.1 && med < 0.8, `${steps.length} adım, ortanca aralık ${med.toFixed(2)} sn (tüm karakterler birlikte)`);
      }

      // Ayak sesi basış karesinde: ses anında ayak inişini bitirmiş olmalı (eskiden ~50 ms erken çalıyordu)
      if (id === 'bolum-1-ormanin-bekcileri') {
        const { THREE } = window.__engine;
        const f = { id: 'youtube_16x9', width: 1920, height: 1080 };
        const ch = sc.characters.get('toprak');
        const legs = ch.rig.legs;
        const lowY = (t) => {
          film.evaluate(t, f);
          return Math.min(...legs.map((l) => {
            const w = l.foot.getWorldPosition(new THREE.Vector3());
            return w.y - (sc.clearance?.terrain?.heightAt(w.x, w.z) ?? 0);
          }));
        };
        const evs = ch.motionEvents().filter((e) => e.kind === 'step' && e.time > 2 && e.time < 15).slice(0, 10);
        let vel = 0;
        for (const e of evs) vel += (lowY(e.time + 0.01) - lowY(e.time - 0.01)) / 0.02;
        vel /= evs.length;
        check('ayak sesi basış karesinde (ayağın inişi bitmiş)', Math.abs(vel) < 0.35, `ortalama dikey hız ${vel.toFixed(2)} m/s, ${evs.length} adım`);
      }

      // Hortum hareket eder: uçuşta pan/kazanç değişir, Doppler perdesi kayar; perde kayması isabet esintisini kaydırmaz
      const tor = cues.find((c) => c.kind === 'tornado');
      if (tor) {
        const use = uses.find((a) => a.recipe.effectType === 'tornado');
        const r = use.recipe;
        const { hz, gain, pan, rate } = tor.auto;
        const k0 = Math.round(r.chargeEnd * hz);
        const k1 = Math.round(r.impactOffset * hz);
        const span = (arr) => Math.max(...arr.slice(k0, k1 + 1)) - Math.min(...arr.slice(k0, k1 + 1));
        const rs = rate.slice(k0, k1);
        const semis = (x) => 12 * Math.log2(x);
        check(
          `${id}: hortum sesi hortumla hareket eder (Doppler)`,
          span(pan) > 0.05 && Math.max(...rs.map((x) => Math.abs(semis(x)))) > 1,
          `uçuşta pan ${Math.min(...pan.slice(k0, k1)).toFixed(2)}…${Math.max(...pan.slice(k0, k1)).toFixed(2)}, kazanç ${Math.min(...gain.slice(k0, k1)).toFixed(2)}…${Math.max(...gain.slice(k0, k1)).toFixed(2)}, perde ${semis(Math.min(...rs)).toFixed(1)}…${semis(Math.max(...rs)).toFixed(1)} yarım ton`,
        );
        // Senkron: isabet esintisinin zarf tepesi Doppler'li ve Doppler'siz seste aynı yerde
        const plain = S.tornado(41, Math.round(r.chargeEnd * 100) / 100, Math.round(r.impactOffset * 100) / 100, Math.round(r.totalDuration * 100) / 100);
        const moved = tor.buffer.getChannelData(0);
        const peakNear = (buf) => {
          const w = 441;
          let best = 0;
          let at = 0;
          for (let s = Math.round((r.impactOffset - 0.15) * 44100); s < (r.impactOffset + 0.3) * 44100; s += w) {
            let e = 0;
            for (let i = s; i < s + w; i++) e += buf[i] * buf[i];
            if (e > best) {
              best = e;
              at = s / 44100;
            }
          }
          return at;
        };
        const dt = Math.abs(peakNear(plain) - peakNear(moved));
        check(`${id}: Doppler isabet senkronunu bozmaz`, dt <= 0.021, `fark ${(dt * 1000).toFixed(0)} ms`);
      }

      // Önizleme (canlı oynatma): oynatırken efektler önceden zamanlanır, atlamada (seek) sıfırlanır
      if (id === 'bolum-2-karabeyin-golgesi') {
        const a = film.audio;
        const target = cues.find((c) => c.kind === 'fireI');
        for (let t = target.start - 0.5; t < target.start + 0.1; t += 1 / 30) a.update(t, true);
        const played = a.sfxPlayed.has(target.id);
        a.update(5, true); // atlama
        const reset = !a.sfxPlayed.has(target.id);
        a.update(5, false);
        check('önizlemede efekt çalar, atlamada sıfırlanır', played && reset, `çaldı ${played}, sıfırlandı ${reset}`);
      }

      // Dışa aktarım miksi: efektler + ortam + konuşma + müzik
      const tm = performance.now();
      const mix = await film.audio.renderMasterAudio(film.duration, 44100);
      const mixMs = performance.now() - tm;
      const h = health([mix.getChannelData(0), mix.getChannelData(1)]);
      check(`${id}: miks sağlıklı`, h.bad === 0 && h.peak < 1.2, `tepe ${h.peak.toFixed(2)}, ${(mixMs / 1000).toFixed(1)} sn`);
      if (wantWav) {
        const [a, b] = sections[id];
        const n = Math.round((b - a) * 44100);
        const cut = new AudioBuffer({ length: n, sampleRate: 44100, numberOfChannels: 2 });
        for (const c of [0, 1]) cut.copyToChannel(mix.getChannelData(c).subarray(Math.round(a * 44100), Math.round(a * 44100) + n), c);
        wavs[`${id}_kesit_${a}-${b}sn.wav`] = await toB64(audioBufferToWav(cut));
      }
      film.dispose();
    }
    return { out, wavs };
  }, Boolean(OUT));
  let failed = 0;
  for (const r of results.out) {
    console.log(`${r.ok ? 'GEÇTİ' : 'KALDI'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
    if (!r.ok) failed++;
  }
  if (OUT) {
    fs.mkdirSync(OUT, { recursive: true });
    for (const [name, b64] of Object.entries(results.wavs)) {
      fs.writeFileSync(path.join(OUT, name), Buffer.from(b64, 'base64'));
      console.log('yazıldı:', path.join(OUT, name));
    }
  }
  console.log(failed ? `\n${failed} test kaldı` : '\nTüm testler geçti');
  process.exitCode = failed ? 1 : 0;
} finally {
  await browser.close();
}
