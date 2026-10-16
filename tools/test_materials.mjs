import puppeteer from 'puppeteer-core';

async function run() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
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

  // Inspect the materials of the map in the running page
  const matInfo = await page.evaluate(() => {
    const f = window.__engine?.film;
    const scene = f.scenes[0];
    const map = scene.group.children.find(c => c.name.includes('harita') || c.children.some(ch => ch.name.includes('Mesh_Dirt_Road')));
    const mats = [];
    scene.group.traverse(o => {
      if (o.isMesh && o.material) {
        const m = o.material;
        if (!mats.some(x => x.name === m.name)) {
          mats.push({
            name: m.name,
            type: m.type,
            transparent: m.transparent,
            alphaTest: m.alphaTest,
            map: !!m.map,
            color: m.color ? m.color.getHexString() : null,
          });
        }
      }
    });
    return mats;
  });
  console.log('Materials currently in scene:', matInfo.slice(0, 15));
  await browser.close();
}

run().catch(console.error);
