#!/usr/bin/env node
/**
 * Bir senaryo üretecinin replik listesindeki (ör. tools/data/bolum1_lines.json) sesi OLMAYAN replikleri ElevenLabs ile
 * seslendirir; var olan dosyalara dokunmaz. Dosya adları üreteçten gelir (kim + metin özeti): metin değişmedikçe
 * yeniden üretilmez. Ardından üreteci tekrar çalıştırın (ör. python tools/build_bolum1.py); süreler gerçek seslere
 * göre güncellenir.
 *
 * Kredi harcar: önce --dry ile kaç replik ve karakter üretileceğini görün.
 *
 * Kullanım:
 *   node tools/tts-missing.mjs tools/data/bolum1_lines.json --dry
 *   node tools/tts-missing.mjs tools/data/bolum1_lines.json
 * Anahtar: .env içindeki ELEVENLABS_API_KEY (ekrana yazılmaz).
 */
import fs from 'node:fs';
import path from 'node:path';

const envPath = path.resolve('.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    const i = t.indexOf('=');
    if (!t || t.startsWith('#') || i <= 0) continue;
    const k = t.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
}

const [listPath, ...flags] = process.argv.slice(2);
if (!listPath) {
  console.error('Kullanım: node tools/tts-missing.mjs <replik-listesi.json> [--dry]');
  process.exit(1);
}
const dry = flags.includes('--dry');
const { audio_dir: audioDir, lines } = JSON.parse(fs.readFileSync(listPath, 'utf8'));
const outDir = path.resolve('public', audioDir);
const missing = lines.filter((l) => !fs.existsSync(path.join(outDir, l.file)));
const chars = missing.reduce((n, l) => n + l.text.length, 0);
console.log(`${lines.length} replik; sesi olmayan ${missing.length} (${chars} karakter).`);
if (dry || missing.length === 0) process.exit(0);

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error('.env içinde ELEVENLABS_API_KEY yok.');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

for (const [k, l] of missing.entries()) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${l.voice}`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text: l.text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.25, use_speaker_boost: true },
    }),
  });
  if (!res.ok) {
    console.error(`[${k + 1}/${missing.length}] ${l.file}: HTTP ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  fs.writeFileSync(path.join(outDir, l.file), Buffer.from(await res.arrayBuffer()));
  console.log(`[${k + 1}/${missing.length}] ${l.who}: ${l.text}`);
}
console.log('Bitti. Şimdi üreteci yeniden çalıştırın (süreler gerçek seslere göre güncellenir).');
