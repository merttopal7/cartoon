import puppeteer from 'puppeteer-core';

async function main() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
    args: ['--no-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 800 });

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));

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

  const result = await page.evaluate(() => {
    const engine = window.__engine;
    const scene = engine.film ? engine.film.scenes[0] : null;
    if (!scene) return { error: 'no film or scene' };

    // Set to render mode
    engine.setRenderMode('render');

    // List all meshes in the scene and their visibility
    const meshes = [];
    scene.group.traverse(o => {
      if (o.isMesh) {
        const matNames = Array.isArray(o.material) ? o.material.map(m => m?.name) : [o.material?.name];
        meshes.push({
          name: o.name,
          visible: o.visible,
          matNames,
        });
      }
    });

    // Check character positions across time
    const trajectory = [];
    const characters = ['jackie', 'amy', 'cocuk'];
    for (let t = 0; t <= 20; t += 1.0) {
      const posObj = { t };
      for (const charId of characters) {
        try {
          const pos = scene.positionOf(charId, t);
          posObj[charId] = { x: +pos.x.toFixed(2), y: +pos.y.toFixed(2), z: +pos.z.toFixed(2) };
        } catch (e) {
          posObj[charId] = e.message;
        }
      }
      trajectory.push(posObj);
    }

    return { meshes, trajectory };
  });

  console.log('RESULT:', result);
  if (result.meshes) {
    console.log('--- MESHES IN RENDER MODE ---');
    for (const m of result.meshes) {
      console.log(`Mesh: "${m.name}" | visible: ${m.visible} | mats: ${m.matNames.join(', ')}`);
    }
  }

  console.log('\n--- TRAJECTORY ---');
  for (const p of result.trajectory) {
    console.log(`t=${p.t}s: jackie=[${p.jackie?.x}, ${p.jackie?.y}, ${p.jackie?.z}] amy=[${p.amy?.x}, ${p.amy?.y}, ${p.amy?.z}] cocuk=[${p.cocuk?.x}, ${p.cocuk?.y}, ${p.cocuk?.z}]`);
  }

  await browser.close();
}

main().catch(console.error);
