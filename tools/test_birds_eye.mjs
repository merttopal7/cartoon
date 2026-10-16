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

  // Test different birds-eye camera setups
  const setups = [
    // Setup A: World coordinates bird's eye target at forest center
    { name: 'birds_eye_target_fixed_high', target: [0, 5, 40], size: 28, angle: 45, el: 45, rel: false },
    { name: 'birds_eye_target_fixed_high_60', target: [0, 5, 40], size: 35, angle: 60, el: 55, rel: false },
    { name: 'birds_eye_target_toprak_size15_el35', target: 'toprak', size: 15, angle: 30, el: 35, rel: true },
    { name: 'birds_eye_target_toprak_size12_el45', target: 'toprak', size: 12, angle: 40, el: 45, rel: true },
    { name: 'birds_eye_target_toprak_size8_el30', target: 'toprak', size: 8, angle: 25, el: 30, rel: true },
  ];

  for (const s of setups) {
    await page.evaluate((cfg) => {
      const f = window.__engine?.film;
      const shot = f.scenes[0].shots[0];
      shot.camera.target = cfg.target;
      shot.camera.angle = cfg.angle;
      shot.camera.size = cfg.size;
      shot.camera.elevation = cfg.el;
      shot.camera.relative = cfg.rel;
      const scrub = document.querySelector('#scrub');
      scrub.value = '0.1';
      scrub.dispatchEvent(new Event('input', { bubbles: true }));
    }, s);
    await new Promise(r => setTimeout(r, 400));
    const stage = await page.$('#stage');
    if (stage) {
      await stage.screenshot({ path: `C:/Users/DELL/.gemini/antigravity/brain/1944cbe1-f58c-4194-98cf-691279cd623a/${s.name}.png` });
    }
  }

  await browser.close();
  console.log('Tested birds-eye setups successfully');
}

run().catch(console.error);
