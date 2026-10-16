import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

async function main() {
  console.log('Launching browser to test Music Editor & Audio Pipeline...');
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
    args: ['--no-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  page.on('console', msg => console.log('PAGE:', msg.text()));
  page.on('pageerror', err => console.error('PAGE ERROR:', err));

  await page.goto('http://localhost:5174/', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));

  await page.waitForFunction(() => {
    const overlay = document.querySelector('#loading-overlay');
    return !overlay || overlay.hidden;
  }, { timeout: 35000 });

  console.log('Loading scenario harita-toprak-yol...');
  await page.evaluate(async () => {
    await window.__engine.loadScenario('harita-toprak-yol');
  });

  await page.waitForFunction(() => {
    const overlay = document.querySelector('#loading-overlay');
    return !overlay || overlay.hidden;
  }, { timeout: 35000 });
  await new Promise(r => setTimeout(r, 1000));

  // 1. Check Music Configuration & Audio Engine
  console.log('Inspecting music configuration in film.audio...');
  const musicInfo = await page.evaluate(async () => {
    const film = window.__engine.film;
    const cfg = film.audio.getMusicConfig();
    const hasBuffer = film.audio.getMusicBuffer() !== null;
    const cues = film.audio.getCues();
    const cuesCount = cues.length;

    // Test ducking values
    // In harita-toprak-yol, first dialogue cue starts around t=4.3s (active speech starts at ~4.34s)
    const quietGain = film.audio.getMusicGainAt(2.0); // No dialogue at t=2.0s
    const speechGain = film.audio.getMusicGainAt(4.5); // Jackie is speaking at t=4.5s
    const quietVoiceActive = film.audio.isVoiceActive(2.0);
    const speechVoiceActive = film.audio.isVoiceActive(4.5);

    // Test master audio mixdown
    const masterBuffer = await film.audio.renderMasterAudio(film.duration);
    const { audioBufferToWav } = await import('/src/engine/audio.ts');
    const wavBlob = audioBufferToWav(masterBuffer);

    return {
      cfg,
      hasBuffer,
      bufferDuration: film.audio.getMusicBuffer()?.duration,
      cuesCount,
      quietGain,
      speechGain,
      quietVoiceActive,
      speechVoiceActive,
      masterBufferChannels: masterBuffer.numberOfChannels,
      masterBufferDuration: masterBuffer.duration,
      wavBlobSize: wavBlob.size,
      wavBlobType: wavBlob.type,
    };
  });

  console.log('Music Info:', JSON.stringify(musicInfo, null, 2));

  // 2. Open Müzik tab in toolbox
  console.log('Opening Müzik tab in toolbox...');
  await page.evaluate(() => {
    window.__engine.switchToolboxTab('music');
  });
  await new Promise(r => setTimeout(r, 500));

  // Take screenshot of Müzik tab
  const outDir = 'C:/Users/DELL/.gemini/antigravity/brain/1944cbe1-f58c-4194-98cf-691279cd623a';
  const musicPanelScreenshot = path.join(outDir, 'music_editor_panel.png');
  await page.screenshot({ path: musicPanelScreenshot });
  console.log('Saved music panel screenshot to', musicPanelScreenshot);

  // 3. Test changing music settings from UI
  console.log('Testing UI interaction in Müzik panel...');
  const uiInteractionResult = await page.evaluate(async () => {
    const volSlider = document.querySelector('#music-volume-slider');
    volSlider.value = '0.45';
    volSlider.dispatchEvent(new Event('input'));

    const duckSlider = document.querySelector('#music-ducking-slider');
    duckSlider.value = '0.20';
    duckSlider.dispatchEvent(new Event('input'));

    const film = window.__engine.film;
    const updatedCfg = film.audio.getMusicConfig();
    return {
      updatedVolume: updatedCfg.volume,
      updatedDucking: updatedCfg.ducking,
    };
  });
  console.log('UI interaction result:', uiInteractionResult);

  // 4. Test mouth lead-in with music playing
  console.log('Testing playback with music and mouth lead-in...');
  const playbackSyncTest = await page.evaluate(async () => {
    const film = window.__engine.film;
    // Set time right before speech start (t = 3.8s)
    const t = 3.8;
    film.audio.update(t, true);
    const { scene } = film.evaluate(t, { id: 'test', label: 'test', width: 640, height: 360, fps: 30 });
    const jackie = scene.characters.get('jackie');
    const jackieMouth = jackie?.pose.mouth ?? 0;
    const musicGain = film.audio.getMusicGainAt(t);

    return {
      t,
      jackieMouth,
      musicGain,
    };
  });
  console.log('Playback sync test at t=3.8s:', playbackSyncTest);

  await browser.close();
  console.log('Verification finished successfully!');
}

main().catch(console.error);
