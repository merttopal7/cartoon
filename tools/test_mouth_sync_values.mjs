import puppeteer from 'puppeteer-core';

async function main() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  await page.goto('http://localhost:5174/', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));

  await page.waitForFunction(() => {
    const overlay = document.querySelector('#loading-overlay');
    return !overlay || overlay.hidden;
  }, { timeout: 35000 });

  await page.evaluate(async () => {
    await window.__engine.loadScenario('harita-toprak-yol');
  });

  await page.waitForFunction(() => {
    const overlay = document.querySelector('#loading-overlay');
    return !overlay || overlay.hidden;
  }, { timeout: 35000 });
  await new Promise(r => setTimeout(r, 1000));

  const data = await page.evaluate(() => {
    const film = window.__engine.film;
    const timing = film.audio.getSyncTiming();
    const cues = film.audio.getCues();

    const scene = film.scenes[0];
    const characters = Array.from(scene.characters.keys());

    // Check jackie's mouth between t = 3.0 and t = 8.0
    const frames = [];
    const fps = film.fps;
    for (let i = Math.round(3.0 * fps); i <= Math.round(8.0 * fps); i++) {
      const t = i / fps;
      film.evaluate(t, { id: 'test', label: 'test', width: 640, height: 360, fps });
      const jackie = scene.characters.get('jackie');
      const vs = scene.voiceState('jackie', t);
      frames.push({
        t: +t.toFixed(3),
        mouth: jackie ? +jackie.pose.mouth.toFixed(3) : null,
        vsActive: vs?.active,
        vsLevel: vs ? +vs.level.toFixed(3) : 0,
      });
    }

    return {
      characters,
      timing,
      cues: cues.map(c => ({ who: c.who, start: c.start, duration: c.duration, activeStart: c.activeStart, activeEnd: c.activeEnd, hasBuffer: !!c.buffer })),
      frames
    };
  });

  console.log('Characters in scene:', data.characters);
  console.log('Sync timing in engine:', data.timing);
  console.log('Audio cues:', data.cues);

  const activeMouthFrames = data.frames.filter(f => f.mouth > 0.05);
  console.log('\nTotal active mouth frames (> 0.05):', activeMouthFrames.length);
  if (activeMouthFrames.length > 0) {
    console.log('First active mouth frame:', activeMouthFrames[0]);
    console.log('Last active mouth frame:', activeMouthFrames[activeMouthFrames.length - 1]);
  }

  // Print all frames around transition
  console.log('\n--- FRAMES AROUND 3.5s - 4.5s ---');
  for (const f of data.frames.filter(f => f.t >= 3.5 && f.t <= 4.5)) {
    console.log(`t=${f.t}s: mouth=${f.mouth} vsActive=${f.vsActive} vsLevel=${f.vsLevel}`);
  }

  console.log('\n--- FRAMES AROUND 6.5s - 7.6s ---');
  for (const f of data.frames.filter(f => f.t >= 6.5 && f.t <= 7.6)) {
    console.log(`t=${f.t}s: mouth=${f.mouth} vsActive=${f.vsActive} vsLevel=${f.vsLevel}`);
  }

  await browser.close();
}

main().catch(console.error);
