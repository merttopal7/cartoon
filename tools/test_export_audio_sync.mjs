import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

async function main() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();

  page.on('console', msg => console.log('PAGE:', msg.text()));

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

  console.log('Running test export...');
  const exportResult = await page.evaluate(async () => {
    const film = window.__engine.film;
    const viewport = window.__engine.viewport;
    const format = { id: 'test', label: 'test', width: 640, height: 360, fps: 30 };

    // We will hook into Muxer or exportMp4 to inspect chunk timestamps
    const { exportMp4 } = await import('/src/export/mp4.ts');

    const timing = film.audio.getSyncTiming();
    const cues = film.audio.getCues();

    const blob = await exportMp4({
      film,
      viewport,
      format,
    });

    // Convert blob to base64
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const b64 = btoa(binary);

    return {
      size: blob.size,
      type: blob.type,
      timing,
      b64,
    };
  });

  console.log('Exported size:', exportResult.size, 'bytes, type:', exportResult.type);
  console.log('Engine sync timing during export:', exportResult.timing);

  const outDir = 'C:/Users/DELL/.gemini/antigravity/brain/1944cbe1-f58c-4194-98cf-691279cd623a';
  const outPath = path.join(outDir, 'test_exported_film.mp4');
  fs.writeFileSync(outPath, Buffer.from(exportResult.b64, 'base64'));
  console.log('Saved to', outPath);

  // Now, let's load this MP4 in the browser and inspect video playback frame by frame!
  console.log('Analyzing exported video playback...');
  const analysis = await page.evaluate(async (videoBase64) => {
    const video = document.createElement('video');
    video.src = 'data:video/mp4;base64,' + videoBase64;
    video.muted = true;
    document.body.appendChild(video);

    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = reject;
    });

    const duration = video.duration;
    return { duration, videoWidth: video.videoWidth, videoHeight: video.videoHeight };
  }, exportResult.b64);

  console.log('Video metadata:', analysis);
  await browser.close();
}

main().catch(console.error);
