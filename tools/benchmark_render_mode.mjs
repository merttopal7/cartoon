import puppeteer from 'puppeteer-core';

async function main() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  await page.goto('http://localhost:5174/', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));

  await page.waitForFunction(() => {
    const overlay = document.querySelector('#loading-overlay');
    return !overlay || overlay.hidden;
  }, { timeout: 35000 });

  await page.evaluate(async () => {
    await window.__engine.loadScenario('harita-toprak-yol');
  });

  await page.waitForFunction(() => {
    const overlay = document.querySelector('#loading-overlay');
    return !overlay || overlay.hidden;
  }, { timeout: 35000 });
  await new Promise(r => setTimeout(r, 1000));

  const stats = await page.evaluate(() => {
    const film = window.__engine.film;
    const viewport = window.__engine.viewport;
    const format = { id: 'test', label: 'test', width: 1280, height: 720, fps: 30 };

    // Set to render mode
    window.__engine.setRenderMode('render');

    // Measure 10 frames
    const times = [];
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now();
      film.evaluate(2.0 + i * 0.033, format);
      viewport.render(film);
      times.push(performance.now() - t0);
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;

    // Check triangle count and draw calls
    const info = viewport.renderer.info;

    return {
      avgMs: +avg.toFixed(2),
      times: times.map(t => +t.toFixed(1)),
      triangles: info.render.triangles,
      calls: info.render.calls,
      geometries: info.memory.geometries,
    };
  });

  console.log('Current Render Mode stats:');
  console.log('Average frame time:', stats.avgMs, 'ms (', (1000 / stats.avgMs).toFixed(1), 'FPS )');
  console.log('Triangles rendered per frame:', stats.triangles);
  console.log('Draw calls:', stats.calls);
  console.log('Frame times:', stats.times);

  await browser.close();
}

main().catch(console.error);
