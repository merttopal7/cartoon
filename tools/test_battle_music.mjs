// Müzik testleri: savaş müziği (savaş aralığı, ilk isabetin tam düzenin ilk vuruşuna denk gelmesi, ana temayla çapraz
// geçiş, belirlilik, sentez süresi) ve yordamsal ana tema (döngü uzunluğu, dikişsiz döngü).
// Kullanım: node tools/test_battle_music.mjs   (dev sunucusu açık olmalı: http://localhost:5174)
import puppeteer from 'puppeteer-core';

const URL = process.env.ENGINE_URL ?? 'http://localhost:5174/';
const BROWSER = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const browser = await puppeteer.launch({ executablePath: BROWSER, headless: true, args: ['--no-sandbox'], protocolTimeout: 600000 });
try {
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__engine?.THREE, { timeout: 120000 });
  const results = await page.evaluate(async () => {
    const { parseScenario } = await import('/src/schema.ts');
    const { buildFilm } = await import('/src/engine/film.ts');
    const { AssetLibrary } = await import('/src/engine/assets.ts');
    const { planBattles, renderBattleMusic, barLength } = await import('/src/engine/music/battle.ts');
    const out = [];
    const check = (name, ok, detail = '') => out.push({ name, ok, detail });

    // Planlama: iki ayrı savaş, ızgara hizası, hazırlık sınırı
    const uses = [
      { start: 10, impact: 12.5 },
      { start: 13, impact: 15 },
      { start: 30, impact: 31 },
    ];
    const plans = planBattles(uses, 140, 60);
    const bar = barLength(140);
    check('8 sn\'den uzun ara yeni savaş sayılır', plans.length === 2, `${plans.length} savaş`);
    const p0 = plans[0];
    check(
      'tam düzen ilk isabette başlar, hazırlık ilk yeteneği kapsar',
      Math.abs(p0.start + p0.introBars * bar - 12.5) < 1e-9 && p0.start <= 10,
      `başlangıç ${p0.start.toFixed(2)}, hazırlık ${p0.introBars} ölçü`,
    );
    check('kapanış son isabetten sonra', p0.end >= 15 + 1.5 && p0.end - 15 < 1.5 + bar + 1e-9, `kapanış ${p0.end.toFixed(2)}`);

    // Bölüm 2: savaş müziği ve çapraz geçiş
    const p = parseScenario(await (await fetch('scenarios/bolum-2-karabeyin-golgesi.yaml')).text());
    const { film, warnings } = await buildFilm(p.scenario, new AssetLibrary());
    check('Bölüm 2 uyarısız derlenir', warnings.length === 0, warnings.join(' | '));
    const segs = film.audio.getBattleMusic();
    check('Bölüm 2\'de tek savaş müziği', segs.length === 1, `${segs.length}`);
    const seg = segs[0];
    if (seg) {
      const mid = (seg.start + seg.end) / 2;
      check('savaşta ana tema susar, savaş müziği çalar', film.audio.getMusicGainAt(mid) === 0 && film.audio.getBattleGainAt(seg, mid) > 0.1);
      const after = seg.end + 4;
      check('kapanıştan sonra ana tema geri gelir', film.audio.getMusicGainAt(after) > 0.2, film.audio.getMusicGainAt(after).toFixed(3));
      const master = await film.audio.renderMasterAudio(film.duration, 44100);
      let peak = 0;
      for (let c = 0; c < 2; c++) for (const v of master.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
      check('tam miks kırpılmaz', peak <= 1, peak.toFixed(3));
    }
    film.dispose();

    // Belirlilik ve süre (önbelleği atlamak için farklı tempo)
    const t0 = performance.now();
    const a = await renderBattleMusic({ bpm: 137, introBars: 2, bodyBars: 12 });
    const ms = performance.now() - t0;
    const b = await (async () => {
      const mod = await import('/src/engine/music/battle.ts?yeniden=' + Date.now());
      return mod.renderBattleMusic({ bpm: 137, introBars: 2, bodyBars: 12 });
    })();
    let diff = 0;
    for (let c = 0; c < 2; c++) {
      const x = a.getChannelData(c), y = b.getChannelData(c);
      for (let i = 0; i < x.length; i++) diff = Math.max(diff, Math.abs(x[i] - y[i]));
    }
    check('müzik belirli (iki sentez aynı)', a.length === b.length && diff < 1e-6, `en büyük fark ${diff.toExponential(1)}`);
    check('14 ölçü 4 sn\'den kısa sürede sentezlenir', ms < 4000, `${Math.round(ms)} ms`);

    // Ana tema: tam 32 ölçülük döngü, döngü noktasında sıçrama yok
    const { renderMainTheme, themeDuration } = await import('/src/engine/music/theme.ts');
    const th = await renderMainTheme();
    check('ana tema tam döngü uzunluğunda', Math.abs(th.duration - themeDuration(116)) < 1e-3, `${th.duration.toFixed(2)} sn`);
    const L = th.getChannelData(0);
    let step = 0;
    for (let i = 1; i < 4000; i++) step = Math.max(step, Math.abs(L[i] - L[i - 1]));
    const jump = Math.abs(L[0] - L[L.length - 1]);
    check('ana tema döngüsünde dikiş yok', jump < step * 0.5, `sıçrama ${jump.toFixed(4)}, tipik ${step.toFixed(4)}`);
    return out;
  });
  let failed = 0;
  for (const r of results) {
    console.log(`${r.ok ? 'GEÇTİ' : 'KALDI'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
    if (!r.ok) failed++;
  }
  console.log(failed ? `\n${failed} test kaldı` : '\nTüm testler geçti');
  process.exitCode = failed ? 1 : 0;
} finally {
  await browser.close();
}
