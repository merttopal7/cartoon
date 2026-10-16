import puppeteer from 'puppeteer-core';
import path from 'path';

async function test() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
    args: ['--no-sandbox', '--window-size=1280,720']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  await page.click('#load-forest');
  await page.waitForFunction(() => window.__engine?.film?.scenes[0]?.id === 'toprak-yol', { timeout: 30000 });
  await new Promise(r => setTimeout(r, 1000));

  const times = [6.8, 7.14, 7.26, 7.4];
  const outDir = 'C:/Users/DELL/.gemini/antigravity/brain/1944cbe1-f58c-4194-98cf-691279cd623a';

  for (const t of times) {
    const info = await page.evaluate((timeVal) => {
      const eng = window.__engine;
      const film = eng.film;
      film.evaluate(timeVal, { width: 1280, height: 720, aspect: '16:9' });
      eng.viewport.render(film);
      const amy = film.scenes[0].characters.get('amy');
      return {
        timeVal,
        mouth: amy?.pose?.mouth,
        headPitch: amy?.pose?.headPitch,
      };
    }, t);
    console.log('Capture at t =', t, info);
    const canvas = await page.$('#canvas');
    await canvas.screenshot({ path: path.join(outDir, `amy_speaking_t${t}.png`) });
  }

  await browser.close();
}

test().catch(console.error);
