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

  // Load harita-toprak-yol scenario
  console.log('2. Loading harita-toprak-yol scenario...');
  await page.evaluate(async () => {
    await window.__engine.loadScenario('harita-toprak-yol');
  });

  // Wait for models to load
  await page.waitForFunction(() => {
    const overlay = document.querySelector('#loading-overlay');
    return !overlay || overlay.hidden;
  }, { timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));

  // Scrub past initial fade-in (fade_in is 0.8s) to t = 2.5s
  console.log('Scrubbing to t = 2.5s...');
  await page.evaluate(() => {
    const scrub = document.querySelector('#scrub');
    if (scrub) {
      scrub.value = '2.5';
      scrub.dispatchEvent(new Event('input'));
      scrub.dispatchEvent(new Event('change'));
    }
  });
  await new Promise(r => setTimeout(r, 800));

  // Set mode to preview
  console.log('3. Setting mode to PREVIEW...');
  await page.evaluate(() => {
    window.__engine.setRenderMode('preview');
  });
  await new Promise(r => setTimeout(r, 1000));

  // Analyze visible objects in Preview Mode
  const previewStats = await page.evaluate(() => {
    const film = window.__engine.film;
    let totalMeshes = 0;
    let visibleMeshes = 0;
    let totalPines = 0;
    let visiblePines = 0;
    let clutterVisible = 0;

    film.scene.traverse((o) => {
      if (o.isMesh) {
        totalMeshes++;
        if (o.visible) visibleMeshes++;
        if (/pine|realistic/i.test(o.name)) {
          totalPines++;
          if (o.visible) visiblePines++;
        }
        if (/grass|fallen|puddle|decal|gravel|broken_rock|mud_pile/i.test(o.name)) {
          if (o.visible) clutterVisible++;
        }
      }
    });

    return { totalMeshes, visibleMeshes, totalPines, visiblePines, clutterVisible };
  });

  console.log('Preview Stats on harita-toprak-yol:', previewStats);

  // Take screenshot in preview mode
  const stage = await page.$('#stage');
  if (stage) {
    await stage.screenshot({ path: path.join(outDir, 'dirt_road_preview_stage.png') });
  }
  await page.screenshot({ path: path.join(outDir, 'dirt_road_preview_full.png') });

  // Switch to Render mode
  console.log('4. Setting mode to RENDER...');
  await page.evaluate(() => {
    window.__engine.setRenderMode('render');
  });
  await new Promise(r => setTimeout(r, 1000));

  // Analyze visible objects in Render Mode
  const renderStats = await page.evaluate(() => {
    const film = window.__engine.film;
    let totalMeshes = 0;
    let visibleMeshes = 0;
    let totalPines = 0;
    let visiblePines = 0;
    let clutterVisible = 0;

    film.scene.traverse((o) => {
      if (o.isMesh) {
        totalMeshes++;
        if (o.visible) visibleMeshes++;
        if (/pine|realistic/i.test(o.name)) {
          totalPines++;
          if (o.visible) visiblePines++;
        }
        if (/grass|fallen|puddle|decal|gravel|broken_rock|mud_pile/i.test(o.name)) {
          if (o.visible) clutterVisible++;
        }
      }
    });

    return { totalMeshes, visibleMeshes, totalPines, visiblePines, clutterVisible };
  });

  console.log('Render Stats on harita-toprak-yol:', renderStats);

  // Take screenshot in render mode
  if (stage) {
    await stage.screenshot({ path: path.join(outDir, 'dirt_road_render_stage.png') });
  }
  await page.screenshot({ path: path.join(outDir, 'dirt_road_render_full.png') });

  // Switch back to Preview mode
  console.log('5. Switching back to Preview mode...');
  await page.evaluate(() => {
    window.__engine.setRenderMode('preview');
  });
  await new Promise(r => setTimeout(r, 500));

  await browser.close();
  console.log('Verification finished successfully!');
}

main().catch(err => {
  console.error('Error during verification:', err);
  process.exit(1);
});
