import puppeteer from 'puppeteer-core';

async function run() {
  console.log('Testing Mouth/Sync timing persistence across page reloads...');
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
    args: ['--no-sandbox']
  });

  const page = await browser.newPage();
  await page.goto('http://localhost:5174/', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));

  // 1. Initial State
  const initial = await page.evaluate(() => ({
    slider: document.querySelector('#sync-slider')?.value,
    valText: document.querySelector('#sync-val')?.textContent,
    timing: window.__engine?.getSyncTiming()
  }));
  console.log('Initial state on load:', initial);

  // 2. Set to 350ms via transport bar slider
  console.log('Setting mouth timing to 350ms...');
  await page.evaluate(() => {
    const slider = document.querySelector('#sync-slider');
    slider.value = '350';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await new Promise(r => setTimeout(r, 300));

  const afterSet = await page.evaluate(() => ({
    slider: document.querySelector('#sync-slider')?.value,
    valText: document.querySelector('#sync-val')?.textContent,
    localIn: localStorage.getItem('cartoon-engine.sync_lead_in'),
    timing: window.__engine?.getSyncTiming()
  }));
  console.log('State after change:', afterSet);

  // 3. Reload page
  console.log('Reloading page...');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 1500));

  const afterReload1 = await page.evaluate(() => ({
    slider: document.querySelector('#sync-slider')?.value,
    valText: document.querySelector('#sync-val')?.textContent,
    leadInInput: document.querySelector('#sync-lead-in')?.value,
    timing: window.__engine?.getSyncTiming(),
    filmTiming: window.__engine?.film?.audio?.getSyncTiming()
  }));
  console.log('State after 1st reload (expected 350):', afterReload1);

  if (afterReload1.slider !== '350' || afterReload1.valText !== '350ms') {
    throw new Error(`Persistence failed on 1st reload! Expected 350, got slider=${afterReload1.slider}, text=${afterReload1.valText}`);
  }

  // 4. Change via Ayarlar toolbox panel to 450ms
  console.log('Setting mouth timing to 450ms via Settings panel...');
  await page.evaluate(() => {
    const leadInInput = document.querySelector('#settings-sync-lead-in');
    leadInInput.value = '450';
    leadInInput.dispatchEvent(new Event('input', { bubbles: true }));
    leadInInput.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await new Promise(r => setTimeout(r, 300));

  // 5. Reload again
  console.log('Reloading page second time...');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 1500));

  const afterReload2 = await page.evaluate(() => ({
    slider: document.querySelector('#sync-slider')?.value,
    valText: document.querySelector('#sync-val')?.textContent,
    leadInInput: document.querySelector('#sync-lead-in')?.value,
    timing: window.__engine?.getSyncTiming(),
    filmTiming: window.__engine?.film?.audio?.getSyncTiming()
  }));
  console.log('State after 2nd reload (expected 450):', afterReload2);

  if (afterReload2.slider !== '450' || afterReload2.valText !== '450ms') {
    throw new Error(`Persistence failed on 2nd reload! Expected 450, got slider=${afterReload2.slider}, text=${afterReload2.valText}`);
  }

  // 6. Test fast reload (simulate immediate F5 right after dragging slider)
  console.log('Testing fast reload immediately after input (250ms)...');
  await page.evaluate(() => {
    const slider = document.querySelector('#sync-slider');
    slider.value = '250';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // Instant reload without waiting for debounce
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 1500));

  const afterFastReload = await page.evaluate(() => ({
    slider: document.querySelector('#sync-slider')?.value,
    valText: document.querySelector('#sync-val')?.textContent,
    timing: window.__engine?.getSyncTiming()
  }));
  console.log('State after fast reload (expected 250):', afterFastReload);

  if (afterFastReload.slider !== '250' || afterFastReload.valText !== '250ms') {
    throw new Error(`Fast reload persistence failed! Expected 250, got slider=${afterFastReload.slider}`);
  }

  console.log('ALL PERSISTENCE TESTS PASSED PERFECTLY!');
  await browser.close();
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
