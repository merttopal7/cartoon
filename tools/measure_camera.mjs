// Kamera akıcılığı ölçümü: bir aralıkta kameranın sahne merkezine uzaklığının kaç kez "yaklaş-uzaklaş"
// yaptığını (pompalama), toplam ileri-geri hareketini ve kamera ivmesini raporlar.
// Kullanım: node tools/measure_camera.mjs [senaryo] [başlangıç] [bitiş]
//   node tools/measure_camera.mjs bolum-2-karabeyin-golgesi 31 76
// Dev sunucusu açık olmalı (npm run dev → http://localhost:5174). İsabet sarsıntısı ölçüm için kapatılır.
import puppeteer from 'puppeteer-core';

const [scenario = 'bolum-2-karabeyin-golgesi', from = '31', to = '76'] = process.argv.slice(2);
const URL = process.env.ENGINE_URL ?? 'http://localhost:5174/';
const BROWSER = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const browser = await puppeteer.launch({ executablePath: BROWSER, headless: true, args: ['--no-sandbox'], protocolTimeout: 600000 });
try {
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  const waitLoaded = () =>
    page.waitForFunction(() => {
      const o = document.querySelector('#loading-overlay');
      return window.__engine?.film && (!o || o.hidden);
    }, { timeout: 180000 });
  await waitLoaded();
  await page.evaluate((id) => window.__engine.loadScenario(id), scenario);
  await waitLoaded();

  const r = await page.evaluate((from, to) => {
    const { film, THREE } = window.__engine;
    for (const sc of film.scenes) sc.impact = null; // sarsıntı ve hit-stop ölçümü bozmasın
    const f = { id: 'youtube_16x9', width: 1920, height: 1080 };
    const fps = 30;
    const d = [];
    const pos = [];
    for (let fi = Math.round(from * fps); fi <= Math.round(to * fps); fi++) {
      const t = fi / fps;
      const { scene } = film.evaluate(t, f);
      const c = new THREE.Vector3();
      for (const ch of scene.characters.values()) c.add(ch.pose.position);
      c.divideScalar(scene.characters.size);
      pos.push(film.camera.position.clone());
      d.push(film.camera.position.distanceTo(c));
    }
    // Yön değiştirme (histerezisli): uzaklık en az HYST kadar değişmeden yeni uç nokta sayılmaz
    const HYST = 0.25;
    let extrema = 0;
    let dir = 0;
    let ref = d[0];
    for (const v of d) {
      if (dir >= 0 && v < ref - HYST) {
        if (dir > 0) extrema++;
        dir = -1;
        ref = v;
      } else if (dir <= 0 && v > ref + HYST) {
        if (dir < 0) extrema++;
        dir = 1;
        ref = v;
      } else if ((dir > 0 && v > ref) || (dir < 0 && v < ref)) ref = v;
    }
    let travel = 0;
    for (let i = 1; i < d.length; i++) travel += Math.abs(d[i] - d[i - 1]);
    const accT = [];
    for (let i = 1; i < pos.length - 1; i++) {
      const a = pos[i + 1].clone().add(pos[i - 1]).sub(pos[i].clone().multiplyScalar(2)).length() * fps * fps;
      accT.push({ a, t: from + i / fps });
    }
    accT.sort((x, y) => y.a - x.a);
    const acc = accT.map((x) => x.a);
    const worst = accT.slice(0, 5).map((x) => `${x.t.toFixed(2)}s ${x.a.toFixed(0)}`);
    return {
      extrema,
      travel,
      net: Math.abs(d[d.length - 1] - d[0]),
      min: Math.min(...d),
      max: Math.max(...d),
      accMax: acc[0],
      accP95: acc[Math.floor(acc.length * 0.05)],
      worst,
    };
  }, +from, +to);

  console.log(`Senaryo: ${scenario} · ${from}-${to} sn`);
  console.log(`Uzaklık: ${r.min.toFixed(1)}–${r.max.toFixed(1)} m · yön değiştirme (pompalama): ${r.extrema} · toplam ileri-geri: ${r.travel.toFixed(1)} m (net ${r.net.toFixed(1)} m)`);
  console.log(`Kamera ivmesi: en büyük ${r.accMax.toFixed(1)} m/sn² · p95 ${r.accP95.toFixed(1)} m/sn²`);
  console.log(`En sert anlar: ${r.worst.join('  ')}`);
} finally {
  await browser.close();
}
