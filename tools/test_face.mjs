// Yüz testleri: şekil anahtarı olmayan yüze üretilen ağız şekilleri (Meşe), konuşmada çene, otomatik ifadeler.
// Kullanım: node tools/test_face.mjs   (dev sunucusu açık olmalı: http://localhost:5174)
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
    const lib = new AssetLibrary();
    const f = { id: 'youtube_16x9', width: 1920, height: 1080 };
    const load = async (id) => (await buildFilm(parseScenario(await (await fetch(`scenarios/${id}.yaml`)).text()).scenario, lib)).film;

    // 1) Meşe: çene açma / gülümseme / üzgün şekilleri üretilir; konuşurken çene açılır, susunca kapanır
    const b1Def = parseScenario(await (await fetch('scenarios/bolum-1-ormanin-bekcileri.yaml')).text()).scenario;
    const b1 = (await buildFilm(b1Def, lib)).film;
    const mese = b1.scenes[0].characters.get('mese');
    // Anlar senaryodan okunur (bölüm üretilir; replik süreleri seslendirmeyle değişir)
    const acts = b1Def.scenes[0].actions;
    const meseTalks = acts.filter((a) => a.who === 'mese' && a.do === 'talk').map((a) => [a.at, a.at + a.duration]);
    const longTalk = meseTalks.find(([s, e]) => e - s >= 3) ?? meseTalks[0];
    const quiet = (t) => !meseTalks.some(([s, e]) => t > s - 0.5 && t < e + 0.5);
    const silentTimes = [longTalk[0] - 1.2, longTalk[1] + 1.0].filter(quiet);
    const meseRun = acts.find((a) => a.who === 'mese' && a.do === 'walk_to' && a.clip === 'run');
    let body;
    mese.rig.root.traverse((o) => { if (o.isSkinnedMesh && /Body_Mesh/.test(o.name)) body = o; });
    const dict = body?.morphTargetDictionary ?? {};
    check('Meşe: ağız şekilleri üretildi', ['jawopen', 'smile', 'sad'].every((k) => k in dict), Object.keys(dict).join(','));
    const jawAt = (t) => { b1.evaluate(t, f); return body.morphTargetInfluences[dict.jawopen]; };
    const [talkS, talkE] = longTalk;
    // Ses dosyalı replikte ağız sesin genliğini izler (hece aralarında ve sondaki sessizlikte kapanır): replik boyunca
    // örneklenir, çoğunda açık olmalı
    const talking = Array.from({ length: 12 }, (_, k) => jawAt(talkS + 0.2 + ((talkE - talkS - 0.4) * k) / 11));
    const silent = silentTimes.map(jawAt);
    // Saç fiziği: koşarken saç geride akar, dururken neredeyse dik; aynı t her zaman aynı sonucu verir
    const hair = (t) => { b1.evaluate(t, f); return [mese.pose.hairBack, mese.pose.hairSide]; };
    const running = hair(meseRun.at + 1.6)[0];
    const still = hair((talkS + talkE) / 2)[0];
    const h1 = hair(47.0);
    hair(12); hair(75);
    const h2 = hair(47.0);
    check('Meşe: saç koşarken geride akar, dururken dik', running > 0.25 && Math.abs(still) < 0.05, `koşu ${running.toFixed(2)} rad, duruş ${still.toFixed(2)} rad`);
    check('saç fiziği belirli (aynı an, farklı sırayla)', h1[0] === h2[0] && h1[1] === h2[1], `${h1.map((v) => v.toFixed(4))} / ${h2.map((v) => v.toFixed(4))}`);
    check('Meşe: konuşurken çene açılır, susunca kapanır', Math.max(...talking) > 0.8 && talking.filter((v) => v > 0.2).length >= 6 && silent.every((v) => v < 0.05), `konuşma ${talking.map((v) => v.toFixed(2))}, sessiz ${silent.map((v) => v.toFixed(2))}`);
    b1.dispose();

    // 2) Otomatik ifadeler: güç toplarken kızgın, vurulunca şaşkın
    const te = await load('test-dort-element');
    const sc = te.scenes[0];
    const expr = (id, t) => { te.evaluate(t, f); return sc.characters.get(id).pose.expr; };
    const uses = sc.abilities.allUses();
    const spike = uses.find((a) => a.name === 'yer_dikeni');
    const charging = expr('toprak', spike.start + spike.recipe.chargeEnd * 0.5).angry;
    const hit = expr(spike.target, spike.start + spike.recipe.impactOffset + 0.3).surprised;
    const calm = expr('toprak', 12.0);
    check('güç toplarken kızgın, vurulunca şaşkın', charging > 0.5 && hit > 0.5, `kızgın ${charging.toFixed(2)}, şaşkın ${hit.toFixed(2)}`);
    check('sakin anda ifade yok', Object.values(calm).every((v) => v < 0.05), JSON.stringify(calm));
    te.dispose();
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
