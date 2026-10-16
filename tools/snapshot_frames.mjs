// Kare anlık görüntüsü: bir senaryoyu belirli anlarda çizer ve her karenin parmak izini kaydeder.
// Yeniden düzenleme (refactor) sonrası görüntünün değişmediğini doğrulamak için.
// Kullanım:
//   node tools/snapshot_frames.mjs bolum-2-karabeyin-golgesi once.json            # kaydet
//   node tools/snapshot_frames.mjs bolum-2-karabeyin-golgesi sonra.json once.json  # kaydet ve karşılaştır
// Dev sunucusu açık olmalı (npm run dev → http://localhost:5174).
//
// Parmak izi: kare 48×27 bloğa bölünür, her bloğun ortalama rengi. GPU, yarı saydam parçacıklarda ve kenar
// yumuşatmada çalıştırmadan çalıştırmaya 1-2 pikseli birkaç birim farklı çizebiliyor (motor mantığı aynı);
// bu yüzden tam piksel özeti yerine toleranslı blok karşılaştırması yapılır. Bir karakterin kayması ya da bir
// efektin renk değiştirmesi blok ortalamalarını açıkça değiştirir.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const [scenario = 'bolum-2-karabeyin-golgesi', out = 'snapshot.json', compare] = process.argv.slice(2);
const URL = process.env.ENGINE_URL ?? 'http://localhost:5174/';
const BROWSER = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const GX = 48;
const GY = 27;
/** Bir bloğun ortalama renginde kabul edilen en büyük fark (0-255). */
const TOLERANCE = 1.5;

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
  await page.evaluate(() => window.__engine.setRenderMode('preview'));
  await page.evaluate((id) => window.__engine.loadScenario(id), scenario);
  await waitLoaded();
  const prints = await page.evaluate(
    (GX, GY) => {
      const { film, viewport } = window.__engine;
      const gl = viewport.renderer.getContext();
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const buf = new Uint8Array(w * h * 4);
      const f = { id: 'youtube_16x9', width: 1920, height: 1080 };
      const out = {};
      const n = 60;
      for (let i = 0; i < n; i++) {
        const t = +((film.duration * (i + 0.5)) / n).toFixed(3);
        film.evaluate(t, f);
        viewport.render(film);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        const sums = new Float64Array(GX * GY * 3);
        const counts = new Uint32Array(GX * GY);
        for (let y = 0; y < h; y++) {
          const by = Math.min(GY - 1, Math.floor((y * GY) / h));
          for (let x = 0; x < w; x++) {
            const b = by * GX + Math.min(GX - 1, Math.floor((x * GX) / w));
            const k = (y * w + x) * 4;
            sums[b * 3] += buf[k];
            sums[b * 3 + 1] += buf[k + 1];
            sums[b * 3 + 2] += buf[k + 2];
            counts[b]++;
          }
        }
        out[t] = Array.from(sums, (s, j) => +(s / counts[Math.floor(j / 3)]).toFixed(2));
      }
      return out;
    },
    GX,
    GY,
  );
  fs.writeFileSync(out, JSON.stringify(prints));
  console.log(`${Object.keys(prints).length} kare kaydedildi: ${out}`);
  if (compare) {
    const ref = JSON.parse(fs.readFileSync(compare, 'utf8'));
    const bad = [];
    for (const t of Object.keys(ref)) {
      const a = ref[t];
      const b = prints[t];
      let worst = 0;
      for (let j = 0; j < a.length; j++) worst = Math.max(worst, Math.abs(a[j] - (b?.[j] ?? -999)));
      if (worst > TOLERANCE) bad.push(`${t}s (${worst.toFixed(1)})`);
    }
    console.log(bad.length ? `FARKLI ${bad.length} kare: ${bad.join(', ')}` : `Tüm kareler aynı (blok farkı ≤ ${TOLERANCE})`);
    process.exitCode = bad.length ? 1 : 0;
  }
} finally {
  await browser.close();
}
