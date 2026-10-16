// Yetenek tanımları (src/data/abilities.yaml) ve reçete üretimi testleri.
// Modülleri Vite üzerinden doğrudan tarayıcıda yükler.
// Kullanım: node tools/test_abilities.mjs   (dev sunucusu açık olmalı: http://localhost:5174)
import puppeteer from 'puppeteer-core';

const URL = process.env.ENGINE_URL ?? 'http://localhost:5174/';
const BROWSER = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const browser = await puppeteer.launch({ executablePath: BROWSER, headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  const results = await page.evaluate(async () => {
    const reg = await import('/src/engine/ability-registry.ts');
    const { parseScenario } = await import('/src/schema.ts');
    const out = [];
    const check = (name, ok, detail = '') => out.push({ name, ok, detail });
    const near = (a, b) => Math.abs(a - b) < 1e-6;

    // Bölüm 2'deki karakterlerin gerçek klip süreleri
    const durs = { hook_punch: 2.167, macaco_side: 3.283, flying_kick: 1.5, hurricane_kick: 1.833, kick: 1.3, draw_arrow: 1.017, aim_overdraw: 3.767, aim_recoil: 0.683, power_up: 2.367, slash_2: 3.533, casting: 2.95, attack_2: 1.3 };
    const real = (n) => durs[n];

    // 1) Tüm eski adlar (takma adlar dahil) çözülür
    const legacy = ['ates_topu', 'fireball', 'alev_tekmesi', 'flame_kick', 'ruzgar_hortumu', 'hortum', 'wind_tornado', 'kasirga_tufani', 'whirlwind_kick', 'yagmur_oku', 'rain_arrow', 'firtina_oku', 'storm_arrow', 'yagmur', 'yagmur_bulutu', 'orman_yagmuru', 'rain', 'golge_kilic', 'golge_dalgasi', 'shadow_slash', 'karanlik_buyu', 'shadow_storm', 'agac_devirme', 'tree_fall'];
    const missing = legacy.filter((n) => !reg.resolveAbility(n));
    check('24 eski yetenek adının hepsi çözülür', missing.length === 0, missing.join(','));

    // 2) Zamanlamalar eski elle yazılmış değerlerle aynı (gerçek klip süresi farkı ≤ 5 ms)
    const golden = {
      ates_topu: [0.92, 1.5, 2.95], alev_tekmesi: [1.45, 2.05, 3.35], ruzgar_hortumu: [2.25, 3.05, 4.35],
      firtina_oku: [2.17, 2.8, 4.7], golge_kilic: [2.2, 2.82, 3.7], karanlik_buyu: [2.12, 2.74, 3.6], agac_devirme: [1.65, 2.38, 3.7],
    };
    for (const [id, [c, i, t]] of Object.entries(golden)) {
      const { recipe } = reg.buildRecipe(reg.resolveAbility(id), real);
      const ok = Math.abs(recipe.chargeEnd - c) <= 0.005 && Math.abs(recipe.impactOffset - i) <= 0.005 && Math.abs(recipe.totalDuration - t) <= 0.005;
      check(`${id} zamanlaması eskisiyle aynı`, ok, `${recipe.chargeEnd}/${recipe.impactOffset}/${recipe.totalDuration}`);
    }

    // 3) Takma ad, kanonik yetenekle aynı reçeteyi verir (kasirga_tufani eskiden "kick" yüklüyordu)
    const k = reg.buildRecipe(reg.resolveAbility('kasirga_tufani'), real).recipe;
    check('kasirga_tufani = ruzgar_hortumu (hurricane_kick + flying_kick)', k.id === 'ruzgar_hortumu' && k.clips.map((c) => c.name).join() === 'hurricane_kick,flying_kick');
    check('kasirga_tufani kullananı flying_kick yükler', reg.casterClipNames(reg.resolveAbility('kasirga_tufani')).includes('flying_kick'));

    // 4) Süresi verilmeyen klip gerçek süresiyle oynar
    const fire = reg.buildRecipe(reg.resolveAbility('ates_topu'), (n) => (n === 'hook_punch' ? 2.5 : undefined)).recipe;
    check('süresiz klip gerçek süreyi alır', near(fire.clips[0].duration, 2.5), String(fire.clips[0].duration));

    // 5) Özel kliplerde fırlatma anı aynı orana kayar (hook_punch 0.92/2.167 → yeni klipte aynı oran)
    const custom = reg.buildRecipe(reg.resolveAbility('ates_topu'), (n) => (n === 'mma_kick' ? 3.0 : durs[n]), ['mma_kick']).recipe;
    const expected = Math.round((0.92 / 2.167) * 3.0 * 1000) / 1000;
    check('özel klipte fırlatma orantılı kayar', near(custom.chargeEnd, expected) && near(custom.impactOffset, Math.round((expected + 0.58) * 1000) / 1000), `${custom.chargeEnd} (beklenen ${expected})`);

    // 6) Eksik klip uyarı verir ve varsayılan süre kullanılır
    const warn = reg.buildRecipe(reg.resolveAbility('ates_topu'), () => undefined);
    check('kullananda olmayan klip uyarı verir', warn.warnings.length === 1 && /klibi kullananda yok/.test(warn.warnings[0]), warn.warnings.join(' | '));

    // 7) Gerçek klipten belirgin uzun açık süre "son kare tutulur" uyarısı verir
    const hold = reg.buildRecipe(reg.resolveAbility('karanlik_buyu'), (n) => (n === 'attack_2' ? 1.0 : durs[n]));
    check('klipten uzun süre uyarı verir', hold.warnings.some((w) => /son kare/.test(w)), hold.warnings.join(' | '));

    // 8) Şema: bilinmeyen yetenek adı anlaşılır hata, ağaç devirme hedefsiz geçerli
    const base = (ability) => `
assets: { a: { placeholder: bear }, b: { placeholder: bunny } }
scenes:
  - id: s
    characters: [{ id: a, asset: a, at: [0, 0, 0] }, { id: b, asset: b, at: [2, 0, 0] }]
    shots:
      - duration: 4
        camera: { target: a }
        actions:
          - ${ability}
`;
    const bad = parseScenario(base('{ who: a, do: ability, name: buz_firtinasi, target: b, at: 0 }'));
    check('bilinmeyen yetenek şemada hata verir', !bad.ok && bad.errors.some((e) => /Bilinmeyen yetenek "buz_firtinasi"/.test(e)), bad.ok ? '' : bad.errors[0]);
    const tree = parseScenario(base('{ who: a, do: ability, name: tree_fall, at: 0 }'));
    check('ağaç devirme hedef karakter istemez', tree.ok, tree.ok ? '' : tree.errors.join(' | '));
    const noTarget = parseScenario(base('{ who: a, do: ability, name: fireball, at: 0 }'));
    check('karakter hedefli yetenek hedefsiz hata verir', !noTarget.ok && noTarget.errors.some((e) => /hedefi belirtilmeli/.test(e)));
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
