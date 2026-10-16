import puppeteer from 'puppeteer-core';

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

  const info = await page.evaluate((t) => {
    const eng = window.__engine;
    const film = eng.film;
    film.evaluate(t, { width: 1280, height: 720, aspect: '16:9' });
    eng.viewport.render(film);
    const amy = film.scenes[0].characters.get('amy');
    return {
      mouth: amy?.pose?.mouth,
      mouthBones: amy?.rig?.mouthBones?.map(b => b.name),
      mouthAxis: amy?.rig?.mouthAxis,
      mouthOpen: amy?.rig?.mouthOpen,
    };
  }, 7.2);
  console.log('Amy info at 7.2:', JSON.stringify(info, null, 2));

  const canvas = await page.$('#canvas');
  await canvas.screenshot({ path: 'C:/Users/DELL/.gemini/antigravity/brain/1944cbe1-f58c-4194-98cf-691279cd623a/amy_talk_t7.2.png' });
  await browser.close();
}
test().catch(console.error);
