import puppeteer from 'puppeteer-core';
import path from 'path';

async function main() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
    args: ['--no-sandbox', '--window-size=1400,820']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 820 });

  console.log('Navigating to http://localhost:5174/ ...');
  await page.goto('http://localhost:5174/', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 1500));

  const outDir = 'C:/Users/DELL/.gemini/antigravity/brain/1944cbe1-f58c-4194-98cf-691279cd623a';

  // 1. Initial State: Scenario Editor Tab
  console.log('1. Checking Toolbox Scenario tab...');
  const isScenarioActive = await page.$eval('#panel-scenario', el => !el.hidden);
  console.log('Is #panel-scenario active initially?', isScenarioActive);

  const aside = await page.$('#editor');
  if (aside) {
    await aside.screenshot({ path: path.join(outDir, 'toolbox_scenario_editor.png') });
  }

  // 2. Switch to "Senaryolar" tab
  console.log('2. Switching to Toolbox Senaryolar tab...');
  await page.click('#tab-scenarios');
  await new Promise(r => setTimeout(r, 600));

  const isScenariosActive = await page.$eval('#panel-scenarios', el => !el.hidden);
  const scenarioCardCount = await page.$$eval('#toolbox-scenarios-container .scenario-card', cards => cards.length);
  console.log('Is #panel-scenarios active?', isScenariosActive, 'Card count:', scenarioCardCount);

  if (aside) {
    await aside.screenshot({ path: path.join(outDir, 'toolbox_scenarios_library.png') });
  }

  // 3. Switch to "Ayarlar" tab
  console.log('3. Switching to Toolbox Ayarlar tab...');
  await page.click('#tab-settings');
  await new Promise(r => setTimeout(r, 600));

  const isSettingsActive = await page.$eval('#panel-settings', el => !el.hidden);
  console.log('Is #panel-settings active?', isSettingsActive);

  // Check initial sync values in Settings panel
  const initialLeadIn = await page.$eval('#settings-sync-lead-in', el => el.value);
  console.log('Initial lead-in from SQLite settings in panel:', initialLeadIn);

  if (aside) {
    await aside.screenshot({ path: path.join(outDir, 'toolbox_settings_panel.png') });
  }

  // 4. Test changing Sync Timing in Settings Panel and check SQLite persistence
  console.log('4. Changing lead-in to 850 in settings panel...');
  await page.$eval('#settings-sync-lead-in-slider', el => {
    el.value = '850';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 800)); // wait for debounce save to SQLite

  const syncTimingAfter = await page.evaluate(() => window.__engine.getSyncTiming());
  console.log('Engine sync timing after slider change:', syncTimingAfter);

  const statusBadgeText = await page.$eval('#settings-status-badge', el => el.textContent);
  console.log('Settings status badge after save:', statusBadgeText);

  // Verify SQLite /api/settings returned updated value
  const apiSettings = await page.evaluate(async () => {
    const res = await fetch('/api/settings');
    return await res.json();
  });
  console.log('SQLite /api/settings response:', apiSettings);

  // 5. Reload the page to test persistence from SQLite
  console.log('5. Reloading page to test SQLite persistence across reloads...');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 1500));

  const reloadedTiming = await page.evaluate(() => window.__engine.getSyncTiming());
  console.log('Reloaded engine timing from SQLite:', reloadedTiming);

  // 6. Switch to "Araçlar" tab
  console.log('6. Switching to Toolbox Araçlar tab...');
  await page.click('#tab-tools');
  await new Promise(r => setTimeout(r, 600));

  const isToolsActive = await page.$eval('#panel-tools', el => !el.hidden);
  console.log('Is #panel-tools active?', isToolsActive);

  const reloadedAside = await page.$('#editor');
  if (reloadedAside) {
    await reloadedAside.screenshot({ path: path.join(outDir, 'toolbox_tools_panel.png') });
  }

  // 7. Reset settings to 700 via button
  console.log('7. Testing Reset to 700ms in Settings panel...');
  await page.click('#tab-settings');
  await new Promise(r => setTimeout(r, 400));
  await page.click('#btn-settings-reset-sync');
  await new Promise(r => setTimeout(r, 600));

  const resetTiming = await page.evaluate(() => window.__engine.getSyncTiming());
  console.log('Engine timing after reset button:', resetTiming);

  // 8. Full app screenshot
  console.log('8. Taking full app screenshot...');
  await page.screenshot({ path: path.join(outDir, 'full_app_toolbox.png') });

  console.log('Verification finished successfully!');
  await browser.close();
}

main().catch(console.error);
