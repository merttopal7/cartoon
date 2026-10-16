// Yürüyüş zaman çizelgesi testleri: yeni bir hareket önceki hareketi geriye dönük değiştirmemeli.
// Character sınıfını Vite üzerinden doğrudan tarayıcıda yükler (sahte rig ile).
// Kullanım: node tools/test_walk_timeline.mjs   (dev sunucusu açık olmalı: http://localhost:5174)
import puppeteer from 'puppeteer-core';

const URL = process.env.ENGINE_URL ?? 'http://localhost:5174/';
const BROWSER = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const browser = await puppeteer.launch({ executablePath: BROWSER, headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  const results = await page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js').catch(() => import('three'));
    const { Character } = await import('/src/engine/character.ts');
    const rig = () => ({ root: new THREE.Group(), height: 1.7, width: 0.5, apply() {} });
    const warn = () => {};
    const make = () => new Character('t', rig(), new THREE.Vector3(0, 0, 0), 0);
    const walk = (to, at, duration, clip) => ({ who: 't', do: 'walk_to', to, at, duration, speed: 1.2, clip, fade: 0.3 });
    const pos = (c, t) => c.positionAt(t, new THREE.Vector3());
    const near = (a, b, eps = 1e-6) => a.distanceTo(b) < eps;
    const out = [];
    const check = (name, ok, detail) => out.push({ name, ok, detail });

    // 1) Kesilen yürüyüş: kesilmeden önceki konumlar, tek başına yürüyüşle birebir aynı olmalı
    const ref = make();
    ref.schedule(walk([[10, 0], [10, 10]], 0, 8), 0, warn);
    const cut = make();
    cut.schedule(walk([[10, 0], [10, 10]], 0, 8), 0, warn);
    cut.schedule(walk([-5, 5], 4, 3, 'run'), 4, warn);
    const same = [0.5, 1, 2, 3, 3.9, 4].every((t) => near(pos(ref, t), pos(cut, t)));
    check('kesilen yürüyüş kesilmeden önce değişmez', same,
      [1, 3, 4].map((t) => `${t}s ${pos(ref, t).toArray().map((v) => v.toFixed(2))} / ${pos(cut, t).toArray().map((v) => v.toFixed(2))}`).join(' · '));
    const atCut = pos(cut, 4);
    check('kesme anında yeni yürüyüş aynı noktadan başlar (ışınlanma yok)', near(pos(cut, 4.0001), atCut, 1e-3),
      `${atCut.toArray().map((v) => v.toFixed(3))}`);
    check('yeni yürüyüş hedefine varır', near(pos(cut, 7.5), new THREE.Vector3(-5, 0, 5), 1e-6), pos(cut, 7.5).toArray().map((v) => v.toFixed(2)).join(','));

    // 2) Birleşen yürüyüşler: her bölüm kendi süresini korumalı
    const merged = make();
    merged.schedule(walk([10, 0], 0, 5), 0, warn);
    merged.schedule(walk([20, 0], 5, 2), 5, warn);
    const x = (t) => pos(merged, t).x;
    check('ilk bölüm 5 sn sonunda 10 m noktasında', Math.abs(x(5) - 10) < 0.05, `x(5)=${x(5).toFixed(3)}`);
    check('ikinci bölüm 7 sn sonunda 20 m noktasında', Math.abs(x(7) - 20) < 1e-6, `x(7)=${x(7).toFixed(3)}`);
    // İlk bölüm hızlanarak başlar ama sonda yavaşlamaz (ikinci bölüme hız kesmeden geçer); bu yüzden
    // zamanın ortasında yolun ortasının biraz gerisindedir. Eski kod 20 m'yi 7 sn'ye yayıp ~7.1 m veriyordu.
    check('ilk bölümün ortası yazıldığı gibi (~5 m)', Math.abs(x(2.5) - 5) < 0.4, `x(2.5)=${x(2.5).toFixed(3)} (eskisi ~7.1)`);
    // Bölümler arasında durup kalkma yok: 5 sn civarında hız sıfıra inmemeli
    const v = (t) => (x(t + 0.01) - x(t - 0.01)) / 0.02;
    check('bölüm geçişinde yavaşlama yok', v(5) > 1.5, `v(5)=${v(5).toFixed(2)} m/sn`);

    // 3) Savrulma yürüyüşü keser; sonra gelen walk_to birleştirilmez, savrulmanın bittiği yerden başlar
    const kb = make();
    kb.schedule(walk([10, 0], 0, 5), 0, warn);
    kb.scheduleKnockback([3, 4], 2, 0.8, 0.3);
    kb.schedule(walk([0, 10], 5.1, 3), 5.1, warn);
    check('savrulmadan önceki yürüyüş değişmez', [0.5, 1, 1.9, 2].every((t) => near(pos(kb, t), pos(ref1(), t))), '');
    check('savrulma sonrası walk_to ışınlanmadan başlar', near(pos(kb, 5.1), new THREE.Vector3(3, 0, 4), 1e-3), pos(kb, 5.1).toArray().map((v) => v.toFixed(2)).join(','));
    function ref1() {
      const r = make();
      r.schedule(walk([10, 0], 0, 5), 0, warn);
      return r;
    }
    return out;
  });
  let failed = 0;
  for (const r of results) {
    console.log(`${r.ok ? 'GEÇTİ' : 'KALDI'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
    if (!r.ok) failed++;
  }
  console.log(failed ? `\n${failed} test kaldı` : '\nTüm testler geçti');
  process.exitCode = failed ? 1 : 0;
} finally {
  await browser.close();
}
