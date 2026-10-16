// Seçilen anlardaki kareleri PNG olarak kaydeder (görünüm ayarlarını gözle kontrol etmek için).
// Kullanım: node tools/capture_frames.mjs <senaryo> <çıktı klasörü> <t1,t2,...> [render|preview] [genişlik] [ön ek]
//   ör. node tools/capture_frames.mjs bolum-2-karabeyin-golgesi out 22,46.7 render 1280
//   CROP=x,y,genişlik,yükseklik (0–1 oranları) ile karenin bir bölümü kırpılır (ince ayrıntıyı görmek için)
// Dev sunucusu açık olmalı (npm run dev → http://localhost:5174).
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const [scenario, outDir, times, mode = 'render', width = '1280', prefix = ''] = process.argv.slice(2);
const URL = process.env.ENGINE_URL ?? 'http://localhost:5174/';
const BROWSER = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const W = Number(width);
const H = Math.round((W * 9) / 16);

const browser = await puppeteer.launch({
  executablePath: BROWSER,
  headless: true,
  args: ['--no-sandbox', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'],
  defaultViewport: { width: 1280, height: 720 },
  protocolTimeout: 600000,
});
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
  const shots = await page.evaluate(
    async (ts, mode, W, H, crop) => {
      const { film, viewport } = window.__engine;
      film.setRenderMode(mode);
      const restore = mode === 'render' ? viewport.beginOffscreen(W, H) : () => {};
      const gl = viewport.renderer.getContext();
      const out = {};
      try {
        for (const t of ts) {
          film.evaluate(t, { id: 'youtube_16x9', width: 1920, height: 1080 });
          viewport.render(film);
          const w = gl.drawingBufferWidth;
          const h = gl.drawingBufferHeight;
          const buf = new Uint8Array(w * h * 4);
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const ctx = c.getContext('2d');
          const img = ctx.createImageData(w, h);
          for (let y = 0; y < h; y++) img.data.set(buf.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
          ctx.putImageData(img, 0, 0);
          if (crop) {
            const [cx, cy, cw, ch] = crop;
            const k = document.createElement("canvas");
            k.width = Math.round(cw * w);
            k.height = Math.round(ch * h);
            k.getContext("2d").drawImage(c, cx * w, cy * h, cw * w, ch * h, 0, 0, k.width, k.height);
            out[t] = k.toDataURL("image/png").split(",")[1];
          } else out[t] = c.toDataURL("image/png").split(",")[1];
        }
      } finally {
        restore();
      }
      return out;
    },
    times.split(',').map(Number),
    mode,
    W,
    H,
    process.env.CROP ? process.env.CROP.split(",").map(Number) : null,
  );
  fs.mkdirSync(outDir, { recursive: true });
  for (const [t, b64] of Object.entries(shots)) {
    const f = path.join(outDir, `${prefix}${scenario}_${t}s.png`);
    fs.writeFileSync(f, Buffer.from(b64, 'base64'));
    console.log('yazıldı:', f);
  }
} finally {
  await browser.close();
}
