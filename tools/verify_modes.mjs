import puppeteer from 'puppeteer-core';
import path from 'path';

async function main() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
    args: ['--no-sandbox', '--window-size=1400,850']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 850 });

  const outDir = 'C:/Users/DELL/.gemini/antigravity/brain/1944cbe1-f58c-4194-98cf-691279cd623a';

  console.log('1. Navigating to http://localhost:5174/ ...');
  await page.goto('http://localhost:5174/', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));

  // 1. Check initial mode (Preview)
  const initialMode = await page.evaluate(() => window.__engine?.getRenderMode?.());
  console.log('Initial mode from __engine:', initialMode);

  const isTopPreviewActive = await page.$eval('#btn-mode-preview', el => el.classList.contains('active'));
  const isTopRenderActive = await page.$eval('#btn-mode-render', el => el.classList.contains('active'));
  console.log('Top bar: Preview active =', isTopPreviewActive, ', Render active =', isTopRenderActive);

  // Take screenshot in Preview mode
  await page.screenshot({ path: path.join(outDir, 'mode_preview_full.png') });
  const stage = await page.$('#stage');
  if (stage) {
    await stage.screenshot({ path: path.join(outDir, 'mode_preview_stage.png') });
  }

  // 2. Switch to Render Mode via Top Bar
  console.log('2. Clicking Render Mode button on Top Bar...');
  await page.click('#btn-mode-render');
  await new Promise(r => setTimeout(r, 800));

  const afterSwitchMode = await page.evaluate(() => window.__engine?.getRenderMode?.());
  console.log('Mode after clicking Render:', afterSwitchMode);

  const isTopPreviewActive2 = await page.$eval('#btn-mode-preview', el => el.classList.contains('active'));
  const isTopRenderActive2 = await page.$eval('#btn-mode-render', el => el.classList.contains('active'));
  console.log('Top bar after switch: Preview active =', isTopPreviewActive2, ', Render active =', isTopRenderActive2);

  // Take screenshot in Render mode
  await page.screenshot({ path: path.join(outDir, 'mode_render_full.png') });
  if (stage) {
    await stage.screenshot({ path: path.join(outDir, 'mode_render_stage.png') });
  }

  // 3. Verify SQLite Settings persistence
  console.log('3. Checking SQLite endpoint /api/settings...');
  const settingsJson = await page.evaluate(async () => {
    const res = await fetch('/api/settings');
    return res.json();
  });
  console.log('SQLite settings response:', settingsJson);

  // 4. Test Settings Panel buttons
  console.log('4. Opening Settings tab in Toolbox...');
  await page.click('#tab-settings');
  await new Promise(r => setTimeout(r, 500));

  const isSettingsPreviewActive = await page.$eval('#settings-btn-mode-preview', el => el.classList.contains('active'));
  const isSettingsRenderActive = await page.$eval('#settings-btn-mode-render', el => el.classList.contains('active'));
  console.log('Settings panel: Preview active =', isSettingsPreviewActive, ', Render active =', isSettingsRenderActive);

  // Switch back to Preview mode in Settings Panel
  console.log('5. Clicking Preview Mode button inside Settings panel...');
  await page.click('#settings-btn-mode-preview');
  await new Promise(r => setTimeout(r, 800));

  const modeAfterSettings = await page.evaluate(() => window.__engine?.getRenderMode?.());
  console.log('Mode after settings panel click:', modeAfterSettings);

  const aside = await page.$('#editor');
  if (aside) {
    await aside.screenshot({ path: path.join(outDir, 'toolbox_settings_mode.png') });
  }

  // 6. Test Tools Panel toggle button
  console.log('6. Opening Tools tab in Toolbox...');
  await page.click('#tab-tools');
  await new Promise(r => setTimeout(r, 500));

  const toolToggleText = await page.$eval('#tool-toggle-mode-text', el => el.textContent);
  console.log('Tool toggle mode button text:', toolToggleText);

  console.log('7. Clicking toggle mode in Tools panel...');
  await page.click('#tool-toggle-mode');
  await new Promise(r => setTimeout(r, 800));

  const modeAfterTools = await page.evaluate(() => window.__engine?.getRenderMode?.());
  console.log('Mode after tools toggle:', modeAfterTools);

  // 7. Reload page to verify persistence from SQLite
  console.log('8. Reloading page to verify persistence from SQLite...');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));

  const reloadedMode = await page.evaluate(() => window.__engine?.getRenderMode?.());
  console.log('Mode after page reload:', reloadedMode);

  // Reset back to preview mode for fast default editing
  await page.click('#btn-mode-preview');
  await new Promise(r => setTimeout(r, 500));
  console.log('Reset back to preview mode for default editing.');

  await browser.close();
  console.log('Verification completed successfully!');
}

main().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
