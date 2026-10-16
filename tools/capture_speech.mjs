import puppeteer from 'puppeteer-core';
import path from 'path';

async function main() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
    args: ['--no-sandbox', '--window-size=1280,720']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });

  // Click load-forest to load the actual forest scenario
  await page.click('#load-forest');
  // Wait for film to load and have toprak-yol scene
  await page.waitForFunction(() => {
    const film = window.__engine?.film;
    return film && film.scenes.length >= 1 && film.scenes[0].id === 'toprak-yol';
  }, { timeout: 30000 });
  console.log('Forest film (toprak-yol) loaded!');

  const times = [9.8, 10.1, 10.35, 10.6];
  const outDir = 'C:/Users/DELL/.gemini/antigravity/brain/1944cbe1-f58c-4194-98cf-691279cd623a';

  for (const t of times) {
    await page.evaluate((timeVal) => {
      const scrub = document.querySelector('#scrub');
      scrub.value = String(timeVal);
      scrub.dispatchEvent(new Event('input'));
    }, t);
    // wait a moment for next frame render
    await new Promise(r => setTimeout(r, 250));
    const canvas = await page.$('#canvas');
    const outPath = path.join(outDir, `cocuk_speech_t${t}.png`);
    await canvas.screenshot({ path: outPath });
    console.log('Captured', outPath);
  }

  await browser.close();
}

main().catch(console.error);
