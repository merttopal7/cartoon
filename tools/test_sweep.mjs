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

  // Test bird's eye sweep angles
  const sweepTimes = [0.1, 4.0, 8.0, 11.5];
  for (const t of sweepTimes) {
    await page.evaluate((time) => {
      const f = window.__engine?.film;
      const shot = f.scenes[0].shots[0];
      shot.camera.target = [10, 0, 42];
      shot.camera.relative = false;
      shot.camera.size = { from: 38, to: 24 };
      shot.camera.elevation = { from: 58, to: 46 };
      shot.camera.angle = { from: 35, to: 75 };
      const scrub = document.querySelector('#scrub');
      scrub.value = String(time);
      scrub.dispatchEvent(new Event('input', { bubbles: true }));
    }, t);
    await new Promise(r => setTimeout(r, 400));
    const stage = await page.$('#stage');
    if (stage) {
      await stage.screenshot({ path: `C:/Users/DELL/.gemini/antigravity/brain/1944cbe1-f58c-4194-98cf-691279cd623a/birds_eye_sweep_${t}.png` });
    }
  }

  await browser.close();
  console.log('Tested bird eye sweep successfully');
}

run().catch(console.error);
