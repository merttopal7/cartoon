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
  await page.waitForFunction(() => window.__engine?.film?.scenes[0]?.id === 'toprak-yol', { timeout: 35000 });
  await new Promise(r => setTimeout(r, 1200));

  const times = [
    { t: 4.2, label: 'amy_shot1_speaking' },
    { t: 7.14, label: 'amy_shot2_vowel' },
    { t: 7.26, label: 'amy_shot2_closed' },
    { t: 7.40, label: 'amy_shot2_open' },
  ];

  for (const item of times) {
    const dataUrl = await page.evaluate((timeVal) => {
      const eng = window.__engine;
      const film = eng.film;
      film.evaluate(timeVal, { width: 1280, height: 720, aspect: '16:9' });
      eng.viewport.render(film);
      const amy = film.scenes[0].characters.get('amy');
      return {
        dataUrl: document.querySelector('#canvas').toDataURL('image/png'),
        mouth: amy?.pose?.mouth,
        headPitch: amy?.pose?.headPitch,
      };
    }, item.t);
    
    console.log(`t=${item.t}: mouth=${dataUrl.mouth?.toFixed(3)}, headPitch=${dataUrl.headPitch?.toFixed(3)}`);
    const base64Data = dataUrl.dataUrl.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(`C:/Users/DELL/.gemini/antigravity/brain/1944cbe1-f58c-4194-98cf-691279cd623a/${item.label}.png`, base64Data, 'base64');
  }

  await browser.close();
  console.log('All Amy frames captured successfully!');
}

test().catch(console.error);
