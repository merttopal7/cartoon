// Dört element testleri: yetenek elementleri, yer dikenleri zamanlaması ve görseli, element uyuşmazlığı uyarısı,
// test bölümü ve Bölüm 2'nin elementlere uygunluğu.
// Kullanım: node tools/test_elements.mjs   (dev sunucusu açık olmalı: http://localhost:5174)
import puppeteer from 'puppeteer-core';

const URL = process.env.ENGINE_URL ?? 'http://localhost:5174/';
const BROWSER = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const browser = await puppeteer.launch({ executablePath: BROWSER, headless: true, args: ['--no-sandbox'], protocolTimeout: 600000 });
try {
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__engine?.THREE, { timeout: 120000 });
  const results = await page.evaluate(async () => {
    const { THREE } = window.__engine;
    const reg = await import('/src/engine/ability-registry.ts');
    const { parseScenario } = await import('/src/schema.ts');
    const { buildFilm } = await import('/src/engine/film.ts');
    const { AssetLibrary } = await import('/src/engine/assets.ts');
    const out = [];
    const check = (name, ok, detail = '') => out.push({ name, ok, detail });
    const lib = new AssetLibrary();

    // 1) Ormanın Bekçileri: her karakterin yeteneği kendi elementinde
    const expected = { alev_buyusu: 'ates', agac_devirme: 'ates', yer_dikeni: 'toprak', ruzgar_hortumu: 'hava', firtina_oku: 'su' };
    const wrong = Object.entries(expected).filter(([n, el]) => reg.resolveAbility(n)?.element !== el);
    check('yetenek elementleri (ateş/toprak/hava/su)', wrong.length === 0, wrong.map(([n]) => n).join(','));

    // 2) Yer dikenleri zamanlaması: 1.0 sn güç + diz çökme 0.35 sn → fırlatma 1.35, isabet 2.10, bitiş 3.25
    const durs = { stretch: 4.0, point: 3.9 };
    const { recipe } = reg.buildRecipe(reg.resolveAbility('yer_dikeni'), (n) => durs[n]);
    check('yer dikenleri zamanlaması', recipe.effectType === 'earth' && recipe.chargeEnd === 1.35 && recipe.impactOffset === 2.1 && recipe.totalDuration === 3.25,
      `${recipe.chargeEnd}/${recipe.impactOffset}/${recipe.totalDuration}`);
    // Alev büyüsü: alev, Karabey'in sağ eli saldırıda en öne uzandığı an (attack_2'nin 0.55. sn'si) elinden çıkar
    const fire = reg.buildRecipe(reg.resolveAbility('alev_buyusu'), () => undefined).recipe;
    check('alev büyüsü sağ el en öndeyken fırlar (1.85 sn), isabet 2.47 sn', fire.chargeEnd === 1.85 && fire.impactOffset === 2.47, `${fire.chargeEnd} / ${fire.impactOffset}`);

    // 3) Element uyuşmazlığı uyarısı (yer tutucu karakterlerle hızlı sahne)
    const yaml = (who, ability) => `
assets:
  a: { placeholder: bear, element: ${who} }
  b: { placeholder: bunny, element: ates }
scenes:
  - id: s
    characters: [{ id: a, asset: a, at: [0, 0, 0] }, { id: b, asset: b, at: [3, 0, 0] }]
    shots:
      - duration: 5
        camera: { target: a }
        actions:
          - { who: a, do: ability, name: ${ability}, target: b, at: 0 }
          - { who: a, do: ability, name: ${ability}, target: b, at: 2 }
`;
    const warnFor = async (who, ability) => {
      const p = parseScenario(yaml(who, ability));
      if (!p.ok) return { error: p.errors.join(' | ') };
      const { film, warnings } = await buildFilm(p.scenario, lib);
      film.dispose();
      return { warnings: warnings.filter((w) => /elementinde/.test(w)) };
    };
    const mismatch = await warnFor('su', 'yer_dikeni');
    check('uyuşmazlıkta tek uyarı (iki kullanım, bir uyarı)', mismatch.warnings?.length === 1 && /su elementinde.*toprak yeteneği/.test(mismatch.warnings[0]), mismatch.error ?? mismatch.warnings.join(' | '));
    const match = await warnFor('toprak', 'yer_dikeni');
    check('uyuşmada uyarı yok', match.warnings?.length === 0, match.error ?? match.warnings.join(' | '));

    // 4) Senaryolar: yüklenip her yeteneğin kullananın elementinde olduğunu doğrula
    const scenarioCheck = async (id) => {
      const text = await (await fetch(`scenarios/${id}.yaml`)).text();
      const p = parseScenario(text);
      if (!p.ok) return { error: p.errors.join(' | ') };
      const els = Object.fromEntries(Object.entries(p.scenario.assets).map(([k, v]) => [k, v.element]));
      const bad = [];
      for (const sc of p.scenario.scenes) {
        const assetOf = Object.fromEntries(sc.characters.map((c) => [c.id, c.asset]));
        const acts = [...(sc.actions ?? []), ...(sc.shots ?? []).flatMap((s) => s.actions ?? [])];
        for (const a of acts) if (a.do === 'ability' && reg.resolveAbility(a.name).element !== els[assetOf[a.who]]) bad.push(`${a.who}:${a.name}`);
      }
      return { bad, scenario: p.scenario };
    };
    for (const id of ['test-dort-element', 'bolum-2-karabeyin-golgesi']) {
      const r = await scenarioCheck(id);
      check(`${id}: her yetenek kullananın elementinde`, !r.error && r.bad.length === 0, r.error ?? r.bad.join(','));
    }

    // 5) Test bölümünde yer dikenleri görseli: dalga uçuşta görünür, büyük dikenler isabette hedefin altında ve yerde
    const p = parseScenario(await (await fetch('scenarios/test-dort-element.yaml')).text());
    const { film, warnings } = await buildFilm(p.scenario, lib);
    check('test bölümü uyarısız derlenir', warnings.length === 0, warnings.join(' | '));
    const f = { id: 'youtube_16x9', width: 1920, height: 1080 };
    const sc = film.scenes[0];
    const earthVisual = () => sc.abilities.visuals.find((v) => v.earth && v.ability.start === 23.9);
    film.evaluate(23.9 + 1.35 + 0.4, f);
    const midWave = earthVisual().earth.wave.filter((m) => m.visible).length;
    film.evaluate(23.9 + 2.1 + 0.3, f);
    const big = earthVisual().earth.big.filter((m) => m.visible);
    const terrainY = (m) => sc.clearance.terrain.heightAt(m.position.x, m.position.z);
    const grounded = big.every((m) => Math.abs(m.position.y - terrainY(m)) < 0.15);
    const target = earthVisual().ability.impactPos;
    const under = big.every((m) => Math.hypot(m.position.x - target.x, m.position.z - target.z) < 0.6);
    check('dalga uçuşta görünür', midWave >= 3, `${midWave} diken`);
    check('büyük dikenler isabette hedefin altında ve yerde', big.length === 3 && grounded && under, `${big.length} diken, yerde ${grounded}, altında ${under}`);
    film.evaluate(23.9 + 3.25 + 0.2, f);
    check('yetenek bitince dikenler kaybolur', !earthVisual().root.visible);
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
