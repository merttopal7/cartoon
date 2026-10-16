// Ayak-zemin teması ölçümü: karakter dururken iki bileğin araziden yüksekliği arasındaki fark (eğimde biri
// havada kalır, öbürü gömülür) ve en alttaki ayağın zemine göre sapması.
// Kullanım: node tools/measure_feet.mjs [senaryo] [fps]
// Dev sunucusu açık olmalı (npm run dev → http://localhost:5174).
import puppeteer from 'puppeteer-core';

const [scenario = 'bolum-2-karabeyin-golgesi', fps = '15'] = process.argv.slice(2);
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

  const lines = await page.evaluate((fps) => {
    const { film, THREE } = window.__engine;
    const f = { id: 'youtube_16x9', width: 1920, height: 1080 };
    const out = [];
    const stats = new Map();
    const v = new THREE.Vector3();
    const frames = Math.round(film.duration * fps);
    for (let fi = 0; fi < frames; fi++) {
      const t = fi / fps;
      const { scene } = film.evaluate(t, f);
      const terrain = scene.terrain ?? scene.clearance?.terrain;
      if (!terrain) continue;
      scene.group.updateMatrixWorld(true);
      for (const [id, ch] of scene.characters) {
        let st = stats.get(id);
        if (!st) {
          const feet = {};
          ch.rig.root.traverse((o) => {
            const n = o.name.toLowerCase().replace(/[\s_.\-:]/g, '');
            if (!o.isBone) return;
            if (!feet.l && /(leftfoot|footl|lfoot)$/.test(n)) feet.l = o;
            if (!feet.r && /(rightfoot|footr|rfoot)$/.test(n)) feet.r = o;
          });
          st = { feet, diffs: [], lows: [], under: [], plane: [] };
          stats.set(id, st);
        }
        if (!st.feet.l || !st.feet.r) continue;
        const p = ch.pose;
        const standing = p.walkWeight < 0.05 && Math.abs(p.jumpLift) < 0.02;
        const gap = (b) => {
          b.getWorldPosition(v);
          const g = terrain.heightAt(v.x, v.z);
          return g === null ? null : v.y - g;
        };
        const gl = gap(st.feet.l);
        const gr = gap(st.feet.r);
        if (gl === null || gr === null) continue;
        st.lows.push(Math.min(gl, gr));
        if (standing) st.diffs.push({ d: Math.abs(gl - gr), t });
        // Animasyondan bağımsız: iki ayağın altındaki zemin farkı ve animasyonun varsaydığı düz zeminden
        // (karakter kökünün yüksekliği) sapma. Ayak IK'sının düzelteceği hata budur.
        if (Math.abs(p.jumpLift) < 0.02) {
          const ground = (b) => { b.getWorldPosition(v); return terrain.heightAt(v.x, v.z); };
          const hl = ground(st.feet.l);
          const hr = ground(st.feet.r);
          if (hl !== null && hr !== null) {
            st.under.push(Math.abs(hl - hr));
            const rootY = ch.rig.root.position.y;
            st.plane.push(Math.max(Math.abs(hl - rootY), Math.abs(hr - rootY)));
          }
        }
      }
    }
    for (const [id, st] of stats) {
      if (!st.lows.length) continue;
      const lows = [...st.lows].sort((a, b) => a - b);
      const med = lows[Math.floor(lows.length / 2)];
      const dev = st.lows.map((x) => Math.abs(x - med)).sort((a, b) => a - b);
      const diffs = [...st.diffs].sort((a, b) => b.d - a.d);
      const mean = diffs.reduce((s, x) => s + x.d, 0) / Math.max(1, diffs.length);
      const q = (arr, k) => { const a = [...arr].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * k))] : 0; };
      out.push(
        `${id}: ZEMİN iki ayak altı farkı p50 ${(q(st.under, 0.5) * 100).toFixed(1)} · p95 ${(q(st.under, 0.95) * 100).toFixed(1)} · en çok ${(q(st.under, 1) * 100).toFixed(1)} cm` +
          ` | ayak altı ile animasyon düzlemi farkı p50 ${(q(st.plane, 0.5) * 100).toFixed(1)} · p95 ${(q(st.plane, 0.95) * 100).toFixed(1)} · en çok ${(q(st.plane, 1) * 100).toFixed(1)} cm`,
      );
      out.push(
        `   dururken bilek farkı ort ${(mean * 100).toFixed(1)} cm · en kötü ${((diffs[0]?.d ?? 0) * 100).toFixed(1)} cm (${diffs[0]?.t.toFixed(1)}s) · >5 cm kare ${diffs.filter((x) => x.d > 0.05).length}/${diffs.length}` +
          ` | alttaki ayak sapması p95 ${(dev[Math.floor(dev.length * 0.95)] * 100).toFixed(1)} cm · en çok ${(dev[dev.length - 1] * 100).toFixed(1)} cm`,
      );
    }
    return out;
  }, +fps);
  console.log(`Senaryo: ${scenario}`);
  console.log(lines.join('\n') || 'arazi yok');
} finally {
  await browser.close();
}
