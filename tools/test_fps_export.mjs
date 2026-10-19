// 30 / 60 fps MP4 dışa aktarım karşılaştırması (boyut, gerçek kare sayısı, süre, kodlayıcı).
// Kullanım: node tools/test_fps_export.mjs [senaryo] [süre-sn] [genişlik] [yükseklik]
// Not: vite dev sunucusu (5174) çalışıyor olmalı.
import puppeteer from 'puppeteer-core';

const [scenario = 'harita-toprak-yol', secs = '5', w = '1920', h = '1080'] = process.argv.slice(2);

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
page.on('console', (m) => console.log('PAGE:', m.text()));
await page.goto('http://localhost:5174/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => { const o = document.querySelector('#loading-overlay'); return !o || o.hidden; }, { timeout: 60000 });
await page.evaluate((id) => window.__engine.loadScenario(id), scenario);
await page.waitForFunction(() => { const o = document.querySelector('#loading-overlay'); return !o || o.hidden; }, { timeout: 120000 });
await new Promise((r) => setTimeout(r, 1000));

const result = await page.evaluate(async (secs, w, h) => {
  const film = window.__engine.film;
  const viewport = window.__engine.viewport;
  const { exportMp4 } = await import('/src/export/mp4.ts');
  film.duration = Math.min(film.duration, secs);
  const out = [];
  const format = { id: 'test', label: 'test', width: w, height: h };
  for (const fps of [30, 60]) {
    const t0 = performance.now();
    const blob = await exportMp4({ film, viewport, format, fps });
    const ms = performance.now() - t0;
    const frames = Math.round(film.duration * fps);
    out.push({
      fps,
      frames,
      mb: +(blob.size / 1e6).toFixed(2),
      mbps: +((blob.size * 8) / secs / 1e6).toFixed(2),
      sec: +(ms / 1000).toFixed(1),
      renderFps: +(frames / (ms / 1000)).toFixed(1),
    });
  }

  // Kare başı süre dağılımı (ms): evaluate / çizim (GPU bitene kadar) / VideoFrame
  const prev = viewport.beginOffscreen(w, h);
  film.setRenderMode('render');
  const gl = viewport.renderer.getContext();
  const t = { evaluate: 0, draw: 0, frame: 0 };
  const N = 60;
  for (let i = 0; i < N; i++) {
    const time = (i / 30) % film.duration;
    let a = performance.now();
    film.evaluate(time, format);
    t.evaluate += performance.now() - a;
    a = performance.now();
    viewport.render(film);
    gl.finish();
    t.draw += performance.now() - a;
    a = performance.now();
    new VideoFrame(viewport.canvas, { timestamp: i * 33333 }).close();
    t.frame += performance.now() - a;
  }
  prev();
  const profile = Object.fromEntries(Object.entries(t).map(([k, v]) => [k + '_ms', +(v / N).toFixed(2)]));
  return { out, profile };
}, +secs, +w, +h);

console.table(result.out);
console.log('Kare başı ortalama:', result.profile);
await browser.close();
