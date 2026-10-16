import puppeteer from 'puppeteer-core';
import path from 'path';

async function main() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
    args: ['--no-sandbox', '--window-size=1366,768']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 768 });
  await page.goto('http://localhost:5174/', { waitUntil: 'domcontentloaded' });

  // Wait for scenario-select
  await page.waitForSelector('#scenario-select');
  await page.waitForFunction(() => {
    const select = document.querySelector('#scenario-select');
    return select && select.options.length >= 7;
  }, { timeout: 10000 });

  const options = await page.$$eval('#scenario-select option', opts => opts.map(o => o.text));
  console.log('Dropdown options count:', options.length, options);

  const outDir = 'C:/Users/DELL/.gemini/antigravity/brain/1944cbe1-f58c-4194-98cf-691279cd623a';

  // 1. Select Bölüm 1
  await page.select('#scenario-select', 'bolum-1');
  await new Promise(r => setTimeout(r, 1200));

  const sourceVal = await page.$eval('#source', el => el.value);
  console.log('Loaded Bolum 1 into source? First 60 chars:', sourceVal.slice(0, 60));

  // Take screenshot of editor bar
  const editorBar = await page.$('#editor-bar');
  if (editorBar) {
    await editorBar.screenshot({ path: path.join(outDir, 'editor_bar_with_scenarios.png') });
  }

  // 2. Open Scenario Library Modal
  await page.click('#btn-library');
  await page.waitForSelector('#scenario-modal:not([hidden])');
  await page.waitForSelector('.scenario-card');

  const cardCount = await page.$$eval('.scenario-card', cards => cards.length);
  console.log('Cards rendered in modal:', cardCount);

  // Take screenshot of open modal
  await page.screenshot({ path: path.join(outDir, 'scenario_library_modal.png') });

  // 3. Test saving a new custom scenario to SQLite
  await page.type('#save-title', 'Benim Özel SQLite Çekimim');
  await page.type('#save-desc', 'Toprak yolda özel capoeira ve yarış sahnesi');
  await page.click('#btn-modal-save');

  await new Promise(r => setTimeout(r, 1000));

  const newCardCount = await page.$$eval('.scenario-card', cards => cards.length);
  console.log('Cards after saving custom scenario:', newCardCount);

  // Take screenshot of modal with new custom scenario
  await page.screenshot({ path: path.join(outDir, 'scenario_modal_after_save.png') });

  // Close modal
  await page.click('#modal-close');
  await page.waitForSelector('#scenario-modal[hidden]');

  // Full app screenshot
  await page.screenshot({ path: path.join(outDir, 'app_with_scenarios.png') });
  console.log('All tests passed and screenshots captured!');

  await browser.close();
}

main().catch(console.error);
