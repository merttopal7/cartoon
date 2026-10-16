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

  console.log('1. Navigating to cartoon engine...');
  await page.goto('http://localhost:5174/', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));

  // Wait for loading overlay to disappear
  await page.waitForFunction(() => {
    const overlay = document.querySelector('#loading-overlay');
    return !overlay || overlay.hidden;
  }, { timeout: 35000 });
  await new Promise(r => setTimeout(r, 1000));

  // Ensure harita-toprak-yol is loaded
  const currentTitle = await page.evaluate(async () => {
    const active = window.__engine.scenarios.getActiveId();
    if (active !== 'harita-toprak-yol') {
      await window.__engine.loadScenario('harita-toprak-yol');
    }
    return window.__engine.scenarios.getActiveId();
  });
  console.log('Active scenario:', currentTitle);

  await page.waitForFunction(() => {
    const overlay = document.querySelector('#loading-overlay');
    return !overlay || overlay.hidden;
  }, { timeout: 35000 });
  await new Promise(r => setTimeout(r, 1500));

  // 1. Test RENDER MODE
  console.log('2. Testing RENDER MODE...');
  await page.evaluate(() => {
    window.__engine.setRenderMode('render');
  });
  await new Promise(r => setTimeout(r, 1000));

  const stage = await page.$('#stage');

  // Scrub to t = 2.0s (mid-walk)
  console.log('3. Scrubbing to t = 2.0s in RENDER mode...');
  await page.evaluate(() => {
    const scrub = document.querySelector('#scrub');
    if (scrub) {
      scrub.value = '2.0';
      scrub.dispatchEvent(new Event('input'));
      scrub.dispatchEvent(new Event('change'));
    }
  });
  await new Promise(r => setTimeout(r, 1000));

  if (stage) {
    await stage.screenshot({ path: path.join(outDir, 'render_mode_walk_t2.png') });
  }

  // Scrub to t = 6.0s (dialogue, full road overview)
  console.log('4. Scrubbing to t = 6.0s in RENDER mode...');
  await page.evaluate(() => {
    const scrub = document.querySelector('#scrub');
    if (scrub) {
      scrub.value = '6.0';
      scrub.dispatchEvent(new Event('input'));
      scrub.dispatchEvent(new Event('change'));
    }
  });
  await new Promise(r => setTimeout(r, 1000));

  if (stage) {
    await stage.screenshot({ path: path.join(outDir, 'render_mode_dialogue_t6.png') });
  }

  // 2. Test PREVIEW MODE
  console.log('5. Testing PREVIEW MODE...');
  await page.evaluate(() => {
    window.__engine.setRenderMode('preview');
  });
  await new Promise(r => setTimeout(r, 1000));

  // Scrub to t = 2.0s in PREVIEW mode
  await page.evaluate(() => {
    const scrub = document.querySelector('#scrub');
    if (scrub) {
      scrub.value = '2.0';
      scrub.dispatchEvent(new Event('input'));
      scrub.dispatchEvent(new Event('change'));
    }
  });
  await new Promise(r => setTimeout(r, 1000));

  if (stage) {
    await stage.screenshot({ path: path.join(outDir, 'preview_mode_walk_t2.png') });
  }

  // Check character heights at t = 2.0s
  const check = await page.evaluate(() => {
    const scene = window.__engine.film.scenes[0];
    const posJackie = scene.positionOf('jackie', 2.0);
    const posAmy = scene.positionOf('amy', 2.0);
    const posCocuk = scene.positionOf('cocuk', 2.0);

    const meshes = [];
    scene.group.traverse(o => {
      if (o.isMesh && (o.name.includes('Road') || o.name.includes('Grass') || o.name.includes('Aerial') || o.name.includes('Gravel'))) {
        meshes.push({ name: o.name, visible: o.visible });
      }
    });

    return {
      jackie: { x: posJackie.x.toFixed(2), y: posJackie.y.toFixed(2), z: posJackie.z.toFixed(2) },
      amy: { x: posAmy.x.toFixed(2), y: posAmy.y.toFixed(2), z: posAmy.z.toFixed(2) },
      cocuk: { x: posCocuk.x.toFixed(2), y: posCocuk.y.toFixed(2), z: posCocuk.z.toFixed(2) },
      meshes
    };
  });

  console.log('\n--- VERIFICATION REPORT ---');
  console.log('Jackie position at t=2.0s:', check.jackie);
  console.log('Amy position at t=2.0s:', check.amy);
  console.log('Cocuk position at t=2.0s:', check.cocuk);
  console.log('Key terrain mesh visibility:');
  for (const m of check.meshes) {
    console.log(`  - ${m.name}: visible=${m.visible}`);
  }

  await browser.close();
  console.log('\nVerification completed successfully!');
}

main().catch(console.error);
