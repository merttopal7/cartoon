// Yol boyunca yürüme (walk_to { road: true }) testleri: RoadPath birim testleri ve gerçek haritayla uçtan uca.
// Kullanım: node tools/test_road.mjs   (dev sunucusu açık olmalı: http://localhost:5174)
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
    const { RoadPath } = await import('/src/engine/road.ts');
    const out = [];
    const check = (name, ok, detail = '') => out.push({ name, ok, detail });
    const V = (x, z) => new THREE.Vector3(x, 0, z);
    const json = (points) => `data:application/json,${encodeURIComponent(JSON.stringify({ points }))}`;

    // L biçimli yol: (0,0) → (20,0) → (20,20), 6 m genişlik
    const L = await RoadPath.load(json([[0, 0, 6, 0], [10, 0, 6, 0], [20, 0, 6, 0], [20, 10, 6, 0], [20, 20, 6, 0]]), [0, 0, 0]);
    check('yol uzunluğu', Math.abs(L.length - 40) < 1e-9, String(L.length));
    check('izdüşüm', Math.abs(L.project(5, 2) - 5) < 1e-9 && Math.abs(L.project(23, 15) - 35) < 1e-9);

    // Rota: yolun dışından girer, köşeyi döner, hedefte çıkar
    const r = L.route(V(2, -3), V(22, 18));
    const onRoad = r.slice(0, -1).every(([x, z]) => Math.min(Math.abs(z) + Math.max(0, x - 20), Math.abs(x - 20) + Math.max(0, -z)) <= 0.01);
    check('rota orta çizgiyi izler ve hedefte biter', onRoad && r[r.length - 1][0] === 22 && r[r.length - 1][1] === 18, JSON.stringify(r));
    check('rota köşeden geçer', r.some(([x, z]) => x === 20 && z === 0));

    // Şerit: +x yönünde yürürken sağ +z'dir; yönün tersinde sağ -z olur
    const right = L.route(V(1, 0), V(9, 0), 1.5);
    const back = L.route(V(9, 0), V(1, 0), 1.5);
    check('şerit +x yönünde sağa (+z)', right.slice(0, -1).every(([, z]) => Math.abs(z - 1.5) < 1e-9), JSON.stringify(right));
    check('şerit ters yönde sağa (-z)', back.slice(0, -1).every(([, z]) => Math.abs(z + 1.5) < 1e-9), JSON.stringify(back));
    const wide = L.route(V(1, 0), V(9, 0), 10);
    check('şerit yol içinde tutulur (6 m yolda en çok 2.5 m)', wide.slice(0, -1).every(([, z]) => Math.abs(z - 2.5) < 1e-9), JSON.stringify(wide));

    // Haritanın yerleşimi: 90° döndürülmüş, 2 kat ölçekli, kaydırılmış
    const T = await RoadPath.load(json([[0, 0, 4, 0], [10, 0, 4, 0]]), [5, 0, 7], 90, 2);
    const s = T.sample(T.length);
    check('yerleşim dönüşümü (90°, 2x, kaydırma)', Math.abs(T.length - 20) < 1e-9 && Math.abs(s.x - 5) < 1e-9 && Math.abs(s.z - (7 - 20)) < 1e-9 && s.width === 8, `${s.x},${s.z},${s.width}`);

    // Uçtan uca: gerçek harita ve yolu ile senaryo; karakter yolu izlemeli
    const { parseScenario } = await import('/src/schema.ts');
    const { buildFilm } = await import('/src/engine/film.ts');
    const { AssetLibrary } = await import('/src/engine/assets.ts');
    const yaml = `
film: { fps: 30 }
assets:
  harita: { src: models/maps/dirt-road.glb, align: none, road: roads/dirt-road.json }
  a: { placeholder: bear }
scenes:
  - id: yol
    environment: { preset: day, ground_plane: false }
    props: [{ asset: harita, at: [0, 0, 0], terrain: [Dirt_Road, Dirt_Road_Bare, Grass_Close, Ground_Dirt] }]
    characters: [{ id: a, asset: a, at: [14, 0, 46] }]
    shots:
      - duration: 30
        camera: { target: a }
        actions:
          - { who: a, do: walk_to, road: true, lane: 1, to: [80, 22], speed: 4, at: 0 }
`;
    const parsed = parseScenario(yaml);
    check('road alanlı senaryo şemadan geçer', parsed.ok, parsed.ok ? '' : parsed.errors.join(' | '));
    if (parsed.ok) {
      const { film, warnings } = await buildFilm(parsed.scenario, new AssetLibrary());
      const ch = film.scenes[0].characters.get('a');
      const road = await RoadPath.load('roads/dirt-road.json', [0, 0, 0]);
      let worst = 0;
      let moved = 0;
      const f = { id: 'youtube_16x9', width: 1920, height: 1080 };
      let prev = null;
      for (let t = 1; t < 20; t += 0.5) {
        const p = ch.positionAt(t, new THREE.Vector3());
        const q = road.sample(road.project(p.x, p.z));
        worst = Math.max(worst, Math.hypot(p.x - q.x, p.z - q.z));
        if (prev) moved += Math.hypot(p.x - prev.x, p.z - prev.z);
        prev = p;
      }
      const end = ch.positionAt(30, new THREE.Vector3());
      check('karakter yol boyunca kalır (orta çizgiden en çok ~şerit + köşe payı)', worst < 2.5, `en uzak ${worst.toFixed(2)} m, yol ${moved.toFixed(1)} m`);
      check('karakter hedefe varır', Math.hypot(end.x - 80, end.z - 22) < 1e-6, `${end.x.toFixed(2)},${end.z.toFixed(2)}`);
      check('uyarı yok', !warnings.some((w) => /yol/i.test(w)), warnings.join(' | '));
      film.evaluate(5, f);
      film.dispose();
    }
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
