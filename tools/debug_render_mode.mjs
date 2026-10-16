import puppeteer from 'puppeteer-core';
import path from 'path';

async function main() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
    args: ['--no-sandbox', '--window-size=1400,900']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  const outDir = 'C:/Users/DELL/.gemini/antigravity/brain/1944cbe1-f58c-4194-98cf-691279cd623a';

  await page.goto('http://localhost:5174/', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));

  console.log('Loading harita-toprak-yol...');
  await page.evaluate(async () => {
    await window.__engine.loadScenario('harita-toprak-yol');
  });

  await page.waitForFunction(() => {
    const overlay = document.querySelector('#loading-overlay');
    return !overlay || overlay.hidden;
  }, { timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));

  // Set to render mode
  await page.evaluate(() => {
    window.__engine.setRenderMode('render');
  });
  await new Promise(r => setTimeout(r, 500));

  const times = [1.0, 2.5, 4.0, 6.0];
  const stage = await page.$('#stage');

  for (const t of times) {
    console.log(`Scrubbing to t=${t}...`);
    await page.evaluate((val) => {
      const scrub = document.querySelector('#scrub');
      if (scrub) {
        scrub.value = String(val);
        scrub.dispatchEvent(new Event('input'));
        scrub.dispatchEvent(new Event('change'));
      }
    }, t);
    await new Promise(r => setTimeout(r, 800));

    if (stage) {
      await stage.screenshot({ path: path.join(outDir, `render_mode_debug_t${t}.png`) });
    }
  }

  // Also inspect what meshes are visible / invisible in currentScene!
  const meshStates = await page.evaluate(() => {
    const scene = window.__engine.film.scenes[0];
    const info = [];
    scene.group.traverse(o => {
      if (o.isMesh) {
        info.push({
          name: o.name,
          visible: o.visible,
          mat: Array.isArray(o.material) ? o.material.map(m=>m?.name) : [o.material?.name],
        });
      }
    });
    return info;
  });

  console.log('Visible meshes count in render mode:', meshStates.filter(m => m.visible).length);
  console.log('Invisible meshes count in render mode:', meshStates.filter(m => !m.visible).length);
  console.log('\n--- INVISIBLE MESHES IN RENDER MODE ---');
  for (const m of meshStates.filter(m => !m.visible)) {
    console.log(`  - "${m.name}" | mat: ${m.mat.join(', ')}`);
  }

  await browser.close();
}

main().catch(console.error);
