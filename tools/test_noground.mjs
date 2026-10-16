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
    const f = window.__engine.film;
    const scene = f.scenes[0];
    
    // Hide flat ground plane if present
    const gp = scene.group.getObjectByName('under_ground_skirt');
    if (gp) gp.visible = false;
    scene.group.traverse(o => {
      if (o.geometry && o.geometry.type === 'CircleGeometry') {
        o.visible = false;
      }
    });

    const scrub = document.querySelector('#scrub');
    scrub.value = '2.0';
    scrub.dispatchEvent(new Event('input', { bubbles: true }));
  });

  await new Promise(r => setTimeout(r, 600));
  const stage = await page.$('#stage');
  if (stage) {
    await stage.screenshot({ path: 'C:/Users/DELL/.gemini/antigravity/brain/1944cbe1-f58c-4194-98cf-691279cd623a/test_no_ground_circle.png' });
  }

  await browser.close();
  console.log('Tested without ground circle successfully');
}

run().catch(console.error);
