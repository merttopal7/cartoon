import puppeteer from 'puppeteer-core';

async function run() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto('http://localhost:5174/', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));
  await page.evaluate(async () => {
    await window.__engine?.loadScenario('bolum-1-ormanin-bekcileri');
  });
  await page.waitForFunction(() => {
    const overlay = document.querySelector('#loading-overlay');
    return !overlay || overlay.hasAttribute('hidden') || overlay.style.display === 'none';
  }, { timeout: 35000 });
  await new Promise(r => setTimeout(r, 1000));

  await page.evaluate(() => {
    const THREE = window.__engine.THREE;
    const f = window.__engine.film;
    const scene = f.scenes[0];

    scene.group.traverse(o => {
      if (o.isMesh && o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          const name = m.name.toLowerCase();
          m.userData.outlineParameters = { visible: false };

          if (name.includes('pine_v2')) {
            m.transparent = false;
            m.alphaTest = 0.5;
            m.depthWrite = true;
            m.side = THREE.DoubleSide;
            m.roughness = 0.85;
          } else if (name.includes('bark')) {
            m.transparent = false;
            m.depthWrite = true;
            m.side = THREE.FrontSide;
            m.roughness = 0.9;
          } else if (name.includes('leaves') || name.includes('bush') || name.includes('vegetation')) {
            m.transparent = false;
            m.alphaTest = 0.5;
            m.depthWrite = true;
            m.side = THREE.DoubleSide;
          } else if (name.includes('trail') || name.includes('puddle') || name.includes('decal') || name.includes('edge')) {
            m.transparent = true;
            m.depthWrite = false;
            m.polygonOffset = true;
            m.polygonOffsetFactor = -1;
            m.polygonOffsetUnits = -1;
          } else {
            // Solid terrain: Dirt_Road, Aerial_Grass, Rocks, etc.
            m.transparent = false;
            m.depthWrite = true;
            m.side = THREE.FrontSide;
          }
          m.needsUpdate = true;
        }
      }
    });

    const scrub = document.querySelector('#scrub');
    scrub.value = '2.0';
    scrub.dispatchEvent(new Event('input', { bubbles: true }));
  });

  await new Promise(r => setTimeout(r, 600));
  const stage = await page.$('#stage');
  if (stage) {
    await stage.screenshot({ path: 'C:/Users/DELL/.gemini/antigravity/brain/1944cbe1-f58c-4194-98cf-691279cd623a/test_alpha_fix.png' });
  }

  await browser.close();
  console.log('Tested alpha fix successfully');
}

run().catch(console.error);
