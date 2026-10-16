import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const ARTIFACT_DIR = 'C:\\Users\\DELL\\.gemini\\antigravity\\brain\\1944cbe1-f58c-4194-98cf-691279cd623a';

async function main() {
  console.log('Starting Timeline Verification with Edge...');
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
    args: ['--no-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 950 });

  page.on('console', msg => {
    const text = msg.text();
    if (!text.includes('THREE.') && !text.includes('[vite]')) {
      console.log('PAGE:', text);
    }
  });
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
  await new Promise(r => setTimeout(r, 1200));

  console.log('Inspecting Timeline structure...');
  const timelineInfo = await page.evaluate(() => {
    const container = document.querySelector('#timeline-container');
    const isContainerVisible = container && !container.hidden && getComputedStyle(container).display !== 'none';

    const rulerTicks = Array.from(document.querySelectorAll('#timeline-ruler-track .timeline-ruler-tick')).map(t => ({
      left: t.style.left,
      text: t.textContent
    }));

    const shotBlocks = Array.from(document.querySelectorAll('#lane-shots .shot-block')).map(b => ({
      left: b.style.left,
      width: b.style.width,
      text: b.textContent,
      title: b.title
    }));

    const dialogueBlocks = Array.from(document.querySelectorAll('#lane-dialogues .dialogue-block')).map(b => ({
      left: b.style.left,
      width: b.style.width,
      text: b.textContent,
      title: b.title
    }));

    const musicTrackName = document.querySelector('#timeline-music-track-name')?.textContent || '';
    const timelineDuckingZones = Array.from(document.querySelectorAll('#timeline-music-ducking-zones .timeline-ducking-zone')).map(z => ({
      left: z.style.left,
      width: z.style.width
    }));

    const waveformCanvas = document.querySelector('#timeline-music-waveform');
    const hasWaveformCanvas = !!waveformCanvas;
    const canvasWidth = waveformCanvas ? waveformCanvas.width : 0;
    const canvasHeight = waveformCanvas ? waveformCanvas.height : 0;

    const filmDuration = window.__engine.film ? window.__engine.film.duration : 0;

    return {
      isContainerVisible,
      filmDuration,
      rulerTicksCount: rulerTicks.length,
      rulerTicksSample: rulerTicks.slice(0, 5),
      shotBlocksCount: shotBlocks.length,
      shotBlocks,
      dialogueBlocksCount: dialogueBlocks.length,
      dialogueBlocks,
      musicTrackName,
      timelineDuckingZonesCount: timelineDuckingZones.length,
      timelineDuckingZonesSample: timelineDuckingZones.slice(0, 3),
      hasWaveformCanvas,
      canvasWidth,
      canvasHeight
    };
  });

  console.log('Timeline Details:', JSON.stringify(timelineInfo, null, 2));

  // 2. Test interactive scrub via click on timeline tracks viewport
  console.log('Testing interactive scrubbing at 50% of the timeline...');
  const scrubResult = await page.evaluate(() => {
    const viewport = document.querySelector('#timeline-tracks-viewport');
    if (!viewport) return { error: 'No timeline-tracks-viewport' };
    const rect = viewport.getBoundingClientRect();

    // Simulate click at 50% width
    const clientX = rect.left + rect.width * 0.5;
    const clientY = rect.top + rect.height * 0.5;

    viewport.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY
    }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    const needle = document.querySelector('#timeline-playhead-needle');
    const scrubVal = Number(document.querySelector('#scrub')?.value || 0);

    return {
      needleLeft: needle?.style.left,
      scrubVal,
      filmDuration: window.__engine.film.duration
    };
  });
  console.log('Scrub 50% result:', scrubResult);

  // 3. Test clicking on a shot block to seek
  console.log('Testing click on Shot Block #2...');
  const shotClickResult = await page.evaluate(() => {
    const shot2 = document.querySelectorAll('#lane-shots .shot-block')[1];
    if (shot2) {
      shot2.click();
      return {
        clicked: true,
        scrubVal: Number(document.querySelector('#scrub')?.value || 0),
        needleLeft: document.querySelector('#timeline-playhead-needle')?.style.left
      };
    }
    return { clicked: false };
  });
  console.log('Shot click seek result:', shotClickResult);

  // 4. Test clicking on a dialogue block to seek
  console.log('Testing click on Dialogue Block #1...');
  const dialogueClickResult = await page.evaluate(() => {
    const dial1 = document.querySelectorAll('#lane-dialogues .dialogue-block')[0];
    if (dial1) {
      dial1.click();
      return {
        clicked: true,
        scrubVal: Number(document.querySelector('#scrub')?.value || 0),
        needleLeft: document.querySelector('#timeline-playhead-needle')?.style.left
      };
    }
    return { clicked: false };
  });
  console.log('Dialogue click seek result:', dialogueClickResult);

  // 5. Test collapse toggle
  console.log('Testing Timeline Collapse / Expand toggle...');
  const collapseResult = await page.evaluate(() => {
    const btn = document.querySelector('#btn-toggle-timeline');
    const container = document.querySelector('#timeline-container');
    btn?.click();
    const collapsedAfterClick = container?.classList.contains('collapsed');
    btn?.click(); // restore
    const restored = !container?.classList.contains('collapsed');
    return { collapsedAfterClick, restored };
  });
  console.log('Collapse test result:', collapseResult);

  // Take Full App Screenshot with Timeline
  await new Promise(r => setTimeout(r, 600));
  const fullScreenshotPath = path.join(ARTIFACT_DIR, 'timeline_full_view.png');
  await page.screenshot({ path: fullScreenshotPath });
  console.log('Saved full view screenshot:', fullScreenshotPath);

  // Take close-up screenshot of the Timeline Container
  const timelineEl = await page.$('#timeline-container');
  if (timelineEl) {
    const timelineScreenshotPath = path.join(ARTIFACT_DIR, 'timeline_closeup_view.png');
    await timelineEl.screenshot({ path: timelineScreenshotPath });
    console.log('Saved timeline close-up screenshot:', timelineScreenshotPath);
  }

  // Switch to Music Tab and check its waveform card
  console.log('Switching to Music Tab in toolbox...');
  await page.evaluate(() => {
    window.__engine.switchToolboxTab('music');
  });
  await new Promise(r => setTimeout(r, 600));

  const musicPanelScreenshotPath = path.join(ARTIFACT_DIR, 'timeline_music_tab_view.png');
  await page.screenshot({ path: musicPanelScreenshotPath });
  console.log('Saved music tab view screenshot:', musicPanelScreenshotPath);

  await browser.close();
  console.log('Timeline Verification Completed Successfully!');
}

main().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
