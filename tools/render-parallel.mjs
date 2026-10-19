// Paralel segment render: filmi zaman aralıklarına bölüp birden çok headless tarayıcı sayfasında aynı anda
// render eder, kodlanmış H.264 paketlerini sırayla tek MP4'e birleştirir (+ master ses miksi, AAC).
//
// Kullanım:
//   node tools/render-parallel.mjs --scenario harita-toprak-yol [--format youtube_16x9] [--fps 60]
//        [--workers 3] [--segment 6] [--out output/render/film.mp4] [--headed] [--no-audio]
//        [--server http://localhost:5174] [--browser <msedge/chrome yolu>]
//
// Not: vite dev sunucusu çalışıyor olmalı (npm run dev). Her işçi sayfa tüm senaryoyu yükler; bellek ve GPU
// kullanımı işçi sayısıyla artar. --headed gerçek GPU/donanım kodlayıcı yolunu kullanmak için önerilir.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { EncodedAudioPacketSource, EncodedPacket, EncodedVideoPacketSource, FilePathTarget, Mp4OutputFormat, Output } from 'mediabunny';

// ---------------------------------------------------------------- argümanlar
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[a.slice(2)] = argv[++i];
    else out[a.slice(2)] = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.scenario) {
  console.error('Kullanım: node tools/render-parallel.mjs --scenario <id> [--format youtube_16x9] [--fps 60] [--workers 3] [--segment 6] [--out dosya.mp4] [--headed] [--no-audio]');
  process.exit(1);
}
const scenario = String(args.scenario);
const formatId = String(args.format ?? 'youtube_16x9');
const fpsArg = args.fps ? Number(args.fps) : undefined;
// Varsayılan 2 işçi: tek ortak GPU'da işçi sayısı arttıkça kazanç hızla doyuyor (ölçüm: 3 işçi ≈ 1.2x), açılış/bellek maliyeti ise artıyor.
const workerCount = Math.max(1, Number(args.workers ?? Math.min(2, Math.max(1, Math.floor(os.cpus().length / 4)))));
const segmentSeconds = Math.max(1, Number(args.segment ?? 6));
const server = String(args.server ?? 'http://localhost:5174/');
const headed = Boolean(args.headed);
const withAudio = !args['no-audio'];
const browserPath =
  args.browser ??
  [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].find((p) => fs.existsSync(p));
if (!browserPath) {
  console.error('Tarayıcı bulunamadı; --browser ile msedge/chrome yolunu verin.');
  process.exit(1);
}

// ---------------------------------------------------------------- yardımcılar
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${((performance.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...a);
const t0 = performance.now();

async function waitLoaded(page, timeout) {
  await page.waitForFunction(
    () => {
      const o = document.querySelector('#loading-overlay');
      return !o || o.hidden;
    },
    { timeout },
  );
}

const fromB64 = (b64) => new Uint8Array(Buffer.from(b64, 'base64')); // Buffer.slice görünüm döndürdüğü için kopya şart

// ---------------------------------------------------------------- tarayıcılar ve işçiler
// Her işçi ayrı bir tarayıcı sürecidir: aynı pencerede arka plan sekmesi olarak kısılmaz, kendi GPU/render süreçlerini alır.
const browsers = [];
async function closeAll() {
  await Promise.all(browsers.map((b) => b.close().catch(() => {})));
}
process.on('SIGINT', async () => {
  await closeAll();
  process.exit(130);
});

let failed = null;
function fail(err) {
  if (failed) return;
  failed = err instanceof Error ? err : new Error(String(err));
  console.error('HATA:', failed.message);
}

/** Her paketi doğru segmente yönlendiren durum. */
const segPackets = new Map(); // segment indeksi -> paketler
const audioPackets = [];
let framesDone = 0;

async function openWorker(id) {
  const browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: !headed,
    args: [
      '--no-sandbox',
      '--enable-gpu',
      '--ignore-gpu-blocklist',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--window-size=1280,720',
    ],
  });
  browsers.push(browser);
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.on('pageerror', (e) => fail(new Error(`işçi ${id} sayfa hatası: ${e.message}`)));
  await page.exposeFunction('__sink', (segIdx, packet) => {
    if (segIdx < 0) {
      audioPackets.push(packet);
    } else {
      segPackets.get(segIdx).push(packet);
      framesDone++;
    }
  });
  await page.goto(server, { waitUntil: 'domcontentloaded' });
  await waitLoaded(page, 300000);
  await page.evaluate((s) => window.__engine.loadScenario(s), scenario);
  await waitLoaded(page, 300000);
  await sleep(500);
  log(`işçi ${id} hazır`);
  return { id, page };
}

log(`${workerCount} işçi başlatılıyor (${headed ? 'görünür' : 'headless'}), senaryo: ${scenario}`);
let workers;
try {
  // Açılış yükünü (modül derleme, model/doku okuma, shader derleme) dağıtmak için işçiler birkaç sn arayla başlar
  workers = await Promise.all(
    Array.from({ length: workerCount }, async (_, i) => {
      await sleep(i * 4000);
      return openWorker(i);
    }),
  );
} catch (e) {
  await closeAll();
  throw e;
}

// ---------------------------------------------------------------- iş planı
const info = await workers[0].page.evaluate(
  async (fmt, fps) => {
    const { describeJob } = await import('/src/export/segments.ts');
    return describeJob(window.__engine.film, fmt, fps);
  },
  formatId,
  fpsArg,
);
const { fps } = info;
const limitSec = args.limit ? Number(args.limit) : null;
const totalFrames = limitSec ? Math.min(info.totalFrames, Math.max(1, Math.round(limitSec * fps))) : info.totalFrames;
const segFrames = Math.max(1, Math.round(segmentSeconds * fps));
const segments = [];
for (let from = 0; from < totalFrames; from += segFrames) segments.push([from, Math.min(totalFrames, from + segFrames)]);
const useAudio = withAudio && info.audio !== null;
log(
  `${info.format.label} ${info.format.width}×${info.format.height} @${fps}fps · ${info.duration.toFixed(1)} sn · ${totalFrames} kare · ${segments.length} segment · ses: ${useAudio ? 'var' : 'yok'}`,
);
segments.forEach((_, i) => segPackets.set(i, []));

// ---------------------------------------------------------------- işçi döngüleri
const queue = segments.map((_, i) => i);
const segDone = new Set();

async function runWorker(w) {
  if (w.id === 0 && useAudio) {
    await w.page.evaluate(async () => {
      const { renderAudio } = await import('/src/export/segments.ts');
      return renderAudio(window.__engine.film, (p) => window.__sink(-1, p));
    });
    log('ses kodlandı');
  }
  while (queue.length && !failed) {
    const idx = queue.shift();
    const [from, to] = segments[idx];
    await w.page.evaluate(
      async (i, fmt, fpsv, a, b) => {
        const { renderSegment } = await import('/src/export/segments.ts');
        const { film, viewport } = window.__engine;
        await renderSegment(film, viewport, fmt, fpsv, a, b, (p) => window.__sink(i, p));
      },
      idx,
      formatId,
      fps,
      from,
      to,
    );
    segDone.add(idx);
  }
}

const progressTimer = setInterval(() => {
  const el = (performance.now() - renderStart) / 1000;
  const rate = framesDone / Math.max(0.001, el);
  const eta = rate > 0 ? (totalFrames - framesDone) / rate : 0;
  process.stdout.write(
    `\r  ${framesDone}/${totalFrames} kare (%${((framesDone / totalFrames) * 100).toFixed(0)}) · ${rate.toFixed(1)} kare/sn · kalan ~${eta.toFixed(0)} sn   `,
  );
}, 1000);
const renderStart = performance.now();

try {
  await Promise.all(
    workers.map((w) =>
      runWorker(w).catch((e) => {
        fail(new Error(`işçi ${w.id}: ${e.message}`));
      }),
    ),
  );
} finally {
  clearInterval(progressTimer);
  process.stdout.write('\n');
  await closeAll();
}
if (failed) process.exit(1);
const renderSec = (performance.now() - renderStart) / 1000;
log(`render bitti: ${renderSec.toFixed(1)} sn (${(totalFrames / renderSec).toFixed(1)} kare/sn)`);

// ---------------------------------------------------------------- birleştirme
// Mediabunny ile doğrudan dosyaya (bellekte toplamadan); meta veri başta (Fast Start, paket sayıları bilindiği için
// yer ayrılır). Ses önce yazılır: izler zamana göre iç içe yazıldığından video paketleri ses beklemeden akar.
const { width, height } = info.format;
const outPath = path.resolve(
  String(args.out ?? path.join('output', 'render', `${scenario}-${formatId}${fps !== 30 ? `-${fps}fps` : ''}.mp4`)),
);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'reserve' }), target: new FilePathTarget(outPath) });
const videoSource = new EncodedVideoPacketSource('avc');
output.addVideoTrack(videoSource, { frameRate: fps, maximumPacketCount: totalFrames + 2 });
const audioSource = useAudio ? new EncodedAudioPacketSource('aac') : null;
if (audioSource) output.addAudioTrack(audioSource, { maximumPacketCount: audioPackets.length + 2 });
await output.start();

/** avcC'den (AVCDecoderConfigurationRecord) codec dizesi: avc1.PPCCLL (profil, uyumluluk, seviye) */
const avcCodec = (avcC) => `avc1.${[avcC[1], avcC[2], avcC[3]].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
const us = (v) => v / 1e6;

if (audioSource) {
  let firstAudio = true;
  const audioEndUs = (totalFrames / fps) * 1e6;
  for (const p of audioPackets) {
    if (p.timestamp >= audioEndUs) break; // --limit: sesi video süresine kırp
    const meta = firstAudio && p.description
      ? { decoderConfig: { codec: 'mp4a.40.2', numberOfChannels: info.audio.numberOfChannels, sampleRate: info.audio.sampleRate, description: fromB64(p.description) } }
      : undefined;
    await audioSource.add(new EncodedPacket(fromB64(p.data), p.type, us(p.timestamp), us(p.duration)), meta);
    firstAudio = false;
  }
  audioSource.close();
}

let videoDescription = null;
let firstVideo = true;
const frameUs = 1e6 / fps;
for (let i = 0; i < segments.length; i++) {
  const packets = segPackets.get(i);
  if (!packets.length || packets[0].type !== 'key') throw new Error(`segment ${i} anahtar kareyle başlamıyor`);
  const desc = packets.find((p) => p.description)?.description;
  if (firstVideo) videoDescription = desc;
  else if (desc && desc !== videoDescription) {
    console.warn(`UYARI: segment ${i} farklı SPS/PPS üretti (kodlayıcı ayarı farklı olabilir); oynatıcılarda bozulma olabilir.`);
  }
  // Zaman damgaları sürekli olmalı (her segmentin ilk karesi önceki segmentin sonunu tam yakalar)
  const startTs = Math.round(segments[i][0] * frameUs);
  if (Math.abs(packets[0].timestamp - startTs) > 1) {
    throw new Error(`segment ${i} zaman damgası ${packets[0].timestamp}µs, beklenen ${startTs}µs`);
  }
  for (const p of packets) {
    let meta;
    if (firstVideo) {
      const avcC = fromB64(videoDescription);
      meta = { decoderConfig: { codec: avcCodec(avcC), codedWidth: width, codedHeight: height, description: avcC } };
    }
    await videoSource.add(new EncodedPacket(fromB64(p.data), p.type, us(p.timestamp), us(p.duration)), meta);
    firstVideo = false;
  }
  segPackets.set(i, null); // belleği bırak
}
videoSource.close();
await output.finalize();
const mb = fs.statSync(outPath).size / 1e6;
log(`yazıldı: ${outPath} · ${mb.toFixed(1)} MB · ${((mb * 8) / (totalFrames / fps)).toFixed(1)} Mbps · toplam ${((performance.now() - t0) / 1000).toFixed(1)} sn`);
