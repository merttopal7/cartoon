// ============================================================================
// PROSEDÜREL GLSL SHADER KÜTÜPHANESİ (FBM GÜRÜLTÜ, BLACKBODY ALEV, HACİMSEL DUMAN)
// ============================================================================

export const NOISE_GLSL = /* glsl */ `
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

export const PARTICLE_VERTEX_SHADER = /* glsl */ `
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
export const VOLUMETRIC_SMOKE_FRAGMENT = /* glsl */ `
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
export const VOLUMETRIC_DETAIL_FRAGMENT = /* glsl */ `
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
export const FIRE_CORE_VERTEX = /* glsl */ `
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

export const FIRE_CORE_FRAGMENT = /* glsl */ `
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
export const ARROW_VERTEX = /* glsl */ `
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

export const ARROW_FRAGMENT = /* glsl */ `
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
export const VORTEX_VERTEX = /* glsl */ `
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

export const VORTEX_FRAGMENT = /* glsl */ `
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
export const TREE_FALL_VERTEX = /* glsl */ `
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

export const TREE_FALL_FRAGMENT = /* glsl */ `
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

/**
 * Meşe'nin dalgası (çizgi film suyu): tabanda koyu deniz mavisi, tepeye doğru açık turkuaz; boyunca akan parlak
 * şeritler, iki kademeli (toon) güneş ışığı, kenarlarda fresnel parlaması, dudakta köpük (uFoamLo..uFoamHi) ve
 * dudağın altındaki içbükey yüzde gölge. uv.x yan boyunca (uçlarda saydamlaşır), uv.y kesit boyunca (0 arka taban →
 * 1 ön taban).
 */
export const WAVE_VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vViewW;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vViewW = cameraPosition - wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const WAVE_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform float uFoamLo;
uniform float uFoamHi;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vViewW;

${NOISE_GLSL}

void main() {
  if (uOpacity <= 0.003) discard;
  vec3 n = normalize(vNormalW);
  vec3 vdir = normalize(vViewW);
  if (dot(n, vdir) < 0.0) n = -n;
  float v = vUv.y;
  float fres = pow(1.0 - clamp(dot(n, vdir), 0.0, 1.0), 2.2);

  vec3 deep = vec3(0.02, 0.22, 0.46);
  vec3 mid = vec3(0.07, 0.48, 0.78);
  vec3 light = vec3(0.58, 0.90, 0.98);
  vec3 col = mix(deep, mid, smoothstep(0.0, uFoamLo, v));
  // Dudağın altındaki içbükey yüz: tüpün içi, gölgede
  float inner = smoothstep(uFoamHi, uFoamHi + 0.1, v);
  col = mix(col, deep * 0.85, inner);

  // Yay boyunca akan su: gürültü şeritleri
  float flow = fbm2D(vec2(vUv.x * 16.0 - uTime * 1.7, v * 4.5 - uTime * 0.9));
  col = mix(col, light, smoothstep(0.60, 0.66, flow) * 0.55);
  // Yüzeyden yukarı akan ince çizgiler (suyun tırmanışı)
  float streak = smoothstep(0.55, 0.62, noise2D(vec2(vUv.x * 70.0, v * 3.0 - uTime * 1.4)));
  col = mix(col, light, streak * 0.25 * smoothstep(0.1, 0.6, v));

  // İki kademeli güneş ışığı (toon)
  float diff = dot(n, normalize(vec3(0.35, 0.85, 0.25))) * 0.5 + 0.5;
  col *= 0.78 + 0.32 * step(0.55, diff);
  col += light * fres * 0.4;

  // Köpük: kıvrık tepe ve dalgalı köpük sınırı
  float edge = uFoamLo - 0.08 * fbm2D(vec2(vUv.x * 24.0 + uTime * 0.8, uTime * 0.4));
  float foam = smoothstep(edge, edge + 0.035, v) * (1.0 - smoothstep(uFoamHi, uFoamHi + 0.04, v));
  float flecks = step(0.74, noise2D(vec2(vUv.x * 60.0 - uTime * 2.0, v * 22.0))) * smoothstep(uFoamLo - 0.25, uFoamLo, v) * (1.0 - inner);
  col = mix(col, vec3(0.95, 0.99, 1.0), max(foam, flecks * 0.8));

  float a = 0.8 + 0.18 * fres + 0.3 * foam;
  // Uçlar ve taban yumuşakça erir
  a *= smoothstep(0.0, 0.07, vUv.x) * (1.0 - smoothstep(0.93, 1.0, vUv.x)) * smoothstep(0.0, 0.06, v);
  a = max(a, inner * 0.9 * smoothstep(0.0, 0.07, vUv.x) * (1.0 - smoothstep(0.93, 1.0, vUv.x)));
  a *= uOpacity;
  if (a <= 0.004) discard;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}
`;

/** Meşe'nin ayağındaki su halkası: dışa yayılan halkalar, köpüklü kenar. Disk ölçekle büyür. */
export const PUDDLE_VERTEX = /* glsl */ `
varying vec2 vXY;
void main() {
  vXY = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const PUDDLE_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
varying vec2 vXY;

${NOISE_GLSL}

void main() {
  float r = length(vXY);
  if (r > 1.0 || uOpacity <= 0.003) discard;
  float ripple = sin(r * 26.0 - uTime * 6.5) * 0.5 + 0.5;
  float wobble = 0.05 * (noise2D(vXY * 5.0 + uTime * 0.6) - 0.5);
  float rim = smoothstep(0.84 + wobble, 0.93 + wobble, r) * (1.0 - smoothstep(0.95, 1.0, r));
  vec3 col = mix(vec3(0.08, 0.42, 0.68), vec3(0.55, 0.88, 0.98), ripple * 0.2);
  col = mix(col, vec3(0.95, 0.99, 1.0), rim);
  float a = (0.3 + 0.08 * ripple + 0.55 * rim) * (1.0 - smoothstep(0.95, 1.0, r)) * uOpacity;
  if (a <= 0.004) discard;
  gl_FragColor = vec4(col, a);
}
`;
