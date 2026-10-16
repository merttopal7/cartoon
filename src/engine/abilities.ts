import * as THREE from 'three';
import type { Character } from './character';
import { clamp } from './math';
import type { ClearanceTree } from './camera-clearance';
import { impactStrengthFor, type ImpactEvent } from './impact';

/** Devrilen ağacın yere çarpışının vuruş gücü. */
const TREE_IMPACT = 0.9;

export type AbilityName =
  | 'ates_topu'
  | 'fireball'
  | 'alev_tekmesi'
  | 'flame_kick'
  | 'ruzgar_hortumu'
  | 'hortum'
  | 'wind_tornado'
  | 'kasirga_tufani'
  | 'whirlwind_kick'
  | 'yagmur_oku'
  | 'rain_arrow'
  | 'firtina_oku'
  | 'storm_arrow'
  | 'yagmur'
  | 'yagmur_bulutu'
  | 'orman_yagmuru'
  | 'rain'
  | 'golge_kilic'
  | 'golge_dalgasi'
  | 'shadow_slash'
  | 'karanlik_buyu'
  | 'shadow_storm'
  | 'agac_devirme'
  | 'tree_fall';

export type AbilityEffectType = 'fire' | 'tornado' | 'rain' | 'shadow' | 'tree_fall';

export interface AbilityRecipe {
  effectType: AbilityEffectType;
  /** Karakterin sırayla oynatacağı 1 veya 2 animasyon klibi */
  clips: { name: string; duration: number; loop?: boolean; /** Bu klibe geçiş süresi (sn); varsayılan 0.3 */ fade?: number }[];
  /** Güç toplama / karakteri çevreleme evresinin bitip efektin hedefe yöneldiği yerel saniye */
  chargeEnd: number;
  /** Efektin hedefe ulaştığı yerel saniye */
  impactOffset: number;
  /** Efektin tamamen sönümlendiği toplam süre */
  totalDuration: number;
  /** Hedefin savrulurken havada çizeceği kavis yüksekliği (m) */
  arcHeight: number;
  /** Hedefin savrulma süresi (sn) */
  knockbackDuration: number;
  /** Hedefin varsayılan tepki/düşüş animasyonu */
  defaultImpactClip: string;
}

export function getAbilityRecipe(name: AbilityName, customClips?: string[]): AbilityRecipe {
  let recipe: AbilityRecipe;
  switch (name) {
    case 'ates_topu':
    case 'fireball':
      recipe = {
        effectType: 'fire',
        clips: [{ name: 'hook_punch', duration: 2.17 }],
        chargeEnd: 0.92,
        impactOffset: 1.50,
        totalDuration: 2.95,
        arcHeight: 1.15,
        knockbackDuration: 0.90,
        defaultImpactClip: 'death',
      };
      break;

    case 'alev_tekmesi':
    case 'flame_kick':
      recipe = {
        effectType: 'fire',
        clips: [
          { name: 'macaco_side', duration: 1.35 },
          { name: 'flying_kick', duration: 1.50 },
        ],
        chargeEnd: 1.45,
        impactOffset: 2.05,
        totalDuration: 3.35,
        arcHeight: 1.20,
        knockbackDuration: 0.90,
        defaultImpactClip: 'impact_3',
      };
      break;

    case 'ruzgar_hortumu':
    case 'hortum':
    case 'wind_tornado':
    case 'kasirga_tufani':
    case 'whirlwind_kick':
      recipe = {
        effectType: 'tornado',
        // Tornado Defne'nin içinde oluşana kadar (2.25s) Hurricane Kick.fbx çalışır; hedefe gönderirken flying_kick oynar
        clips: [
          { name: 'hurricane_kick', duration: 2.25, loop: true },
          { name: 'flying_kick', duration: 1.65, loop: false },
        ],
        chargeEnd: 2.25,
        impactOffset: 3.05,
        totalDuration: 4.35,
        arcHeight: 1.55,
        knockbackDuration: 1.05,
        defaultImpactClip: 'impact_2',
      };
      break;

    case 'yagmur_oku':
    case 'rain_arrow':
    case 'firtina_oku':
    case 'storm_arrow':
    case 'yagmur':
    case 'yagmur_bulutu':
    case 'orman_yagmuru':
    case 'rain':
      recipe = {
        effectType: 'rain',
        // 1) draw_arrow (1.02s): Erika yayına ok yerleştirir ve sol elindeki yayı kaldırıp kirişi çeker (tam FBX süresi: 1.017s)
        // 2) aim_overdraw (1.00s): Ok çıkmadan önce sol elindeki yayda parlayarak güç toplar (1.02s .. 2.02s)
        // 3) aim_recoil (0.68s): 2.02s + 0.15s = 2.17s'de sağ el kirişi bıraktığı anda ok doğrudan sol elden çıkar;
        //    klibin sonunda (2.70s) yay doğal olarak tam idle pozuna iner (tam FBX süresi: 0.683s)
        clips: [
          { name: 'draw_arrow', duration: 1.02, loop: false, fade: 0.2 },
          { name: 'aim_overdraw', duration: 1.00, loop: false, fade: 0.15 },
          { name: 'aim_recoil', duration: 0.68, loop: false, fade: 0.15 },
        ],
        chargeEnd: 2.17,
        impactOffset: 2.80,
        totalDuration: 4.70,
        arcHeight: 0.65,
        knockbackDuration: 0.85,
        defaultImpactClip: 'impact_3',
      };
      break;

    case 'golge_kilic':
    case 'golge_dalgasi':
    case 'shadow_slash':
      recipe = {
        effectType: 'shadow',
        clips: [
          { name: 'power_up', duration: 1.35 },
          { name: 'slash_2', duration: 1.60 },
        ],
        // Toplam animasyon süresi 2.95 sn; duman animasyonun sonuna doğru (2.20 sn'de) hedefe harekete geçer
        chargeEnd: 2.20,
        impactOffset: 2.82,
        totalDuration: 3.70,
        arcHeight: 0.32,
        knockbackDuration: 0.80,
        defaultImpactClip: 'dodge_back',
      };
      break;

    case 'karanlik_buyu':
    case 'shadow_storm':
      recipe = {
        effectType: 'shadow',
        clips: [
          { name: 'casting', duration: 1.30 },
          { name: 'attack_2', duration: 1.55 },
        ],
        // Toplam animasyon süresi 2.85 sn; duman animasyonun sonuna doğru (2.12 sn'de) hedefe harekete geçer
        chargeEnd: 2.12,
        impactOffset: 2.74,
        totalDuration: 3.60,
        arcHeight: 0.32,
        knockbackDuration: 0.80,
        defaultImpactClip: 'dodge_back',
      };
      break;

    case 'agac_devirme':
    case 'tree_fall':
      recipe = {
        effectType: 'tree_fall',
        // Karabey önce güç toplar (power_up: 1.15s), ardından güçlü yatay kılıç darbesiyle (slash_2: 1.65s)
        // yanındaki dev çam ağacının gövdesini keser; kesilen ağaç 1.65s -> 2.38s arasında devrilerek hedeflerin üzerine çarpar!
        clips: [
          { name: 'power_up', duration: 1.15 },
          { name: 'slash_2', duration: 1.65 },
        ],
        chargeEnd: 1.65,
        impactOffset: 2.38,
        totalDuration: 3.70,
        arcHeight: 0.95,
        knockbackDuration: 0.85,
        defaultImpactClip: 'fall_flat',
      };
      break;
  }

  if (customClips && customClips.length > 0) {
    if (customClips.length === 1) {
      recipe.clips = [{ name: customClips[0], duration: 2.2 }];
    } else if (recipe.effectType === 'tornado') {
      recipe.clips = [
        { name: customClips[0], duration: recipe.chargeEnd, loop: true },
        { name: customClips[1], duration: 1.65, loop: false },
      ];
    } else {
      recipe.clips = [
        { name: customClips[0], duration: 1.35 },
        { name: customClips[1], duration: 1.55 },
      ];
    }
    if (recipe.effectType === 'shadow') {
      const animDur = recipe.clips.reduce((sum, c) => sum + c.duration, 0);
      recipe.chargeEnd = +(animDur * 0.75).toFixed(2);
      recipe.impactOffset = +(animDur * 0.96).toFixed(2);
      recipe.totalDuration = +(animDur + 0.75).toFixed(2);
    }
  }
  return recipe;
}

export interface MapTreeRecord {
  id: string;
  node: THREE.Object3D;
  worldPos: THREE.Vector3;
  origPosition: THREE.Vector3;
  origQuaternion: THREE.Quaternion;
  origScale: THREE.Vector3;
  origWorldQuat: THREE.Quaternion;
  parentWorldQuatInv: THREE.Quaternion;
}

export interface ScheduledAbility {
  who: string;
  target: string;
  name: AbilityName;
  recipe: AbilityRecipe;
  start: number;
  knockback: number;
  /** Vuruş anında hedefin başlangıç konumu (savrulma öncesi zemin konumu veya devrilecek harita ağacının kök konumu). */
  impactPos: THREE.Vector3;
  /** Çoklu hedefli yeteneklerde bu kolun sıra indeksi (0..groupSize-1) */
  groupIndex?: number;
  /** Çoklu hedefli yeteneklerde toplam eş zamanlı hedef sayısı */
  groupSize?: number;
  /** Ağaç devirme / düzeltme yeteneklerinde haritadaki gerçek ağaç düğümünün kimliği (ör. Realistic_Pine_057) */
  mapTreeId?: string;
  /** Harita ağacının devrileceği yatay yön vektörü */
  fallDirXZ?: THREE.Vector3;
  /** Devrilen harita ağacının yerde sürüklenerek Karabey'in yanında duracağı kök hedef konumu */
  slideTargetPos?: THREE.Vector3;
  /** Vuruş hissi gücü (sarsıntı + hit-stop); verilmezse savrulmadan hesaplanır. */
  impact?: number;
}

export interface ActiveAbilityFocus {
  casterId: string;
  targetId: string;
  zoomWeight: number;
  effectCenter: THREE.Vector3;
  suggestedSize: number;
  /** Kuş uçuşu (yukarıdan bakış) kamera açısı ağırlığı (0..1) */
  birdEyeWeight?: number;
  /** Kuş uçuşu kamera eğim açısı (derece) */
  elevationOverride?: number;
}

export interface ActiveAbilityHUDInfo {
  who: string;
  target: string;
  name: AbilityName;
  recipe: AbilityRecipe;
  start: number;
  localTime: number;
  progress: number;
  phase: 'charge' | 'flight' | 'impact';
  casterWorldPos: THREE.Vector3;
}

// ============================================================================
// PROSEDÜREL GLSL SHADER KÜTÜPHANESİ (FBM GÜRÜLTÜ, BLACKBODY ALEV, HACİMSEL DUMAN)
// ============================================================================

const NOISE_GLSL = /* glsl */ `
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm2D(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    v += amp * noise2D(p);
    p = rot * p * 2.07 + vec2(17.3, 9.2);
    amp *= 0.5;
  }
  return v;
}
`;

const PARTICLE_VERTEX_SHADER = /* glsl */ `
attribute float aSize;
attribute float aAngle;
attribute float aAlpha;
attribute float aSeed;
attribute vec3 aColor;

varying float vAngle;
varying float vAlpha;
varying float vSeed;
varying vec3 vColor;

void main() {
  vAngle = aAngle;
  vAlpha = aAlpha;
  vSeed = aSeed;
  vColor = aColor;

  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float dist = max(0.5, -mvPosition.z);
  gl_PointSize = clamp(aSize * (540.0 / dist), 1.5, 260.0);
}
`;

/**
 * Hacimsel Duman / Bulut / Toz / Siyah Gölge Shader'ı (NormalBlending)
 * - 5 oktav FBM türbülans ile gerçekçi kıvrımlı kenar erimesi (erosion)
 * - Gürültü türevinden (gradient) hesaplanan sahte 3B normal ile üstten ışıklandırma ve iç gölgeleme (self-shadowing)
 */
const VOLUMETRIC_SMOKE_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uDarkMode;
varying float vAngle;
varying float vAlpha;
varying float vSeed;
varying vec3 vColor;

${NOISE_GLSL}

void main() {
  if (vAlpha <= 0.005) discard;
  vec2 centered = gl_PointCoord - 0.5;
  float r = length(centered) * 2.0;
  if (r > 1.0) discard;

  float c = cos(vAngle);
  float s = sin(vAngle);
  vec2 rotUV = mat2(c, -s, s, c) * centered + 0.5;

  vec2 nCoord = rotUV * 3.4 + vec2(vSeed * 13.7, vSeed * 29.1 + uTime * 0.45);
  float n1 = fbm2D(nCoord);
  float n2 = fbm2D(nCoord * 1.85 - vec2(uTime * 0.6, -uTime * 0.5));
  float billow = mix(n1, n2, 0.45);

  // Radyal yumuşak düşüş + FBM kenar aşınması (gerçekçi bulut/duman sınırı)
  float radial = pow(clamp(1.0 - r * r, 0.0, 1.0), 1.25);
  float density = radial * (0.45 + 0.85 * billow);
  float erosion = mix(0.45, 0.04, clamp(vAlpha, 0.0, 1.0));
  float alpha = smoothstep(erosion, erosion + 0.48, density) * clamp(vAlpha, 0.0, 1.0);
  if (alpha <= 0.005) discard;

  // Hacimsel 3B gölgeleme (üst kısım aydınlık, alt kısım ve iç oyuklar derin gölgeli)
  float topLight = clamp(0.5 - centered.y + (n1 - 0.5) * 0.55, 0.0, 1.0);
  vec3 col = vColor;
  if (uDarkMode > 0.5) {
    // Karabey'in siyah dumanı: yoğun obsidyen/is siyahı, kenarlarda hafif antrasit kırचा
    vec3 coreBlack = vec3(0.015, 0.015, 0.024);
    vec3 rimSmoke = vColor + vec3(0.05, 0.045, 0.065) * topLight;
    col = mix(coreBlack, rimSmoke, clamp(billow * 0.75 + (1.0 - radial) * 0.35, 0.0, 1.0));
  } else {
    // Doğal bulut / toz / yanık dumanı: üstten güneş/şimşek aydınlatması, altta ambiyans
    col = vColor * (0.68 + 0.54 * topLight) * (0.78 + 0.35 * billow);
  }

  gl_FragColor = vec4(col, alpha);
}
`;

/**
 * Gerçekçi Blackbody Alev / Plazma / Kıvılcım / Rüzgar ve Yağmur Detay Shader'ı
 */
const VOLUMETRIC_DETAIL_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uEffectMode; // 0 = Ateş/Kıvılcım, 1 = Hortum Yaprak/Akım, 2 = Yağmur Çizgisi, 3 = Siyah Duman İç Girdap
varying float vAngle;
varying float vAlpha;
varying float vSeed;
varying vec3 vColor;

${NOISE_GLSL}

vec3 blackbody(float t) {
  // Gerçekçi fiziksel kara-cisim (blackbody) ateş renk eğrisi
  vec3 c1 = vec3(0.18, 0.02, 0.01); // Koyu köz
  vec3 c2 = vec3(0.88, 0.14, 0.02); // Derin kızıl alev
  vec3 c3 = vec3(1.00, 0.52, 0.05); // Parlak turuncu
  vec3 c4 = vec3(1.00, 0.96, 0.78); // Akkor beyaz-sarı merkez
  if (t < 0.33) return mix(c1, c2, t / 0.33);
  if (t < 0.68) return mix(c2, c3, (t - 0.33) / 0.35);
  return mix(c3, c4, clamp((t - 0.68) / 0.32, 0.0, 1.0));
}

void main() {
  if (vAlpha <= 0.005) discard;
  vec2 centered = gl_PointCoord - 0.5;

  if (uEffectMode > 1.5 && uEffectMode < 2.5) {
    // MOD 2: Gerçekçi Anizotropik Sağanak Yağmur Çizgisi (Motion-Blurred Raindrop Streak) ve Zemin Sıçraması
    float c = cos(vAngle);
    float s = sin(vAngle);
    vec2 p = mat2(c, -s, s, c) * centered;
    if (vSeed > 0.78) {
      // Zeminde sıçrayan su halkası / damlacık
      float r = length(p) * 2.0;
      if (r > 1.0) discard;
      float ring = smoothstep(0.35, 0.72, r) * (1.0 - smoothstep(0.72, 1.0, r));
      float core = pow(max(0.0, 1.0 - r * 1.6), 2.0);
      float a = (ring * 0.75 + core * 0.65) * vAlpha;
      gl_FragColor = vec4(vColor, a);
      return;
    }
    // İnce uzun yağmur damlası izi
    float streakX = exp(-abs(p.x) * 26.0);
    float streakY = smoothstep(0.5, 0.0, abs(p.y));
    float headGlow = exp(-length(vec2(p.x * 7.0, (p.y - 0.18) * 3.5)) * 4.0);
    float a = clamp((streakX * streakY * 0.95 + headGlow * 0.55) * vAlpha, 0.0, 1.0);
    if (a <= 0.01) discard;
    gl_FragColor = vec4(vColor + vec3(0.18) * headGlow, a);
    return;
  }

  float r = length(centered) * 2.0;
  if (r > 1.0) discard;

  float c = cos(vAngle);
  float s = sin(vAngle);
  vec2 rotUV = mat2(c, -s, s, c) * centered + 0.5;

  if (uEffectMode < 0.5) {
    // MOD 0: Gerçekçi Türbülanslı Alev ve Kor Kıvılcımı
    vec2 flameUV = rotUV * 3.2 + vec2(vSeed * 19.3, -uTime * 2.4 + vSeed * 7.1);
    float fNoise = fbm2D(flameUV);
    float radial = pow(clamp(1.0 - r, 0.0, 1.0), 1.35);
    float intensity = clamp(radial * (0.55 + 0.85 * fNoise) * vAlpha, 0.0, 1.0);
    if (intensity <= 0.01) discard;
    vec3 fireCol = blackbody(clamp(intensity * 1.15, 0.0, 1.0)) * vColor;
    gl_FragColor = vec4(fireCol * intensity * 1.35, intensity);
    return;
  }

  if (uEffectMode > 2.5) {
    // MOD 3: Karabey Siyah Duman İç Girdap Katmanı
    vec2 nUV = rotUV * 3.8 + vec2(vSeed * 21.0, uTime * 0.8);
    float n = fbm2D(nUV);
    float radial = pow(clamp(1.0 - r * r, 0.0, 1.0), 1.3);
    float a = smoothstep(0.18, 0.65, radial * (0.5 + 0.7 * n)) * vAlpha;
    if (a <= 0.01) discard;
    gl_FragColor = vec4(vColor * (0.6 + 0.4 * n), a);
    return;
  }

  // MOD 1: Hortum İçi Kavisli Rüzgar Akım Şeritleri (Streamlines), Uçuşan Yaprak, Dal ve Toprak Parçacıkları
  if (vSeed < 0.15) {
    // 3B takla atan (tumbling) organik sivri orman yaprağı
    vec2 lp = rotUV - 0.5;
    float tumble = 0.28 + 0.72 * abs(cos(uTime * 11.0 + vSeed * 43.0));
    lp.y /= tumble;
    float leafShape = 1.0 - smoothstep(0.0, 0.20, abs(lp.x) * 1.65 + abs(lp.y) * 0.90 + abs(lp.x * lp.y) * 1.4);
    if (leafShape <= 0.02) discard;
    float vein = 0.82 + 0.28 * cos(lp.y * 32.0);
    gl_FragColor = vec4(vColor * vein, leafShape * vAlpha);
  } else if (vSeed < 0.26) {
    // Kırık dal / ağaç kabuğu kıymığı
    vec2 tp = rotUV - 0.5;
    float bend = tp.y + 0.25 * tp.x * tp.x;
    float twig = (1.0 - smoothstep(0.0, 0.045, abs(bend))) * (1.0 - smoothstep(0.18, 0.36, abs(tp.x)));
    if (twig <= 0.02) discard;
    gl_FragColor = vec4(vColor, twig * vAlpha);
  } else if (vSeed < 0.36) {
    // Zeminden kopan düzensiz toprak / taş parçacığı
    float clodNoise = fbm2D(rotUV * 4.5 + vec2(vSeed * 19.0, vSeed * 31.0));
    float clod = smoothstep(0.38, 0.62, (1.0 - r) * (0.55 + 0.75 * clodNoise));
    if (clod <= 0.02) discard;
    gl_FragColor = vec4(vColor * (0.7 + 0.4 * clodNoise), clod * vAlpha);
  } else {
    // Yüksek hızlı kavisli rüzgar şeridi / toz filamenti (Anisotropic Curved Vortex Streamline)
    vec2 p = rotUV - 0.5;
    float curveY = p.y + 0.38 * (p.x * p.x - 0.08);
    float wNoise = fbm2D(vec2(p.x * 3.2 - uTime * 4.8 + vSeed * 17.0, curveY * 7.5 + vSeed * 23.0));
    float crossProfile = exp(-abs(curveY + (wNoise - 0.5) * 0.08) * 15.5);
    float lengthFade = smoothstep(0.50, 0.06, abs(p.x));
    float a = crossProfile * lengthFade * (0.52 + 0.68 * wNoise) * vAlpha;
    if (a <= 0.01) discard;
    gl_FragColor = vec4(vColor * (0.85 + 0.30 * wNoise), clamp(a, 0.0, 1.0));
  }
}
`;

/**
 * 3B Hacimsel Ateş Topu Plazma Çekirdeği ve Alev Koronası Shader'ı
 */
const FIRE_CORE_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uIsCorona;
varying vec3 vNormal;
varying vec3 vViewPos;
varying vec2 vUv;

${NOISE_GLSL}

void main() {
  vUv = uv;
  float amp = uIsCorona > 0.5 ? 0.26 : 0.12;
  float speed = uIsCorona > 0.5 ? 3.4 : 2.2;
  float disp = fbm2D(uv * (uIsCorona > 0.5 ? 6.5 : 5.0) + vec2(uTime * speed, -uTime * (speed * 0.85))) - 0.5;
  vec3 newPos = position + normal * (disp * amp);
  vNormal = normalize(normalMatrix * normal);
  vec4 mvPos = modelViewMatrix * vec4(newPos, 1.0);
  vViewPos = -mvPos.xyz;
  gl_Position = projectionMatrix * mvPos;
}
`;

const FIRE_CORE_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform float uIsCorona;
varying vec3 vNormal;
varying vec3 vViewPos;
varying vec2 vUv;

${NOISE_GLSL}

void main() {
  if (uOpacity <= 0.01) discard;
  vec3 N = normalize(vNormal);
  vec3 V = normalize(vViewPos);
  float ndotv = clamp(abs(dot(N, V)), 0.0, 1.0);

  float n1 = fbm2D(vUv * 6.5 + vec2(uTime * 2.8, -uTime * 3.4));
  float n2 = fbm2D(vUv * 12.0 - vec2(uTime * 3.8, uTime * 2.2));
  float plasma = clamp(n1 * 0.65 + n2 * 0.35, 0.0, 1.0);

  vec3 hotCore = vec3(1.0, 0.98, 0.82);
  vec3 midOrange = vec3(1.0, 0.45, 0.04);
  vec3 darkRed = vec3(0.72, 0.07, 0.01);

  if (uIsCorona > 0.5) {
    // Dış 3B hacimsel alev zarfı ve kuyruk koronası (partikül yerine sürekli 3B alev dili)
    float flameMask = pow(ndotv, 0.65) * smoothstep(0.24, 0.76, plasma * (0.55 + 0.65 * ndotv));
    if (flameMask <= 0.01) discard;
    vec3 coronaCol = mix(darkRed, midOrange, smoothstep(0.2, 0.7, plasma));
    coronaCol = mix(coronaCol, hotCore, smoothstep(0.65, 0.95, plasma * ndotv));
    gl_FragColor = vec4(coronaCol * 1.35, clamp(flameMask * uOpacity * 0.88, 0.0, 1.0));
    return;
  }

  vec3 col = mix(darkRed, midOrange, smoothstep(0.15, 0.6, plasma));
  col = mix(col, hotCore, smoothstep(0.55, 0.92, plasma * ndotv + 0.25));
  float edgeFade = pow(ndotv, 0.82) * smoothstep(0.08, 0.42, ndotv * (0.55 + 0.65 * plasma));
  gl_FragColor = vec4(col * 1.45, clamp(edgeFade * uOpacity, 0.0, 1.0));
}
`;

/**
 * Erika'nın 3B Büyülü Yağmur Oku Özel Shader'ı:
 * - uPart = 0.0: Akışkan Su/Safir Çekirdekli Ok Gövdesi (Slender Hydro-Crystal Shaft)
 * - uPart = 1.0: Çentikli Elmas Su Kristali Ok Temreni (4-Bladed Barbed Diamond Broadhead)
 * - uPart = 2.0: Gövdeyi Saran Çift Sarmallı 3B Su Akıntısı (Double-Helix Water Streams)
 * - uPart = 3.0: Kavisli Su Tüyü Kanatçıklar ve Kiriş Yatağı (Swept-Back Feather Fletchings)
 * - uPart = 4.0: Hidrodinamik Su Şok Konisi / Uç Dalga Halkası (Hydro-Sonic Wake Cone)
 */
const ARROW_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uPart;
uniform float uFlight;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldNormal;
varying vec3 vViewPos;
varying vec3 vLocalPos;

void main() {
  vUv = uv;
  vec3 pos = position;
  if (uPart > 1.5 && uPart < 2.5) {
    // 3B su sarmallarında ince dalgalanma
    float wave = sin(uv.x * 24.0 - uTime * 16.0) * 0.0018;
    pos += normal * wave;
  } else if (uPart > 3.5) {
    // Uçtaki su şok konisinde genişleyen hidrodinamik dalga
    float ripple = sin(uv.y * 18.0 - uTime * 20.0) * 0.004 * (0.4 + 0.6 * uFlight);
    pos += normal * ripple;
  }
  vLocalPos = pos;
  vNormal = normalize(normalMatrix * normal);
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
  vViewPos = -mvPos.xyz;
  gl_Position = projectionMatrix * mvPos;
}
`;

const ARROW_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform float uPart;
uniform float uFlight;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldNormal;
varying vec3 vViewPos;
varying vec3 vLocalPos;

${NOISE_GLSL}

void main() {
  if (uOpacity <= 0.01) discard;
  vec3 N = normalize(vNormal);
  vec3 V = normalize(vViewPos);
  float ndotv = clamp(abs(dot(N, V)), 0.0, 1.0);
  float fresnel = pow(1.0 - ndotv, 1.8);
  vec3 sunDir = normalize(vec3(0.45, 0.82, 0.42));
  float sunDiff = clamp(dot(normalize(vWorldNormal), sunDir) * 0.5 + 0.5, 0.0, 1.0);

  // Kuyruktan (-0.37) temren ucuna (+0.25) doğru akan su/şimşek darbesi
  float alongY = clamp((vLocalPos.y + 0.38) / 0.64, 0.0, 1.0);
  float surge = 0.5 + 0.5 * sin(alongY * 14.0 - uTime * 15.0);
  float flowNoise = fbm2D(vec2(alongY * 6.0 - uTime * 3.8, vUv.x * 4.0 + uTime * 1.4));

  vec3 deepCobalt = vec3(0.01, 0.24, 0.52);
  vec3 oceanCyan  = vec3(0.05, 0.62, 0.94);
  vec3 aquaBright = vec3(0.38, 0.86, 1.00);
  vec3 iceWhite   = vec3(0.92, 0.98, 1.00);

  if (uPart < 0.5) {
    // PARÇA 0: Som 3B Su/Safir Ok Gövdesi (Gündüz sahnesinde yüksek kontrastlı)
    vec3 col = mix(deepCobalt, oceanCyan, smoothstep(0.15, 0.85, ndotv * 0.65 + flowNoise * 0.35));
    col = mix(col, aquaBright, surge * 0.45 + fresnel * 0.55);
    col = mix(col, iceWhite, pow(ndotv, 4.0) * 0.55 + pow(surge, 3.0) * 0.35);
    gl_FragColor = vec4(col, clamp(uOpacity * 0.98, 0.0, 1.0));
    return;
  }

  if (uPart < 1.5) {
    // PARÇA 1: Çentikli Elmas Su Kristali Ok Temreni (Keskin fasetli, parlak uçlu)
    float facetLight = clamp(sunDiff * 0.65 + ndotv * 0.35, 0.0, 1.0);
    float tipGlow = smoothstep(0.55, 0.98, alongY);
    vec3 bladeCol = mix(deepCobalt * 0.85, oceanCyan, smoothstep(0.2, 0.75, facetLight));
    bladeCol = mix(bladeCol, aquaBright, fresnel * 0.75 + flowNoise * 0.25);
    bladeCol = mix(bladeCol, iceWhite, tipGlow * 0.72 + pow(fresnel, 1.4) * 0.55);
    gl_FragColor = vec4(bladeCol, clamp(uOpacity * 0.98, 0.0, 1.0));
    return;
  }

  if (uPart < 2.5) {
    // PARÇA 2: Gövdeyi Saran 3B Çift Sarmallı Su Akıntısı
    float streamPulse = 0.5 + 0.5 * sin(vUv.x * 20.0 - uTime * 18.0);
    float core = smoothstep(0.05, 0.85, ndotv);
    vec3 waterCol = mix(oceanCyan, aquaBright, streamPulse * 0.7 + core * 0.3);
    waterCol = mix(waterCol, iceWhite, pow(streamPulse, 2.5) * 0.75);
    float alpha = (0.45 + 0.55 * streamPulse) * (0.35 + 0.65 * ndotv) * uOpacity;
    gl_FragColor = vec4(waterCol * 1.25, clamp(alpha * 0.92, 0.0, 1.0));
    return;
  }

  if (uPart < 3.5) {
    // PARÇA 3: Kavisli Su Tüyü Kanatçıklar (Tüy damar çizgileri + parlak kenar)
    float rDist = length(vLocalPos.xz);
    float barbs = 0.5 + 0.5 * sin(vLocalPos.y * 190.0 - rDist * 140.0 - uTime * 6.0);
    vec3 finCol = mix(deepCobalt, oceanCyan, 0.45 + 0.35 * sunDiff);
    finCol = mix(finCol, aquaBright, barbs * 0.55 + fresnel * 0.45);
    finCol = mix(finCol, iceWhite, smoothstep(0.018, 0.032, rDist) * 0.65);
    gl_FragColor = vec4(finCol, clamp(uOpacity * 0.94, 0.0, 1.0));
    return;
  }

  // PARÇA 4: Hidrodinamik Su Şok Konisi / Uç Dalga Halkası
  float coneFade = sin(clamp(vUv.y, 0.0, 1.0) * 3.14159);
  float waveRing = 0.5 + 0.5 * sin(vUv.y * 24.0 - uTime * 22.0);
  vec3 wakeCol = mix(oceanCyan, iceWhite, waveRing * 0.75 + fresnel * 0.25);
  float wakeAlpha = coneFade * (0.28 + 0.48 * uFlight) * (0.4 + 0.6 * waveRing) * uOpacity;
  gl_FragColor = vec4(wakeCol * 1.2, clamp(wakeAlpha, 0.0, 1.0));
}
`;

/**
 * 3B Çok Katmanlı Hacimsel Doğa Olayı Shader'ı:
 * - uMode = 0.0: Gerçekçi 3B Trompet Hortum Hunisi (Tornado)
 * - uMode = 1.0: Karabey'in 3B Hacimsel Siyah Duman Örtüsü (Black Smoke Shroud)
 * - uMode = 2.0: Meşe'nin 3B Hacimsel Cumulonimbus Fırtına Bulutu (Storm Cloud Volume)
 */
const VORTEX_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uSway;
uniform float uMode;
uniform float uLayer;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldNormal;
varying vec3 vViewPos;
varying vec3 vLocalPos;

${NOISE_GLSL}

void main() {
  vUv = uv;
  float h = uv.y;
  float theta = atan(position.z, position.x);

  vec3 pos = position;
  vec3 norm = normal;

  if (uMode < 0.5) {
    // MOD 0: GERÇEKÇİ HORTUM HUNİSİ (Trumpet Funnel)
    float baseFoot = exp(-h * 10.5) * (uLayer > 0.5 ? 0.64 : 0.25);
    float midColumn = 0.15 + 0.36 * pow(h, 1.28);
    float topTrumpet = 0.96 * pow(max(0.0, (h - 0.40) / 0.60), 2.35);
    float layerScale = uLayer > 0.5 ? 1.32 : 0.86;

    float speed = uLayer > 0.5 ? 15.5 : 11.5;
    float wave1 = sin(theta * 2.0 + h * 17.0 - uTime * speed);
    float wave2 = cos(theta * 3.0 - h * 24.0 - uTime * (speed * 1.28));
    float fbmDisp = fbm2D(vec2(cos(theta) * 1.4 + h * 3.2, sin(theta) * 1.4 + h * 4.2 - uTime * 2.6)) - 0.5;
    float disp = (wave1 * 0.055 + wave2 * 0.035 + fbmDisp * 0.13) * (0.35 + 0.85 * h);

    float radius = (midColumn + topTrumpet + baseFoot) * layerScale + disp;
    pos.x = cos(theta) * radius;
    pos.z = sin(theta) * radius;
    pos.y = h * 3.25;

    float swayAmp = uSway * (0.10 + 0.28 * pow(h, 1.35));
    float swayX = sin(h * 4.2 - uTime * 5.8) * swayAmp + cos(h * 7.5 - uTime * 9.0) * 0.045 * h;
    float swayZ = cos(h * 3.6 - uTime * 5.1) * swayAmp + sin(h * 6.8 - uTime * 8.2) * 0.045 * h;
    pos.x += swayX;
    pos.z += swayZ;

    norm = normalize(vec3(cos(theta), -0.30 * pow(h, 1.2), sin(theta)));
  } else if (uMode < 1.5) {
    // MOD 1: KARABEY'İN 3B HACİMSEL SİYAH DUMAN ÖRTÜSÜ
    float layerScale = uLayer > 0.5 ? 1.22 : 0.88;
    float fbmDisp = fbm2D(vec2(cos(theta) * 1.6 + uTime * 0.8, h * 3.5 - uTime * 1.5)) - 0.5;
    float bellProfile = (0.52 + 0.36 * sin(h * 3.14159) + fbmDisp * 0.18) * layerScale;
    pos.x = cos(theta) * bellProfile + sin(h * 4.0 - uTime * 3.2) * 0.10 * h * uSway;
    pos.z = sin(theta) * bellProfile + cos(h * 3.5 - uTime * 2.8) * 0.10 * h * uSway;
    pos.y = h * 2.05;
    norm = normalize(vec3(cos(theta), (0.5 - h) * 0.4, sin(theta)));
  } else {
    // MOD 2: MEŞE'NİN 3B HACİMSEL CUMULONIMBUS FIRTINA BULUTU KUBBESİ
    float layerScale = uLayer > 0.5 ? 1.18 : 0.92;
    float fbmDisp = fbm2D(vec2(theta * 1.5 + uTime * 0.25, h * 4.0 - uTime * 0.2)) - 0.45;
    vec3 cloudPos = position * vec3(1.65 * layerScale, 0.58 * layerScale, 1.45 * layerScale);
    // Bulutun alt tabanı düz ve ağır, üst kısmı kabarık karnabahar (cumulonimbus) kubbeli
    if (cloudPos.y < 0.0) cloudPos.y *= 0.42;
    cloudPos += normal * (fbmDisp * 0.32 * layerScale);
    pos = cloudPos;
    norm = normalize(normal + vec3(fbmDisp * 0.35));
  }

  vLocalPos = pos;
  vNormal = normalize(normalMatrix * norm);
  vWorldNormal = normalize(mat3(modelMatrix) * norm);
  vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
  vViewPos = -mvPos.xyz;
  gl_Position = projectionMatrix * mvPos;
}
`;

const VORTEX_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform float uMode;
uniform float uLayer;
uniform float uLightning;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldNormal;
varying vec3 vViewPos;
varying vec3 vLocalPos;

${NOISE_GLSL}

void main() {
  if (uOpacity <= 0.01) discard;
  vec3 N = normalize(vNormal);
  vec3 V = normalize(vViewPos);
  float ndotv = clamp(abs(dot(N, V)), 0.0, 1.0);
  float theta = vUv.x * 6.2831853;
  float h = vUv.y;
  vec2 cyl = vec2(cos(theta), sin(theta));

  if (uMode > 0.5 && uMode < 1.5) {
    // MOD 1: KARABEY'İN KESİNTİSİZ 3B SİYAH DUMAN ÖRTÜSÜ
    float n1 = fbm2D(cyl * 1.8 + vec2(h * 3.2 - uTime * 0.9, h * 3.8 - uTime * 1.5));
    float n2 = fbm2D(cyl * 3.2 - vec2(h * 5.5 + uTime * 1.2, h * 4.6 - uTime * 1.9));
    float billow = clamp(n1 * 0.62 + n2 * 0.38, 0.0, 1.0);

    float verticalMask = smoothstep(0.0, 0.18 + n1 * 0.12, h) * (1.0 - smoothstep(0.72 - n2 * 0.14, 0.98, h));
    float fresnel = pow(ndotv, uLayer > 0.5 ? 1.15 : 0.78);
    float density = fresnel * verticalMask * (0.35 + 0.85 * billow);
    float thresh = uLayer > 0.5 ? 0.24 : 0.14;
    float alpha = smoothstep(thresh, thresh + 0.45, density) * uOpacity;
    if (alpha <= 0.01) discard;

    vec3 sunDir = normalize(vec3(0.5, 0.8, 0.4));
    float rimLight = clamp(dot(normalize(vWorldNormal), sunDir) * 0.5 + 0.5, 0.0, 1.0);
    vec3 obsidianCore = vec3(0.012, 0.012, 0.018);
    vec3 sootRim = vec3(0.055, 0.058, 0.078) * (0.5 + 0.5 * rimLight);
    vec3 smokeCol = mix(obsidianCore, sootRim, smoothstep(0.25, 0.85, billow * 0.7 + (1.0 - ndotv) * 0.3));
    gl_FragColor = vec4(smokeCol, clamp(alpha * (uLayer > 0.5 ? 0.78 : 0.94), 0.0, 1.0));
    return;
  }

  if (uMode > 1.5) {
    // MOD 2: MEŞE'NİN 3B HACİMSEL FIRTINA BULUTU
    float n1 = fbm2D(cyl * 2.0 + vec2(h * 4.0 + uTime * 0.22, uTime * 0.18));
    float n2 = fbm2D(cyl * 4.2 - vec2(uTime * 0.30, h * 6.0));
    float cloudNoise = clamp(n1 * 0.65 + n2 * 0.35, 0.0, 1.0);

    float edgeFade = pow(ndotv, uLayer > 0.5 ? 1.05 : 0.68);
    float density = edgeFade * (0.42 + 0.78 * cloudNoise);
    float thresh = uLayer > 0.5 ? 0.26 : 0.12;
    float alpha = smoothstep(thresh, thresh + 0.42, density) * uOpacity;
    if (alpha <= 0.01) discard;

    float topFactor = clamp((vLocalPos.y + 0.35) / 0.95, 0.0, 1.0);
    vec3 darkBase = vec3(0.12, 0.15, 0.20);
    vec3 sunlitTop = vec3(0.46, 0.53, 0.62);
    vec3 cloudCol = mix(darkBase, sunlitTop, smoothstep(0.1, 0.85, topFactor * 0.7 + cloudNoise * 0.4));
    // Şimşek çaktığında bulutun içinden yayılan hacimsel aydınlanma (subsurface scattering)
    cloudCol += vec3(0.55, 0.75, 0.98) * uLightning * (1.0 - topFactor * 0.6) * (0.5 + 0.5 * cloudNoise);
    gl_FragColor = vec4(cloudCol, clamp(alpha * (uLayer > 0.5 ? 0.76 : 0.95), 0.0, 1.0));
    return;
  }

  // MOD 0: GERÇEKÇİ HORTUM HUNİSİ (kesintisiz silindirik FBM + helisel rüzgar/bulut kuşakları + 3B gölgeleme)
  float spin = uLayer > 0.5 ? 16.5 : 11.8;
  float n1 = fbm2D(cyl * 1.75 + vec2(h * 4.0 - uTime * 2.4, h * 5.2 - uTime * 3.6));
  float n2 = fbm2D(cyl * 3.40 - vec2(h * 7.8 + uTime * 3.2, h * 6.4 - uTime * 4.8));
  float fbmVal = clamp(n1 * 0.62 + n2 * 0.38, 0.0, 1.0);

  // Tam sayı açısal frekanslı (2, 4, 6) + FBM domain-warped kesintisiz helisel burgaç şeritleri
  float phase1 = theta * 2.0 + h * 18.0 - uTime * spin + (fbmVal - 0.5) * 4.8;
  float phase2 = theta * 4.0 + h * 30.0 - uTime * (spin * 1.32) - (n1 - 0.5) * 4.2;
  float phase3 = theta * 6.0 + h * 44.0 - uTime * (spin * 1.68) + (n2 - 0.5) * 3.6;

  float band1 = 0.5 + 0.5 * sin(phase1);
  float band2 = 0.5 + 0.5 * sin(phase2);
  float band3 = 0.5 + 0.5 * sin(phase3);
  float helical = band1 * 0.48 + band2 * 0.34 + band3 * 0.18;

  // Silindir kenarlarında FBM aşınmalı (eroded) yumuşak geçiş ve dikey maske
  float verticalMask = smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(0.86, 1.0, h));
  float edgeSoftness = pow(ndotv, uLayer > 0.5 ? 0.95 : 0.70);
  float rawDensity = edgeSoftness * (0.35 + 0.65 * helical) * (0.48 + 0.72 * fbmVal);
  float threshold = uLayer > 0.5 ? 0.24 : 0.13;
  float alpha = smoothstep(threshold, threshold + 0.46, rawDensity) * verticalMask * uOpacity;
  if (alpha <= 0.01) discard;

  // 3B Hacimsel Işıklandırma (Helisel kabartma normali + Güneş yönü + İç oyuk gölgesi)
  float ridgeSlope = cos(phase1) * 0.48 + cos(phase2) * 0.32 + (n2 - 0.5) * 0.45;
  vec3 pertN = normalize(vWorldNormal + vec3(0.0, ridgeSlope * 0.58, 0.0));
  vec3 sunDir = normalize(vec3(0.58, 0.76, 0.38));
  float sunLight = clamp(dot(pertN, sunDir) * 0.5 + 0.5, 0.0, 1.0);
  float cavityAO = mix(0.38, 1.08, smoothstep(0.16, 0.84, helical * 0.65 + fbmVal * 0.35));

  vec3 earthShadow = vec3(0.24, 0.19, 0.14);
  vec3 earthLight  = vec3(0.52, 0.43, 0.33);
  vec3 coreShadow  = vec3(0.19, 0.23, 0.28);
  vec3 coreLight   = vec3(0.66, 0.73, 0.79);
  vec3 topCollar   = vec3(0.16, 0.20, 0.25);

  vec3 dirtCol = mix(earthShadow, earthLight, sunLight);
  vec3 funnelCol = mix(coreShadow, coreLight, pow(sunLight, 0.9));
  vec3 baseMix = mix(dirtCol, funnelCol, smoothstep(0.04, 0.36, h));
  vec3 finalCol = mix(baseMix, topCollar, smoothstep(0.76, 0.98, h)) * cavityAO;

  gl_FragColor = vec4(finalCol, clamp(alpha * (uLayer > 0.5 ? 0.74 : 0.94), 0.0, 1.0));
}
`;

/**
 * Karabey'in 3B Ağaç Devirme Yeteneği Özel Shader'ı:
 * - uPart = 0.0: Yarık Kabuklu Orman Çamı Gövdesi ve Kök Kütüğü (Grooved Pine Bark & Mossy Root Flare)
 * - uPart = 1.0: Çok Katmanlı Gür Çam Dalları ve İğne Yaprak Kubbeleri (Tiered Forest Pine Canopy)
 * - uPart = 2.0: Kesik Odun Halkaları ve Kılıç Kesiği Kor İzi (Cut Heartwood Annual Rings & Ember Seam)
 * - uPart = 3.0: Yatay Kılıç Darbesi Enerji Hilali (Sword Cleave Crescent Wave)
 */
const TREE_FALL_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uPart;
uniform float uCutGlow;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldNormal;
varying vec3 vViewPos;
varying vec3 vLocalPos;

${NOISE_GLSL}

void main() {
  vUv = uv;
  vec3 pos = position;
  vec3 norm = normal;

  if (uPart > 0.5 && uPart < 1.5) {
    // Çam ağacı yaprak katmanlarında doğal dal püskülü girinti-çıkıntıları
    float theta = atan(pos.z, pos.x);
    float branchTuft = sin(theta * 9.0 + pos.y * 5.5) * 0.065 + cos(theta * 15.0 - pos.y * 8.0) * 0.035;
    float bottomSpread = clamp(1.0 - uv.y, 0.0, 1.0);
    pos.xz += normalize(pos.xz + vec2(0.0001)) * branchTuft * bottomSpread;
    pos.y += sin(theta * 7.0) * 0.03 * bottomSpread;
  } else if (uPart < 0.5) {
    // Ağaç gövdesi kabuğunda dikey oluk kabartmaları
    float theta = atan(pos.z, pos.x);
    float barkRidge = (fbm2D(vec2(theta * 3.5, pos.y * 2.8)) - 0.5) * 0.024;
    pos.xz += normalize(pos.xz + vec2(0.0001)) * barkRidge;
  }

  vLocalPos = pos;
  vNormal = normalize(normalMatrix * norm);
  vWorldNormal = normalize(mat3(modelMatrix) * norm);
  vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
  vViewPos = -mvPos.xyz;
  gl_Position = projectionMatrix * mvPos;
}
`;

const TREE_FALL_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform float uPart;
uniform float uCutGlow;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldNormal;
varying vec3 vViewPos;
varying vec3 vLocalPos;

${NOISE_GLSL}

void main() {
  if (uOpacity <= 0.01) discard;
  vec3 N = normalize(vNormal);
  vec3 V = normalize(vViewPos);
  float ndotv = clamp(abs(dot(N, V)), 0.0, 1.0);
  vec3 sunDir = normalize(vec3(0.48, 0.82, 0.38));
  float sunDiff = clamp(dot(normalize(vWorldNormal), sunDir) * 0.5 + 0.5, 0.0, 1.0);

  if (uPart < 0.5) {
    // PARÇA 0: Yarık Kabuklu Orman Çamı Gövdesi
    float theta = atan(vLocalPos.z, vLocalPos.x);
    float barkGrain = fbm2D(vec2(theta * 4.5, vLocalPos.y * 5.2));
    float fineFissure = fbm2D(vec2(theta * 11.0, vLocalPos.y * 12.0));
    float barkVal = clamp(barkGrain * 0.65 + fineFissure * 0.35, 0.0, 1.0);

    vec3 darkBark = vec3(0.14, 0.08, 0.04);
    vec3 warmBark = vec3(0.36, 0.21, 0.11);
    vec3 rimBark  = vec3(0.48, 0.30, 0.16);
    vec3 col = mix(darkBark, warmBark, smoothstep(0.22, 0.78, barkVal) * (0.45 + 0.55 * sunDiff));
    col = mix(col, rimBark, pow(1.0 - ndotv, 2.2) * 0.35 * sunDiff);

    // Kök ve kütük tabanında hafif orman yosunu dokusu
    float mossMask = smoothstep(0.35, 0.0, vUv.y) * smoothstep(0.45, 0.75, barkGrain);
    col = mix(col, vec3(0.16, 0.31, 0.12), mossMask * 0.55);

    // Kesiğe yakın bölgede kılıç darbesi kor ışıması
    float nearCut = smoothstep(0.28, 0.0, abs(vLocalPos.y));
    col += vec3(1.0, 0.38, 0.08) * nearCut * uCutGlow * 0.85;

    gl_FragColor = vec4(col, clamp(uOpacity, 0.0, 1.0));
    return;
  }

  if (uPart < 1.5) {
    // PARÇA 1: Gür Çam İğne Yaprak Katmanları
    float theta = atan(vLocalPos.z, vLocalPos.x);
    float needleNoise = fbm2D(vec2(theta * 6.0, vUv.y * 10.0));
    float tuftShadow = smoothstep(0.0, 0.35, vUv.y);

    vec3 deepPine   = vec3(0.05, 0.17, 0.07);
    vec3 forestPine = vec3(0.12, 0.33, 0.13);
    vec3 sunlitTip  = vec3(0.25, 0.50, 0.18);

    float lightMix = clamp(sunDiff * 0.68 + needleNoise * 0.32, 0.0, 1.0);
    vec3 foliageCol = mix(deepPine, forestPine, smoothstep(0.18, 0.75, lightMix));
    foliageCol = mix(foliageCol, sunlitTip, smoothstep(0.62, 0.96, lightMix) * (1.0 - vUv.y * 0.45));
    foliageCol *= 0.68 + 0.32 * tuftShadow;

    gl_FragColor = vec4(foliageCol, clamp(uOpacity, 0.0, 1.0));
    return;
  }

  if (uPart < 2.5) {
    // PARÇA 2: Kesik Odun Kesiti (Yıllık Ağaç Halkaları + Kılıç Kesiği Kor İzi)
    float r = length(vLocalPos.xz) * 3.6;
    float ringNoise = fbm2D(vLocalPos.xz * 12.0) * 0.15;
    float rings = 0.5 + 0.5 * sin((r + ringNoise) * 38.0);
    vec3 sapwood = vec3(0.78, 0.58, 0.35);
    vec3 heartwood = vec3(0.48, 0.29, 0.14);
    vec3 woodCol = mix(heartwood, sapwood, smoothstep(0.2, 0.8, rings));
    // Kılıç kesiği anında korlaşan altın-kızıl kesim yüzeyi
    vec3 emberGlow = vec3(1.0, 0.48, 0.12) * uCutGlow * (0.65 + 0.35 * sin(r * 18.0 - uTime * 16.0));
    gl_FragColor = vec4(woodCol + emberGlow, clamp(uOpacity, 0.0, 1.0));
    return;
  }

  // PARÇA 3: Yatay Kılıç Darbesi Enerji Hilali (Sword Cleave Crescent Wave)
  float radial = length(vUv - vec2(0.5)) * 2.0;
  float crescent = smoothstep(0.25, 0.72, radial) * (1.0 - smoothstep(0.78, 1.0, radial));
  float sweep = 0.5 + 0.5 * sin(atan(vUv.y - 0.5, vUv.x - 0.5) * 3.0 - uTime * 22.0);
  vec3 slashCol = mix(vec3(0.95, 0.22, 0.06), vec3(1.0, 0.88, 0.45), sweep * 0.7 + crescent * 0.3);
  float alpha = crescent * (0.45 + 0.55 * sweep) * uCutGlow * uOpacity;
  if (alpha <= 0.01) discard;
  gl_FragColor = vec4(slashCol * 1.4, clamp(alpha, 0.0, 1.0));
}
`;

// ============================================================================
// YETENEK GÖRSEL SİSTEMİ (MİNİMAL PARTİKÜL + MAKSİMUM 3B HACİMSEL AĞ GERÇEKÇİLİĞİ)
// ============================================================================

const SMOKE_COUNT = 36;
const DETAIL_COUNT = 48;
const MAX_SEEDS = Math.max(SMOKE_COUNT, DETAIL_COUNT);
const LIGHTNING_SEGMENTS = 18;

interface AbilityVisual {
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
}

/** Aynı anda sahneyi aydınlatabilecek yetenek ışığı sayısı. */
const LIGHT_POOL_SIZE = 2;

export class AbilitySystem {
  readonly group = new THREE.Group();
  private readonly visuals: AbilityVisual[] = [];
  private readonly mapTrees = new Map<string, MapTreeRecord>();
  private readonly assignedFallTrees = new Set<string>();
  /**
   * Sahnede her zaman duran sabit ışık havuzu. three.js görünmeyen ışıkları saymaz; ışık sayısı her
   * değiştiğinde sahnedeki tüm aydınlatılan malzemeler yeniden derlenir (yetenek başlarında ~1.5 sn donma).
   * Her yeteneğin kendi ışığı sahneye eklenmez, yalnızca değerleri tutar; en parlak olanlar havuza kopyalanır.
   */
  private readonly lightPool: THREE.PointLight[] = [];

  constructor() {
    this.group.name = 'ability_effects_group';
    this.group.userData.isAbility = true;
  }

  /**
   * Harita prop'ları sahneye eklendikten sonra haritadaki gerçek çam ağaçlarını (Realistic_Pine_*)
   * bularak başlangıç konum/dönüş/ölçek bilgilerini kaydeder.
   */
  bindSceneTrees(sceneGroup: THREE.Object3D) {
    sceneGroup.updateMatrixWorld(true);
    sceneGroup.traverse((o) => {
      if (/^Realistic_Pine_\d+$/i.test(o.name)) {
        const worldPos = new THREE.Vector3();
        o.getWorldPosition(worldPos);
        const origWorldQuat = new THREE.Quaternion();
        o.getWorldQuaternion(origWorldQuat);
        const parentWorldQuat = new THREE.Quaternion();
        if (o.parent) {
          o.parent.getWorldQuaternion(parentWorldQuat);
        }
        const parentWorldQuatInv = parentWorldQuat.clone().invert();
        this.mapTrees.set(o.name, {
          id: o.name,
          node: o,
          origPosition: o.position.clone(),
          origQuaternion: o.quaternion.clone(),
          origScale: o.scale.clone(),
          worldPos,
          origWorldQuat,
          parentWorldQuatInv,
        });
        // Görüş alanı ayıklaması açık kalır: devrilen ağacın sınır küresi dünya matrisiyle birlikte döner.
        // Ağaçlar aynı geometriyi paylaşır; rüzgar salınımı kenarda kırpılmasın diye küreye bir kez pay eklenir.
        o.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (!mesh.isMesh || mesh.geometry.userData.windMargin) return;
          if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
          mesh.geometry.boundingSphere!.radius *= 1.1;
          mesh.geometry.userData.windMargin = true;
        });
      }
    });
  }

  /** Yetenek isabet anları (çoklu hedefli kollar tek isabet sayılır; devrilen ağaç yere çarptığı an). */
  impactEvents(): ImpactEvent[] {
    const byCast = new Map<string, ImpactEvent>();
    for (const v of this.visuals) {
      const a = v.ability;
      const isTree = a.recipe.effectType === 'tree_fall';
      const strength = a.impact ?? (isTree ? TREE_IMPACT : impactStrengthFor(a.knockback));
      if (strength <= 0) continue;
      const key = `${a.who}@${a.start.toFixed(3)}`;
      const prev = byCast.get(key);
      if (!prev || strength > prev.strength) byCast.set(key, { time: a.start + a.recipe.impactOffset, strength });
    }
    return [...byCast.values()];
  }

  /** Kamera açıklığı için haritadaki ağaçlar; devrilenlerde devrilmenin bittiği sahne zamanı da verilir. */
  clearanceTrees(): ClearanceTree[] {
    const fallEnds = new Map<string, number>();
    for (const v of this.visuals) {
      const id = v.ability.mapTreeId;
      if (!id) continue;
      const end = v.ability.start + v.ability.recipe.totalDuration;
      fallEnds.set(id, Math.max(fallEnds.get(id) ?? -Infinity, end));
    }
    return [...this.mapTrees.values()].map((t) => ({
      id: t.id,
      node: t.node,
      fallEnd: this.assignedFallTrees.has(t.id) ? (fallEnds.get(t.id) ?? Infinity) : undefined,
    }));
  }

  /**
   * Ağaç Devirme yeteneği için haritadaki gerçek ağaçlardan birini seçer;
   * ağacın doğrudan Karabey'e doğru devrilme yönünü ve Karabey'in yanına kadar sürüklenme hedefini hesaplar.
   */
  selectMapTreeForFall(
    casterPos: THREE.Vector3,
    _characters: Map<string, Character>,
    _lt: number,
    preferredId?: string,
  ): { tree: MapTreeRecord; fallDirXZ: THREE.Vector3; slideTargetPos: THREE.Vector3 } | null {
    if (this.mapTrees.size === 0) return null;

    let chosen: MapTreeRecord | undefined;
    if (preferredId && this.mapTrees.has(preferredId)) {
      chosen = this.mapTrees.get(preferredId);
    } else {
      let bestDist = Infinity;
      for (const tree of this.mapTrees.values()) {
        if (this.assignedFallTrees.has(tree.id)) continue;
        const d = Math.hypot(tree.worldPos.x - casterPos.x, tree.worldPos.z - casterPos.z);
        if (d < bestDist) {
          bestDist = d;
          chosen = tree;
        }
      }
      if (!chosen) {
        for (const tree of this.mapTrees.values()) {
          const d = Math.hypot(tree.worldPos.x - casterPos.x, tree.worldPos.z - casterPos.z);
          if (d < bestDist) {
            bestDist = d;
            chosen = tree;
          }
        }
      }
    }

    if (!chosen) return null;
    const fallOrder = this.assignedFallTrees.size;
    this.assignedFallTrees.add(chosen.id);

    // Ağaç doğrudan Karabey'e (hemen yanındaki noktaya) doğru devrilir
    const zSide = chosen.worldPos.z < casterPos.z ? -1 : 1;
    const sideOffset = (1.35 + fallOrder * 1.05) * zSide;
    const besideCaster = new THREE.Vector3(
      casterPos.x,
      casterPos.y,
      casterPos.z + sideOffset,
    );

    const fallDirXZ = new THREE.Vector3(
      besideCaster.x - chosen.worldPos.x,
      0,
      besideCaster.z - chosen.worldPos.z,
    );
    if (fallDirXZ.lengthSq() > 0.001) {
      fallDirXZ.normalize();
    } else {
      fallDirXZ.set(0, 0, 1);
    }

    // Ağaç Karabey'e doğru devrilirken yerde sürüklenir ve gövdesi Karabey'in hemen yanında duracak şekilde kayar
    const slideTargetPos = new THREE.Vector3(
      besideCaster.x - fallDirXZ.x * 4.2,
      chosen.worldPos.y,
      besideCaster.z - fallDirXZ.z * 4.2,
    );

    return { tree: chosen, fallDirXZ, slideTargetPos };
  }

  add(ability: ScheduledAbility) {
    const root = new THREE.Group();
    root.visible = false;
    root.userData.isAbility = true;

    const { effectType } = ability.recipe;
    const isShadow = effectType === 'shadow';
    const isRain = effectType === 'rain';
    const isTornado = effectType === 'tornado';
    const isTreeFall = effectType === 'tree_fall';

    // 1. Dinamik Işık
    const lightColor = isTornado
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
    if (this.lightPool.length === 0) {
      for (let i = 0; i < LIGHT_POOL_SIZE; i++) {
        const pooled = new THREE.PointLight(0xffffff, 0, 15, 1.5);
        pooled.name = `ability_light_${i}`;
        this.lightPool.push(pooled);
        this.group.add(pooled);
      }
    }

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
      vertexShader: FIRE_CORE_VERTEX,
      fragmentShader: FIRE_CORE_FRAGMENT,
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
      vertexShader: FIRE_CORE_VERTEX,
      fragmentShader: FIRE_CORE_FRAGMENT,
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
      vertexShader: VORTEX_VERTEX,
      fragmentShader: VORTEX_FRAGMENT,
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
      vertexShader: VORTEX_VERTEX,
      fragmentShader: VORTEX_FRAGMENT,
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
        vertexShader: ARROW_VERTEX,
        fragmentShader: ARROW_FRAGMENT,
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
        vertexShader: TREE_FALL_VERTEX,
        fragmentShader: TREE_FALL_FRAGMENT,
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
      vertexShader: PARTICLE_VERTEX_SHADER,
      fragmentShader: VOLUMETRIC_SMOKE_FRAGMENT,
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

    const effectMode = isShadow ? 3.0 : isRain ? 2.0 : isTornado || isTreeFall ? 1.0 : 0.0;
    const detailMat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERTEX_SHADER,
      fragmentShader: VOLUMETRIC_DETAIL_FRAGMENT,
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

    this.group.add(root);
    this.visuals.push({
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
    });
  }

  getActiveCameraFocus(lt: number, characters: Map<string, Character>): ActiveAbilityFocus | null {
    // Aynı yetenek kullanımının çoklu hedefli kollarını tek bir odak kaydında birleştir
    const groupedByCast = new Map<
      string,
      {
        casterId: string;
        targetId: string;
        zoomWeight: number;
        centerSum: THREE.Vector3;
        sizeSum: number;
        count: number;
        birdEyeWeight?: number;
        elevationOverride?: number;
      }
    >();

    for (const v of this.visuals) {
      const { chargeEnd, impactOffset, totalDuration, effectType } = v.ability.recipe;
      const local = lt - v.ability.start;
      const zoomStart = -0.55;
      const zoomFull = 0.65;
      const zoomHoldEnd =
        effectType === 'shadow'
          ? Math.min(1.45, chargeEnd * 0.68)
          : effectType === 'tree_fall'
            ? impactOffset + 0.85
            : chargeEnd + 0.25;
      const zoomReleaseEnd = Math.min(
        totalDuration,
        effectType === 'shadow'
          ? chargeEnd + 0.85
          : effectType === 'tree_fall'
            ? totalDuration
            : impactOffset + 0.95,
      );
      if (local < zoomStart || local > zoomReleaseEnd) continue;

      const caster = characters.get(v.ability.who);
      const target = characters.get(v.ability.target);
      if (!caster || (!target && effectType !== 'tree_fall')) continue;

      const casterPos = caster.positionAt(lt, new THREE.Vector3());
      const targetPos = target ? target.positionAt(lt, new THREE.Vector3()) : v.ability.impactPos.clone();

      let zoomWeight = 0;
      if (local >= zoomStart && local < zoomFull) {
        const u = clamp((local - zoomStart) / (zoomFull - zoomStart), 0, 1);
        zoomWeight = 0.5 - 0.5 * Math.cos(u * Math.PI);
      } else if (local >= zoomFull && local <= zoomHoldEnd) {
        zoomWeight = 1.0;
      } else if (local > zoomHoldEnd && local < zoomReleaseEnd) {
        const u = clamp((local - zoomHoldEnd) / Math.max(0.01, zoomReleaseEnd - zoomHoldEnd), 0, 1);
        zoomWeight = 0.5 + 0.5 * Math.cos(u * Math.PI);
      }

      if (zoomWeight <= 0.001) continue;

      const dir = new THREE.Vector3().subVectors(targetPos, casterPos);
      const dist = Math.max(0.001, dir.length());
      dir.divideScalar(dist);

      const rawLaunchU = local <= chargeEnd ? 0 : clamp((local - chargeEnd) / Math.max(0.01, impactOffset - chargeEnd), 0, 1);
      const smoothLaunchU = rawLaunchU * rawLaunchU * (3 - 2 * rawLaunchU);

      let birdEyeWeight: number | undefined;
      let elevationOverride: number | undefined;

      const effectCenter = casterPos.clone();
      if (effectType === 'rain') {
        effectCenter.addScaledVector(dir, 0.45);
        effectCenter.lerp(targetPos, smoothLaunchU * 0.52);
        effectCenter.y += caster.rig.height * 0.78;
      } else if (effectType === 'tornado') {
        effectCenter.lerp(targetPos, smoothLaunchU * 0.42);
        effectCenter.y += caster.rig.height * 0.78;
      } else if (effectType === 'shadow') {
        effectCenter.addScaledVector(dir, 0.30);
        effectCenter.lerp(targetPos, smoothLaunchU * 0.35);
        effectCenter.y += caster.rig.height * 0.86;
      } else if (effectType === 'tree_fall') {
        const fallDir = v.ability.fallDirXZ ?? dir;
        const slideTarget = v.ability.slideTargetPos ?? targetPos;
        const rawSlide = local <= 1.75 ? 0 : clamp((local - 1.75) / (3.20 - 1.75), 0, 1);
        const slideU = 1 - Math.pow(1 - rawSlide, 2.35);

        const curBase = new THREE.Vector3().lerpVectors(targetPos, slideTarget, slideU);
        const curTreeMid = new THREE.Vector3(
          curBase.x + fallDir.x * (3.2 * smoothLaunchU),
          curBase.y,
          curBase.z + fallDir.z * (3.2 * smoothLaunchU),
        );
        // Devrilen ağaç ile sahnedeki tüm karakterlerin ortası: yeteneğin hedef karakteri yok; yalnızca
        // Karabey ile ağaca bakınca kahramanlar yüksek açıda kadrajın alt kenarından taşıyordu
        const fighters = new THREE.Vector3();
        for (const c of characters.values()) fighters.add(c.positionAt(lt, new THREE.Vector3()));
        fighters.divideScalar(Math.max(1, characters.size));
        effectCenter.copy(fighters).lerp(curTreeMid, 0.4);
        effectCenter.y += caster.rig.height * 0.85;

        // Yüksek açıdan bakış: ağaç kesilirken (0.65s .. 1.35s) yükselir, devrilme ve Karabey'in yanına
        // sürüklenme boyunca (1.35s .. 3.20s) 35°'den izletir, ardından yumuşakça iner.
        // (54° ve 7.4'lük kadraj kamerayı 45 m yükseltip kesintisiz savaşın ritmini bölüyordu.)
        if (local >= 0.65 && local < 1.35) {
          const u = clamp((local - 0.65) / 0.70, 0, 1);
          birdEyeWeight = 0.5 - 0.5 * Math.cos(u * Math.PI);
        } else if (local >= 1.35 && local <= zoomHoldEnd) {
          birdEyeWeight = 1.0;
        } else if (local > zoomHoldEnd && local < zoomReleaseEnd) {
          const u = clamp((local - zoomHoldEnd) / Math.max(0.01, zoomReleaseEnd - zoomHoldEnd), 0, 1);
          birdEyeWeight = 0.5 + 0.5 * Math.cos(u * Math.PI);
        } else {
          birdEyeWeight = 0;
        }
        elevationOverride = 35;
      } else {
        effectCenter.addScaledVector(dir, 0.55);
        effectCenter.lerp(targetPos, smoothLaunchU * 0.38);
        effectCenter.y += caster.rig.height * 0.62;
      }

      const groupSize = v.ability.groupSize ?? 1;
      const suggestedSize =
        effectType === 'tree_fall'
          ? 6.2
          : groupSize > 1
            ? 3.45
            : effectType === 'rain'
              ? 3.25
              : effectType === 'tornado'
                ? 3.15
                : effectType === 'shadow'
                  ? 3.25
                  : caster.rig.height > 1.8
                    ? 2.85
                    : 2.65;

      const castKey = `${v.ability.who}@${v.ability.start.toFixed(3)}`;
      const existing = groupedByCast.get(castKey);
      if (existing) {
        existing.centerSum.add(effectCenter);
        existing.sizeSum += suggestedSize;
        existing.count += 1;
      } else {
        groupedByCast.set(castKey, {
          casterId: v.ability.who,
          targetId: v.ability.target,
          zoomWeight,
          centerSum: effectCenter,
          sizeSum: suggestedSize,
          count: 1,
          birdEyeWeight,
          elevationOverride,
        });
      }
    }

    const activeList: ActiveAbilityFocus[] = [];
    for (const g of groupedByCast.values()) {
      activeList.push({
        casterId: g.casterId,
        targetId: g.targetId,
        zoomWeight: g.zoomWeight,
        effectCenter: g.centerSum.divideScalar(g.count),
        suggestedSize: g.sizeSum / g.count,
        birdEyeWeight: g.birdEyeWeight,
        elevationOverride: g.elevationOverride,
      });
    }

    if (activeList.length === 0) return null;
    if (activeList.length === 1) return activeList[0];

    // Ardışık yetenekler arasında kameranın sıçramaması ve geri-ileri savrulmaması için yumuşak ağırlıklı geçiş (crossfade)
    const combinedCenter = new THREE.Vector3();
    let totalW = 0;
    let combinedSize = 0;
    let invProd = 1;
    let maxBirdEye = 0;
    let birdEyeElev: number | undefined;
    for (const f of activeList) {
      combinedCenter.addScaledVector(f.effectCenter, f.zoomWeight);
      combinedSize += f.suggestedSize * f.zoomWeight;
      totalW += f.zoomWeight;
      invProd *= 1 - clamp(f.zoomWeight, 0, 1);
      if (f.birdEyeWeight !== undefined && f.birdEyeWeight > maxBirdEye) {
        maxBirdEye = f.birdEyeWeight;
        birdEyeElev = f.elevationOverride;
      }
    }
    if (totalW > 0) {
      combinedCenter.divideScalar(totalW);
      combinedSize /= totalW;
    }

    return {
      casterId: activeList[activeList.length - 1].casterId,
      targetId: activeList[activeList.length - 1].targetId,
      zoomWeight: 1 - invProd,
      effectCenter: combinedCenter,
      suggestedSize: combinedSize,
      birdEyeWeight: maxBirdEye > 0 ? maxBirdEye : undefined,
      elevationOverride: birdEyeElev,
    };
  }

  /** Sahnedeki tüm yetenek kullanımlarını (çoklu hedefli kolları tekilleştirerek) döndürür. */
  getScheduledCasts(): ScheduledAbility[] {
    const seen = new Set<string>();
    const list: ScheduledAbility[] = [];
    for (const v of this.visuals) {
      const key = `${v.ability.who}@${v.ability.start.toFixed(3)}@${v.ability.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push(v.ability);
    }
    return list;
  }

  /** Sahne yerel zamanı lt'de aktif olarak kullanılan yeteneklerin HUD bilgilerini döndürür. */
  getActiveAbilities(lt: number, characters: Map<string, Character>): ActiveAbilityHUDInfo[] {
    const seen = new Set<string>();
    const active: ActiveAbilityHUDInfo[] = [];
    for (const v of this.visuals) {
      const { chargeEnd, impactOffset, totalDuration } = v.ability.recipe;
      const local = lt - v.ability.start;
      if (local < 0 || local > totalDuration) continue;

      const key = `${v.ability.who}@${v.ability.start.toFixed(3)}@${v.ability.name}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const caster = characters.get(v.ability.who);
      const casterPos = caster ? caster.positionAt(lt, new THREE.Vector3()) : new THREE.Vector3();
      const casterHeight = caster ? caster.rig.height : 1.75;
      const casterWorldPos = new THREE.Vector3(casterPos.x, casterPos.y + casterHeight + 0.35, casterPos.z);

      let phase: 'charge' | 'flight' | 'impact' = 'charge';
      if (local >= impactOffset) {
        phase = 'impact';
      } else if (local >= chargeEnd) {
        phase = 'flight';
      }

      active.push({
        who: v.ability.who,
        target: v.ability.target,
        name: v.ability.name,
        recipe: v.ability.recipe,
        start: v.ability.start,
        localTime: local,
        progress: clamp(local / Math.max(0.01, totalDuration), 0, 1),
        phase,
        casterWorldPos,
      });
    }
    return active;
  }

  update(lt: number, characters: Map<string, Character>) {
    // Zaman çizelgesinde ileri-geri sarıldığında deterministik olması için harita ağaçlarını önce dik konuma sıfırla
    for (const tree of this.mapTrees.values()) {
      tree.node.position.copy(tree.origPosition);
      tree.node.quaternion.copy(tree.origQuaternion);
      tree.node.scale.copy(tree.origScale);
    }

    for (const v of this.visuals) {
      const { chargeEnd, impactOffset, totalDuration, effectType } = v.ability.recipe;
      const local = lt - v.ability.start;

      if (effectType === 'tree_fall') {
        if (local < 0) {
          v.root.visible = false;
          continue;
        }
        const caster = characters.get(v.ability.who);
        if (!caster) {
          v.root.visible = false;
          continue;
        }
        v.root.visible = true;
        v.smokeMat.uniforms.uTime.value = local;
        v.detailMat.uniforms.uTime.value = local;
        this.updateRealisticTreeFall(v, local, lt, caster, chargeEnd, impactOffset, totalDuration);

        if (local <= totalDuration) {
          (v.smokePoints.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
          (v.smokePoints.geometry.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
          (v.smokePoints.geometry.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
          (v.smokePoints.geometry.getAttribute('aAngle') as THREE.BufferAttribute).needsUpdate = true;
          (v.smokePoints.geometry.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;

          (v.detailPoints.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
          (v.detailPoints.geometry.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
          (v.detailPoints.geometry.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
          (v.detailPoints.geometry.getAttribute('aAngle') as THREE.BufferAttribute).needsUpdate = true;
          (v.detailPoints.geometry.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
        }
        continue;
      }

      if (local < 0 || local > totalDuration) {
        v.root.visible = false;
        continue;
      }

      const caster = characters.get(v.ability.who);
      const target = characters.get(v.ability.target);
      if (!caster || !target) {
        v.root.visible = false;
        continue;
      }

      v.root.visible = true;
      v.smokePoints.visible = true;
      v.detailPoints.visible = true;
      v.smokeMat.uniforms.uTime.value = local;
      v.detailMat.uniforms.uTime.value = local;
      v.fireCoreMat.uniforms.uTime.value = local;
      v.fireCoronaMat.uniforms.uTime.value = local;
      v.vortexMat.uniforms.uTime.value = local;
      v.outerVortexMat.uniforms.uTime.value = local;

      if (effectType === 'shadow') {
        this.updateRealisticBlackSmoke(v, local, lt, caster, target, chargeEnd, impactOffset, totalDuration);
      } else if (effectType === 'tornado') {
        this.updateRealisticTornado(v, local, lt, caster, target, chargeEnd, impactOffset, totalDuration);
      } else if (effectType === 'rain') {
        this.updateRealisticRain(v, local, lt, caster, target, chargeEnd, impactOffset, totalDuration);
      } else {
        this.updateRealisticFireball(v, local, lt, caster, target, chargeEnd, impactOffset, totalDuration);
      }

      (v.smokePoints.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (v.smokePoints.geometry.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
      (v.smokePoints.geometry.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
      (v.smokePoints.geometry.getAttribute('aAngle') as THREE.BufferAttribute).needsUpdate = true;
      (v.smokePoints.geometry.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;

      (v.detailPoints.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (v.detailPoints.geometry.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
      (v.detailPoints.geometry.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
      (v.detailPoints.geometry.getAttribute('aAngle') as THREE.BufferAttribute).needsUpdate = true;
      (v.detailPoints.geometry.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
    }

    this.assignPooledLights();
  }

  /** O karede en parlak yetenek ışıklarını sabit havuza kopyalar; artanlar sönük kalır. */
  private assignPooledLights() {
    const lit = this.visuals
      .filter((v) => v.root.visible && v.light.intensity > 0.001)
      .sort((a, b) => b.light.intensity - a.light.intensity);
    this.lightPool.forEach((pooled, i) => {
      const src = lit[i]?.light;
      if (!src) {
        pooled.intensity = 0;
        return;
      }
      pooled.position.copy(src.position);
      pooled.color.copy(src.color);
      pooled.intensity = src.intensity;
      pooled.distance = src.distance;
      pooled.decay = src.decay;
    });
  }

  /**
   * Shader ısıtma için tüm yetenek görsellerini geçici olarak görünür yapar; geri alma fonksiyonu döndürür.
   * Böylece ateş, hortum, ok ve duman shader'ları ilk kullanıldıkları karede değil, yüklemede derlenir.
   */
  revealAllForWarmup(): () => void {
    const hidden: THREE.Object3D[] = [];
    this.group.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
    return () => {
      for (const o of hidden) o.visible = false;
    };
  }

  /**
   * 1. KARABEY'İN GERÇEKÇİ SİYAH DUMAN YETENEĞİ (Çift Katmanlı 3B Hacimsel Duman + Minimal Sis)
   * - Siyaha çok yakın yoğun is/gölge dumanı, kesinlikle patlamaz.
   * - Karabey'in içinden değil, KAFASININ BİRAZ ÜSTÜNDEN başlayarak yoğunlaşır,
   *   ardından çoklu hedef varsa 3 kola ayrılarak eş zamanlı biçimde DÜŞMANLARIN İÇİNE gider
   *   ve düşman gövdelerinin içine doğru emilir.
   */
  private updateRealisticBlackSmoke(
    v: AbilityVisual,
    local: number,
    lt: number,
    caster: Character,
    target: Character,
    chargeEnd: number,
    impactOffset: number,
    totalDuration: number,
  ) {
    v.fireCoreMesh.visible = false;
    v.fireCoronaMesh.visible = false;
    v.lightningLine.visible = false;
    v.arrowGroup.visible = false;
    v.treeGroup.visible = false;
    v.vortexMesh.visible = true;
    v.outerVortexMesh.visible = true;

    const groupIndex = v.ability.groupIndex ?? 0;
    const groupSize = Math.max(1, v.ability.groupSize ?? 1);
    const groupPhase = (groupIndex / groupSize) * Math.PI * 2;

    const casterPos = caster.positionAt(lt, new THREE.Vector3());
    const targetNow = target.positionAt(lt, new THREE.Vector3());

    // Başlangıç noktası: Karabey'in kafasının biraz üstü (içinden değil!)
    const startAboveHead = new THREE.Vector3(
      casterPos.x,
      casterPos.y + caster.rig.height + 0.18,
      casterPos.z,
    );
    // Varış noktası: Düşmanın göğüs/gövde merkezi (düşmanın içine gider)
    const impactBodyBase = new THREE.Vector3(
      v.ability.impactPos.x,
      v.ability.impactPos.y + target.rig.height * 0.22,
      v.ability.impactPos.z,
    );
    const targetBodyNow = new THREE.Vector3(
      targetNow.x,
      targetNow.y + target.rig.height * 0.22,
      targetNow.z,
    );

    const center = new THREE.Vector3();
    let radiusScale = 0.65;
    let heightScale = 0.95;
    let fade = 1.0;
    let flightProgress = 0.0;
    let absorbProgress = 0.0;
    // Çoklu hedefte kafa üstünde toplanırken üst üste binen bulutların yoğunluğunu dengele, uçuşta tam yoğunluğa çıkar
    let groupDensityScale = 1.0;

    if (local < chargeEnd) {
      // EVRE 1: Karabey'in kafasının biraz üstünde toplanan yoğun siyah duman bulutu
      const u = clamp(local / chargeEnd, 0, 1);
      center.copy(startAboveHead);
      if (groupSize > 1 && u > 0.75) {
        // Fırlatmadan hemen önce her kol kendi hedefine doğru hafifçe yönelir
        const preSplit = clamp((u - 0.75) / 0.25, 0, 1);
        center.lerp(impactBodyBase, preSplit * 0.06);
      }
      radiusScale = 0.42 + 0.34 * Math.sin(u * Math.PI * 0.5);
      heightScale = 0.68 + 0.32 * u;
      fade = clamp(local / 0.22, 0, 1);
      groupDensityScale = groupSize > 1 ? 1.0 / Math.sqrt(groupSize) : 1.0;
    } else if (local < impactOffset) {
      // EVRE 2: Kafasının üstünden aşağı/ileri doğru süzülerek eş zamanlı biçimde tüm hedeflerin içine akış
      const u = clamp((local - chargeEnd) / (impactOffset - chargeEnd), 0, 1);
      flightProgress = u;
      const eased = u * u * (3 - 2 * u);
      center.lerpVectors(startAboveHead, impactBodyBase, eased);
      center.y += Math.sin(u * Math.PI) * 0.22;
      radiusScale = THREE.MathUtils.lerp(0.74, 0.58, eased);
      heightScale = THREE.MathUtils.lerp(0.98, target.rig.height * 0.68, eased);
      fade = 1.0;
      const splitBlend = clamp(u / 0.25, 0, 1);
      groupDensityScale = groupSize > 1 ? THREE.MathUtils.lerp(1.0 / Math.sqrt(groupSize), 1.0, splitBlend) : 1.0;
    } else {
      // EVRE 3: Her hedefin etrafını sarıp gövdesinin İÇİNE doğru emilerek nüfuz etme (patlamaz)
      const surroundDuration = totalDuration - impactOffset;
      const u = clamp((local - impactOffset) / surroundDuration, 0, 1);
      absorbProgress = u;
      center.copy(targetBodyNow);
      center.y += target.rig.height * 0.14 * u;
      // Yarıçap dıştan düşmanın gövdesinin içine doğru daralır (düşmanın içine girer)
      radiusScale = 0.68 * (1.0 - u * 0.68);
      heightScale = target.rig.height * (0.68 - u * 0.30);
      fade = u < 0.72 ? 1.0 : clamp((1.0 - u) / 0.28, 0, 1);
      groupDensityScale = 1.0;
    }

    v.vortexMesh.position.copy(center);
    v.vortexMesh.rotation.y = groupPhase;
    v.vortexMesh.scale.set(radiusScale, heightScale / 2.05, radiusScale);
    v.vortexMat.uniforms.uOpacity.value = 0.94 * fade * groupDensityScale;

    v.outerVortexMesh.position.copy(center);
    v.outerVortexMesh.rotation.y = -groupPhase;
    v.outerVortexMesh.scale.set(radiusScale * 1.12, heightScale / 1.95, radiusScale * 1.12);
    v.outerVortexMat.uniforms.uOpacity.value = 0.80 * fade * groupDensityScale;

    v.light.position.set(center.x, center.y + heightScale * 0.5, center.z);
    v.light.intensity = (1.1 * fade) / groupSize;

    for (let i = 0; i < SMOKE_COUNT; i++) {
      const s0 = v.seeds[i * 4 + 0];
      const s1 = v.seeds[i * 4 + 1];
      const s2 = v.seeds[i * 4 + 2];
      const s3 = v.seeds[i * 4 + 3];

      const hFrac = (s0 + local * (0.42 + s1 * 0.30)) % 1;
      const angle = groupPhase + s3 * Math.PI * 2 + local * (2.2 + s1 * 1.4) + hFrac * 2.4;

      if (local >= chargeEnd && local < impactOffset) {
        // Uçuş evresinde kafa üstünden her bir düşmanın içine uzanan akışkan duman kuyruğu
        const streamLag = s0 * 0.35;
        const streamU = clamp(flightProgress - streamLag, 0, 1);
        const streamEased = streamU * streamU * (3 - 2 * streamU);
        const px = THREE.MathUtils.lerp(startAboveHead.x, impactBodyBase.x, streamEased);
        const py =
          THREE.MathUtils.lerp(startAboveHead.y + 0.35, impactBodyBase.y + target.rig.height * 0.32, streamEased) +
          Math.sin(streamU * Math.PI) * 0.22;
        const pz = THREE.MathUtils.lerp(startAboveHead.z, impactBodyBase.z, streamEased);
        const streamR = (0.24 + (1.0 - streamU) * 0.25) * (0.6 + s2 * 0.6);

        v.smokePositions[i * 3 + 0] = px + Math.cos(angle) * streamR;
        v.smokePositions[i * 3 + 1] = py + (s1 - 0.5) * 0.35;
        v.smokePositions[i * 3 + 2] = pz + Math.sin(angle) * streamR;
      } else {
        // Kafa üstünde toplanma veya düşmanın içine doğru sarmal emilme
        const inwardPull = local >= impactOffset ? Math.max(0.08, 1.0 - hFrac * 0.55 - absorbProgress * 0.45) : 1.0;
        const ringRadius = (0.36 + Math.sin(hFrac * Math.PI) * 0.32 + (s2 - 0.5) * 0.16) * radiusScale * inwardPull;
        const y = 0.05 + hFrac * heightScale * 0.92;

        v.smokePositions[i * 3 + 0] = center.x + Math.cos(angle) * ringRadius;
        v.smokePositions[i * 3 + 1] = center.y + y;
        v.smokePositions[i * 3 + 2] = center.z + Math.sin(angle) * ringRadius;
      }

      const shade = 0.015 + s1 * 0.035;
      v.smokeColors[i * 3 + 0] = shade;
      v.smokeColors[i * 3 + 1] = shade;
      v.smokeColors[i * 3 + 2] = shade + 0.010;

      v.smokeSizes[i] = (0.55 + Math.sin(hFrac * Math.PI) * 0.38) * Math.max(0.45, radiusScale);
      v.smokeAngles[i] = groupPhase + s3 * Math.PI * 2 + local * (s0 > 0.5 ? 1.0 : -1.0);
      v.smokeAlphas[i] = Math.sin(hFrac * Math.PI) * 0.48 * fade * groupDensityScale;
    }

    for (let i = 0; i < DETAIL_COUNT; i++) {
      const s0 = v.seeds[i * 4 + 0];
      const s1 = v.seeds[i * 4 + 1];
      const s2 = v.seeds[i * 4 + 2];
      const s3 = v.seeds[i * 4 + 3];

      const hFrac = (s1 + local * (0.50 + s0 * 0.35)) % 1;
      const angle = groupPhase + s3 * Math.PI * 2 - local * (2.6 + s0 * 1.4) + hFrac * 2.8;

      if (local >= chargeEnd && local < impactOffset) {
        const streamLag = s1 * 0.30;
        const streamU = clamp(flightProgress - streamLag, 0, 1);
        const streamEased = streamU * streamU * (3 - 2 * streamU);
        const px = THREE.MathUtils.lerp(startAboveHead.x, impactBodyBase.x, streamEased);
        const py =
          THREE.MathUtils.lerp(startAboveHead.y + 0.35, impactBodyBase.y + target.rig.height * 0.32, streamEased) +
          Math.sin(streamU * Math.PI) * 0.22;
        const pz = THREE.MathUtils.lerp(startAboveHead.z, impactBodyBase.z, streamEased);
        const streamR = (0.18 + s2 * 0.25) * (1.0 - streamU * 0.35);

        v.detailPositions[i * 3 + 0] = px + Math.cos(angle) * streamR;
        v.detailPositions[i * 3 + 1] = py + (s0 - 0.5) * 0.28;
        v.detailPositions[i * 3 + 2] = pz + Math.sin(angle) * streamR;
      } else {
        const inwardPull = local >= impactOffset ? Math.max(0.05, 1.0 - hFrac * 0.65 - absorbProgress * 0.50) : 1.0;
        const ringRadius = (0.28 + s2 * 0.36) * radiusScale * inwardPull;
        const y = 0.04 + hFrac * heightScale * 0.88;

        v.detailPositions[i * 3 + 0] = center.x + Math.cos(angle) * ringRadius;
        v.detailPositions[i * 3 + 1] = center.y + y;
        v.detailPositions[i * 3 + 2] = center.z + Math.sin(angle) * ringRadius;
      }

      const dark = 0.012 + s2 * 0.028;
      v.detailColors[i * 3 + 0] = dark;
      v.detailColors[i * 3 + 1] = dark;
      v.detailColors[i * 3 + 2] = dark + 0.012;

      v.detailSizes[i] = 0.38 + s0 * 0.28;
      v.detailAngles[i] = groupPhase + s2 * Math.PI * 2 - local * 1.4;
      v.detailAlphas[i] = Math.sin(hFrac * Math.PI) * 0.42 * fade * groupDensityScale;
    }
  }

  /**
   * 2. TOPRAK'IN GERÇEKÇİ ATEŞ TOPU YETENEĞİ (3B Magma Çekirdeği + 3B Alev Koronası/Kuyruğu + Minimal Kıvılcım)
   */
  private updateRealisticFireball(
    v: AbilityVisual,
    local: number,
    lt: number,
    caster: Character,
    target: Character,
    chargeEnd: number,
    impactOffset: number,
    totalDuration: number,
  ) {
    v.vortexMesh.visible = false;
    v.outerVortexMesh.visible = false;
    v.lightningLine.visible = false;
    v.arrowGroup.visible = false;
    v.treeGroup.visible = false;

    const tmpCaster = caster.positionAt(lt, new THREE.Vector3());
    const startPoint = new THREE.Vector3(tmpCaster.x, tmpCaster.y + caster.rig.height * 0.62, tmpCaster.z);
    const endPoint = v.ability.impactPos.clone();
    endPoint.y += target.rig.height * 0.56;

    const tmpDir = new THREE.Vector3().subVectors(endPoint, startPoint);
    const totalDist = Math.max(0.001, tmpDir.length());
    tmpDir.divideScalar(totalDist);
    const tmpRight = new THREE.Vector3().crossVectors(tmpDir, new THREE.Vector3(0, 1, 0)).normalize();

    const handOrigin = startPoint.clone().addScaledVector(tmpDir, 0.58).addScaledVector(tmpRight, 0.26);
    const ballPos = new THREE.Vector3();

    if (local < chargeEnd) {
      const u = clamp(local / chargeEnd, 0, 1);
      const swingForward = u < 0.72 ? -0.30 * Math.sin((u / 0.72) * Math.PI * 0.5) : ((u - 0.72) / 0.28) * 0.62;
      ballPos.copy(handOrigin).addScaledVector(tmpDir, swingForward);

      const coreScale = 0.22 + Math.pow(u, 1.3) * 0.85;
      v.fireCoreMesh.visible = true;
      v.fireCoreMesh.position.copy(ballPos);
      v.fireCoreMesh.scale.setScalar(coreScale);
      v.fireCoreMat.uniforms.uOpacity.value = clamp(u * 1.3, 0, 1);

      v.fireCoronaMesh.visible = true;
      v.fireCoronaMesh.position.copy(ballPos);
      v.fireCoronaMesh.rotation.set(0, 0, 0);
      v.fireCoronaMesh.scale.setScalar(coreScale * 1.15);
      v.fireCoronaMat.uniforms.uOpacity.value = clamp(u * 1.1, 0, 1);

      v.light.position.copy(ballPos);
      v.light.intensity = 2.5 + u * 7.0;

      for (let i = 0; i < SMOKE_COUNT; i++) {
        const s0 = v.seeds[i * 4 + 0];
        const s1 = v.seeds[i * 4 + 1];
        const s2 = v.seeds[i * 4 + 2];
        const s3 = v.seeds[i * 4 + 3];
        const rise = (s0 + local * (1.2 + s1)) % 1;
        const r = (0.08 + rise * 0.28) * u;
        const a = local * 3.8 + s2 * Math.PI * 2;

        v.smokePositions[i * 3 + 0] = ballPos.x + Math.cos(a) * r;
        v.smokePositions[i * 3 + 1] = ballPos.y + 0.14 + rise * 0.65 * u;
        v.smokePositions[i * 3 + 2] = ballPos.z + Math.sin(a) * r;

        const g = 0.14 + (1 - rise) * 0.14;
        v.smokeColors[i * 3 + 0] = g + 0.06 * (1 - rise);
        v.smokeColors[i * 3 + 1] = g;
        v.smokeColors[i * 3 + 2] = g * 0.88;

        v.smokeSizes[i] = (0.28 + rise * 0.42) * u;
        v.smokeAngles[i] = s3 * Math.PI * 2 + local * 1.4;
        v.smokeAlphas[i] = Math.sin(rise * Math.PI) * 0.35 * u;
      }

      for (let i = 0; i < DETAIL_COUNT; i++) {
        const s0 = v.seeds[i * 4 + 0];
        const s1 = v.seeds[i * 4 + 1];
        const s2 = v.seeds[i * 4 + 2];
        const s3 = v.seeds[i * 4 + 3];

        const cycle = (local * (2.6 + s0 * 1.8) + s1) % 1;
        const radius = (0.18 + cycle * 0.35) * u;
        const angle = local * (7.0 + s2 * 5.0) + s3 * Math.PI * 2;
        const elev = (s1 - 0.5) * Math.PI;

        v.detailPositions[i * 3 + 0] = ballPos.x + Math.cos(angle) * Math.cos(elev) * radius;
        v.detailPositions[i * 3 + 1] = ballPos.y + Math.sin(elev) * radius + cycle * 0.25;
        v.detailPositions[i * 3 + 2] = ballPos.z + Math.sin(angle) * Math.cos(elev) * radius;

        v.detailColors[i * 3 + 0] = 1.0;
        v.detailColors[i * 3 + 1] = 0.90;
        v.detailColors[i * 3 + 2] = 0.78;

        v.detailSizes[i] = (0.06 + s2 * 0.08) * u;
        v.detailAngles[i] = s3 * Math.PI * 2 + local * 3.0;
        v.detailAlphas[i] = Math.sin(cycle * Math.PI) * 0.75 * u;
      }
    } else if (local < impactOffset) {
      const u = clamp((local - chargeEnd) / (impactOffset - chargeEnd), 0, 1);
      const eased = 1 - Math.pow(1 - u, 1.55);
      ballPos.lerpVectors(handOrigin, endPoint, eased);
      ballPos.y += Math.sin(u * Math.PI) * 0.22;

      v.fireCoreMesh.visible = true;
      v.fireCoreMesh.position.copy(ballPos);
      v.fireCoreMesh.scale.setScalar(1.18 + Math.sin(local * 38) * 0.06);
      v.fireCoreMat.uniforms.uOpacity.value = 1.0;

      // 3B Alev Koronası uçuş yönünün tersine doğru damla/kuyruklu yıldız gibi uzar
      v.fireCoronaMesh.visible = true;
      v.fireCoronaMesh.position.copy(ballPos).addScaledVector(tmpDir, -0.28);
      v.fireCoronaMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tmpDir);
      v.fireCoronaMesh.scale.set(1.15, 2.15, 1.15);
      v.fireCoronaMat.uniforms.uOpacity.value = 0.95;

      v.light.position.copy(ballPos);
      v.light.intensity = 9.5 + Math.sin(local * 45) * 1.5;

      const trailMaxLen = Math.min(3.2, totalDist * eased + 0.35);

      for (let i = 0; i < SMOKE_COUNT; i++) {
        const s0 = v.seeds[i * 4 + 0];
        const s1 = v.seeds[i * 4 + 1];
        const s2 = v.seeds[i * 4 + 2];
        const s3 = v.seeds[i * 4 + 3];

        const tailFrac = (s0 + local * (2.2 + s1 * 1.4)) % 1;
        const backDist = 0.35 + tailFrac * trailMaxLen;
        const spread = (0.08 + tailFrac * 0.32) * (0.4 + s2 * 0.6);
        const swirl = local * 7.5 + s3 * Math.PI * 2;

        v.smokePositions[i * 3 + 0] = ballPos.x - tmpDir.x * backDist + tmpRight.x * Math.cos(swirl) * spread;
        v.smokePositions[i * 3 + 1] =
          ballPos.y - tmpDir.y * backDist + Math.sin(swirl) * spread * 0.6 + tailFrac * 0.42;
        v.smokePositions[i * 3 + 2] = ballPos.z - tmpDir.z * backDist + tmpRight.z * Math.cos(swirl) * spread;

        const warmth = Math.max(0, 1 - tailFrac * 1.8);
        v.smokeColors[i * 3 + 0] = 0.14 + warmth * 0.32;
        v.smokeColors[i * 3 + 1] = 0.12 + warmth * 0.12;
        v.smokeColors[i * 3 + 2] = 0.11;

        v.smokeSizes[i] = 0.35 + tailFrac * 0.68;
        v.smokeAngles[i] = s3 * Math.PI * 2 + local * 1.8;
        v.smokeAlphas[i] = Math.sin(tailFrac * Math.PI) * 0.48;
      }

      for (let i = 0; i < DETAIL_COUNT; i++) {
        const s0 = v.seeds[i * 4 + 0];
        const s1 = v.seeds[i * 4 + 1];
        const s2 = v.seeds[i * 4 + 2];
        const s3 = v.seeds[i * 4 + 3];

        const tailFrac = (s0 + local * (3.2 + s1 * 2.0)) % 1;
        const backDist = 0.15 + tailFrac * trailMaxLen * 0.75;
        const spread = (0.05 + tailFrac * 0.24) * (0.35 + s2 * 0.65);
        const swirl = local * 12.0 + s3 * Math.PI * 2;

        v.detailPositions[i * 3 + 0] = ballPos.x - tmpDir.x * backDist + tmpRight.x * Math.cos(swirl) * spread;
        v.detailPositions[i * 3 + 1] = ballPos.y - tmpDir.y * backDist + Math.sin(swirl) * spread + tailFrac * 0.14;
        v.detailPositions[i * 3 + 2] = ballPos.z - tmpDir.z * backDist + tmpRight.z * Math.cos(swirl) * spread;

        v.detailColors[i * 3 + 0] = 1.0;
        v.detailColors[i * 3 + 1] = 0.92 - tailFrac * 0.35;
        v.detailColors[i * 3 + 2] = 0.80 - tailFrac * 0.60;

        v.detailSizes[i] = 0.07 + s2 * 0.09;
        v.detailAngles[i] = s3 * Math.PI * 2 + local * 4.0;
        v.detailAlphas[i] = (1.0 - Math.pow(tailFrac, 1.3)) * 0.82;
      }
    } else {
      const dt = local - impactOffset;
      const u = clamp(dt / (totalDuration - impactOffset), 0, 1);
      const fade = Math.max(0, 1 - Math.pow(u, 1.25));
      ballPos.copy(endPoint);

      if (u < 0.34) {
        const fu = u / 0.34;
        v.fireCoreMesh.visible = true;
        v.fireCoreMesh.position.copy(ballPos);
        v.fireCoreMesh.scale.setScalar(1.25 + fu * 1.45);
        v.fireCoreMat.uniforms.uOpacity.value = 1.0 - fu;

        v.fireCoronaMesh.visible = true;
        v.fireCoronaMesh.position.copy(ballPos);
        v.fireCoronaMesh.rotation.set(0, local * 4.0, 0);
        v.fireCoronaMesh.scale.setScalar(1.35 + fu * 1.95);
        v.fireCoronaMat.uniforms.uOpacity.value = (1.0 - fu) * 0.9;
      } else {
        v.fireCoreMesh.visible = false;
        v.fireCoronaMesh.visible = false;
      }

      v.light.position.copy(ballPos);
      v.light.intensity = Math.max(0, (1 - u) * (1 - u) * 12.0);

      for (let i = 0; i < SMOKE_COUNT; i++) {
        const s0 = v.seeds[i * 4 + 0];
        const s1 = v.seeds[i * 4 + 1];
        const s2 = v.seeds[i * 4 + 2];
        const s3 = v.seeds[i * 4 + 3];

        const theta = s0 * Math.PI * 2;
        const phi = Math.acos(2 * s1 - 1);
        const speed = 1.2 + s2 * 2.4;
        const drag = 1 - Math.exp(-dt * 2.1);

        v.smokePositions[i * 3 + 0] = ballPos.x + (Math.sin(phi) * Math.cos(theta) * speed + tmpDir.x * 1.2) * drag * 0.65;
        v.smokePositions[i * 3 + 1] = ballPos.y + Math.abs(Math.cos(phi)) * speed * drag * 0.55 + dt * (0.95 + s3 * 0.55);
        v.smokePositions[i * 3 + 2] = ballPos.z + (Math.sin(phi) * Math.sin(theta) * speed + tmpDir.z * 1.2) * drag * 0.65;

        const warmth = Math.max(0, 1 - u * 2.4);
        v.smokeColors[i * 3 + 0] = 0.14 + warmth * 0.32;
        v.smokeColors[i * 3 + 1] = 0.12 + warmth * 0.12;
        v.smokeColors[i * 3 + 2] = 0.11;

        v.smokeSizes[i] = 0.58 + u * 0.95 + s2 * 0.35;
        v.smokeAngles[i] = s3 * Math.PI * 2 + local * 1.2;
        v.smokeAlphas[i] = fade * 0.55;
      }

      const groundY = v.ability.impactPos.y + 0.06;
      for (let i = 0; i < DETAIL_COUNT; i++) {
        const s0 = v.seeds[i * 4 + 0];
        const s1 = v.seeds[i * 4 + 1];
        const s2 = v.seeds[i * 4 + 2];
        const s3 = v.seeds[i * 4 + 3];

        const theta = s0 * Math.PI * 2;
        const phi = Math.acos(2 * s1 - 1);
        const speed = 2.8 + s2 * 5.2;
        const drag = 1 - Math.exp(-dt * 1.9);

        const vx = Math.sin(phi) * Math.cos(theta) * speed + tmpDir.x * (1.4 + s3 * 1.8);
        const vy = Math.abs(Math.cos(phi)) * speed * 0.85 + 1.6;
        const vz = Math.sin(phi) * Math.sin(theta) * speed + tmpDir.z * (1.4 + s3 * 1.8);

        let py = ballPos.y + vy * drag * 0.65 - 4.8 * dt * dt;
        if (py < groundY) {
          py = groundY + Math.abs(py - groundY) * 0.35 * Math.exp(-dt * 2.5);
        }

        v.detailPositions[i * 3 + 0] = ballPos.x + vx * drag * 0.65;
        v.detailPositions[i * 3 + 1] = py;
        v.detailPositions[i * 3 + 2] = ballPos.z + vz * drag * 0.65;

        v.detailColors[i * 3 + 0] = 1.0;
        v.detailColors[i * 3 + 1] = 0.85 - u * 0.45;
        v.detailColors[i * 3 + 2] = 0.65 - u * 0.55;

        v.detailSizes[i] = 0.07 + s3 * 0.09;
        v.detailAngles[i] = s3 * Math.PI * 2 + local * 3.5;
        v.detailAlphas[i] = Math.max(0, 1 - u * (0.8 + s3 * 0.35)) * 0.88;
      }
    }
  }

  /**
   * 3. DEFNE'NİN GERÇEKÇİ 3B HACİMSEL RÜZGAR HORTUMU YETENEĞİ
   * - Partikül kalabalığı yerine çift katmanlı 3B trompet huni (İç Yoğuşma Çekirdeği + Dış Helisel Rüzgar Kılıfı)
   * - Yalnızca çok az sayıda ince uçuşan yaprak/dal ve taban toz sisi içerir.
   */
  private updateRealisticTornado(
    v: AbilityVisual,
    local: number,
    lt: number,
    caster: Character,
    target: Character,
    chargeEnd: number,
    impactOffset: number,
    totalDuration: number,
  ) {
    v.fireCoreMesh.visible = false;
    v.fireCoronaMesh.visible = false;
    v.lightningLine.visible = false;
    v.arrowGroup.visible = false;
    v.treeGroup.visible = false;
    v.vortexMesh.visible = true;
    v.outerVortexMesh.visible = true;

    const casterPos = caster.positionAt(lt, new THREE.Vector3());
    const endGround = v.ability.impactPos.clone();
    const tornadoPos = new THREE.Vector3();

    let scaleXZ = 1.0;
    let scaleY = 1.0;
    let alpha = 1.0;

    let outerAlpha = 1.0;

    if (local < chargeEnd) {
      // Tornado oluşma evresi (2.25 sn): Hurricane Kick.fbx dönerken tornado doğrudan Defne'nin içinde (casterPos) oluşur
      const u = clamp(local / chargeEnd, 0, 1);
      const easedGrow = u * u * (3 - 2 * u);
      tornadoPos.copy(casterPos);
      scaleXZ = 0.22 + Math.pow(u, 1.10) * 0.82;
      scaleY = 0.14 + Math.pow(u, 1.02) * 0.94;
      alpha = clamp(local / 0.95, 0, 1) * (0.45 + 0.55 * easedGrow);
      outerAlpha = clamp((local - 0.18) / 1.20, 0, 1) * easedGrow;
    } else if (local < impactOffset) {
      // Sonraki tekme animasyonu (flying_kick / kick) başladığında tornado Defne'nin içinden hedefe doğru fırlatılır
      const u = clamp((local - chargeEnd) / (impactOffset - chargeEnd), 0, 1);
      const eased = 1 - Math.pow(1 - u, 1.45);
      tornadoPos.lerpVectors(casterPos, endGround, eased);
      scaleXZ = 1.04 + u * 0.24;
      scaleY = 1.08 + u * 0.18;
      alpha = 1.0;
      outerAlpha = 1.0;
    } else {
      const u = clamp((local - impactOffset) / (totalDuration - impactOffset), 0, 1);
      const targetNow = target.positionAt(lt, new THREE.Vector3());
      tornadoPos.lerpVectors(endGround, targetNow, Math.min(1, u * 1.35));
      tornadoPos.y = endGround.y;
      scaleXZ = 1.28 + u * 0.72;
      scaleY = 1.26 + u * 0.28;
      alpha = Math.max(0, 1 - Math.pow(u, 1.35));
      outerAlpha = alpha;
    }

    // 1. İç Yoğuşma Hunisi (3B Trompet Gövde)
    v.vortexMesh.position.copy(tornadoPos);
    v.vortexMesh.scale.set(scaleXZ, scaleY, scaleXZ);
    v.vortexMat.uniforms.uOpacity.value = 0.95 * alpha;

    // 2. Dış Helisel Rüzgar Kılıfı ve Taban Toz Etekliği
    v.outerVortexMesh.position.copy(tornadoPos);
    v.outerVortexMesh.scale.set(scaleXZ, scaleY, scaleXZ);
    v.outerVortexMat.uniforms.uOpacity.value = 0.82 * outerAlpha;

    v.light.position.set(tornadoPos.x, tornadoPos.y + 1.6, tornadoPos.z);
    v.light.intensity = 2.4 * alpha;

    // Minimal taban toz sisi ve tepe mezosiklon bulut yumuşatması (sadece 36 yumuşak FBM bulutçuk)
    for (let i = 0; i < SMOKE_COUNT; i++) {
      const s0 = v.seeds[i * 4 + 0];
      const s1 = v.seeds[i * 4 + 1];
      const s2 = v.seeds[i * 4 + 2];
      const s3 = v.seeds[i * 4 + 3];

      const isBaseFoot = i < 20;
      const h = isBaseFoot ? s0 * 0.12 : 0.82 + s0 * 0.16;
      const swayAmp = 0.10 + 0.28 * Math.pow(h, 1.35);
      const swayX = Math.sin(h * 4.2 - local * 5.8) * swayAmp * scaleXZ;
      const swayZ = Math.cos(h * 3.6 - local * 5.1) * swayAmp * scaleXZ;

      const r = isBaseFoot ? (0.45 + s2 * 0.75) * scaleXZ : (0.75 + s2 * 0.85) * scaleXZ;
      const angle = local * (isBaseFoot ? 9.5 : 5.5) + s3 * Math.PI * 2;

      v.smokePositions[i * 3 + 0] = tornadoPos.x + swayX + Math.cos(angle) * r;
      v.smokePositions[i * 3 + 1] = tornadoPos.y + h * 3.25 * scaleY;
      v.smokePositions[i * 3 + 2] = tornadoPos.z + swayZ + Math.sin(angle) * r;

      if (isBaseFoot) {
        v.smokeColors[i * 3 + 0] = 0.42;
        v.smokeColors[i * 3 + 1] = 0.35;
        v.smokeColors[i * 3 + 2] = 0.27;
        v.smokeSizes[i] = (0.55 + s1 * 0.38) * scaleXZ;
        v.smokeAlphas[i] = 0.42 * alpha;
      } else {
        v.smokeColors[i * 3 + 0] = 0.24;
        v.smokeColors[i * 3 + 1] = 0.28;
        v.smokeColors[i * 3 + 2] = 0.34;
        v.smokeSizes[i] = (0.78 + s1 * 0.55) * scaleXZ;
        v.smokeAlphas[i] = 0.46 * alpha;
      }
      v.smokeAngles[i] = s3 * Math.PI * 2 + local * 2.2;
    }

    // Minimal fiziksel detaylar (sadece 48 ince rüzgar akım çizgisi ve küçük yaprak/dal)
    for (let i = 0; i < DETAIL_COUNT; i++) {
      const s0 = v.seeds[i * 4 + 0];
      const s1 = v.seeds[i * 4 + 1];
      const s2 = v.seeds[i * 4 + 2];
      const s3 = v.seeds[i * 4 + 3];

      const h = (s0 + local * (1.25 + s2 * 0.85)) % 1;
      const baseFoot = Math.exp(-h * 10.5) * 0.45;
      const midColumn = 0.15 + 0.36 * Math.pow(h, 1.28);
      const topTrumpet = 0.96 * Math.pow(Math.max(0, (h - 0.40) / 0.60), 2.35);
      const funnelR = (midColumn + topTrumpet + baseFoot) * (1.05 + s2 * 0.38) * scaleXZ;

      const swayAmp = 0.10 + 0.28 * Math.pow(h, 1.35);
      const swayX = Math.sin(h * 4.2 - local * 5.8) * swayAmp * scaleXZ;
      const swayZ = Math.cos(h * 3.6 - local * 5.1) * swayAmp * scaleXZ;
      const angle = local * (12.5 + s3 * 4.0) + h * 14.0 + s1 * Math.PI * 2;

      v.detailPositions[i * 3 + 0] = tornadoPos.x + swayX + Math.cos(angle) * funnelR;
      v.detailPositions[i * 3 + 1] = tornadoPos.y + 0.08 + h * 3.20 * scaleY;
      v.detailPositions[i * 3 + 2] = tornadoPos.z + swayZ + Math.sin(angle) * funnelR;

      if (s1 < 0.15) {
        // Küçük koyu orman yaprağı
        v.detailColors[i * 3 + 0] = 0.20 + s2 * 0.18;
        v.detailColors[i * 3 + 1] = 0.38 + s3 * 0.22;
        v.detailColors[i * 3 + 2] = 0.14;
        v.detailSizes[i] = 0.11 + s0 * 0.07;
        v.detailAngles[i] = s3 * Math.PI * 2 + local * 9.0;
        v.detailAlphas[i] = Math.sin(h * Math.PI) * 0.72 * alpha;
      } else if (s1 < 0.36) {
        // İnce dal kıymığı / toprak zerresi
        v.detailColors[i * 3 + 0] = 0.30;
        v.detailColors[i * 3 + 1] = 0.23;
        v.detailColors[i * 3 + 2] = 0.16;
        v.detailSizes[i] = 0.09 + s0 * 0.06;
        v.detailAngles[i] = s2 * Math.PI * 2 + local * 7.0;
        v.detailAlphas[i] = Math.sin(h * Math.PI) * 0.65 * alpha;
      } else {
        // Huninin etrafını yatay/helisel saran ince rüzgar filamenti
        v.detailColors[i * 3 + 0] = 0.62;
        v.detailColors[i * 3 + 1] = 0.70;
        v.detailColors[i * 3 + 2] = 0.78;
        v.detailSizes[i] = (0.28 + h * 0.26) * scaleXZ;
        v.detailAngles[i] = 0.22 * Math.cos(angle) + (s2 - 0.5) * 0.18;
        v.detailAlphas[i] = Math.sin(h * Math.PI) * 0.42 * alpha;
      }
    }
  }

  /**
   * Erika'nın (veya yayı kullanan karakterin) sol bileğinin (mixamorigLeftHand) o andaki gerçek 3B dünya
   * konumunu (outPos) ve sol bilek ile sol dirsek (mixamorigLeftForeArm) arasındaki önkol doğrultusunu (outDir) döndürür.
   * Böylece okun ucu bilekte dururken mavi ok gövdesi tam bilekten dirseğe doğru uzanır ve sol kol nasıl hareket ederse
   * ok da çıkana kadar birebir öyle hareket eder.
   */
  private getCasterLeftHandTransform(
    caster: Character,
    fallbackDirXZ: THREE.Vector3,
    outPos: THREE.Vector3,
    outDir: THREE.Vector3,
  ): void {
    caster.rig.root.updateMatrixWorld(true);
    let leftWrist: THREE.Object3D | undefined;
    let leftElbow: THREE.Object3D | undefined;
    caster.rig.root.traverse((obj) => {
      if (!leftWrist && /lefthand$/i.test(obj.name)) {
        leftWrist = obj;
      } else if (!leftElbow && /leftforearm$/i.test(obj.name)) {
        leftElbow = obj;
      }
    });
    if (leftWrist) {
      leftWrist.getWorldPosition(outPos);
      if (leftElbow) {
        const elbowPos = leftElbow.getWorldPosition(new THREE.Vector3());
        // Sol bilek (mixamorigLeftHand) ile sol dirsek (mixamorigLeftForeArm) arasındaki doğrultu:
        // +Y ekseni dirsekten bileğe (okun sivri ucu bilekte ileriye),
        // -Y ekseni (okun gövdesi ve kanatçıkları) ise tam BİLEKTEN DİRSEĞE DOĞRU uzanır.
        outDir.subVectors(outPos, elbowPos);
        if (outDir.lengthSq() > 1e-6) {
          outDir.normalize();
          return;
        }
      }
      const handQuat = leftWrist.getWorldQuaternion(new THREE.Quaternion());
      outDir.set(0, 1, 0).applyQuaternion(handQuat).normalize();
      return;
    }
    const casterPos = caster.pose.position;
    outPos.set(
      casterPos.x + fallbackDirXZ.x * 0.68,
      casterPos.y + caster.rig.height * 0.79,
      casterPos.z + fallbackDirXZ.z * 0.68,
    );
    outDir.copy(fallbackDirXZ);
  }

  /**
   * 4. ERİKA'NIN (MEŞE'NİN) 3B BÜYÜLÜ YAĞMUR OKU VE FIRTINA YAĞMURU YETENEĞİ
   * - Evre 1 (0 .. chargeEnd = 2.15s): Mavi büyülü ok doğrudan Erika'nın SOL BİLEĞİNDEN SOL DİRSEĞİNE DOĞRU
   *   (mixamorigLeftHand -> mixamorigLeftForeArm) bağlıdır; sol el/önkol nasıl hareket edip dönüyorsa mavi ok da
   *   çıkana kadar bilekten dirseğe doğru hizalı olarak hareket eder. (Henüz yağmur yağmaz)
   * - Evre 2 (chargeEnd .. impactOffset = 2.15s .. 2.80s): Erika yay kirişini bıraktığında (aim_recoil)
   *   3B Büyülü Ok doğrudan Erika'nın SOL ELİNDEN çıkarak yüksek hızla hedefe fırlar. (Henüz yağmur yağmaz)
   * - Evre 3 (impactOffset .. totalDuration = 2.80s .. 4.70s): Büyülü ok hedefe çarptığı anda hedefin tepesinde
   *   3B Fırtına Bulutu patlar, şimşek çakar ve hedefin üzerine sağanak yağmur yağmaya başlar.
   */
  private updateRealisticRain(
    v: AbilityVisual,
    local: number,
    lt: number,
    caster: Character,
    target: Character,
    chargeEnd: number,
    impactOffset: number,
    totalDuration: number,
  ) {
    v.fireCoreMesh.visible = false;
    v.fireCoronaMesh.visible = false;
    v.treeGroup.visible = false;

    const casterPos = caster.positionAt(lt, new THREE.Vector3());
    const targetNow = target.positionAt(lt, new THREE.Vector3());

    const toTargetXZ = new THREE.Vector3(
      v.ability.impactPos.x - casterPos.x,
      0,
      v.ability.impactPos.z - casterPos.z,
    );
    const distXZ = Math.max(0.001, toTargetXZ.length());
    toTargetXZ.divideScalar(distXZ);

    // Erika'nın SOL BİLEĞİNİN (mixamorigLeftHand) 3B konumu ve BİLEK-DİRSEK (mixamorigLeftForeArm) doğrultusu
    const leftHandPos = new THREE.Vector3();
    const leftHandDir = new THREE.Vector3();
    this.getCasterLeftHandTransform(caster, toTargetXZ, leftHandPos, leftHandDir);

    // Büyülü okun hedefe saplanacağı göğüs/üst gövde noktası
    const impactPoint = new THREE.Vector3(
      v.ability.impactPos.x,
      v.ability.impactPos.y + target.rig.height * 0.68,
      v.ability.impactPos.z,
    );

    const upAxis = new THREE.Vector3(0, 1, 0);

    if (local < chargeEnd) {
      // ======================================================================
      // EVRE 1: MAVİ OKUN ERİKA'NIN SOL BİLEĞİNDEN DİRSEĞİNE DOĞRU BAĞLI HAREKET ETMESİ (0 .. 2.15s)
      // Sol el ve önkol nasıl hareket ederse mavi ok da çıkana kadar bilekten dirseğe doğru hizalı hareket eder.
      // ======================================================================
      v.vortexMesh.visible = false;
      v.outerVortexMesh.visible = false;
      v.lightningLine.visible = false;
      v.arrowGroup.visible = true;

      // Sol bileğin son konumunu fırlatma başlangıç noktası olarak kaydet (ok tam sol elden çıkacak)
      v.launchOrigin.copy(leftHandPos);

      const appear = clamp(local / 0.08, 0, 1);
      const chargeProgress = clamp(local / Math.max(0.01, chargeEnd), 0, 1);
      const pulse = 1.0 + Math.sin(local * 12.0) * 0.04 * chargeProgress;

      // Okun konumu sol bileğe (leftHandPos), gövdesi ise bilekten dirseğe doğru (-leftHandDir) kilitlenir
      v.arrowGroup.position.copy(leftHandPos);
      v.arrowGroup.quaternion.setFromUnitVectors(upAxis, leftHandDir);
      // Elde tutulurken ok matkap gibi dönmez; 3B su sarmalları kendi shader'ı içinde akar
      v.arrowSpinGroup.rotation.y = Math.sin(local * 3.5) * 0.12;

      const chargeScale = (0.92 + 0.14 * appear) * pulse;
      v.arrowGroup.scale.set(chargeScale, chargeScale, chargeScale);

      for (let m = 0; m < v.arrowMats.length; m++) {
        v.arrowMats[m].uniforms.uTime.value = local;
        v.arrowMats[m].uniforms.uOpacity.value = appear;
        v.arrowMats[m].uniforms.uFlight.value = chargeProgress * 0.35;
      }

      // Işık ve su/şimşek enerjisi doğrudan Erika'nın sol bileğiyle birlikte hareket eder
      v.light.position.copy(leftHandPos);
      v.light.intensity = (2.8 + chargeProgress * 4.8) * appear;

      // Okun üstünü örtmeyen, yalnızca ok gövdesi ve temreni etrafında çok ince su buharı halesi
      const horizAngle = Math.atan2(leftHandDir.x, leftHandDir.y);
      for (let i = 0; i < SMOKE_COUNT; i++) {
        const s0 = v.seeds[i * 4 + 0];
        const s1 = v.seeds[i * 4 + 1];
        const s2 = v.seeds[i * 4 + 2];
        const s3 = v.seeds[i * 4 + 3];

        const cycle = (s0 + local * (1.5 + s1)) % 1;
        const r = (0.045 * (1 - cycle * 0.65) + 0.012) * appear;
        const a = local * 5.5 + s2 * Math.PI * 2;
        // 0.20m (temren ucu) ile -0.36m (dirsekteki kanatçıklar) arasında tam bilekten dirseğe dizilim
        const along = (0.20 - s3 * 0.56) * chargeScale;

        v.smokePositions[i * 3 + 0] = leftHandPos.x + leftHandDir.x * along + Math.cos(a) * r;
        v.smokePositions[i * 3 + 1] = leftHandPos.y + leftHandDir.y * along + Math.sin(a) * r;
        v.smokePositions[i * 3 + 2] = leftHandPos.z + leftHandDir.z * along + Math.sin(a + 1.2) * r;

        v.smokeColors[i * 3 + 0] = 0.28;
        v.smokeColors[i * 3 + 1] = 0.72;
        v.smokeColors[i * 3 + 2] = 0.98;

        v.smokeSizes[i] = (0.07 + (1 - cycle) * 0.06) * appear;
        v.smokeAngles[i] = s3 * Math.PI * 2 + local * 2.5;
        v.smokeAlphas[i] = Math.sin(cycle * Math.PI) * 0.14 * appear;
      }

      // Bilekten dirseğe uzanan ok gövdesine doğru yoğunlaşan ince kristal su damlacıkları
      for (let i = 0; i < DETAIL_COUNT; i++) {
        const s0 = v.seeds[i * 4 + 0];
        const s1 = v.seeds[i * 4 + 1];
        const s2 = v.seeds[i * 4 + 2];
        const s3 = v.seeds[i * 4 + 3];

        const cycle = (s0 + local * (2.6 + s2 * 1.4)) % 1;
        const spiralR = (1 - cycle) * (0.025 + s1 * 0.045) * appear;
        const angle = local * (12.0 + s3 * 5.0) + s2 * Math.PI * 2;
        // -0.36m (dirsek) ile +0.23m (bilek önü temren ucu) arasında akış
        const shaftOffset = (-0.36 + ((s1 + cycle * 0.45) % 1) * 0.59) * chargeScale;

        v.detailPositions[i * 3 + 0] = leftHandPos.x + leftHandDir.x * shaftOffset + Math.cos(angle) * spiralR;
        v.detailPositions[i * 3 + 1] = leftHandPos.y + leftHandDir.y * shaftOffset + Math.sin(angle) * spiralR;
        v.detailPositions[i * 3 + 2] = leftHandPos.z + leftHandDir.z * shaftOffset + Math.cos(angle + 1.57) * spiralR;

        v.detailColors[i * 3 + 0] = 0.45 + cycle * 0.45;
        v.detailColors[i * 3 + 1] = 0.86 + cycle * 0.14;
        v.detailColors[i * 3 + 2] = 1.0;

        v.detailSizes[i] = (0.045 + s0 * 0.045) * appear;
        v.detailAngles[i] = horizAngle;
        v.detailAlphas[i] = Math.sin(cycle * Math.PI) * 0.68 * appear;
      }
    } else if (local < impactOffset) {
      // ======================================================================
      // EVRE 2: BÜYÜLÜ YAĞMUR OKUNUN DOĞRUDAN ERİKA'NIN SOL ELİNDEN ÇIKIP HEDEFE UÇUŞU
      // ======================================================================
      v.vortexMesh.visible = false;
      v.outerVortexMesh.visible = false;
      v.lightningLine.visible = false;
      v.arrowGroup.visible = true;

      // Zaman çizelgesinde doğrudan bu kareye atlandıysa sol el konumunu yedekle
      if (v.launchOrigin.lengthSq() < 0.001) {
        v.launchOrigin.copy(leftHandPos);
      }
      const startHandPos = v.launchOrigin;

      const rawU = clamp((local - chargeEnd) / Math.max(0.01, impactOffset - chargeEnd), 0, 1);
      // Yaydan çıkan okun gergin, hızlı ve gerçekçi okçu yörüngesi (hafif kavis: 0.18m)
      const flightU = 1 - Math.pow(1 - rawU, 1.45);
      const arcLift = 0.18;

      const arrowPos = new THREE.Vector3().lerpVectors(startHandPos, impactPoint, flightU);
      arrowPos.y += Math.sin(flightU * Math.PI) * arcLift;

      // Anlık teğet vektörü (okun çentikli elmas ucu daima uçuş eğrisinin teğetine bakar)
      const tangent = new THREE.Vector3().subVectors(impactPoint, startHandPos);
      tangent.y += Math.cos(flightU * Math.PI) * Math.PI * arcLift;
      tangent.normalize();

      v.arrowGroup.position.copy(arrowPos);
      v.arrowGroup.quaternion.setFromUnitVectors(upAxis, tangent);
      v.arrowSpinGroup.rotation.y = (local - chargeEnd) * 18.0;
      v.arrowGroup.scale.set(1.18, 1.38, 1.18);

      for (let m = 0; m < v.arrowMats.length; m++) {
        v.arrowMats[m].uniforms.uTime.value = local;
        v.arrowMats[m].uniforms.uOpacity.value = 1.0;
        v.arrowMats[m].uniforms.uFlight.value = 1.0;
      }

      v.light.position.copy(arrowPos);
      v.light.intensity = 6.5;

      // Uçan okun arkasında bıraktığı ince, yüksek hızlı hidrodinamik su/buhar izi
      const trailAngle = Math.atan2(tangent.x, tangent.y);
      for (let i = 0; i < SMOKE_COUNT; i++) {
        const s0 = v.seeds[i * 4 + 0];
        const s1 = v.seeds[i * 4 + 1];
        const s2 = v.seeds[i * 4 + 2];
        const s3 = v.seeds[i * 4 + 3];

        const lagFrac = (i / SMOKE_COUNT) * 0.50 + s0 * 0.12;
        const trailU = clamp(flightU - lagFrac * 0.55, 0, flightU);
        const px = THREE.MathUtils.lerp(startHandPos.x, impactPoint.x, trailU);
        const py =
          THREE.MathUtils.lerp(startHandPos.y, impactPoint.y, trailU) + Math.sin(trailU * Math.PI) * arcLift;
        const pz = THREE.MathUtils.lerp(startHandPos.z, impactPoint.z, trailU);

        const swirlAngle = local * 18.0 + i * 0.75 + s3 * Math.PI * 2;
        const spread = (0.015 + lagFrac * 0.075) * (0.5 + s1 * 0.5);

        v.smokePositions[i * 3 + 0] = px + Math.cos(swirlAngle) * spread;
        v.smokePositions[i * 3 + 1] = py + Math.sin(swirlAngle) * spread;
        v.smokePositions[i * 3 + 2] = pz + Math.cos(swirlAngle + 1.57) * spread;

        v.smokeColors[i * 3 + 0] = 0.25;
        v.smokeColors[i * 3 + 1] = 0.72;
        v.smokeColors[i * 3 + 2] = 0.98;

        v.smokeSizes[i] = 0.09 + lagFrac * 0.16;
        v.smokeAngles[i] = s2 * Math.PI * 2 + local * 4.0;
        v.smokeAlphas[i] = (1 - lagFrac) * 0.34;
      }

      // Uçan okun kanatçıklarından saçılan ince su damlacıkları ve keskin su çizgileri
      for (let i = 0; i < DETAIL_COUNT; i++) {
        const s0 = v.seeds[i * 4 + 0];
        const s1 = v.seeds[i * 4 + 1];
        const s2 = v.seeds[i * 4 + 2];
        const s3 = v.seeds[i * 4 + 3];

        const lagFrac = ((s0 + local * 3.8) % 1) * 0.55;
        const trailU = clamp(flightU - lagFrac * 0.48, 0, flightU);
        const px = THREE.MathUtils.lerp(startHandPos.x, impactPoint.x, trailU);
        const py =
          THREE.MathUtils.lerp(startHandPos.y, impactPoint.y, trailU) + Math.sin(trailU * Math.PI) * arcLift;
        const pz = THREE.MathUtils.lerp(startHandPos.z, impactPoint.z, trailU);

        const swirlAngle = local * 24.0 + s3 * Math.PI * 2;
        const spread = (0.012 + lagFrac * 0.065) * (0.4 + s2 * 0.6);

        v.detailPositions[i * 3 + 0] = px + Math.cos(swirlAngle) * spread;
        v.detailPositions[i * 3 + 1] = py + Math.sin(swirlAngle) * spread;
        v.detailPositions[i * 3 + 2] = pz + Math.sin(swirlAngle + 1.2) * spread;

        v.detailColors[i * 3 + 0] = 0.42 + s1 * 0.38;
        v.detailColors[i * 3 + 1] = 0.88;
        v.detailColors[i * 3 + 2] = 1.0;

        v.detailSizes[i] = 0.07 + (1 - lagFrac) * 0.09;
        v.detailAngles[i] = trailAngle;
        v.detailAlphas[i] = (1 - lagFrac) * 0.88;
      }
    } else {
      // ======================================================================
      // EVRE 3: OK HEDEFE ÇARPINCA GÖĞE YÜKSELİR, FIRTINA BULUTU OLUŞUR, ÇATALLI ŞİMŞEK ÇAKAR VE YAĞMUR YAĞAR
      // ======================================================================
      v.vortexMesh.visible = true;
      v.outerVortexMesh.visible = true;

      const rainLocal = local - impactOffset;
      const cloudCenter = new THREE.Vector3(
        v.ability.impactPos.x * 0.25 + targetNow.x * 0.75,
        v.ability.impactPos.y + 3.25,
        v.ability.impactPos.z * 0.25 + targetNow.z * 0.75,
      );

      // Çarpma anındaki ilk 0.22 saniyede büyülü ok hedeften gökyüzündeki bulut merkezine yükselerek bulutu oluşturur
      if (rainLocal < 0.22) {
        const ascendU = clamp(rainLocal / 0.22, 0, 1);
        v.arrowGroup.visible = true;
        v.arrowGroup.position.lerpVectors(impactPoint, cloudCenter, ascendU);
        v.arrowGroup.quaternion.identity();
        v.arrowSpinGroup.rotation.y = local * 24.0;
        const burstScale = 1.15 * (1 - ascendU * 0.55);
        v.arrowGroup.scale.set(burstScale, burstScale * 1.45, burstScale);
        for (let m = 0; m < v.arrowMats.length; m++) {
          v.arrowMats[m].uniforms.uTime.value = local;
          v.arrowMats[m].uniforms.uOpacity.value = 1.0 - ascendU;
          v.arrowMats[m].uniforms.uFlight.value = 1.0;
        }
      } else {
        v.arrowGroup.visible = false;
      }

      const fadeOut = local > totalDuration - 0.55 ? clamp((totalDuration - local) / 0.55, 0, 1) : 1.0;
      // Ok çarptığı anda (rainLocal: 0 -> 0.28s) fırtına bulutu hızla büyür
      const grow = clamp(rainLocal / 0.28, 0, 1);

      // Çarpma anında güçlü ilk şimşek çakması + sağanak boyunca çakan şimşekler
      const impactBurstFlash = rainLocal < 0.24 ? 1.0 - rainLocal / 0.24 : 0;
      const stormFlash =
        local < totalDuration - 0.35
          ? Math.max(0, Math.sin(rainLocal * 31 + 1.2) * Math.sin(rainLocal * 13 + 0.8))
          : 0;
      const lightningFlash = Math.max(impactBurstFlash, stormFlash);

      // 3B Hacimsel Fırtına Bulutu Kubbesi
      v.vortexMesh.position.copy(cloudCenter);
      v.vortexMesh.scale.setScalar(grow);
      v.vortexMat.uniforms.uOpacity.value = 0.95 * grow * fadeOut;
      v.vortexMat.uniforms.uLightning.value = lightningFlash;

      v.outerVortexMesh.position.copy(cloudCenter);
      v.outerVortexMesh.scale.setScalar(grow);
      v.outerVortexMat.uniforms.uOpacity.value = 0.80 * grow * fadeOut;
      v.outerVortexMat.uniforms.uLightning.value = lightningFlash;

      // 3B Çatallı Şimşek Güncellemesi (12 segment ana gövde + 6 segment iki yan çatal kol)
      if (lightningFlash > 0.38) {
        v.lightningLine.visible = true;
        v.lightningMat.opacity = clamp((lightningFlash - 0.34) * 1.85 * fadeOut, 0, 1);
        const boltStep = Math.floor(local * 24);
        const mainSegments = 12;
        let curX = cloudCenter.x + Math.sin(boltStep * 7.3) * 0.22;
        let curY = cloudCenter.y - 0.12;
        let curZ = cloudCenter.z + Math.cos(boltStep * 5.1) * 0.22;
        const segH = 3.05 / mainSegments;

        let fork1X = curX;
        let fork1Y = curY;
        let fork1Z = curZ;
        let fork2X = curX;
        let fork2Y = curY;
        let fork2Z = curZ;

        for (let i = 0; i < mainSegments; i++) {
          const nextY = curY - segH;
          const jx = Math.sin(boltStep * 13.7 + i * 4.9) * 0.25 * (1 - i / mainSegments);
          const jz = Math.cos(boltStep * 9.3 + i * 6.1) * 0.25 * (1 - i / mainSegments);
          const nextX = cloudCenter.x + jx;
          const nextZ = cloudCenter.z + jz;

          const idx = i * 6;
          v.lightningPositions[idx + 0] = curX;
          v.lightningPositions[idx + 1] = curY;
          v.lightningPositions[idx + 2] = curZ;
          v.lightningPositions[idx + 3] = nextX;
          v.lightningPositions[idx + 4] = nextY;
          v.lightningPositions[idx + 5] = nextZ;

          if (i === 3) {
            fork1X = nextX;
            fork1Y = nextY;
            fork1Z = nextZ;
          } else if (i === 6) {
            fork2X = nextX;
            fork2Y = nextY;
            fork2Z = nextZ;
          }

          curX = nextX;
          curY = nextY;
          curZ = nextZ;
        }

        // Yan Çatal 1 (segment 12..14)
        let bx = fork1X;
        let by = fork1Y;
        let bz = fork1Z;
        for (let f = 0; f < 3; f++) {
          const nx = bx + (0.18 + 0.08 * Math.sin(boltStep * 3.1 + f)) * (boltStep % 2 === 0 ? 1 : -1);
          const ny = by - segH * 0.85;
          const nz = bz + 0.14 * Math.cos(boltStep * 4.7 + f);
          const idx = (mainSegments + f) * 6;
          v.lightningPositions[idx + 0] = bx;
          v.lightningPositions[idx + 1] = by;
          v.lightningPositions[idx + 2] = bz;
          v.lightningPositions[idx + 3] = nx;
          v.lightningPositions[idx + 4] = ny;
          v.lightningPositions[idx + 5] = nz;
          bx = nx;
          by = ny;
          bz = nz;
        }

        // Yan Çatal 2 (segment 15..17)
        bx = fork2X;
        by = fork2Y;
        bz = fork2Z;
        for (let f = 0; f < 3; f++) {
          const nx = bx + (0.16 + 0.07 * Math.cos(boltStep * 5.3 + f)) * (boltStep % 2 === 0 ? -1 : 1);
          const ny = by - segH * 0.80;
          const nz = bz - 0.15 * Math.sin(boltStep * 6.1 + f);
          const idx = (mainSegments + 3 + f) * 6;
          v.lightningPositions[idx + 0] = bx;
          v.lightningPositions[idx + 1] = by;
          v.lightningPositions[idx + 2] = bz;
          v.lightningPositions[idx + 3] = nx;
          v.lightningPositions[idx + 4] = ny;
          v.lightningPositions[idx + 5] = nz;
          bx = nx;
          by = ny;
          bz = nz;
        }

        (v.lightningLine.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      } else {
        v.lightningLine.visible = false;
      }

      v.light.position.set(cloudCenter.x, cloudCenter.y - 1.0, cloudCenter.z);
      v.light.intensity = (3.5 + lightningFlash * 10.0) * grow * fadeOut;

      for (let i = 0; i < SMOKE_COUNT; i++) {
        const s0 = v.seeds[i * 4 + 0];
        const s1 = v.seeds[i * 4 + 1];
        const s2 = v.seeds[i * 4 + 2];
        const s3 = v.seeds[i * 4 + 3];

        if (i < 24) {
          // Bulut kenarlarını yumuşatan büyük FBM fırtına bulutu katmanları
          const angle = s0 * Math.PI * 2 + local * 0.15;
          const rx = (0.65 + s1 * 0.95) * grow;
          const rz = (0.55 + s2 * 0.85) * grow;
          const ry = (s3 - 0.5) * 0.45 * grow;

          v.smokePositions[i * 3 + 0] = cloudCenter.x + Math.cos(angle) * rx;
          v.smokePositions[i * 3 + 1] = cloudCenter.y + ry;
          v.smokePositions[i * 3 + 2] = cloudCenter.z + Math.sin(angle) * rz;

          const baseShade = 0.16 + s3 * 0.16 + (lightningFlash > 0.38 ? 0.32 * (1 - s1 * 0.5) : 0);
          v.smokeColors[i * 3 + 0] = baseShade * 0.80;
          v.smokeColors[i * 3 + 1] = baseShade * 0.88;
          v.smokeColors[i * 3 + 2] = baseShade * 1.04;

          v.smokeSizes[i] = (1.05 + (1 - s1) * 0.65) * grow;
          v.smokeAngles[i] = s2 * Math.PI * 2 + local * 0.25;
          v.smokeAlphas[i] = 0.58 * grow * fadeOut;
        } else {
          // Zeminde ince yağmur sıçrama buharı
          const splashCycle = (s0 + rainLocal * (1.8 + s1)) % 1;
          const r = Math.sqrt(s2) * 1.25;
          const a = s3 * Math.PI * 2;
          v.smokePositions[i * 3 + 0] = cloudCenter.x + Math.cos(a) * r;
          v.smokePositions[i * 3 + 1] = v.ability.impactPos.y + 0.08 + splashCycle * 0.25;
          v.smokePositions[i * 3 + 2] = cloudCenter.z + Math.sin(a) * r;

          v.smokeColors[i * 3 + 0] = 0.55;
          v.smokeColors[i * 3 + 1] = 0.66;
          v.smokeColors[i * 3 + 2] = 0.76;

          v.smokeSizes[i] = 0.52 + s1 * 0.32;
          v.smokeAngles[i] = s3 * Math.PI * 2 + local * 0.6;
          v.smokeAlphas[i] = Math.sin(splashCycle * Math.PI) * 0.35 * grow * fadeOut;
        }
      }

      // Ok hedefe çarptığı andan itibaren yoğun sağanak yağmur yağışı ve zemin su halkaları
      const rainActive = clamp(rainLocal / 0.16, 0, 1);
      for (let i = 0; i < DETAIL_COUNT; i++) {
        const s0 = v.seeds[i * 4 + 0];
        const s1 = v.seeds[i * 4 + 1];
        const s2 = v.seeds[i * 4 + 2];
        const s3 = v.seeds[i * 4 + 3];

        const isSplash = s1 > 0.78;
        const fallFrac = (s0 + rainLocal * (3.8 + s2 * 1.9)) % 1;
        const radius = Math.sqrt(s2) * 1.32 * grow;
        const angle = s3 * Math.PI * 2;

        const rx = cloudCenter.x + Math.cos(angle) * radius;
        const rz = cloudCenter.z + Math.sin(angle) * radius;
        const ry = isSplash
          ? v.ability.impactPos.y + 0.05 + Math.sin(fallFrac * Math.PI) * 0.14
          : cloudCenter.y - 0.16 - fallFrac * 3.12 * rainActive;

        v.detailPositions[i * 3 + 0] = rx;
        v.detailPositions[i * 3 + 1] = ry;
        v.detailPositions[i * 3 + 2] = rz;

        const b = (0.76 + (1 - fallFrac) * 0.24) * rainActive * fadeOut;
        v.detailColors[i * 3 + 0] = b * 0.72;
        v.detailColors[i * 3 + 1] = b * 0.90;
        v.detailColors[i * 3 + 2] = b;

        v.detailSizes[i] = isSplash ? 0.24 + fallFrac * 0.26 : 0.48 + s0 * 0.20;
        v.detailAngles[i] = -0.06;
        v.detailAlphas[i] = (isSplash ? 1.0 - fallFrac : 0.88) * rainActive * fadeOut;
      }
    }
  }

  /**
   * 5. KARABEY'İN HARİTA AĞACI DEVİRME YETENEĞİ (Haritadaki Gerçek Çam Ağacını Kesip Yere Devirme)
   * - Bu yetenek karakterlere hasar vermez; haritadaki gerçek bir çam ağacını (Realistic_Pine_*)
   *   kesip devirir ve ağaç yerde devrilmiş halde kalır (daha sonra Defne tarafından düzeltilebilir).
   * - Evre 1 (0 .. chargeEnd = 1.65s): Karabey haritadaki ağaca döner, güç toplar ve yatay kılıç
   *   darbesini (slash_2) savurduğunda (1.15s .. 1.65s) kılıcından çıkan kızıl-altın kesim hilali
   *   ağacın gövdesine saplanarak gövdeyi keser; talaş ve odun kıymıkları saçılır.
   * - Evre 2 (chargeEnd .. impactOffset = 1.65s .. 2.38s): Haritadaki gerçek çam ağacı yerçekimi
   *   ivmesiyle (u^1.85) hızlanarak (~82°) yol kenarına devrilir; kökünde taze kesilmiş kütük kalır.
   * - Evre 3 (impactOffset .. totalDuration = 2.38s .. 3.70s ve sonrası): Ağaç yere çarpar, hafifçe
   *   sekip yerde kalıcı olarak yatık vaziyette kalır; çarpma anında gövde boyunca toz ve çam iğneleri yükselir.
   */
  private updateRealisticTreeFall(
    v: AbilityVisual,
    local: number,
    lt: number,
    caster: Character,
    chargeEnd: number,
    impactOffset: number,
    totalDuration: number,
  ) {
    v.fireCoreMesh.visible = false;
    v.fireCoronaMesh.visible = false;
    v.vortexMesh.visible = false;
    v.outerVortexMesh.visible = false;
    v.lightningLine.visible = false;
    v.arrowGroup.visible = false;

    const mapTree = v.ability.mapTreeId ? this.mapTrees.get(v.ability.mapTreeId) : undefined;
    const casterPos = caster.positionAt(lt, new THREE.Vector3());
    const treeBasePos = mapTree ? mapTree.worldPos : v.ability.impactPos;

    // Karabey'den harita ağacına doğru yatay yön vektörü
    const dirToTreeXZ = new THREE.Vector3(treeBasePos.x - casterPos.x, 0, treeBasePos.z - casterPos.z);
    const distToTree = Math.max(0.001, dirToTreeXZ.length());
    dirToTreeXZ.divideScalar(distToTree);

    // Ağacın devrilme yönü (yolun açık kısmına doğru)
    const fallDirXZ = v.ability.fallDirXZ
      ? v.ability.fallDirXZ.clone().normalize()
      : new THREE.Vector3(-dirToTreeXZ.x, 0, -dirToTreeXZ.z).normalize();
    const rightXZ = new THREE.Vector3(-fallDirXZ.z, 0, fallDirXZ.x);

    const treeScale = mapTree ? mapTree.origScale.x : 1.0;
    const stumpAppear = clamp((local - 1.18) / 0.25, 0, 1);

    // Kılıç kesiği kor parlaklığı: kılıç dalgası ağaca ulaştığında (1.35s .. 1.65s) zirve yapar, sonra yavaşça soğur
    let cutGlow = 0.0;
    if (local >= 1.32 && local < chargeEnd) {
      cutGlow = clamp((local - 1.32) / Math.max(0.01, chargeEnd - 1.32), 0, 1);
    } else if (local >= chargeEnd) {
      cutGlow = Math.max(0, 1.0 - (local - chargeEnd) * 0.85);
    }

    // Devrilme açısı (radyan):
    // Evre 1 sonunda (1.35s .. 1.65s) kesik açılınca hafifçe (0 -> 7°) bel verir,
    // Evre 2'de (1.65s .. 2.38s) yerçekimi ivmesiyle (u^1.85) hızlanarak 82° (1.43 rad) açıyla yere çarpar,
    // Evre 3'te (2.38s .. 3.70s) çarpma anında ağır gövde sekmesi (bounce) yapar ve sonrasında yerde kalıcı olarak yatar.
    let tiltAngle = 0.0;
    let trunkShudderX = 0.0;
    let trunkShudderZ = 0.0;
    const maxFallAngle = 1.43; // ~82 derece

    if (local < chargeEnd) {
      if (local > 1.32) {
        const cutU = clamp((local - 1.32) / Math.max(0.01, chargeEnd - 1.32), 0, 1);
        tiltAngle = cutU * cutU * 0.12;
        const shudder = Math.sin(local * 62.0) * 0.045 * Math.sin(cutU * Math.PI);
        trunkShudderX = shudder;
        trunkShudderZ = Math.cos(local * 48.0) * 0.035 * Math.sin(cutU * Math.PI);
      }
    } else if (local < impactOffset) {
      const u = clamp((local - chargeEnd) / Math.max(0.01, impactOffset - chargeEnd), 0, 1);
      const gravityCurve = Math.pow(u, 1.85);
      tiltAngle = 0.12 + gravityCurve * (maxFallAngle - 0.12);
    } else if (local <= totalDuration) {
      const impactDt = local - impactOffset;
      const bounce = Math.abs(Math.sin(impactDt * 9.5)) * Math.exp(-impactDt * 4.6) * 0.075;
      tiltAngle = maxFallAngle - bounce;
    } else {
      tiltAngle = maxFallAngle;
    }

    // 1) Haritadaki gerçek çam ağacını (Realistic_Pine_*) Karabey'e doğru devir ve Karabey'in yanına kadar yerde sürükle
    const slideTarget = v.ability.slideTargetPos ?? treeBasePos;
    const rawSlide = local <= 1.75 ? 0 : clamp((local - 1.75) / (3.20 - 1.75), 0, 1);
    const slideU = local > 3.20 ? 1.0 : 1 - Math.pow(1 - rawSlide, 2.35);
    const curTreeBase = new THREE.Vector3().lerpVectors(
      treeBasePos,
      slideTarget,
      slideU,
    );

    if (mapTree) {
      // Sağ el kuralına göre: Dünya +Y eksenini (0,1,0) doğrudan fallDirXZ (Karabey) yönüne yatıran eksen = U x F = (fallDirXZ.z, 0, -fallDirXZ.x)
      const worldFallAxis = new THREE.Vector3(fallDirXZ.z, 0, -fallDirXZ.x).normalize();
      const worldTiltQuat = new THREE.Quaternion().setFromAxisAngle(worldFallAxis, tiltAngle);
      mapTree.node.quaternion
        .copy(mapTree.parentWorldQuatInv)
        .multiply(worldTiltQuat)
        .multiply(mapTree.origWorldQuat);

      const cutLift = Math.sin(Math.min(1, tiltAngle / 0.5)) * 0.46 * (1 - slideU * 0.45);
      const cutSlide = Math.sin(tiltAngle) * 0.42 * (1 - slideU);
      // Sürüklenme sırasında zemin sürtünmesi titreşimi
      const dragRumble =
        rawSlide > 0 && rawSlide < 1
          ? Math.sin(local * 44.0) * 0.05 * (1 - rawSlide)
          : 0;
      const targetWorldPos = new THREE.Vector3(
        curTreeBase.x + fallDirXZ.x * cutSlide + trunkShudderX + rightXZ.x * dragRumble,
        curTreeBase.y + cutLift,
        curTreeBase.z + fallDirXZ.z * cutSlide + trunkShudderZ + rightXZ.z * dragRumble,
      );
      if (mapTree.node.parent) {
        mapTree.node.parent.worldToLocal(targetWorldPos);
      }
      mapTree.node.position.copy(targetWorldPos);
      v.treePivotGroup.visible = false;
    } else {
      v.treePivotGroup.visible = true;
      v.treePivotGroup.position.set(
        curTreeBase.x - treeBasePos.x + trunkShudderX,
        0.68,
        curTreeBase.z - treeBasePos.z + trunkShudderZ,
      );
      v.treePivotGroup.rotation.set(tiltAngle, 0, 0);
    }

    // 2) Kesilen ağacın kök noktasında kalan taze kesilmiş kütük (ağaç Karabey'in yanına sürüklense de kütük orijinal kök yerinde kalır)
    v.treeGroup.visible = stumpAppear > 0.01;
    v.treeGroup.position.copy(treeBasePos);
    v.treeGroup.rotation.set(0, Math.atan2(fallDirXZ.x, fallDirXZ.z), 0);
    v.treeStumpGroup.scale.set(treeScale * stumpAppear, stumpAppear, treeScale * stumpAppear);

    for (let m = 0; m < v.treeMats.length; m++) {
      v.treeMats[m].uniforms.uTime.value = local;
      v.treeMats[m].uniforms.uOpacity.value = 1.0;
      v.treeMats[m].uniforms.uCutGlow.value = cutGlow;
    }

    // Yetenek süresi tamamlandıktan sonra ağaç Karabey'in yanında yatık halde ve kütük kök yerinde kalır; duman, kıymık ve ışık efektleri kapanır
    if (local > totalDuration) {
      v.treeSlashMesh.visible = false;
      v.smokePoints.visible = false;
      v.detailPoints.visible = false;
      v.light.intensity = 0;
      return;
    }

    v.smokePoints.visible = true;
    v.detailPoints.visible = true;

    const cutWorldPos = new THREE.Vector3(treeBasePos.x, treeBasePos.y + 0.72, treeBasePos.z);
    const swordStartPos = new THREE.Vector3(
      casterPos.x + dirToTreeXZ.x * 0.85,
      casterPos.y + 1.05,
      casterPos.z + dirToTreeXZ.z * 0.85,
    );

    // 3) Kılıç Kesiği Enerji Hilali (1.12s .. 1.78s arasında Karabey'in kılıcından ağacın gövdesine uçar ve gövdeyi biçer)
    if (local >= 1.12 && local <= 1.78) {
      const flightU = clamp((local - 1.12) / 0.26, 0, 1);
      const slashFade =
        local < 1.20
          ? clamp((local - 1.12) / 0.08, 0, 1)
          : local > 1.58
            ? clamp((1.78 - local) / 0.20, 0, 1)
            : 1.0;
      v.treeSlashMesh.visible = true;
      v.treeSlashMesh.position.lerpVectors(swordStartPos, cutWorldPos, flightU);
      v.treeSlashMesh.rotation.set(0, Math.atan2(dirToTreeXZ.x, dirToTreeXZ.z), (local - 1.12) * 8.5);
      const sScale = (0.85 + flightU * 0.65) * treeScale;
      v.treeSlashMesh.scale.set(sScale, sScale, 1);
      v.treeMats[3].uniforms.uCutGlow.value = slashFade;
      v.treeMats[3].uniforms.uOpacity.value = slashFade;
    } else {
      v.treeSlashMesh.visible = false;
    }

    const fadeOut = local > totalDuration - 0.55 ? clamp((totalDuration - local) / 0.55, 0, 1) : 1.0;
    const fallMidPos = new THREE.Vector3(
      curTreeBase.x + fallDirXZ.x * 5.0,
      curTreeBase.y + 0.85,
      curTreeBase.z + fallDirXZ.z * 5.0,
    );

    // 4) Dinamik ışık: kesim anında kılıç dalgasında ve kütükte, devrilme ve sürüklenme anında gövde boyunca parlar
    if (local < chargeEnd) {
      v.light.position.copy(local < 1.35 ? v.treeSlashMesh.position : cutWorldPos);
      v.light.intensity = 2.0 + cutGlow * 7.5;
    } else {
      const impactU = clamp((local - chargeEnd) / Math.max(0.01, impactOffset - chargeEnd), 0, 1);
      v.light.position.lerpVectors(cutWorldPos, fallMidPos, impactU);
      v.light.intensity = 4.5 * fadeOut;
    }

    const sinTilt = Math.sin(tiltAngle);
    const cosTilt = Math.cos(tiltAngle);
    const trunkLength = 12.5 * treeScale;

    // 5) KATMAN A: Kılıç kesim talaş dumanı, devrilme hava akımı ve Karabey'in yanına sürüklenirken yükselen yoğun toprak tozu
    for (let i = 0; i < SMOKE_COUNT; i++) {
      const s0 = v.seeds[i * 4 + 0];
      const s1 = v.seeds[i * 4 + 1];
      const s2 = v.seeds[i * 4 + 2];
      const s3 = v.seeds[i * 4 + 3];

      if (local < chargeEnd) {
        const activeCenter = local < 1.32 ? swordStartPos : cutWorldPos;
        const cycle = (s0 + local * (1.2 + s1 * 0.8)) % 1;
        const angle = s2 * Math.PI * 2 + local * 2.5;
        const r = 0.25 + cycle * 0.65;
        v.smokePositions[i * 3 + 0] = activeCenter.x + Math.cos(angle) * r;
        v.smokePositions[i * 3 + 1] = activeCenter.y - 0.35 + s3 * 0.65 + cycle * 0.35;
        v.smokePositions[i * 3 + 2] = activeCenter.z + Math.sin(angle) * r;

        v.smokeColors[i * 3 + 0] = 0.44;
        v.smokeColors[i * 3 + 1] = 0.34;
        v.smokeColors[i * 3 + 2] = 0.24;
        v.smokeSizes[i] = 0.35 + cycle * 0.42;
        v.smokeAngles[i] = s3 * Math.PI * 2 + local * 1.5;
        v.smokeAlphas[i] = Math.sin(cycle * Math.PI) * (0.18 + cutGlow * 0.32);
      } else if (local < impactOffset) {
        // Harita ağacı devrilirken ve sürüklenmeye başlarken 12m'lik gövde boyunca oluşan hava akımı ve toz izi
        const trunkDist = 1.0 + s0 * trunkLength;
        const px = curTreeBase.x + fallDirXZ.x * (trunkDist * sinTilt);
        const py = curTreeBase.y + 0.68 + trunkDist * cosTilt;
        const pz = curTreeBase.z + fallDirXZ.z * (trunkDist * sinTilt);
        const spread = (s1 - 0.5) * 1.55;

        v.smokePositions[i * 3 + 0] = px + rightXZ.x * spread;
        v.smokePositions[i * 3 + 1] = py + (s2 - 0.3) * 0.55;
        v.smokePositions[i * 3 + 2] = pz + rightXZ.z * spread;

        v.smokeColors[i * 3 + 0] = 0.44;
        v.smokeColors[i * 3 + 1] = 0.36;
        v.smokeColors[i * 3 + 2] = 0.26;
        v.smokeSizes[i] = 0.62 + s3 * 0.60;
        v.smokeAngles[i] = s2 * Math.PI * 2 + local * 2.2;
        v.smokeAlphas[i] = 0.40;
      } else {
        // Ağaç yere çarpıp Karabey'in yanına kadar sürüklenirken gövde ve sürüklenme izi boyunca yayılan yoğun toz bulutu
        const dt = local - impactOffset;
        const u = clamp(dt / Math.max(0.01, totalDuration - impactOffset), 0, 1);
        const drag = 1 - Math.exp(-dt * 2.6);
        const alongTrunk = 0.8 + s0 * trunkLength;
        // Parçacıkların bir kısmı sürüklenen ağacın anlık konumunda, bir kısmı da kütükten Karabey'e uzanan sürüklenme izinde kalır
        const trailLerp = s2 < 0.55 ? slideU : slideU * (0.25 + 0.75 * s2);
        const trailOriginX = THREE.MathUtils.lerp(treeBasePos.x, slideTarget.x, trailLerp);
        const trailOriginZ = THREE.MathUtils.lerp(treeBasePos.z, slideTarget.z, trailLerp);
        const baseX = trailOriginX + fallDirXZ.x * alongTrunk;
        const baseZ = trailOriginZ + fallDirXZ.z * alongTrunk;
        const angle = s3 * Math.PI * 2;
        const rad = (0.40 + s1 * 2.10) * drag;

        v.smokePositions[i * 3 + 0] = baseX + Math.cos(angle) * rad;
        v.smokePositions[i * 3 + 1] = treeBasePos.y + 0.18 + s2 * 0.85 * drag + dt * 0.48;
        v.smokePositions[i * 3 + 2] = baseZ + Math.sin(angle) * rad;

        v.smokeColors[i * 3 + 0] = 0.48;
        v.smokeColors[i * 3 + 1] = 0.39;
        v.smokeColors[i * 3 + 2] = 0.28;
        v.smokeSizes[i] = 0.85 + u * 1.05 + s1 * 0.50;
        v.smokeAngles[i] = s3 * Math.PI * 2 + local * 1.4;
        v.smokeAlphas[i] = (1 - u * 0.82) * 0.62 * fadeOut;
      }
    }

    // 6) KATMAN B: Kılıç kesiğinden fırlayan odun kıymıkları ve sürüklenme sırasında saçılan çam iğneleri/dallar
    const groundY = treeBasePos.y + 0.05;
    for (let i = 0; i < DETAIL_COUNT; i++) {
      const s0 = v.seeds[i * 4 + 0];
      const s1 = v.seeds[i * 4 + 1];
      const s2 = v.seeds[i * 4 + 2];
      const s3 = v.seeds[i * 4 + 3];
      const isPineNeedle = s1 < 0.45;

      if (local < chargeEnd) {
        const chipActive = clamp((local - 1.25) / Math.max(0.01, chargeEnd - 1.25), 0, 1);
        const cycle = (s0 + local * (2.8 + s2 * 1.8)) % 1;
        const angle = s3 * Math.PI * 2;
        const speed = (0.30 + cycle * 1.35) * chipActive;

        v.detailPositions[i * 3 + 0] = cutWorldPos.x + Math.cos(angle) * speed;
        v.detailPositions[i * 3 + 1] = cutWorldPos.y + (s1 - 0.3) * 0.55 - cycle * cycle * 0.45;
        v.detailPositions[i * 3 + 2] = cutWorldPos.z + Math.sin(angle) * speed;

        if (s2 < 0.65) {
          v.detailColors[i * 3 + 0] = 0.82;
          v.detailColors[i * 3 + 1] = 0.58;
          v.detailColors[i * 3 + 2] = 0.32;
        } else {
          v.detailColors[i * 3 + 0] = 1.0;
          v.detailColors[i * 3 + 1] = 0.65;
          v.detailColors[i * 3 + 2] = 0.22;
        }
        v.detailSizes[i] = 0.09 + s0 * 0.08;
        v.detailAngles[i] = s3 * Math.PI * 2 + local * 8.0;
        v.detailAlphas[i] = Math.sin(cycle * Math.PI) * chipActive * 0.90;
      } else if (local < impactOffset) {
        const trunkDist = 1.2 + s0 * trunkLength;
        const px = curTreeBase.x + fallDirXZ.x * (trunkDist * sinTilt);
        const py = curTreeBase.y + 0.68 + trunkDist * cosTilt;
        const pz = curTreeBase.z + fallDirXZ.z * (trunkDist * sinTilt);
        const spread = (s2 - 0.5) * 1.95;

        v.detailPositions[i * 3 + 0] = px + rightXZ.x * spread;
        v.detailPositions[i * 3 + 1] = py + (s3 - 0.2) * 0.75;
        v.detailPositions[i * 3 + 2] = pz + rightXZ.z * spread;

        if (isPineNeedle) {
          v.detailColors[i * 3 + 0] = 0.16;
          v.detailColors[i * 3 + 1] = 0.42;
          v.detailColors[i * 3 + 2] = 0.15;
        } else {
          v.detailColors[i * 3 + 0] = 0.68;
          v.detailColors[i * 3 + 1] = 0.46;
          v.detailColors[i * 3 + 2] = 0.24;
        }
        v.detailSizes[i] = 0.10 + s0 * 0.08;
        v.detailAngles[i] = s3 * Math.PI * 2 + local * 9.0;
        v.detailAlphas[i] = 0.85;
      } else {
        const dt = local - impactOffset;
        const alongTrunk = 1.0 + s0 * trunkLength;
        const baseX = curTreeBase.x + fallDirXZ.x * alongTrunk;
        const baseZ = curTreeBase.z + fallDirXZ.z * alongTrunk;
        const angle = s1 * Math.PI * 2;
        const speed = 1.4 + s2 * 3.2;
        const drag = 1 - Math.exp(-dt * 2.2);
        const vy = 1.8 + s3 * 2.6;

        let py = treeBasePos.y + 0.35 + vy * drag * 0.65 - 4.6 * dt * dt;
        if (py < groundY) {
          py = groundY + Math.abs(py - groundY) * 0.30 * Math.exp(-dt * 3.0);
        }

        v.detailPositions[i * 3 + 0] = baseX + Math.cos(angle) * speed * drag * 0.65;
        v.detailPositions[i * 3 + 1] = py;
        v.detailPositions[i * 3 + 2] = baseZ + Math.sin(angle) * speed * drag * 0.65;

        if (isPineNeedle) {
          v.detailColors[i * 3 + 0] = 0.18;
          v.detailColors[i * 3 + 1] = 0.44;
          v.detailColors[i * 3 + 2] = 0.16;
        } else {
          v.detailColors[i * 3 + 0] = 0.72;
          v.detailColors[i * 3 + 1] = 0.48;
          v.detailColors[i * 3 + 2] = 0.25;
        }
        v.detailSizes[i] = 0.11 + s3 * 0.09;
        v.detailAngles[i] = s2 * Math.PI * 2 + local * 6.5;
        v.detailAlphas[i] = fadeOut * 0.88;
      }
    }
  }
}

