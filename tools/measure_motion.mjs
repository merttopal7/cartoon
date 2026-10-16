// Hareket akıcılığı ölçümü: filmi kare kare değerlendirir ve karakterlerdeki ani sıçramaları ("pat" diye
// geçişleri) bulur. Kemiklerde açısal ivme (ardışık iki karedeki açısal hız farkı), kökte konum ve yön sıçraması.
// Kullanım: node tools/measure_motion.mjs [senaryo] [fps]
//   node tools/measure_motion.mjs bolum-2-karabeyin-golgesi 30
// Dev sunucusu açık olmalı (npm run dev → http://localhost:5174).
import puppeteer from 'puppeteer-core';

const [scenario = 'bolum-2-karabeyin-golgesi', fps = '30'] = process.argv.slice(2);
const URL = process.env.ENGINE_URL ?? 'http://localhost:5174/';
const BROWSER = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const browser = await puppeteer.launch({
  executablePath: BROWSER,
  headless: true,
  args: ['--no-sandbox', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'],
  defaultViewport: { width: 1280, height: 720 },
  protocolTimeout: 600000,
});

try {
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  const waitLoaded = () =>
    page.waitForFunction(
      () => {
        const o = document.querySelector('#loading-overlay');
        return window.__engine?.film && (!o || o.hidden);
      },
      { timeout: 180000 },
    );
  await waitLoaded();
  await page.evaluate((id) => window.__engine.loadScenario(id), scenario);
  await waitLoaded();

  const report = await page.evaluate((fps) => {
    const { film, THREE } = window.__engine;
    const format = { id: 'youtube_16x9', width: 1920, height: 1080, fps };
    const MAJOR = /(hips|spine|neck|head|shoulder|arm|forearm|hand$|upleg|thigh|leg|foot)$/i;
    const deg = 180 / Math.PI;

    const tracks = new Map(); // karakter → { bones, prevQ, prevW, prevPos, prevVel, prevYaw, events }
    const qa = new THREE.Quaternion();
    const qInv = new THREE.Quaternion();
    const rootQ = new THREE.Quaternion();

    const frames = Math.round(film.duration * fps);
    for (let f = 0; f < frames; f++) {
      const t = f / fps;
      const { scene } = film.evaluate(t, format);
      scene.group.updateMatrixWorld(true);
      for (const [id, ch] of scene.characters) {
        const key = `${scene.id}/${id}`;
        let tr = tracks.get(key);
        if (!tr) {
          const bones = [];
          ch.rig.root.traverse((o) => o.isBone && MAJOR.test(o.name.replace(/^mixamorig\d*:?/i, '')) && bones.push(o));
          tr = { bones, prevQ: null, prevW: null, prevPos: null, prevVel: null, prevYaw: null, prevYawVel: null, bonePops: [], rootPops: [] };
          tracks.set(key, tr);
        }
        ch.rig.root.getWorldQuaternion(rootQ);
        qInv.copy(rootQ).invert();
        // Kemik yönleri karakterin köküne göre (dönüş ayrıca ölçülür)
        const q = tr.bones.map((b) => b.getWorldQuaternion(new THREE.Quaternion()).premultiply(qInv));
        if (tr.prevQ) {
          const w = q.map((qi, i) => {
            qa.copy(qi).multiply(tr.prevQ[i].clone().invert());
            if (qa.w < 0) qa.set(-qa.x, -qa.y, -qa.z, -qa.w);
            const angle = 2 * Math.acos(Math.min(1, qa.w));
            const s = Math.sqrt(Math.max(1e-12, 1 - qa.w * qa.w));
            return new THREE.Vector3(qa.x / s, qa.y / s, qa.z / s).multiplyScalar(angle);
          });
          if (tr.prevW) {
            let worst = 0;
            let worstBone = '';
            w.forEach((wi, i) => {
              const a = wi.distanceTo(tr.prevW[i]) * deg;
              if (a > worst) {
                worst = a;
                worstBone = tr.bones[i].name.replace(/^mixamorig\d*:?/i, '');
              }
            });
            tr.bonePops.push({ t, a: worst, bone: worstBone });
          }
          tr.prevW = w;
        }
        tr.prevQ = q;

        const pos = ch.rig.root.getWorldPosition(new THREE.Vector3());
        const yaw = ch.rig.root.rotation.y;
        if (tr.prevPos) {
          const vel = pos.clone().sub(tr.prevPos);
          let yawVel = yaw - tr.prevYaw;
          yawVel = Math.atan2(Math.sin(yawVel), Math.cos(yawVel));
          if (tr.prevVel) {
            tr.rootPops.push({ t, move: vel.distanceTo(tr.prevVel) * fps, turn: Math.abs(yawVel - tr.prevYawVel) * deg });
          }
          tr.prevVel = vel;
          tr.prevYawVel = yawVel;
        }
        tr.prevPos = pos;
        tr.prevYaw = yaw;
      }
    }

    const out = [];
    const totals = { pops20: 0, pops40: 0, moveJumps: 0, turnJumps: 0, sumTop: 0 };
    for (const [key, tr] of tracks) {
      const pops = tr.bonePops.sort((a, b) => b.a - a.a);
      const p20 = pops.filter((p) => p.a > 20).length;
      const p40 = pops.filter((p) => p.a > 40).length;
      // Konum: ardışık iki karede hız değişimi > 1.5 m/sn (ışınlanma / ani duruş), yön: > 6°/kare ivme
      const mj = tr.rootPops.filter((p) => p.move > 1.5);
      const tj = tr.rootPops.filter((p) => p.turn > 6);
      totals.pops20 += p20;
      totals.pops40 += p40;
      totals.moveJumps += mj.length;
      totals.turnJumps += tj.length;
      totals.sumTop += pops.slice(0, 10).reduce((s, p) => s + p.a, 0);
      out.push(
        `${key}: kemik ivmesi >20°: ${p20} kare, >40°: ${p40} kare · kök sıçraması: ${mj.length} · dönüş sıçraması: ${tj.length}\n` +
          `   en kötü: ${pops.slice(0, 6).map((p) => `${p.t.toFixed(2)}s ${p.bone} ${p.a.toFixed(0)}°`).join('  ')}\n` +
          (mj.length ? `   kök: ${mj.sort((a, b) => b.move - a.move).slice(0, 4).map((p) => `${p.t.toFixed(2)}s ${p.move.toFixed(1)}m/s`).join('  ')}\n` : '') +
          (tj.length ? `   dönüş: ${tj.sort((a, b) => b.turn - a.turn).slice(0, 4).map((p) => `${p.t.toFixed(2)}s ${p.turn.toFixed(0)}°`).join('  ')}\n` : ''),
      );
    }
    return { lines: out, totals };
  }, +fps);

  console.log(`Senaryo: ${scenario} · ${fps} fps`);
  console.log(report.lines.join(''));
  const t = report.totals;
  console.log(`TOPLAM: kemik >20°: ${t.pops20} · >40°: ${t.pops40} · kök sıçraması: ${t.moveJumps} · dönüş sıçraması: ${t.turnJumps} · en kötü 10 ort: ${(t.sumTop / (10 * report.lines.length)).toFixed(1)}°`);
} finally {
  await browser.close();
}
