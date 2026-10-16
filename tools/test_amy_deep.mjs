import puppeteer from 'puppeteer-core';
import fs from 'fs';

async function run() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 800 });
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  await page.click('#load-forest');
  await page.waitForFunction(() => window.__engine?.film?.scenes[0]?.id === 'toprak-yol', { timeout: 30000 });
  await new Promise(r => setTimeout(r, 1000));

  const tests = [
    { label: 'neg_08_top_0', btm: -0.8, top: 0 },
    { label: 'neg_12_top_0', btm: -1.2, top: 0 },
    { label: 'neg_12_top_04', btm: -1.2, top: 0.4 },
    { label: 'neg_15_top_05', btm: -1.5, top: 0.5 },
  ];

  for (const t of tests) {
    const dataUrl = await page.evaluate((testCfg) => {
      const THREE = window.__engine.THREE;
      const eng = window.__engine;
      const film = eng.film;
      film.evaluate(7.4, { width: 800, height: 800, aspect: '1:1' });
      const amy = film.scenes[0].characters.get('amy');
      const axisY = new THREE.Vector3(0, 1, 0);
      const tmpQ = new THREE.Quaternion();
      
      amy.rig.root.traverse((o) => {
        if (o.isBone) {
          if (/lip_btm|teeth_low/i.test(o.name)) {
            o.quaternion.multiply(tmpQ.setFromAxisAngle(axisY, testCfg.btm));
          }
          if (/lip_top|teeth_up/i.test(o.name) && testCfg.top !== 0) {
            o.quaternion.multiply(tmpQ.setFromAxisAngle(axisY, testCfg.top));
          }
        }
      });
      eng.viewport.render(film);
      return document.querySelector('#canvas').toDataURL('image/png');
    }, t);
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(`C:/Users/DELL/.gemini/antigravity/brain/1944cbe1-f58c-4194-98cf-691279cd623a/amy_test_${t.label}.png`, base64, 'base64');
    console.log('Saved', t.label);
  }
  await browser.close();
}
run().catch(console.error);
