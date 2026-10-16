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

  const panoramicSetups = [
    // 1. Looking across the forest toward the mountain from high up
    { name: 'pano_mountain_view', target: [20, 0, 40], size: 28, angle: 30, el: 22, rel: false },
    // 2. High bird's eye view over the entire valley
    { name: 'pano_valley_birds_eye', target: [15, 0, 42], size: 35, angle: 45, el: 32, rel: false },
    // 3. Wide sweep from the road bend
    { name: 'pano_road_bend_sweep', target: [10, 0, 38], size: 25, angle: 70, el: 28, rel: false },
    // 4. Grand aerial canopy view
    { name: 'pano_grand_aerial', target: [18, 0, 42], size: 30, angle: 100, el: 30, rel: false },
  ];

  for (const s of panoramicSetups) {
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
  console.log('Tested panoramic setups successfully');
}

run().catch(console.error);
