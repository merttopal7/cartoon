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

  const configs = [
    { name: 'current_035', btmAngle: -0.35, topAngle: 0 },
    { name: 'strong_060', btmAngle: -0.60, topAngle: 0 },
    { name: 'both_lips_050_020', btmAngle: -0.50, topAngle: 0.20 },
    { name: 'both_lips_065_025', btmAngle: -0.65, topAngle: 0.25 },
  ];

  for (const cfg of configs) {
    const dataUrl = await page.evaluate((c) => {
      const THREE = window.__engine.THREE;
      const eng = window.__engine;
      const film = eng.film;
      film.evaluate(7.4, { width: 1280, height: 720, aspect: '16:9' });
      
      const amy = film.scenes[0].characters.get('amy');
      const root = amy.rig.root;
      
      // Find btm and top bones
      const tmpQ = new THREE.Quaternion();
      const axisY = new THREE.Vector3(0, 1, 0);
      
      root.traverse((o) => {
        if (o.isBone) {
          if (/lip_btm|teeth_low/i.test(o.name)) {
            o.quaternion.multiply(tmpQ.setFromAxisAngle(axisY, c.btmAngle));
          }
          if (/lip_top|teeth_up/i.test(o.name) && c.topAngle !== 0) {
            o.quaternion.multiply(tmpQ.setFromAxisAngle(axisY, c.topAngle));
          }
        }
      });
      
      eng.viewport.render(film);
      return document.querySelector('#canvas').toDataURL('image/png');
    }, cfg);
    
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(`C:/Users/DELL/.gemini/antigravity/brain/1944cbe1-f58c-4194-98cf-691279cd623a/amy_test_${cfg.name}.png`, base64, 'base64');
    console.log('Tested', cfg.name);
  }

  await browser.close();
}

test().catch(console.error);
