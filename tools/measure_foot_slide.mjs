// Ayak kayması ölçümü: yürürken/koşarken yere basan ayağın dünyadaki yatay hızı (ideali 0).
// Bacak hızı karakterin ilerleme hızıyla uyuşmazsa ayak yerde "patenle kayar".
// Kullanım: node tools/measure_foot_slide.mjs [senaryo]
// Dev sunucusu açık olmalı (npm run dev → http://localhost:5174).
import puppeteer from 'puppeteer-core';

const [scenario = 'bolum-1-ormanin-bekcileri'] = process.argv.slice(2);
const URL = process.env.ENGINE_URL ?? 'http://localhost:5174/';
const BROWSER = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const browser = await puppeteer.launch({ executablePath: BROWSER, headless: true, args: ['--no-sandbox'], protocolTimeout: 600000 });
try {
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  const waitLoaded = () =>
    page.waitForFunction(() => {
      const o = document.querySelector('#loading-overlay');
      return window.__engine?.film && (!o || o.hidden);
    }, { timeout: 180000 });
  await waitLoaded();
  await page.evaluate((id) => window.__engine.loadScenario(id), scenario);
  await waitLoaded();

  const lines = await page.evaluate(() => {
    const { film, THREE } = window.__engine;
    const f = { id: 'youtube_16x9', width: 1920, height: 1080 };
    const fps = 60;
    const stats = new Map();
    const frames = Math.round(film.duration * fps);
    for (let fi = 0; fi < frames; fi++) {
      const t = fi / fps;
      const { scene } = film.evaluate(t, f);
      scene.group.updateMatrixWorld(true);
      for (const [id, ch] of scene.characters) {
        let st = stats.get(id);
        if (!st) {
          const feet = [];
          ch.rig.root.traverse((o) => {
            const n = o.name.toLowerCase().replace(/[\s_.\-:]/g, '');
            if (o.isBone && /(leftfoot|footl|rightfoot|footr)$/.test(n) && feet.length < 2) feet.push(o);
          });
          st = { feet, prev: null, slides: [], speeds: [] };
          stats.set(id, st);
        }
        if (st.feet.length < 2) continue;
        const pos = st.feet.map((b) => b.getWorldPosition(new THREE.Vector3()));
        const p = ch.pose;
        if (st.prev && p.walkWeight > 0.9 && p.jumpLift < 0.02) {
          // Alttaki ayak yere basıyor sayılır; yatay hızı kayma, gövde hızı karşılaştırma için
          const k = pos[0].y < pos[1].y ? 0 : 1;
          const dx = pos[k].x - st.prev.pos[k].x;
          const dz = pos[k].z - st.prev.pos[k].z;
          st.slides.push(Math.hypot(dx, dz) * fps);
          st.speeds.push(p.walkSpeed);
        }
        st.prev = { pos };
      }
    }
    const out = [];
    for (const [id, st] of stats) {
      if (!st.slides.length) continue;
      const s = [...st.slides].sort((a, b) => a - b);
      const q = (k) => s[Math.min(s.length - 1, Math.floor(s.length * k))];
      const v = st.speeds.reduce((a, b) => a + b, 0) / st.speeds.length;
      out.push(`${id}: yürüme hızı ort ${v.toFixed(2)} m/sn · basan ayak kayması p50 ${q(0.5).toFixed(2)} · p90 ${q(0.9).toFixed(2)} m/sn (${s.length} kare)`);
    }
    return out;
  });
  console.log(`Senaryo: ${scenario}`);
  console.log(lines.join('\n'));
} finally {
  await browser.close();
}
