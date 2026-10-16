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
    { label: 'trans_y_neg05', type: 'trans', axis: 'y', val: -0.05 },
    { label: 'trans_y_neg15', type: 'trans', axis: 'y', val: -0.15 },
    { label: 'trans_z_neg15', type: 'trans', axis: 'z', val: -0.15 },
    { label: 'rot_y_neg08', type: 'rot', axis: 'y', val: -0.8 },
  ];

  for (const t of tests) {
    const dataUrl = await page.evaluate((testCfg) => {
      const THREE = window.__engine.THREE;
      const eng = window.__engine;
      const film = eng.film;
      film.evaluate(7.4, { width: 800, height: 800, aspect: '1:1' });
      const amy = film.scenes[0].characters.get('amy');
      amy.rig.root.traverse((o) => {
        if (o.isBone && /lip_btm|teeth_low/i.test(o.name)) {
          if (testCfg.type === 'trans') {
            o.position[testCfg.axis] += testCfg.val;
          } else {
            const v = new THREE.Vector3(testCfg.axis === 'x' ? 1 : 0, testCfg.axis === 'y' ? 1 : 0, testCfg.axis === 'z' ? 1 : 0);
            o.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(v, testCfg.val));
          }
        }
      });
      eng.viewport.render(film);
      return document.querySelector('#canvas').toDataURL('image/png');
    }, t);
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(`C:/Users/DELL/.gemini/antigravity/brain/1944cbe1-f58c-4194-98cf-691279cd623a/amy_${t.label}.png`, base64, 'base64');
    console.log('Saved', t.label);
  }
  await browser.close();
}
run().catch(console.error);
