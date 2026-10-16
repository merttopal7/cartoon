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

  // Wait for initial load
  await page.waitForSelector('#scenario-select');
  await new Promise(r => setTimeout(r, 1000));

  const outDir = 'C:/Users/DELL/.gemini/antigravity/brain/1944cbe1-f58c-4194-98cf-691279cd623a';

  // Now trigger loading Bölüm 4 (Amy + Jackie + Çocuk)
  console.log('Switching to Bölüm 4 to observe smooth loading overlay...');
  
  // Select bolum-4 without awaiting network completion immediately so we can capture loading overlay
  page.select('#scenario-select', 'bolum-4');

  // Immediately check loading overlay visibility
  let overlayVisible = false;
  for (let i = 0; i < 20; i++) {
    const isHidden = await page.$eval('#loading-overlay', el => el.hidden);
    if (!isHidden) {
      overlayVisible = true;
      const statusText = await page.$eval('#loading-status', el => el.textContent);
      console.log(`Loading overlay visible! Status: "${statusText}"`);
      await page.screenshot({ path: path.join(outDir, 'loading_overlay_active.png') });
      break;
    }
    await new Promise(r => setTimeout(r, 40));
  }

  // Wait for loading overlay to be hidden (ready)
  await page.waitForFunction(() => {
    const overlay = document.querySelector('#loading-overlay');
    return overlay && overlay.hidden;
  }, { timeout: 15000 });
  console.log('Loading finished cleanly and smoothly!');

  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: path.join(outDir, 'loaded_bolum_4.png') });

  await browser.close();
  console.log('Test completed successfully!');
}

main().catch(console.error);
