// Akıcılık ölçümü: bir senaryonun zaman aralığını kare kare çizer, kare sürelerini ve takılmaları raporlar.
// Kullanım: node tools/benchmark_fluidity.mjs [senaryo] [başlangıç] [bitiş] [fps] [mod]
//   node tools/benchmark_fluidity.mjs bolum-2-karabeyin-golgesi 28 78 15 preview
// Dev sunucusu açık olmalı (npm run dev → http://localhost:5174).
// "Soğuk" geçiş shader derleme takılmalarını, "sıcak" geçiş kalıcı kare maliyetini gösterir.
import puppeteer from 'puppeteer-core';

const [scenario = 'bolum-2-karabeyin-golgesi', from = '28', to = '78', fps = '15', mode = 'preview'] = process.argv.slice(2);
const URL = process.env.ENGINE_URL ?? 'http://localhost:5174/';
const BROWSER =
  process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const browser = await puppeteer.launch({
  executablePath: BROWSER,
  headless: true,
  args: ['--no-sandbox', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--window-size=1280,720'],
  defaultViewport: { width: 1280, height: 720 },
  protocolTimeout: 600000,
});

try {
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  const waitLoaded = () =>
    page.waitForFunction(
      () => {
        const o = document.querySelector('#loading-overlay');
        return window.__engine?.film && (!o || o.hidden);
      },
      { timeout: 180000 },
    );
  await waitLoaded();

  await page.evaluate((m) => window.__engine.setRenderMode(m), mode);
  const loadStart = Date.now();
  await page.evaluate((id) => window.__engine.loadScenario(id), scenario);
  await waitLoaded();
  const loadMs = Date.now() - loadStart;

  const result = await page.evaluate(
    (from, to, fps) => {
      const { film, viewport } = window.__engine;
      const gl = viewport.renderer.getContext();
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'bilinmiyor';
      const format = { id: 'youtube_16x9', label: 'bench', width: 1920, height: 1080, fps: 30 };
      const px = new Uint8Array(4);

      const pass = () => {
        const times = [];
        const programsBefore = viewport.renderer.info.programs?.length ?? 0;
        let evalSum = 0;
        let renderSum = 0;
        for (let t = from; t < to; t += 1 / fps) {
          const t0 = performance.now();
          film.evaluate(t, format);
          const t1 = performance.now();
          viewport.render(film);
          // GPU'nun kareyi bitirmesini bekle (yoksa yalnızca komut gönderme süresi ölçülür)
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          const t2 = performance.now();
          evalSum += t1 - t0;
          renderSum += t2 - t1;
          times.push({ t, ms: t2 - t0 });
        }
        const ms = times.map((x) => x.ms).sort((a, b) => a - b);
        const q = (p) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))];
        const spikes = times.filter((x) => x.ms > 50).map((x) => `${x.t.toFixed(2)}s:${Math.round(x.ms)}ms`);
        return {
          frames: ms.length,
          avg: +(ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(1),
          p50: +q(0.5).toFixed(1),
          p95: +q(0.95).toFixed(1),
          max: +ms[ms.length - 1].toFixed(1),
          over50ms: spikes.length,
          worst: spikes.sort((a, b) => +b.split(':')[1].replace('ms', '') - +a.split(':')[1].replace('ms', '')).slice(0, 8),
          newPrograms: (viewport.renderer.info.programs?.length ?? 0) - programsBefore,
          evalAvg: +(evalSum / times.length).toFixed(1),
          renderAvg: +(renderSum / times.length).toFixed(1),
        };
      };

      const cold = pass();
      const warm = pass();

      film.evaluate((from + to) / 2, format);
      viewport.render(film);
      const info = viewport.renderer.info;
      return {
        gpu,
        cold,
        warm,
        triangles: info.render.triangles,
        drawCalls: info.render.calls,
        programs: info.programs?.length ?? 0,
      };
    },
    +from,
    +to,
    +fps,
  );

  console.log(`Senaryo: ${scenario}  aralık: ${from}-${to} sn  ${fps} fps  mod: ${mode}`);
  console.log(`GPU: ${result.gpu}`);
  console.log(`Yükleme: ${(loadMs / 1000).toFixed(1)} sn`);
  console.log(`Orta karede: ${result.triangles.toLocaleString('tr-TR')} üçgen, ${result.drawCalls} draw call, ${result.programs} shader programı`);
  for (const [name, r] of [['Soğuk (ilk geçiş)', result.cold], ['Sıcak (ikinci geçiş)', result.warm]]) {
    console.log(`\n${name}: ${r.frames} kare`);
    console.log(`  ort ${r.avg} ms · p50 ${r.p50} · p95 ${r.p95} · max ${r.max} ms`);
    console.log(`  ortalama dağılım: sahne hesaplama (CPU) ${r.evalAvg} ms + çizim (GPU) ${r.renderAvg} ms`);
    console.log(`  >50 ms kare: ${r.over50ms} · yeni derlenen shader: ${r.newPrograms}`);
    if (r.worst.length) console.log(`  en kötü: ${r.worst.join('  ')}`);
  }
} finally {
  await browser.close();
}
