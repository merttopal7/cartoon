import puppeteer from 'puppeteer-core';
import fs from 'fs';

async function test() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  await page.click('#load-forest');
  await page.waitForFunction(() => window.__engine?.film?.scenes[0]?.id === 'toprak-yol', { timeout: 30000 });
  await new Promise(r => setTimeout(r, 1000));

  for (const t of [7.14, 7.26, 7.4]) {
    const dataUrl = await page.evaluate((timeVal) => {
      const eng = window.__engine;
      const film = eng.film;
      film.evaluate(timeVal, { width: 1280, height: 720, aspect: '16:9' });
      eng.viewport.render(film);
      return document.querySelector('#canvas').toDataURL('image/png');
    }, t);
    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(`C:/Users/DELL/.gemini/antigravity/brain/1944cbe1-f58c-4194-98cf-691279cd623a/amy_dataurl_t${t}.png`, base64Data, 'base64');
    console.log('Saved dataurl for t =', t);
  }
  await browser.close();
}
test().catch(console.error);
