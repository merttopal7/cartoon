#!/usr/bin/env node
/**
 * Statik bir modeli (harita, dekor) motor için optimize GLB'ye çevirir:
 *   - aynı malzemeli mesh'leri birleştirir (yüzlerce çizim çağrısı → birkaç)
 *   - birimi metreye çevirir (FBX varsayılanı cm → 0.01)
 *   - dokuları küçültür, saydamlığı olmayanları JPEG yazar
 *
 * Kullanım:
 *   node tools/convert-model.mjs <girdi.fbx|glb> <çıktı.glb> [--scale 0.01] [--max-texture 2048] [--crop minX,minZ,maxX,maxZ]
 *
 * --crop: merkezi bu XZ dikdörtgeninin (metre) dışında kalan parçaları atar; ör. asset
 *         paketlerinde haritanın yanına dizilmiş örnek modelleri temizlemek için.
 *
 * Dönüşüm three.js'in kendi yükleyici/dışa aktarıcılarıyla headless Chrome/Edge içinde yapılır.
 * Tarayıcı yolu otomatik bulunur; gerekirse CHROME_PATH ortam değişkeniyle verin.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  const v = args.splice(i, 2)[1];
  return Number(v);
};
const maxTexture = flag('--max-texture', 2048);
const cropIdx = args.indexOf('--crop');
const crop = cropIdx === -1 ? null : args.splice(cropIdx, 2)[1].split(',').map(Number);
const scaleArg = flag('--scale', undefined);
const [input, output] = args;
if (!input || !output) {
  console.error('Kullanım: node tools/convert-model.mjs <girdi.fbx|glb> <çıktı.glb> [--scale 0.01] [--max-texture 2048]');
  process.exit(1);
}
const inputAbs = path.resolve(input);
const outputAbs = path.resolve(output);
if (!fs.existsSync(inputAbs)) {
  console.error(`Girdi bulunamadı: ${inputAbs}`);
  process.exit(1);
}
const scale = scaleArg ?? (/\.fbx$/i.test(inputAbs) ? 0.01 : 1);

const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const executablePath = chromeCandidates.find((p) => fs.existsSync(p));
if (!executablePath) {
  console.error('Chrome/Edge bulunamadı. CHROME_PATH ortam değişkenini ayarlayın.');
  process.exit(1);
}

const server = await createServer({
  root,
  logLevel: 'error',
  server: { port: 0, fs: { allow: [root, path.dirname(inputAbs)] } },
});
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await puppeteer.launch({ executablePath, headless: 'new', protocolTimeout: 0 });

try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[sayfa hatası]', e.message));
  page.on('response', (r) => {
    if (r.status() >= 400) console.warn(`[uyarı] ${r.status()} ${decodeURIComponent(r.url())}`);
  });
  fs.mkdirSync(path.dirname(outputAbs), { recursive: true });
  await page.exposeFunction('__write', (b64, first) =>
    fs[first ? 'writeFileSync' : 'appendFileSync'](outputAbs, Buffer.from(b64, 'base64')),
  );
  await page.goto(`${base}tools/convert/index.html`, { waitUntil: 'networkidle0' });

  const t0 = Date.now();
  const url = '/@fs/' + encodeURI(inputAbs.replace(/\\/g, '/').replace(/^\//, ''));
  const stats = await page.evaluate((o) => window.convert(o), { url, scale, maxTexture, crop });

  const mb = (n) => (n / 1e6).toFixed(1) + ' MB';
  console.log(`✓ ${path.basename(inputAbs)} → ${path.relative(root, outputAbs)} (${((Date.now() - t0) / 1000).toFixed(1)} sn)`);
  console.log(`  boyut      ${mb(fs.statSync(inputAbs).size)} → ${mb(fs.statSync(outputAbs).size)}`);
  console.log(`  mesh       ${stats.meshesBefore} → ${stats.meshesAfter}  (${stats.trianglesBefore.toLocaleString('tr')} üçgen)`);
  if (crop) console.log(`  kırpma     ${stats.cropped} parça atıldı`);
  console.log(`  ölçü (m)   ${stats.size.map((v) => v.toFixed(2)).join(' × ')}  (en alt y = ${stats.min[1].toFixed(2)})`);
  for (const m of stats.materials) console.log(`  malzeme    ${m}`);
  for (const w of stats.warnings) console.warn(`  [uyarı]    ${w}`);
} finally {
  await browser.close();
  await server.close();
}
