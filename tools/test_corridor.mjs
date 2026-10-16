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

  // Trajectory 1: Along road corridor angle 90 (relative: false)
  await page.evaluate(() => {
    const f = window.__engine?.film;
    const shot = f.scenes[0].shots[0];
    shot.camera.target = 'toprak';
    shot.camera.relative = false;
    shot.camera.size = { from: 22, to: 1.8 };
    shot.camera.elevation = { from: 58, to: 5.5 };
    shot.camera.angle = { from: 95, to: 92 };
  });

  const times = [0.1, 3.0, 6.0, 9.0, 12.0];
  for (const t of times) {
    await page.evaluate((time) => {
      const scrub = document.querySelector('#scrub');
      scrub.value = String(time);
      scrub.dispatchEvent(new Event('input', { bubbles: true }));
    }, t);
    await new Promise(r => setTimeout(r, 400));
    const stage = await page.$('#stage');
    if (stage) {
      await stage.screenshot({ path: `C:/Users/DELL/.gemini/antigravity/brain/1944cbe1-f58c-4194-98cf-691279cd623a/corridor_${t}.png` });
    }
  }

  await browser.close();
  console.log('Tested corridor path successfully');
}

run().catch(console.error);
