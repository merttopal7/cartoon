import puppeteer from 'puppeteer-core';

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

  await page.evaluate(() => {
    const THREE = window.__engine.THREE;
    const film = window.__engine.film;
    const eng = window.__engine;
    const amy = film.scenes[0].characters.get('amy');
    
    // Evaluate at t = 0 to get initial pose
    film.evaluate(0, { width: 800, height: 800, aspect: '1:1' });

    // Position camera right in front of Amy's mouth
    const head = amy.rig.head;
    const worldPos = new THREE.Vector3();
    head.getWorldPosition(worldPos);
    
    // Amy facing is 90 deg (facing +X or -Z). Let's see Amy's facing
    const facing = amy.pose.facing;
    // in front of Amy is facing vector
    const dx = Math.sin(facing) * 0.55;
    const dz = Math.cos(facing) * 0.55;

    film.camera.position.set(worldPos.x + dx, worldPos.y - 0.05, worldPos.z + dz);
    film.camera.lookAt(worldPos.x, worldPos.y - 0.05, worldPos.z);
    
    // Apply mouth open = 1.0
    amy.pose.mouth = 1.0;
    amy.rig.apply(amy.pose);
    eng.viewport.render(film);
  });

  const canvas = await page.$('#canvas');
  await canvas.screenshot({ path: 'C:/Users/DELL/.gemini/antigravity/brain/1944cbe1-f58c-4194-98cf-691279cd623a/amy_mouth_open_closeview.png' });
  
  // Also capture with mouth = 0.0
  await page.evaluate(() => {
    const film = window.__engine.film;
    const eng = window.__engine;
    const amy = film.scenes[0].characters.get('amy');
    amy.pose.mouth = 0.0;
    amy.rig.apply(amy.pose);
    eng.viewport.render(film);
  });
  await canvas.screenshot({ path: 'C:/Users/DELL/.gemini/antigravity/brain/1944cbe1-f58c-4194-98cf-691279cd623a/amy_mouth_closed_closeview.png' });

  await browser.close();
  console.log('Saved closeviews!');
}
run().catch(console.error);
