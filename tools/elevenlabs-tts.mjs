#!/usr/bin/env node
/**
 * ElevenLabs TTS Generator for Cartoon Engine Scenarios.
 *
 * Usage:
 *   node tools/elevenlabs-tts.mjs [scenario-file] [--api-key <key>]
 *
 * Example:
 *   node tools/elevenlabs-tts.mjs public/scenarios/harita-toprak-yol.yaml
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

// Load .env if present
const envPath = path.resolve('.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const k = trimmed.slice(0, idx).trim();
        const v = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[k]) process.env[k] = v;
      }
    }
  }
}

// User-defined & curated ElevenLabs voices (compatible with eleven_multilingual_v2)
export const DEFAULT_VOICES = {
  // Amy
  amy: 'A2XgcJ6lQVEFeIaIUyrc',
  rachel: '21m00Tcm4TlvDq8ikWAM',
  lily: 'pFZP5JQG7iQjIQuC4Bku',
  freya: 'jsCqWAovK2LkecY7zXl4',

  // Jackie
  jackie: 'o9DOmAyPjfFu8AfoFAnM',
  adam: 'pNInz6obpgDQGcFmaJgB',
  antoni: 'ErXwobaYiN019PkySvjV',
  arnold: 'VR6AewLTigWG4xSOukaG',

  // Çocuk / Kid
  cocuk: 'xDppd78rqTGY8ICN7M4n',
  kid: 'xDppd78rqTGY8ICN7M4n',
  elli: 'MF3mGyEYCl7XYWbV9V6O',
  gigi: 'jBpfuIE2acCO8z3wKNLl',
};

// Simple MP3 duration parser without external dependencies
function getMp3DurationSeconds(buffer) {
  // Bitrate lookup table for MPEG-1 Audio Layer III (kbps)
  const bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
  const sampleRates = [44100, 48000, 32000, 0];

  let offset = 0;
  // Skip ID3v2 tag if present
  if (buffer.length > 10 && buffer.toString('ascii', 0, 3) === 'ID3') {
    const size =
      ((buffer[6] & 0x7f) << 21) |
      ((buffer[7] & 0x7f) << 14) |
      ((buffer[8] & 0x7f) << 7) |
      (buffer[9] & 0x7f);
    offset = 10 + size;
  }

  let totalFrames = 0;
  let sampleRate = 44100;

  while (offset + 4 < buffer.length) {
    if (buffer[offset] === 0xff && (buffer[offset + 1] & 0xe0) === 0xe0) {
      const b1 = buffer[offset + 1];
      const b2 = buffer[offset + 2];
      const version = (b1 >> 3) & 0x03;
      const layer = (b1 >> 1) & 0x03;

      if (version === 3 && layer === 1) { // MPEG-1 Layer 3
        const bitrateIdx = (b2 >> 4) & 0x0f;
        const srIdx = (b2 >> 2) & 0x03;
        const padding = (b2 >> 1) & 0x01;
        const bitrate = bitrates[bitrateIdx] * 1000;
        sampleRate = sampleRates[srIdx] || 44100;

        if (bitrate > 0 && sampleRate > 0) {
          const frameLength = Math.floor((144 * bitrate) / sampleRate) + padding;
          totalFrames++;
          offset += frameLength;
          continue;
        }
      }
    }
    offset++;
  }

  if (totalFrames > 0 && sampleRate > 0) {
    return (totalFrames * 1152) / sampleRate;
  }
  // Fallback estimation assuming 128kbps standard
  return (buffer.length * 8) / 128000;
}

async function callElevenLabsTTS(apiKey, voiceId, text) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Accept': 'audio/mpeg',
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.25,
        use_speaker_boost: true,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs API Hatası (${response.status}): ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function main() {
  const args = process.argv.slice(2);
  let scenarioPath = 'public/scenarios/harita-toprak-yol.yaml';
  let apiKey = process.env.ELEVENLABS_API_KEY;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--api-key' && args[i + 1]) {
      apiKey = args[++i];
    } else if (!args[i].startsWith('--')) {
      scenarioPath = args[i];
    }
  }

  if (!apiKey) {
    console.error('Hata: ElevenLabs API Key bulunamadı!');
    console.error('Lütfen .env dosyasına ELEVENLABS_API_KEY=... ekleyin veya --api-key <key> parametresi verin.');
    process.exit(1);
  }

  if (!fs.existsSync(scenarioPath)) {
    console.error(`Hata: Senaryo dosyası bulunamadı: ${scenarioPath}`);
    process.exit(1);
  }

  console.log(`[TTS] Senaryo okunuyor: ${scenarioPath}`);
  const yamlText = fs.readFileSync(scenarioPath, 'utf8');
  const scenario = parseYaml(yamlText);
  const SHARED_CHARACTERS = parseYaml(fs.readFileSync(path.resolve('src/data/characters.yaml'), 'utf8')) ?? {};

  const scenarioName = path.basename(scenarioPath, path.extname(scenarioPath));
  const audioDir = path.resolve('public/audio', scenarioName);
  fs.mkdirSync(audioDir, { recursive: true });

  let count = 0;

  for (const [sceneIdx, scene] of (scenario.scenes || []).entries()) {
    const processAction = async (action, labelPrefix, fileTag) => {
      if (action.do === 'talk' && action.text) {
        const who = action.who;
        // Karakterin varlığı (sahnedeki asset adı); ses senaryodaki tanımdan, yoksa ortak katalogdan
        // (src/data/characters.yaml: aynı adlı karakter ya da `base`)
        const assetKey = (scene.characters || []).find((c) => c.id === who)?.asset ?? who;
        const characterAsset = scenario.assets?.[assetKey];
        const shared = SHARED_CHARACTERS[characterAsset?.base ?? assetKey];
        const voiceId =
          action.voice ||
          characterAsset?.voice ||
          shared?.voice ||
          DEFAULT_VOICES[who.toLowerCase()] ||
          DEFAULT_VOICES.rachel;

        const fileName = `${who}_${fileTag}.mp3`;
        const filePath = path.join(audioDir, fileName);
        const relativeAudioPath = `audio/${scenarioName}/${fileName}`;

        console.log(`\n[${labelPrefix}] "${who}" seslendiriliyor (Ses: ${voiceId}):`);
        console.log(`  Metin: "${action.text}"`);

        const audioBuffer = await callElevenLabsTTS(apiKey, voiceId, action.text);
        fs.writeFileSync(filePath, audioBuffer);

        const duration = getMp3DurationSeconds(audioBuffer);
        console.log(`  Kaydedildi: ${relativeAudioPath} (${duration.toFixed(2)} sn)`);

        action.audio = relativeAudioPath;
        action.duration = Math.round(duration * 100) / 100;
        count++;
      }
    };

    for (const [actionIdx, action] of (scene.actions || []).entries()) {
      await processAction(action, `Sahne ${sceneIdx + 1} Eylem ${actionIdx + 1}`, `scene${sceneIdx + 1}_${actionIdx + 1}`);
    }

    for (const [shotIdx, shot] of (scene.shots || []).entries()) {
      for (const [actionIdx, action] of (shot.actions || []).entries()) {
        await processAction(action, `Çekim ${shotIdx + 1}`, `shot${shotIdx + 1}_${actionIdx + 1}`);
      }
    }
  }

  if (count > 0) {
    fs.writeFileSync(scenarioPath, stringifyYaml(scenario), 'utf8');
    console.log(`\n[BAŞARILI] ${count} konuşma seslendirildi ve senaryo güncellendi!`);
  } else {
    console.log('\n[BİLGİ] Senaryoda seslendirilecek "talk" eylemi (text içeren) bulunamadı.');
  }
}

main().catch((err) => {
  console.error('\n[HATA] TTS İşleminde Hata:', err.message);
  process.exit(1);
});
