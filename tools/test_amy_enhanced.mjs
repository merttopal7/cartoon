import puppeteer from 'puppeteer-core';
import fs from 'fs';

async function run() {
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

  const dataUrl = await page.evaluate(() => {
    const THREE = window.__engine.THREE;
    const eng = window.__engine;
    const film = eng.film;
    film.evaluate(7.4, { width: 1280, height: 720, aspect: '16:9' });
    const amy = film.scenes[0].characters.get('amy');
    
    // Apply enhanced mouth opening:
    const tmpQ = new THREE.Quaternion();
    const axisY = new THREE.Vector3(0, 1, 0);
    const m = amy.pose.mouth; // at 7.4 it is ~0.96

    amy.rig.root.traverse((o) => {
      if (o.isBone) {
        if (/lip_btm|teeth_low/i.test(o.name)) {
          // strong lower lip drop
          o.quaternion.multiply(tmpQ.setFromAxisAngle(axisY, -0.85 * m));
          o.position.y -= 0.03 * m;
        }
        if (/lip_top|teeth_up/i.test(o.name)) {
          // upper lip lift
          o.quaternion.multiply(tmpQ.setFromAxisAngle(axisY, 0.45 * m));
          o.position.y += 0.015 * m;
        }
      }
    });

    eng.viewport.render(film);
    return document.querySelector('#canvas').toDataURL('image/png');
  });

  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  fs.writeFileSync('C:/Users/DELL/.gemini/antigravity/brain/1944cbe1-f58c-4194-98cf-691279cd623a/amy_enhanced_test.png', base64, 'base64');
  console.log('Saved amy_enhanced_test.png');

  await browser.close();
}

run().catch(console.error);
