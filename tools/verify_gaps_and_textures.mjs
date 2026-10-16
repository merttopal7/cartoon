import puppeteer from 'puppeteer-core';
import path from 'path';

async function main() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
    args: ['--no-sandbox', '--window-size=1400,850']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 850 });

  const outDir = 'C:/Users/DELL/.gemini/antigravity/brain/1944cbe1-f58c-4194-98cf-691279cd623a';

  console.log('1. Navigating to app...');
  await page.goto('http://localhost:5174/', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));

  console.log('2. Loading harita-toprak-yol scenario...');
  await page.evaluate(async () => {
    await window.__engine.loadScenario('harita-toprak-yol');
  });

  await page.waitForFunction(() => {
    const overlay = document.querySelector('#loading-overlay');
    return !overlay || overlay.hidden;
  }, { timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));

  // Scrub to 2.5s past fade in
  console.log('3. Scrubbing to t = 2.5s...');
  await page.evaluate(() => {
    const scrub = document.querySelector('#scrub');
    if (scrub) {
      scrub.value = '2.5';
      scrub.dispatchEvent(new Event('input'));
      scrub.dispatchEvent(new Event('change'));
    }
  });
  await new Promise(r => setTimeout(r, 800));

  // Test PREVIEW mode
  console.log('4. Testing PREVIEW mode...');
  await page.evaluate(() => window.__engine.setRenderMode('preview'));
  await new Promise(r => setTimeout(r, 1000));

  const stage = await page.$('#stage');
  if (stage) {
    await stage.screenshot({ path: path.join(outDir, 'dirt_road_no_gaps_preview.png') });
  }

  // Test RENDER mode
  console.log('5. Testing RENDER mode...');
  await page.evaluate(() => window.__engine.setRenderMode('render'));
  await new Promise(r => setTimeout(r, 1000));

  if (stage) {
    await stage.screenshot({ path: path.join(outDir, 'dirt_road_no_gaps_render.png') });
  }

  // Inspect material textures
  const matInfo = await page.evaluate(() => {
    const film = window.__engine.film;
    const mats = [];
    film.scene.traverse((o) => {
      if (o.isMesh && o.material) {
        const arr = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of arr) {
          if (!mats.some(x => x.name === m.name)) {
            mats.push({
              name: m.name,
              type: m.type,
              hasMap: !!m.map,
              hasNormalMap: !!m.normalMap,
              reduced: !!m.map?.userData?.__reduced,
              color: '#' + (m.color ? m.color.getHexString() : 'ffffff')
            });
          }
        }
      }
    });
    return mats;
  });

  console.log('Sample Materials Summary:', matInfo.slice(0, 15));

  await browser.close();
  console.log('Test completed successfully!');
}

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
