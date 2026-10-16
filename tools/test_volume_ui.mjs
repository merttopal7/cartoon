import puppeteer from 'puppeteer-core';
import path from 'path';

async function main() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
    args: ['--no-sandbox', '--window-size=1280,720']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });

  // Wait for volume controls
  await page.waitForSelector('#volume-slider');
  await page.waitForSelector('#mute-btn');
  await page.waitForSelector('#volume-label');

  const initialText = await page.$eval('#volume-label', el => el.textContent);
  const initialIcon = await page.$eval('#mute-btn', el => el.textContent);
  console.log('Initial volume:', initialText, 'icon:', initialIcon);

  // Set volume to 50%
  await page.evaluate(() => {
    const slider = document.querySelector('#volume-slider');
    slider.value = '0.5';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const halfText = await page.$eval('#volume-label', el => el.textContent);
  const halfIcon = await page.$eval('#mute-btn', el => el.textContent);
  console.log('After 50% slider:', halfText, 'icon:', halfIcon);

  // Click mute button
  await page.click('#mute-btn');
  const mutedIcon = await page.$eval('#mute-btn', el => el.textContent);
  console.log('After mute click:', mutedIcon);

  // Click unmute button
  await page.click('#mute-btn');
  const unmutedIcon = await page.$eval('#mute-btn', el => el.textContent);
  console.log('After unmute click:', unmutedIcon);

  // Reset to 80%
  await page.evaluate(() => {
    const slider = document.querySelector('#volume-slider');
    slider.value = '0.8';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });

  const outDir = 'C:/Users/DELL/.gemini/antigravity/brain/1944cbe1-f58c-4194-98cf-691279cd623a';
  const transport = await page.$('#transport');
  if (transport) {
    await transport.screenshot({ path: path.join(outDir, 'transport_volume_ui.png') });
  }

  await page.screenshot({ path: path.join(outDir, 'app_volume_ui.png') });
  console.log('Screenshots saved successfully!');

  await browser.close();
}

main().catch(console.error);
