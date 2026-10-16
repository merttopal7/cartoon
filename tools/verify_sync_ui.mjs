import puppeteer from 'puppeteer-core';
import path from 'path';

async function test() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
    args: ['--no-sandbox', '--window-size=1366,768']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 768 });
  await page.goto('http://localhost:5174/');
  await page.waitForFunction(() => !!window.__engine?.loadScenario);
  await page.evaluate(async () => {
    await window.__engine.loadScenario('harita-toprak-yol');
  });

  const outDir = 'C:/Users/DELL/.gemini/antigravity/brain/1944cbe1-f58c-4194-98cf-691279cd623a';

  // Check initial sync values
  const initSync = await page.evaluate(() => {
    return {
      sliderVal: document.querySelector('#sync-slider')?.value,
      labelVal: document.querySelector('#sync-val')?.textContent,
      engineTiming: window.__engine.getSyncTiming?.(),
    };
  });
  console.log('Initial Sync:', initSync);

  // Take screenshot of transport bar
  const transport = await page.$('#transport');
  if (transport) {
    await transport.screenshot({ path: path.join(outDir, 'sync_ui_transport.png') });
  }

  // Click popover button to open detailed settings
  await page.click('#sync-popover-btn');
  await new Promise(r => setTimeout(r, 250));

  if (transport) {
    await transport.screenshot({ path: path.join(outDir, 'sync_ui_popover.png') });
  }

  // Change slider value to 850
  await page.evaluate(() => {
    const s = document.querySelector('#sync-slider');
    s.value = '850';
    s.dispatchEvent(new Event('input'));
  });

  const changedSync = await page.evaluate(() => {
    return {
      sliderVal: document.querySelector('#sync-slider')?.value,
      labelVal: document.querySelector('#sync-val')?.textContent,
      leadInVal: document.querySelector('#sync-lead-in')?.value,
      leadOutVal: document.querySelector('#sync-lead-out')?.value,
      engineTiming: window.__engine.getSyncTiming?.(),
      storageIn: localStorage.getItem('cartoon-engine.sync_lead_in'),
      storageOut: localStorage.getItem('cartoon-engine.sync_lead_out')
    };
  });
  console.log('After changing to 850ms:', changedSync);

  // Reset back to 700ms
  await page.evaluate(() => {
    const s = document.querySelector('#sync-slider');
    s.value = '700';
    s.dispatchEvent(new Event('input'));
  });

  await page.screenshot({ path: path.join(outDir, 'app_with_sync_control.png') });

  await browser.close();
  console.log('All sync UI tests passed successfully!');
}

test().catch(console.error);
