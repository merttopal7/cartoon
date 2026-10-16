import puppeteer from 'puppeteer-core';

async function test() {
  console.log('Testing Ormanın Bekçileri - Bölüm 1 (Bird Eye Forest Roam + Pushups + Kicks + Dance)...');
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
    args: ['--no-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('http://localhost:5174/', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));

  console.log('Loading bolum-1-ormanin-bekcileri scenario...');
  await page.evaluate(async () => {
    await window.__engine?.loadScenario('bolum-1-ormanin-bekcileri');
  });

  console.log('Waiting for film build...');
  await page.waitForFunction(() => {
    const overlay = document.querySelector('#loading-overlay');
    return !overlay || overlay.hasAttribute('hidden') || overlay.style.display === 'none';
  }, { timeout: 45000 });
  await new Promise(r => setTimeout(r, 2500));

  const check = await page.evaluate(() => {
    const f = window.__engine?.film;
    return {
      title: f?.title,
      duration: f?.duration,
      fadeAt0: f?.fade,
      shotsCount: f?.scenes?.[0]?.shots?.length,
      audioCuesCount: f?.audio?.getCues?.()?.length,
    };
  });
  console.log('Film Check on Load:', check);

  const stage = await page.$('#stage');

  async function captureAt(t, name) {
    console.log(`Capturing t=${t}s (${name})...`);
    await page.evaluate((seekTime) => {
      const scrub = document.querySelector('#scrub');
      scrub.value = String(seekTime);
      scrub.dispatchEvent(new Event('input', { bubbles: true }));
    }, t);
    await new Promise(r => setTimeout(r, 600));
    if (stage) {
      await stage.screenshot({
        path: `C:/Users/DELL/.gemini/antigravity/brain/1944cbe1-f58c-4194-98cf-691279cd623a/${name}.png`
      });
    }
  }

  // 1) Shot 1: Bird's eye forest roam (kuş uçuşu orman gezintisi)
  await captureAt(2.0, 'birds_eye_forest_roam_1');
  await captureAt(8.0, 'birds_eye_forest_roam_2');

  // 2) Shot 2: Camera descends to road, Toprak does push-ups, then introduces himself
  await captureAt(16.0, 'birds_eye_toprak_pushup');
  await captureAt(21.0, 'birds_eye_toprak_speaks');

  // 3) Shot 3: Defne kick & intro
  await captureAt(30.5, 'birds_eye_defne_kick');
  await captureAt(33.0, 'birds_eye_defne_speaks');

  // 4) Shot 4: Meşe jump & intro
  await captureAt(42.5, 'birds_eye_mese_jump');
  await captureAt(45.0, 'birds_eye_mese_speaks');

  // 5) Shot 5: All 3 characters doing the SAME dance together!
  await captureAt(56.0, 'birds_eye_group_dance_together');

  // Full page view
  await page.screenshot({
    path: 'C:/Users/DELL/.gemini/antigravity/brain/1944cbe1-f58c-4194-98cf-691279cd623a/birds_eye_full_page.png'
  });

  await browser.close();
  console.log('Console Errors:', consoleErrors);
  console.log('Full visual test with bird eye view completed successfully!');
}

test().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
