import * as THREE from 'three';
import type { ScheduledAbility } from '../abilities';
import * as SH from './shaders';
import { toonMaterial } from '../toon';

export const SMOKE_COUNT = 36;
export const DETAIL_COUNT = 48;
export const MAX_SEEDS = Math.max(SMOKE_COUNT, DETAIL_COUNT);
export const LIGHTNING_SEGMENTS = 18;
/** Toprak yeteneğinde yol boyunca fışkıran diken sayısı ve hedefin altındaki büyük diken sayısı. */
export const EARTH_WAVE_SPIKES = 10;
export const EARTH_BIG_SPIKES = 3;

/** Toprak (yer dikenleri) efektinin parçaları; yalnızca bu efekti kullanan yeteneklerde kurulur. */
export interface EarthParts {
  group: THREE.Group;
  /** Kullanandan hedefe sırayla yerden fışkıran dikenler */
  wave: THREE.Mesh[];
  /** Hedefin altında fışkıran büyük dikenler */
  big: THREE.Mesh[];
}

export interface AbilityVisual {
  ability: ScheduledAbility;
  root: THREE.Group;
  light: THREE.PointLight;
  fireCoreMesh: THREE.Mesh;
  fireCoreMat: THREE.ShaderMaterial;
  fireCoronaMesh: THREE.Mesh;
  fireCoronaMat: THREE.ShaderMaterial;
  vortexMesh: THREE.Mesh;
  vortexMat: THREE.ShaderMaterial;
  outerVortexMesh: THREE.Mesh;
  outerVortexMat: THREE.ShaderMaterial;
  lightningLine: THREE.LineSegments;
  lightningPositions: Float32Array;
  lightningMat: THREE.LineBasicMaterial;
  arrowGroup: THREE.Group;
  arrowSpinGroup: THREE.Group;
  arrowMats: THREE.ShaderMaterial[];
  treeGroup: THREE.Group;
  treeStumpGroup: THREE.Group;
  treePivotGroup: THREE.Group;
  treeSlashMesh: THREE.Mesh;
  treeMats: THREE.ShaderMaterial[];
  launchOrigin: THREE.Vector3;
  smokePoints: THREE.Points;
  smokeMat: THREE.ShaderMaterial;
  smokePositions: Float32Array;
  smokeColors: Float32Array;
  smokeSizes: Float32Array;
  smokeAngles: Float32Array;
  smokeAlphas: Float32Array;
  detailPoints: THREE.Points;
  detailMat: THREE.ShaderMaterial;
  detailPositions: Float32Array;
  detailColors: Float32Array;
  detailSizes: Float32Array;
  detailAngles: Float32Array;
  detailAlphas: Float32Array;
  seeds: Float32Array;
  earth?: EarthParts;
}

/** Tohumlu sözde rastgele (0..1); diken biçimleri her çalıştırmada aynı. */
function seeded(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Kaya diken geometrisi: tabanı y=0'da, boyu 1, yarıçapı 1 olan yamuk bir koni (ölçekle boyutlanır).
 * Köşeler tohumla oynatılır ki her diken farklı, kırık taş gibi görünsün.
 */
function rockSpikeGeometry(seed: number): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(1, 1, 7, 3).toNonIndexed();
  g.translate(0, 0.5, 0);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (v.y > 0.98) continue; // sivri uç yerinde kalsın
    const key = Math.round(v.x * 97) * 31 + Math.round(v.z * 89) * 17 + Math.round(v.y * 13);
    const k = 0.75 + seeded(seed * 13.7 + key) * 0.5;
    v.x *= k;
    v.z *= k;
    v.y += (seeded(seed * 7.3 + key) - 0.5) * 0.08 * (1 - v.y);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function buildEarthParts(): EarthParts {
  const group = new THREE.Group();
  group.visible = false;
  const light = toonMaterial('#7b6248', { flat: true });
  const dark = toonMaterial('#5c4835', { flat: true });
  const make = (i: number) => {
    const m = new THREE.Mesh(rockSpikeGeometry(i + 1), i % 3 === 0 ? dark : light);
    m.visible = false;
    m.castShadow = true;
    group.add(m);
    return m;
  };
  const wave = Array.from({ length: EARTH_WAVE_SPIKES }, (_, i) => make(i));
  const big = Array.from({ length: EARTH_BIG_SPIKES }, (_, i) => make(EARTH_WAVE_SPIKES + i));
  return { group, wave, big };
}

/** Bir yetenek kullanımının tüm görsel parçalarını kurar (sahneye eklemez; ışık havuza kopyalanır). */
export function buildVisual(ability: ScheduledAbility): AbilityVisual {
  const root = new THREE.Group();
  root.visible = false;
  root.userData.isAbility = true;

  const { effectType } = ability.recipe;
  const isShadow = effectType === 'shadow';
  const isRain = effectType === 'rain';
  const isTornado = effectType === 'tornado';
  const isTreeFall = effectType === 'tree_fall';
  const isEarth = effectType === 'earth';

  // 1. Dinamik Işık
  const lightColor = isEarth
    ? 0xd6a35c
    : isTornado
    ? 0x94a3b8
    : isRain
      ? 0xbae6fd
      : isShadow
        ? 0x1e1b4b
        : isTreeFall
          ? 0xf97316
          : 0xff6b00;
  // Sahneye eklenmez; konum root uzayındadır (root hiç dönüştürülmez) ve kare sonunda havuza kopyalanır.
  const light = new THREE.PointLight(lightColor, 0, 15, 1.5);

  // 2. Deterministik Tohumlar
  const seeds = new Float32Array(MAX_SEEDS * 4);
  for (let i = 0; i < MAX_SEEDS; i++) {
    const s1 = Math.sin((i + 1) * 12.9898) * 43758.5453;
    const s2 = Math.sin((i + 1) * 78.233) * 43758.5453;
    const s3 = Math.sin((i + 1) * 39.425) * 43758.5453;
    const s4 = Math.sin((i + 1) * 93.117) * 43758.5453;
    seeds[i * 4 + 0] = s1 - Math.floor(s1);
    seeds[i * 4 + 1] = s2 - Math.floor(s2);
    seeds[i * 4 + 2] = s3 - Math.floor(s3);
    seeds[i * 4 + 3] = s4 - Math.floor(s4);
  }

  // 3. 3B Plazma Ateş Çekirdeği ve 3B Alev Koronası (Ateş Topu için)
  const fireCoreMat = new THREE.ShaderMaterial({
    vertexShader: SH.FIRE_CORE_VERTEX,
    fragmentShader: SH.FIRE_CORE_FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uIsCorona: { value: 0.0 },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const fireCoreMesh = new THREE.Mesh(new THREE.SphereGeometry(0.30, 36, 36), fireCoreMat);
  fireCoreMesh.visible = false;
  fireCoreMesh.renderOrder = 12;
  root.add(fireCoreMesh);

  const fireCoronaMat = new THREE.ShaderMaterial({
    vertexShader: SH.FIRE_CORE_VERTEX,
    fragmentShader: SH.FIRE_CORE_FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uIsCorona: { value: 1.0 },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const fireCoronaGeo = new THREE.SphereGeometry(0.46, 36, 36);
  const fireCoronaMesh = new THREE.Mesh(fireCoronaGeo, fireCoronaMat);
  fireCoronaMesh.visible = false;
  fireCoronaMesh.renderOrder = 11;
  root.add(fireCoronaMesh);

  // 4. 3B Çok Katmanlı Hacimsel Gövde (Hortum Hunisi / Siyah Duman Örtüsü / Fırtına Bulutu Kubbesi)
  const vortexMode = isRain ? 2.0 : isShadow ? 1.0 : 0.0;
  const vortexMat = new THREE.ShaderMaterial({
    vertexShader: SH.VORTEX_VERTEX,
    fragmentShader: SH.VORTEX_FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uSway: { value: isTornado ? 1.0 : 0.25 },
      uMode: { value: vortexMode },
      uLayer: { value: 0.0 },
      uLightning: { value: 0.0 },
    },
    transparent: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const outerVortexMat = new THREE.ShaderMaterial({
    vertexShader: SH.VORTEX_VERTEX,
    fragmentShader: SH.VORTEX_FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uSway: { value: isTornado ? 1.15 : 0.25 },
      uMode: { value: vortexMode },
      uLayer: { value: 1.0 },
      uLightning: { value: 0.0 },
    },
    transparent: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  let vortexGeo: THREE.BufferGeometry;
  let outerVortexGeo: THREE.BufferGeometry;
  if (isRain) {
    vortexGeo = new THREE.SphereGeometry(1.0, 48, 32);
    outerVortexGeo = new THREE.SphereGeometry(1.0, 48, 32);
  } else {
    vortexGeo = new THREE.CylinderGeometry(1.0, 1.0, 1.0, 64, 48, true);
    vortexGeo.translate(0, 0.5, 0);
    outerVortexGeo = new THREE.CylinderGeometry(1.0, 1.0, 1.0, 64, 48, true);
    outerVortexGeo.translate(0, 0.5, 0);
  }

  const vortexMesh = new THREE.Mesh(vortexGeo, vortexMat);
  vortexMesh.visible = false;
  vortexMesh.renderOrder = 9;
  root.add(vortexMesh);

  const outerVortexMesh = new THREE.Mesh(outerVortexGeo, outerVortexMat);
  outerVortexMesh.visible = false;
  outerVortexMesh.renderOrder = 10;
  root.add(outerVortexMesh);

  // 5. 3B Kırıklı Şimşek Çatalı (Yağmur Fırtınası için)
  const lightningPositions = new Float32Array(LIGHTNING_SEGMENTS * 2 * 3);
  const lightningGeo = new THREE.BufferGeometry();
  lightningGeo.setAttribute('position', new THREE.BufferAttribute(lightningPositions, 3));
  const lightningMat = new THREE.LineBasicMaterial({
    color: 0xe0f2fe,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
  });
  const lightningLine = new THREE.LineSegments(lightningGeo, lightningMat);
  lightningLine.visible = false;
  lightningLine.frustumCulled = false;
  lightningLine.renderOrder = 15;
  root.add(lightningLine);

  // 5B. Erika'nın 3B Büyülü Yağmur Oku (Çentikli Elmas Su Kristali Temren + Çift Sarmal Su Akıntısı + Kavisli Tüy Kanatçıklar)
  // y = 0.0 noktası tam olarak Erika'nın sol bileğine (mixamorigLeftHand) oturur;
  // çentikli elmas temren bileğin hemen önünde (+0.02m .. +0.25m),
  // ince kristal ok gövdesi, çift su sarmalı ve kavisli tüy kanatçıklar ise tam bilekten dirseğe doğru (0.0m -> -0.37m) uzanır.
  const arrowGroup = new THREE.Group();
  arrowGroup.visible = false;
  const arrowSpinGroup = new THREE.Group();
  arrowGroup.add(arrowSpinGroup);
  const arrowMats: THREE.ShaderMaterial[] = [];

  const makeArrowPartMat = (part: number, additive = false) => {
    const mat = new THREE.ShaderMaterial({
      vertexShader: SH.ARROW_VERTEX,
      fragmentShader: SH.ARROW_FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 1.0 },
        uPart: { value: part },
        uFlight: { value: 0.0 },
      },
      transparent: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: !additive,
      side: THREE.DoubleSide,
    });
    arrowMats.push(mat);
    return mat;
  };

  const shaftMat = makeArrowPartMat(0.0, false);
  const broadheadMat = makeArrowPartMat(1.0, false);
  const helixStreamMat = makeArrowPartMat(2.0, true);
  const featherMat = makeArrowPartMat(3.0, false);
  const wakeConeMat = makeArrowPartMat(4.0, true);

  // 1) İnce Som Su/Safir Ok Gövdesi (bilekten y=+0.03m dirseğe y=-0.37m uzanır)
  const shaftGeo = new THREE.CylinderGeometry(0.0095, 0.0075, 0.40, 16, 20);
  shaftGeo.translate(0, -0.17, 0);
  const shaftCoreMesh = new THREE.Mesh(shaftGeo, shaftMat);
  shaftCoreMesh.renderOrder = 14;
  arrowSpinGroup.add(shaftCoreMesh);

  // 2) 4 Kanatlı Çentikli Elmas Su Kristali Ok Temreni (Barbed Diamond Broadhead: y=+0.005m .. +0.25m)
  const headShape = new THREE.Shape();
  headShape.moveTo(0, 0.25);
  headShape.lineTo(0.038, 0.045);
  headShape.lineTo(0.031, 0.004);
  headShape.lineTo(0.011, 0.038);
  headShape.lineTo(0.010, 0.018);
  headShape.lineTo(-0.010, 0.018);
  headShape.lineTo(-0.011, 0.038);
  headShape.lineTo(-0.031, 0.004);
  headShape.lineTo(-0.038, 0.045);
  headShape.closePath();

  const bladeGeo = new THREE.ExtrudeGeometry(headShape, {
    depth: 0.005,
    bevelEnabled: true,
    bevelThickness: 0.0035,
    bevelSize: 0.0025,
    bevelSegments: 2,
  });
  bladeGeo.translate(0, 0, -0.0025);

  const bladeMeshA = new THREE.Mesh(bladeGeo, broadheadMat);
  bladeMeshA.renderOrder = 15;
  arrowSpinGroup.add(bladeMeshA);

  const bladeMeshB = new THREE.Mesh(bladeGeo, broadheadMat);
  bladeMeshB.rotation.y = Math.PI * 0.5;
  bladeMeshB.renderOrder = 15;
  arrowSpinGroup.add(bladeMeshB);

  // Temren bilezik halkası (Ferrule Collar)
  const collarGeo = new THREE.CylinderGeometry(0.0135, 0.010, 0.032, 16);
  collarGeo.translate(0, 0.022, 0);
  const collarMesh = new THREE.Mesh(collarGeo, broadheadMat);
  collarMesh.renderOrder = 15;
  arrowSpinGroup.add(collarMesh);

  // 3) Ok Gövdesini Saran Çift Sarmallı 3B Su Akıntısı (Double-Helix Water Streams)
  for (let strand = 0; strand < 2; strand++) {
    const pts: THREE.Vector3[] = [];
    const steps = 28;
    for (let s = 0; s <= steps; s++) {
      const u = s / steps;
      const py = -0.33 + u * 0.38;
      const ang = u * Math.PI * 4.5 + strand * Math.PI;
      const rad = 0.013 + Math.sin(u * Math.PI) * 0.007;
      pts.push(new THREE.Vector3(Math.cos(ang) * rad, py, Math.sin(ang) * rad));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tubeGeo = new THREE.TubeGeometry(curve, 36, 0.0042, 8, false);
    const tubeMesh = new THREE.Mesh(tubeGeo, helixStreamMat);
    tubeMesh.renderOrder = 15;
    arrowSpinGroup.add(tubeMesh);
  }

  // 4) Kavisli Su Tüyü Kanatçıklar (3 Adet Parabolik Ok Tüyü: y=-0.20m .. -0.365m) ve Kiriş Yatağı (Nock)
  const fletchShape = new THREE.Shape();
  fletchShape.moveTo(0.006, -0.20);
  fletchShape.quadraticCurveTo(0.033, -0.275, 0.028, -0.362);
  fletchShape.lineTo(0.006, -0.342);
  fletchShape.closePath();

  const fletchGeo = new THREE.ExtrudeGeometry(fletchShape, {
    depth: 0.0024,
    bevelEnabled: false,
  });
  fletchGeo.translate(0, 0, -0.0012);

  for (let f = 0; f < 3; f++) {
    const fin = new THREE.Mesh(fletchGeo, featherMat);
    fin.rotation.y = (f * Math.PI * 2) / 3;
    fin.renderOrder = 14;
    arrowSpinGroup.add(fin);
  }

  const nockGeo = new THREE.CylinderGeometry(0.011, 0.007, 0.026, 12);
  nockGeo.translate(0, -0.365, 0);
  const nockMesh = new THREE.Mesh(nockGeo, broadheadMat);
  nockMesh.renderOrder = 15;
  arrowSpinGroup.add(nockMesh);

  // 5) Hidrodinamik Su Şok Konisi (Temrenin etrafında su dalgası halkası)
  const wakeGeo = new THREE.ConeGeometry(0.052, 0.18, 24, 1, true);
  wakeGeo.translate(0, 0.09, 0);
  const wakeMesh = new THREE.Mesh(wakeGeo, wakeConeMat);
  wakeMesh.renderOrder = 13;
  arrowSpinGroup.add(wakeMesh);

  root.add(arrowGroup);

  // 5C. Karabey'in 3B Ağaç Devirme Grubu (Kök Kütüğü + Menteşeli Üst Çam Gövdesi + 4 Katmanlı İğne Yaprak Kubbesi + Kılıç Kesiği Hilali)
  const treeGroup = new THREE.Group();
  treeGroup.visible = false;
  const treeStumpGroup = new THREE.Group();
  const treePivotGroup = new THREE.Group();
  // Kılıç kesim yüksekliği y = 0.68m (Karabey'in yatay kılıç darbesi hizası)
  treePivotGroup.position.set(0, 0.68, 0);
  treeGroup.add(treeStumpGroup);
  treeGroup.add(treePivotGroup);

  const treeMats: THREE.ShaderMaterial[] = [];
  const makeTreePartMat = (part: number, additive = false) => {
    const mat = new THREE.ShaderMaterial({
      vertexShader: SH.TREE_FALL_VERTEX,
      fragmentShader: SH.TREE_FALL_FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 1.0 },
        uPart: { value: part },
        uCutGlow: { value: 0.0 },
      },
      transparent: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: !additive,
      side: THREE.DoubleSide,
    });
    treeMats.push(mat);
    return mat;
  };

  const barkMat = makeTreePartMat(0.0, false);
  const foliageMat = makeTreePartMat(1.0, false);
  const cutWoodMat = makeTreePartMat(2.0, false);
  const slashWaveMat = makeTreePartMat(3.0, true);

  // 1) Kök Kütüğü (y = 0.0 .. 0.68m) ve 4 Yan Kök Çıkıntısı
  const stumpGeo = new THREE.CylinderGeometry(0.26, 0.36, 0.68, 20, 8, true);
  stumpGeo.translate(0, 0.34, 0);
  const stumpMesh = new THREE.Mesh(stumpGeo, barkMat);
  stumpMesh.renderOrder = 12;
  treeStumpGroup.add(stumpMesh);

  const stumpTopGeo = new THREE.CircleGeometry(0.26, 20);
  stumpTopGeo.rotateX(-Math.PI * 0.5);
  stumpTopGeo.translate(0, 0.68, 0);
  const stumpTopMesh = new THREE.Mesh(stumpTopGeo, cutWoodMat);
  stumpTopMesh.renderOrder = 13;
  treeStumpGroup.add(stumpTopMesh);

  for (let rIdx = 0; rIdx < 4; rIdx++) {
    const rootGeo = new THREE.ConeGeometry(0.11, 0.48, 10);
    rootGeo.translate(0, 0.20, 0.24);
    rootGeo.rotateX(-0.55);
    rootGeo.rotateY((rIdx * Math.PI) / 2 + 0.35);
    const rootMesh = new THREE.Mesh(rootGeo, barkMat);
    rootMesh.renderOrder = 12;
    treeStumpGroup.add(rootMesh);
  }

  // 2) Kılıç Kesiği Enerji Hilali (Karabey'in kılıcından haritadaki ağaca uçan yatay kesim dalgası)
  const slashGeo = new THREE.PlaneGeometry(1.85, 1.85, 1, 1);
  slashGeo.rotateX(-Math.PI * 0.5);
  const treeSlashMesh = new THREE.Mesh(slashGeo, slashWaveMat);
  treeSlashMesh.position.set(0, 0.68, 0);
  treeSlashMesh.visible = false;
  treeSlashMesh.renderOrder = 15;
  root.add(treeSlashMesh);

  // 3) Yedek Üst Ağaç Gövdesi (haritada Realistic_Pine_* bulunmayan özel sahneler için)
  treePivotGroup.visible = false;
  const upperTrunkGeo = new THREE.CylinderGeometry(0.09, 0.25, 4.45, 20, 16, true);
  upperTrunkGeo.translate(0, 2.225, 0);
  const upperTrunkMesh = new THREE.Mesh(upperTrunkGeo, barkMat);
  upperTrunkMesh.renderOrder = 12;
  treePivotGroup.add(upperTrunkMesh);

  const upperCutCapGeo = new THREE.CircleGeometry(0.25, 20);
  upperCutCapGeo.rotateX(Math.PI * 0.5);
  const upperCutCapMesh = new THREE.Mesh(upperCutCapGeo, cutWoodMat);
  upperCutCapMesh.renderOrder = 13;
  treePivotGroup.add(upperCutCapMesh);

  // 4) 4 Katmanlı Gür Orman Çamı Dalları ve Yaprak Kubbesi
  const tiers = [
    { y: 1.15, radius: 1.38, height: 1.65 },
    { y: 2.05, radius: 1.14, height: 1.50 },
    { y: 2.90, radius: 0.88, height: 1.35 },
    { y: 3.70, radius: 0.58, height: 1.20 },
  ];
  for (let tIdx = 0; tIdx < tiers.length; tIdx++) {
    const tier = tiers[tIdx];
    const coneGeo = new THREE.ConeGeometry(tier.radius, tier.height, 24, 10);
    coneGeo.translate(0, tier.y + tier.height * 0.5, 0);
    const coneMesh = new THREE.Mesh(coneGeo, foliageMat);
    coneMesh.rotation.y = tIdx * 0.85;
    coneMesh.renderOrder = 13;
    treePivotGroup.add(coneMesh);
  }

  root.add(treeGroup);

  // 6. KATMAN A: İnce Atmosferik Duman / Toz Sisi (Minimal Sayıda Yumuşak FBM Katmanı)
  const smokePositions = new Float32Array(SMOKE_COUNT * 3);
  const smokeColors = new Float32Array(SMOKE_COUNT * 3);
  const smokeSizes = new Float32Array(SMOKE_COUNT);
  const smokeAngles = new Float32Array(SMOKE_COUNT);
  const smokeAlphas = new Float32Array(SMOKE_COUNT);
  const smokeSeedAttr = new Float32Array(SMOKE_COUNT);
  for (let i = 0; i < SMOKE_COUNT; i++) smokeSeedAttr[i] = seeds[i * 4 + 0];

  const smokeGeo = new THREE.BufferGeometry();
  smokeGeo.setAttribute('position', new THREE.BufferAttribute(smokePositions, 3));
  smokeGeo.setAttribute('aColor', new THREE.BufferAttribute(smokeColors, 3));
  smokeGeo.setAttribute('aSize', new THREE.BufferAttribute(smokeSizes, 1));
  smokeGeo.setAttribute('aAngle', new THREE.BufferAttribute(smokeAngles, 1));
  smokeGeo.setAttribute('aAlpha', new THREE.BufferAttribute(smokeAlphas, 1));
  smokeGeo.setAttribute('aSeed', new THREE.BufferAttribute(smokeSeedAttr, 1));

  const smokeMat = new THREE.ShaderMaterial({
    vertexShader: SH.PARTICLE_VERTEX_SHADER,
    fragmentShader: SH.VOLUMETRIC_SMOKE_FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uDarkMode: { value: isShadow ? 1.0 : 0.0 },
    },
    transparent: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
  });
  const smokePoints = new THREE.Points(smokeGeo, smokeMat);
  smokePoints.frustumCulled = false;
  smokePoints.renderOrder = 10;
  root.add(smokePoints);

  // 7. KATMAN B: Minimal Fiziksel Detaylar (Kıvılcım, İnce Sağanak Çizgisi, Uçuşan Yaprak, Kırılan Odun Kıymıkları)
  const detailPositions = new Float32Array(DETAIL_COUNT * 3);
  const detailColors = new Float32Array(DETAIL_COUNT * 3);
  const detailSizes = new Float32Array(DETAIL_COUNT);
  const detailAngles = new Float32Array(DETAIL_COUNT);
  const detailAlphas = new Float32Array(DETAIL_COUNT);
  const detailSeedAttr = new Float32Array(DETAIL_COUNT);
  for (let i = 0; i < DETAIL_COUNT; i++) detailSeedAttr[i] = seeds[i * 4 + 1];

  const detailGeo = new THREE.BufferGeometry();
  detailGeo.setAttribute('position', new THREE.BufferAttribute(detailPositions, 3));
  detailGeo.setAttribute('aColor', new THREE.BufferAttribute(detailColors, 3));
  detailGeo.setAttribute('aSize', new THREE.BufferAttribute(detailSizes, 1));
  detailGeo.setAttribute('aAngle', new THREE.BufferAttribute(detailAngles, 1));
  detailGeo.setAttribute('aAlpha', new THREE.BufferAttribute(detailAlphas, 1));
  detailGeo.setAttribute('aSeed', new THREE.BufferAttribute(detailSeedAttr, 1));

  const effectMode = isShadow ? 3.0 : isRain ? 2.0 : isTornado || isTreeFall || isEarth ? 1.0 : 0.0;
  const detailMat = new THREE.ShaderMaterial({
    vertexShader: SH.PARTICLE_VERTEX_SHADER,
    fragmentShader: SH.VOLUMETRIC_DETAIL_FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uEffectMode: { value: effectMode },
    },
    transparent: true,
    blending: effectType === 'fire' ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: false,
  });
  const detailPoints = new THREE.Points(detailGeo, detailMat);
  detailPoints.frustumCulled = false;
  detailPoints.renderOrder = 11;
  root.add(detailPoints);

  const earth = isEarth ? buildEarthParts() : undefined;
  if (earth) root.add(earth.group);

  return {
    ability,
    root,
    light,
    fireCoreMesh,
    fireCoreMat,
    fireCoronaMesh,
    fireCoronaMat,
    vortexMesh,
    vortexMat,
    outerVortexMesh,
    outerVortexMat,
    lightningLine,
    lightningPositions,
    lightningMat,
    arrowGroup,
    arrowSpinGroup,
    arrowMats,
    treeGroup,
    treeStumpGroup,
    treePivotGroup,
    treeSlashMesh,
    treeMats,
    launchOrigin: new THREE.Vector3(),
    smokePoints,
    smokeMat,
    smokePositions,
    smokeColors,
    smokeSizes,
    smokeAngles,
    smokeAlphas,
    detailPoints,
    detailMat,
    detailPositions,
    detailColors,
    detailSizes,
    detailAngles,
    detailAlphas,
    seeds,
    earth,
  };
}
