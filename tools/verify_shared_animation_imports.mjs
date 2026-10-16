import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { parseScenario } from '../src/schema.ts';

// 1. Unit Test parseScenario
console.log('--- 1. Testing parseScenario with harita-toprak-yol.yaml ---');
const textToprak = fs.readFileSync('public/scenarios/harita-toprak-yol.yaml', 'utf8');
const parsedToprak = parseScenario(textToprak);
if (!parsedToprak.ok) {
  console.error('Failed to parse harita-toprak-yol:', parsedToprak.errors);
  process.exit(1);
}
console.log('harita-toprak-yol parsed successfully!');
console.log('cocuk animations:', parsedToprak.scenario.assets.cocuk.animations);
console.log('jackie animations:', parsedToprak.scenario.assets.jackie.animations);
console.log('amy animations:', parsedToprak.scenario.assets.amy.animations);

if (!parsedToprak.scenario.assets.cocuk.animations?.idle || !parsedToprak.scenario.assets.amy.animations?.walk) {
  throw new Error('Inherited animations missing on characters in harita-toprak-yol!');
}

console.log('--- 2. Testing parseScenario with bolum-4.yaml ---');
const textBolum4 = fs.readFileSync('public/scenarios/bolum-4.yaml', 'utf8');
const parsedBolum4 = parseScenario(textBolum4);
if (!parsedBolum4.ok) {
  console.error('Failed to parse bolum-4:', parsedBolum4.errors);
  process.exit(1);
}
console.log('bolum-4 parsed successfully!');
console.log('cocuk animations in bolum-4:', Object.keys(parsedBolum4.scenario.assets.cocuk.animations || {}));
console.log('jackie animations in bolum-4:', Object.keys(parsedBolum4.scenario.assets.jackie.animations || {}));
console.log('amy animations in bolum-4:', Object.keys(parsedBolum4.scenario.assets.amy.animations || {}));

// 3. Browser E2E verification
async function testBrowser() {
  console.log('--- 3. Testing in Browser via Puppeteer ---');
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
    args: ['--no-sandbox', '--window-size=1400,850']
  });

  const page = await browser.newPage();
  await page.goto('http://localhost:5174/', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));

  console.log('Loading harita-toprak-yol in browser...');
  await page.evaluate(async () => {
    await window.__engine.loadScenario('harita-toprak-yol');
  });

  await page.waitForFunction(() => {
    const overlay = document.querySelector('#loading-overlay');
    return !overlay || overlay.hidden;
  }, { timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));

  const filmStatus = await page.evaluate(() => {
    const film = window.__engine.film;
    if (!film) return null;
    const scene = film.scenes[0];
    const characters = [];
    for (const [id, c] of scene.characters) {
      characters.push({
        id,
        clips: Array.from(c.rig.actions?.keys() || []),
      });
    }
    return {
      duration: film.duration,
      characters,
    };
  });

  console.log('Browser Film Status on harita-toprak-yol:', JSON.stringify(filmStatus, null, 2));

  await browser.close();
  console.log('All tests passed successfully!');
}

testBrowser().catch(err => {
  console.error('Browser test failed:', err);
  process.exit(1);
});
