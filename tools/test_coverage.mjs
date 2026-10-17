// Kurgu kapsaması testleri: karşılıklı çekim (konuşana kesme, tepki, 180° kuralı), vuruş tepki çekimleri, çekim süreleri.
// Kullanım: node tools/test_coverage.mjs   (dev sunucusu açık olmalı: http://localhost:5174)
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
    const out = [];
    const check = (name, ok, detail = '') => out.push({ name, ok, detail });
    const p = parseScenario(await (await fetch('scenarios/bolum-2-karabeyin-golgesi.yaml')).text());
    const { film, warnings } = await buildFilm(p.scenario, new AssetLibrary());
    const sc = film.scenes[0];
    const shots = sc.shots;
    check('Bölüm 2 uyarısız derlenir', warnings.length === 0, warnings.join(' | '));
    const shotAt = (t) => shots.find((s) => t >= s.start && t < s.start + s.duration);

    // Çekimler kesintisiz ve sıralı; sahne aralığını tam kaplar
    let gaps = 0;
    for (let i = 1; i < shots.length; i++) if (Math.abs(shots[i].start - (shots[i - 1].start + shots[i - 1].duration)) > 1e-6) gaps++;
    check('çekimler boşluksuz ve üst üste binmeden', gaps === 0, `${gaps} boşluk`);

    // Konuşma ve savaş bölümünde ortalama çekim 2–4 sn, hiçbiri göz kırpması kadar kısa değil
    const mid = shots.filter((s) => s.start >= 10 && s.start < 76);
    const avg = mid.reduce((a, s) => a + s.duration, 0) / mid.length;
    const shortest = Math.min(...mid.map((s) => s.duration));
    check('konuşma/savaş çekimleri kısa ve ritmik (ort. 1.5–4 sn, en kısa ≥ 0.85 sn)', avg >= 1.5 && avg <= 4 && shortest >= 0.85, `ort ${avg.toFixed(2)} sn, en kısa ${shortest.toFixed(2)} sn, ${mid.length} çekim`);

    // Karşılıklı çekim: her replik sırasında çoğunlukla konuşan kadrajda
    const talks = [
      ['karabey', 10.5, 16.1],
      ['toprak', 16.8, 21.6],
      ['defne', 22.0, 26.3],
      ['mese', 26.6, 30.8],
    ];
    const bad = [];
    for (const [who, a, b] of talks) {
      let on = 0;
      let n = 0;
      for (let t = a + 0.2; t < b; t += 0.1, n++) if (shotAt(t).camera.target === who) on++;
      if (on / n < 0.6) bad.push(`${who} %${Math.round((100 * on) / n)}`);
    }
    check('replik sırasında konuşan kadrajda (≥ %60)', bad.length === 0, bad.join(', '));
    check('Karabey konuşurken dinleyenlerin tepki çekimi var', shots.some((s) => s.start > 10.5 && s.start < 16 && Array.isArray(s.camera.target) && s.camera.target.length === 3));

    // Vuruş tepki çekimleri: isabetten hemen sonra, yetenek odağı kapalı, vurulan kadrajda
    const uses = sc.abilities.allUses().filter((a) => a.recipe.targetKind === 'character');
    const inserts = shots.filter((s) => s.camera.focus === false);
    const matched = inserts.filter((s) => uses.some((a) => {
      const t = a.start + a.recipe.impactOffset;
      const tg = Array.isArray(s.camera.target) ? s.camera.target : [s.camera.target];
      return s.start - t > 0 && s.start - t < 0.2 && tg.includes(a.target);
    }));
    check('vuruş tepki çekimleri isabetten hemen sonra ve vurulanı gösterir', inserts.length >= 8 && matched.length === inserts.length, `${inserts.length} tepki, ${matched.length} eşleşti`);

    // Belirli: aynı senaryo iki kez aynı kurguyu üretir
    const again = await buildFilm(p.scenario, new AssetLibrary());
    const sig = (ss) => ss.map((s) => `${s.start.toFixed(3)}:${JSON.stringify(s.camera)}`).join('|');
    check('kurgu belirli (iki derleme aynı)', sig(again.film.scenes[0].shots) === sig(shots));
    again.film.dispose();
    film.dispose();
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
