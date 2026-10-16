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

  // Wait for __engine
  await page.waitForFunction(() => !!window.__engine?.loadScenario);
  await new Promise(r => setTimeout(r, 600));

  console.log('Calling window.__engine.loadScenario("harita-toprak-yol")...');
  await page.evaluate(async () => {
    await window.__engine.loadScenario('harita-toprak-yol');
  });
  console.log('harita-toprak-yol loaded and built successfully!');

  const outDir = 'C:/Users/DELL/.gemini/antigravity/brain/1944cbe1-f58c-4194-98cf-691279cd623a';

  const capturePoints = [
    { t: 3.9, name: 'shot2_jackie_prespeech.png', label: 'Jackie Konuşma Öncesi Kamera Çevrildi (Shot 2)' },
    { t: 5.5, name: 'shot2_jackie_speaking.png', label: 'Jackie Konuşuyor - Büst Plan (Shot 2)' },
    { t: 10.2, name: 'shot3_amy_speaking.png', label: 'Amy Konuşuyor - Büst Plan (Shot 3)' },
    { t: 18.8, name: 'shot5_cocuk_speaking.png', label: 'Çocuk Konuşuyor - Büst Plan (Shot 5)' },
  ];

  for (const pt of capturePoints) {
    await page.evaluate((timeVal) => {
      const s = document.querySelector('#scrub');
      s.value = String(timeVal);
      s.dispatchEvent(new Event('input'));
    }, pt.t);

    await new Promise(r => setTimeout(r, 500));

    const shotInfo = await page.$eval('#where', el => el.textContent);
    console.log(`[t=${pt.t}] ${pt.label} -> ${shotInfo}`);

    const canvas = await page.$('#canvas');
    if (canvas) {
      await canvas.screenshot({ path: path.join(outDir, pt.name) });
    }
  }

  await page.screenshot({ path: path.join(outDir, 'app_speaker_focus.png') });
  console.log('All speaker shots verified and saved!');

  await browser.close();
}

main().catch(console.error);
