import * as THREE from 'three';
import type { OverlayDef, TransitionType } from '../schema';
import type { ActiveAbilityHUDInfo } from './abilities';
import { clamp } from './math';

// ---------------------------------------------------------------------------
// Remotion Tarzı Temel Animasyon İlkel Fonksiyonları (spring & interpolate)
// ---------------------------------------------------------------------------

export interface SpringConfig {
  damping?: number;
  mass?: number;
  stiffness?: number;
  overshootClamping?: boolean;
}

export interface SpringOptions {
  frame: number;
  fps: number;
  config?: SpringConfig;
  from?: number;
  to?: number;
  delay?: number;
  durationInFrames?: number;
}

/**
 * Remotion `spring()` fonksiyonunun deterministik harmonik osilatör çözümü.
 */
export function spring(opts: SpringOptions): number {
  const {
    frame,
    fps,
    config = {},
    from = 0,
    to = 1,
    delay = 0,
    durationInFrames,
  } = opts;

  const f = frame - delay;
  if (f <= 0) return from;

  const damping = config.damping ?? 10;
  const mass = Math.max(0.05, config.mass ?? 1);
  const stiffness = Math.max(1, config.stiffness ?? 100);
  const overshootClamping = config.overshootClamping ?? false;

  const timeScale = durationInFrames ? (fps * 0.6) / Math.max(1, durationInFrames) : 1;
  const t = (f / Math.max(1, fps)) * timeScale;

  const c = damping;
  const m = mass;
  const k = stiffness;

  const omega0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));

  let progress = 1;
  if (zeta < 1) {
    const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);
    const envelope = Math.exp(-zeta * omega0 * t);
    progress = 1 - envelope * (Math.cos(omegaD * t) + ((zeta * omega0) / omegaD) * Math.sin(omegaD * t));
  } else if (zeta === 1) {
    progress = 1 - (1 + omega0 * t) * Math.exp(-omega0 * t);
  } else {
    const s1 = -omega0 * (zeta - Math.sqrt(zeta * zeta - 1));
    const s2 = -omega0 * (zeta + Math.sqrt(zeta * zeta - 1));
    progress = 1 - (s2 * Math.exp(s1 * t) - s1 * Math.exp(s2 * t)) / (s2 - s1);
  }

  if (overshootClamping) {
    progress = clamp(progress, 0, 1);
  }

  return from + (to - from) * progress;
}

export interface InterpolateOptions {
  extrapolateLeft?: 'clamp' | 'extend';
  extrapolateRight?: 'clamp' | 'extend';
  easing?: (t: number) => number;
}

export function interpolate(
  input: number,
  inputRange: readonly number[],
  outputRange: readonly number[],
  options: InterpolateOptions = {},
): number {
  if (inputRange.length < 2 || inputRange.length !== outputRange.length) {
    return outputRange[0] ?? 0;
  }

  const {
    extrapolateLeft = 'clamp',
    extrapolateRight = 'clamp',
    easing,
  } = options;

  let idx = 0;
  for (let i = 0; i < inputRange.length - 1; i++) {
    if (input >= inputRange[i]) idx = i;
  }

  const inMin = inputRange[idx];
  const inMax = inputRange[idx + 1];
  const outMin = outputRange[idx];
  const outMax = outputRange[idx + 1];

  let t = inMax === inMin ? 1 : (input - inMin) / (inMax - inMin);

  if (t < 0 && extrapolateLeft === 'clamp') t = 0;
  if (t > 1 && extrapolateRight === 'clamp') t = 1;

  if (easing) {
    t = easing(clamp(t, 0, 1));
  }

  return outMin + t * (outMax - outMin);
}

// ---------------------------------------------------------------------------
// Çizgi Film (Cartoon) Vektör ve Tipografi Yardımcıları
// ---------------------------------------------------------------------------

export interface TransitionCue {
  time: number;
  type: TransitionType;
}

const CARTOON_INK = '#2b1608';
const CARTOON_FONT = '"Baloo 2", "Fredoka", "Comic Sans MS", "Trebuchet MS", cursive, sans-serif';

/**
 * Katmanların yazı tipini (Google Fonts, index.html) yüklenene kadar bekler. Beklenmezse ilk karelerdeki
 * başlıklar, yazı tipinin ne zaman indiğine göre yedek yazı tipiyle çizilebiliyordu: aynı senaryo farklı
 * çalıştırmalarda farklı kare veriyordu (dışa aktarımda da). Çevrimdışıyken en çok `timeoutMs` bekler.
 */
export async function loadOverlayFonts(timeoutMs = 5000): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const loads = ['700', '800'].map((w) => document.fonts.load(`${w} 32px "Baloo 2"`).catch(() => []));
  await Promise.race([Promise.all(loads), new Promise((res) => setTimeout(res, timeoutMs))]);
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * Organik/yamuk çizgi film tabelası veya kartı çizer (düz cetvel dikdörtgeni yerine hafif kavisli).
 */
function cartoonPlankPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  bow = 4,
) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.quadraticCurveTo(x + w * 0.5, y - bow, x + w - rad, y);
  ctx.quadraticCurveTo(x + w + bow * 0.4, y, x + w, y + rad);
  ctx.quadraticCurveTo(x + w + bow * 0.5, y + h * 0.5, x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.quadraticCurveTo(x + w * 0.5, y + h + bow, x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.quadraticCurveTo(x - bow * 0.5, y + h * 0.5, x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

/**
 * 3B derinlik gölgeli ve kalın mürekkep konturlu çizgi film yazısı çizer.
 */
function drawCartoonText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  opts: {
    fill: string | CanvasGradient;
    stroke?: string;
    strokeWidth: number;
    extrudeColor?: string;
    extrudeY?: number;
    extrudeX?: number;
    maxWidth?: number;
  },
) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.miterLimit = 2;

  const strokeColor = opts.stroke ?? CARTOON_INK;
  const ex = opts.extrudeX ?? 0;
  const ey = opts.extrudeY ?? opts.strokeWidth * 0.55;

  // 3B Kalın Çizgi Film Gölge Katmanı
  if (ey !== 0 || ex !== 0) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = opts.strokeWidth;
    if (opts.maxWidth) ctx.strokeText(text, x + ex, y + ey, opts.maxWidth);
    else ctx.strokeText(text, x + ex, y + ey);

    ctx.fillStyle = opts.extrudeColor ?? strokeColor;
    if (opts.maxWidth) ctx.fillText(text, x + ex, y + ey, opts.maxWidth);
    else ctx.fillText(text, x + ex, y + ey);
  }

  // Ana Kontur
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = opts.strokeWidth;
  if (opts.maxWidth) ctx.strokeText(text, x, y, opts.maxWidth);
  else ctx.strokeText(text, x, y);

  // Ana Dolgu
  ctx.fillStyle = opts.fill;
  if (opts.maxWidth) ctx.fillText(text, x, y, opts.maxWidth);
  else ctx.fillText(text, x, y);
}

/**
 * Sevimli çizgi film orman yaprağı çizer.
 */
function drawCartoonLeaf(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  angle: number,
  color = '#4ade80',
  darkColor = '#16a34a',
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(size * 0.4, -size * 0.55, size * 0.95, -size * 0.35, size * 1.15, 0);
  ctx.bezierCurveTo(size * 0.95, size * 0.35, size * 0.4, size * 0.55, 0, 0);
  ctx.closePath();

  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = Math.max(2, size * 0.14);
  ctx.strokeStyle = CARTOON_INK;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Yaprak orta damarı
  ctx.beginPath();
  ctx.moveTo(size * 0.15, 0);
  ctx.quadraticCurveTo(size * 0.55, -size * 0.05, size * 0.92, 0);
  ctx.lineWidth = Math.max(1.5, size * 0.09);
  ctx.strokeStyle = darkColor;
  ctx.lineCap = 'round';
  ctx.stroke();

  ctx.restore();
}

/**
 * Yuvarlak hatlı şişkin çizgi film yıldızı çizer.
 */
function drawPuffyStar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  outerR: number,
  angle: number,
  fill = '#fde047',
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  const points = 5;
  const innerR = outerR * 0.52;
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = (i * Math.PI) / points - Math.PI / 2;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(2, outerR * 0.28);
  ctx.strokeStyle = CARTOON_INK;
  ctx.stroke();
  ctx.fillStyle = fill;
  ctx.fill();

  ctx.restore();
}

// ---------------------------------------------------------------------------
// 1. Bölüm Açılış Başlığı (title_card) — Ahşap Orman Tabelası & Yapraklı Kurdele
// ---------------------------------------------------------------------------

function renderTitleCard(
  ctx: CanvasRenderingContext2D,
  ov: Extract<OverlayDef, { type: 'title_card' }>,
  localTime: number,
  fps: number,
  width: number,
  height: number,
  u: number,
) {
  const frame = localTime * fps;
  const totalFrames = ov.duration * fps;
  const exitStart = Math.max(0, totalFrames - fps * 0.65);

  // Squash-and-stretch yay fiziğiyle yukarıdan sallanarak iniş
  const dropSpring = spring({
    frame,
    fps,
    config: { damping: 9.5, stiffness: 130, mass: 0.9 },
  });
  const exitProgress = frame > exitStart
    ? interpolate(frame, [exitStart, totalFrames], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    : 0;

  const alpha = clamp(
    interpolate(frame, [0, fps * 0.18], [0, 1]) * (1 - exitProgress),
    0,
    1,
  );
  if (alpha <= 0.005) return;

  // Hafif sarkaç salınımı (ahşap tabela rüzgarda sallanır)
  const swingAngle = Math.sin(localTime * 2.8) * 0.022 * clamp(dropSpring, 0, 1);

  // Squash & Stretch ölçeklemesi
  const s = clamp(dropSpring * (1 - exitProgress * 0.95), 0, 1.25);
  const stretchY = s;
  const squashX = 1 + (1 - Math.min(1, s)) * 0.22;

  const cx = width * 0.5;
  const baseCy =
    ov.position === 'center'
      ? height * 0.45
      : ov.position === 'bottom-left'
        ? height * 0.78
        : height * 0.165;

  const dropOffsetY = (1 - dropSpring) * (-150 * u) - exitProgress * (120 * u);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, baseCy + dropOffsetY);
  ctx.rotate(swingAngle);
  ctx.scale(squashX, stretchY);

  const titleFont = `800 ${Math.round(46 * u)}px ${CARTOON_FONT}`;
  ctx.font = titleFont;
  const titleWidth = ctx.measureText(ov.title).width;
  const boardW = Math.max(520 * u, titleWidth + 140 * u);
  const boardH = (ov.subtitle ? 148 : 112) * u;

  // 1) Üstten sarkan çizgi film halatları (yalnızca üst konumdayken)
  if (ov.position === 'top') {
    const ropeX = boardW * 0.34;
    for (const rx of [-ropeX, ropeX]) {
      ctx.beginPath();
      ctx.moveTo(rx, -boardH * 0.5);
      ctx.lineTo(rx, -boardH * 0.5 - 160 * u);
      ctx.lineWidth = 11 * u;
      ctx.strokeStyle = CARTOON_INK;
      ctx.lineCap = 'round';
      ctx.stroke();

      ctx.lineWidth = 6 * u;
      ctx.strokeStyle = '#c28b48';
      ctx.stroke();
    }
  }

  // 2) Yanlardan fışkıran çizgi film orman yaprakları (yay fiziğiyle açılır)
  const leafScale = clamp(spring({ frame, fps, delay: 6, config: { damping: 8, stiffness: 160 } }), 0, 1.3);
  if (leafScale > 0.02) {
    drawCartoonLeaf(ctx, -boardW * 0.48, -boardH * 0.22, 42 * u * leafScale, -2.55, '#4ade80', '#15803d');
    drawCartoonLeaf(ctx, -boardW * 0.50, 8 * u, 34 * u * leafScale, -2.95, '#22c55e', '#14532d');
    drawCartoonLeaf(ctx, boardW * 0.48, -boardH * 0.22, 42 * u * leafScale, -0.58, '#4ade80', '#15803d');
    drawCartoonLeaf(ctx, boardW * 0.50, 8 * u, 34 * u * leafScale, -0.18, '#22c55e', '#14532d');
  }

  // 3) Kalın 3B Ahşap Tabela Alt Gölgesi
  cartoonPlankPath(ctx, -boardW / 2, -boardH / 2 + 10 * u, boardW, boardH, 28 * u, 6 * u);
  ctx.fillStyle = CARTOON_INK;
  ctx.fill();

  // 4) Ana Ahşap Çerçeve (Sıcak Sedir Ağacı Rengi + Çizgi Film Damarları)
  const woodGrad = ctx.createLinearGradient(0, -boardH / 2, 0, boardH / 2);
  woodGrad.addColorStop(0, '#c67d38');
  woodGrad.addColorStop(0.5, '#9c5a20');
  woodGrad.addColorStop(1, '#7c4314');

  cartoonPlankPath(ctx, -boardW / 2, -boardH / 2, boardW, boardH, 28 * u, 6 * u);
  ctx.fillStyle = woodGrad;
  ctx.fill();
  ctx.lineWidth = 6.5 * u;
  ctx.strokeStyle = CARTOON_INK;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // 5) İç Parşömen / Sıcak Krem Plaka
  const innerPad = 13 * u;
  const innerW = boardW - innerPad * 2;
  const innerH = boardH - innerPad * 2;
  const creamGrad = ctx.createLinearGradient(0, -innerH / 2, 0, innerH / 2);
  creamGrad.addColorStop(0, '#fffef5');
  creamGrad.addColorStop(1, '#fef0c7');

  cartoonPlankPath(ctx, -innerW / 2, -innerH / 2, innerW, innerH, 20 * u, 4 * u);
  ctx.fillStyle = creamGrad;
  ctx.fill();
  ctx.lineWidth = 4 * u;
  ctx.strokeStyle = '#65350f';
  ctx.stroke();

  // Köşe ahşap çivileri / perçinleri
  const nailOffX = innerW * 0.455;
  const nailOffY = innerH * 0.36;
  for (const [nx, ny] of [
    [-nailOffX, -nailOffY],
    [nailOffX, -nailOffY],
    [-nailOffX, nailOffY],
    [nailOffX, nailOffY],
  ]) {
    ctx.beginPath();
    ctx.arc(nx, ny, 5.5 * u, 0, Math.PI * 2);
    ctx.fillStyle = '#fbbf24';
    ctx.fill();
    ctx.lineWidth = 2.5 * u;
    ctx.strokeStyle = CARTOON_INK;
    ctx.stroke();
  }

  // 6) Üst Çizgi Film Kurdele Şeridi (Badge: "ORMANIN BEKÇİLERİ")
  if (ov.badge) {
    const badgeSpring = spring({
      frame,
      fps,
      delay: 4,
      config: { damping: 8.5, stiffness: 165, mass: 0.8 },
    });
    const bs = clamp(badgeSpring, 0, 1.25);
    ctx.save();
    ctx.translate(0, -boardH * 0.5 - 2 * u);
    ctx.scale(bs, bs);

    ctx.font = `800 ${Math.round(18 * u)}px ${CARTOON_FONT}`;
    const bw = ctx.measureText(ov.badge).width + 64 * u;
    const bh = 36 * u;

    // Kurdele kulakçıkları (sol ve sağ kıvrımlar)
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      const rx = dir * (bw * 0.46);
      ctx.moveTo(rx, -bh * 0.25);
      ctx.lineTo(rx + dir * 24 * u, -bh * 0.42);
      ctx.lineTo(rx + dir * 16 * u, bh * 0.05);
      ctx.lineTo(rx + dir * 26 * u, bh * 0.45);
      ctx.lineTo(rx, bh * 0.35);
      ctx.closePath();
      ctx.fillStyle = '#15803d';
      ctx.fill();
      ctx.lineWidth = 4 * u;
      ctx.strokeStyle = CARTOON_INK;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    // Ana kurdele gövdesi
    roundRectPath(ctx, -bw / 2, -bh / 2, bw, bh, bh / 2);
    const ribGrad = ctx.createLinearGradient(0, -bh / 2, 0, bh / 2);
    ribGrad.addColorStop(0, '#4ade80');
    ribGrad.addColorStop(1, '#16a34a');
    ctx.fillStyle = ribGrad;
    ctx.fill();
    ctx.lineWidth = 4.5 * u;
    ctx.strokeStyle = CARTOON_INK;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    drawCartoonText(ctx, ov.badge, 0, 1 * u, {
      fill: '#fffbeb',
      stroke: CARTOON_INK,
      strokeWidth: 4.5 * u,
      extrudeY: 2.5 * u,
    });

    ctx.restore();
  }

  // 7) Ana Başlık ("BÖLÜM 1: İLK DEVRİYE") — Sıcak Turuncu/Altın 3B Çizgi Film Harfleri
  ctx.font = titleFont;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const titleY = ov.subtitle ? -12 * u : 4 * u;

  const textGrad = ctx.createLinearGradient(0, titleY - 22 * u, 0, titleY + 22 * u);
  textGrad.addColorStop(0, '#fde047');
  textGrad.addColorStop(0.55, '#f59e0b');
  textGrad.addColorStop(1, '#ea580c');

  drawCartoonText(ctx, ov.title, 0, titleY, {
    fill: textGrad,
    stroke: CARTOON_INK,
    strokeWidth: 8.5 * u,
    extrudeColor: CARTOON_INK,
    extrudeY: 5.5 * u,
  });

  // 8) Alt Başlık + İki Yanda Parlayan Şişkin Yıldızlar
  if (ov.subtitle) {
    const subSpring = spring({
      frame,
      fps,
      delay: 9,
      config: { damping: 10, stiffness: 140 },
    });
    const subScale = clamp(subSpring, 0, 1.15);
    const subY = boardH * 0.27;

    ctx.save();
    ctx.translate(0, subY);
    ctx.scale(subScale, subScale);

    ctx.font = `700 ${Math.round(21 * u)}px ${CARTOON_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const subW = ctx.measureText(ov.subtitle).width;

    // Alt başlık şeridi
    const pillW = subW + 58 * u;
    const pillH = 30 * u;
    roundRectPath(ctx, -pillW / 2, -pillH / 2, pillW, pillH, pillH / 2);
    ctx.fillStyle = '#fde68a';
    ctx.fill();
    ctx.lineWidth = 3 * u;
    ctx.strokeStyle = '#78350f';
    ctx.stroke();

    ctx.fillStyle = '#451a03';
    ctx.fillText(ov.subtitle, 0, 1 * u);

    // İki yanda dönen sevimli çizgi film yıldızları
    drawPuffyStar(ctx, -pillW * 0.5 - 16 * u, 0, 12 * u, localTime * 2.2, '#facc15');
    drawPuffyStar(ctx, pillW * 0.5 + 16 * u, 0, 12 * u, -localTime * 2.2, '#facc15');

    ctx.restore();
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// 2. Karakter Tanıtım Kartı (lower_third) — Neşeli Çizgi Film Bulut/Etiket Kartı
// ---------------------------------------------------------------------------

function renderLowerThird(
  ctx: CanvasRenderingContext2D,
  ov: Extract<OverlayDef, { type: 'lower_third' }>,
  localTime: number,
  fps: number,
  width: number,
  height: number,
  u: number,
) {
  const frame = localTime * fps;
  const totalFrames = ov.duration * fps;
  const exitStart = Math.max(0, totalFrames - fps * 0.5);

  const popIn = spring({
    frame,
    fps,
    config: { damping: 9.2, stiffness: 145, mass: 0.82 },
  });
  const exitProgress = frame > exitStart
    ? interpolate(frame, [exitStart, totalFrames], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    : 0;

  const s = clamp(popIn * (1 - exitProgress), 0, 1.25);
  if (s <= 0.02) return;

  const isRight = ov.align === 'right';
  const cardW = 460 * u;
  const cardH = (ov.tag ? 126 : 100) * u;
  const marginX = 68 * u;
  const baseY = height - cardH - 58 * u;
  const baseX = isRight ? width - cardW - marginX : marginX;

  const cx = baseX + cardW * 0.5;
  const cy = baseY + cardH * 0.5;

  // Squash & Stretch + hafif neşeli eğim
  const tilt = (isRight ? -0.028 : 0.028) + Math.sin(localTime * 3.5) * 0.012;
  const squashX = s * (1 + (1 - Math.min(1, s)) * 0.18);
  const stretchY = s;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tilt);
  ctx.scale(squashX, stretchY);
  ctx.translate(-cardW * 0.5, -cardH * 0.5);

  // 1) Arkadaki Renkli Çizgi Film Gölge Plakası (Offset Sticker)
  ctx.save();
  ctx.translate(isRight ? -10 * u : 10 * u, 10 * u);
  cartoonPlankPath(ctx, 0, 0, cardW, cardH, 28 * u, 5 * u);
  ctx.fillStyle = ov.accent;
  ctx.fill();
  ctx.lineWidth = 6 * u;
  ctx.strokeStyle = CARTOON_INK;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();

  // 2) Ana Sıcak Krem Çizgi Film Kart Gövdesi
  cartoonPlankPath(ctx, 0, 0, cardW, cardH, 28 * u, 5 * u);
  const creamGrad = ctx.createLinearGradient(0, 0, 0, cardH);
  creamGrad.addColorStop(0, '#fffef7');
  creamGrad.addColorStop(1, '#fef3c7');
  ctx.fillStyle = creamGrad;
  ctx.fill();
  ctx.lineWidth = 6 * u;
  ctx.strokeStyle = CARTOON_INK;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Köşelerden çıkan sevimli yaprak ve yıldız süsleri
  const decoX = isRight ? 14 * u : cardW - 14 * u;
  drawCartoonLeaf(ctx, decoX, 10 * u, 28 * u, isRight ? -2.4 : -0.7, '#4ade80', '#15803d');
  drawPuffyStar(ctx, decoX, cardH - 14 * u, 13 * u, localTime * 2.5, '#facc15');

  // 3) Karakter Çizgi Film Madalyon Rozeti (Sol veya Sağda Büyük Yuvarlak Sticker)
  const badgeR = 44 * u;
  const badgeX = isRight ? cardW - 52 * u : 52 * u;
  const badgeY = cardH * 0.5;

  ctx.save();
  ctx.translate(badgeX, badgeY);
  const bScale = clamp(spring({ frame, fps, delay: 4, config: { damping: 8, stiffness: 170 } }), 0, 1.3);
  ctx.scale(bScale, bScale);

  // Tırtıklı çizgi film rozet dış çerçevesi
  const scallops = 14;
  ctx.beginPath();
  for (let i = 0; i < scallops * 2; i++) {
    const r = i % 2 === 0 ? badgeR : badgeR * 0.88;
    const a = (i * Math.PI) / scallops + localTime * 0.8;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = ov.accent;
  ctx.fill();
  ctx.lineWidth = 5 * u;
  ctx.strokeStyle = CARTOON_INK;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // İç krem daire ve yıldız/yaprak amblemi
  ctx.beginPath();
  ctx.arc(0, 0, badgeR * 0.64, 0, Math.PI * 2);
  ctx.fillStyle = '#fffbeb';
  ctx.fill();
  ctx.lineWidth = 3.5 * u;
  ctx.strokeStyle = CARTOON_INK;
  ctx.stroke();

  drawPuffyStar(ctx, 0, 0, badgeR * 0.42, -localTime * 1.8, '#fde047');
  ctx.restore();

  // 4) Karakter İsmi, Unvanı ve Renkli Etiket Hapı
  const textX = isRight ? 28 * u : 112 * u;
  const textMaxW = cardW - 140 * u;

  // Karakter İsmi (3B Çizgi Film Harfleri)
  ctx.font = `800 ${Math.round(38 * u)}px ${CARTOON_FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  drawCartoonText(ctx, ov.name, textX, 10 * u, {
    fill: ov.accent,
    stroke: CARTOON_INK,
    strokeWidth: 7 * u,
    extrudeColor: CARTOON_INK,
    extrudeY: 4 * u,
    maxWidth: textMaxW,
  });

  // Karakter Rolü
  if (ov.role) {
    ctx.font = `700 ${Math.round(19 * u)}px ${CARTOON_FONT}`;
    ctx.fillStyle = '#451a03';
    ctx.fillText(ov.role, textX, 54 * u, textMaxW);
  }

  // Çizgi Film Etiket Kurdelesi (Teknik bar yerine neşeli çıkartma şeridi)
  if (ov.tag) {
    const tagSpring = clamp(spring({ frame, fps, delay: 7, config: { damping: 9, stiffness: 150 } }), 0, 1.2);
    ctx.save();
    const tagY = 82 * u;
    ctx.translate(textX, tagY);
    ctx.scale(tagSpring, tagSpring);

    ctx.font = `800 ${Math.round(14.5 * u)}px ${CARTOON_FONT}`;
    const tw = Math.min(textMaxW, ctx.measureText(ov.tag).width + 28 * u);
    const th = 28 * u;

    roundRectPath(ctx, 0, 0, tw, th, th / 2);
    ctx.fillStyle = ov.accent;
    ctx.fill();
    ctx.lineWidth = 3.5 * u;
    ctx.strokeStyle = CARTOON_INK;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    drawCartoonText(ctx, ov.tag, 14 * u, th * 0.52, {
      fill: '#fffbeb',
      stroke: CARTOON_INK,
      strokeWidth: 3.5 * u,
      extrudeY: 1.5 * u,
      maxWidth: tw - 24 * u,
    });
    ctx.restore();
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// 3. Tam Ekran 2B Ara Sahne Kartı (interstitial)
// ---------------------------------------------------------------------------

function renderInterstitial(
  ctx: CanvasRenderingContext2D,
  ov: Extract<OverlayDef, { type: 'interstitial' }>,
  localTime: number,
  fps: number,
  width: number,
  height: number,
  u: number,
) {
  const frame = localTime * fps;
  const totalFrames = ov.duration * fps;
  const enterAlpha = interpolate(frame, [0, fps * 0.3], [0, 1]);
  const exitAlpha = interpolate(frame, [totalFrames - fps * 0.35, totalFrames], [1, 0]);
  const alpha = clamp(enterAlpha * exitAlpha, 0, 1);
  if (alpha <= 0.005) return;

  ctx.save();
  ctx.globalAlpha = alpha;

  const bg = ctx.createRadialGradient(width * 0.5, height * 0.5, 40 * u, width * 0.5, height * 0.5, width * 0.75);
  bg.addColorStop(0, '#fef08a');
  bg.addColorStop(0.55, '#4ade80');
  bg.addColorStop(1, '#15803d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  renderTitleCard(
    ctx,
    {
      type: 'title_card',
      at: ov.at,
      duration: ov.duration,
      badge: ov.badge,
      title: ov.title,
      subtitle: ov.subtitle,
      accent: ov.accent,
      position: 'center',
    },
    localTime,
    fps,
    width,
    height,
    u,
  );

  ctx.restore();
}

// ---------------------------------------------------------------------------
// 5. Çizgi Film Kamera & Sahne Geçiş Efektleri (iris, stripes, flash)
// ---------------------------------------------------------------------------

function renderTransitionCue(
  ctx: CanvasRenderingContext2D,
  cue: TransitionCue,
  filmTime: number,
  width: number,
  height: number,
  u: number,
): boolean {
  if (cue.type === 'cut' || cue.type === 'fade') return false;

  if (cue.type === 'iris') {
    const halfDur = 0.58;
    const dt = filmTime - cue.time;
    if (Math.abs(dt) >= halfDur) return false;

    const norm = Math.abs(dt) / halfDur;
    const ease = norm * norm * (3 - 2 * norm);
    const maxR = Math.hypot(width, height) * 0.56;
    const radius = Math.max(0, maxR * ease);

    const cx = width * 0.5;
    const cy = height * 0.5;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.arc(cx, cy, radius, 0, Math.PI * 2, true);
    ctx.fillStyle = '#1f1208';
    ctx.fill('evenodd');

    if (radius > 6 * u) {
      // Çizgi film çift renkli kalın iris halkası + üzerinde dönen yıldızlar
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 6 * u, 0, Math.PI * 2);
      ctx.lineWidth = 14 * u;
      ctx.strokeStyle = CARTOON_INK;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, radius + 4 * u, 0, Math.PI * 2);
      ctx.lineWidth = 8 * u;
      ctx.strokeStyle = '#facc15';
      ctx.stroke();

      const starCount = 8;
      for (let i = 0; i < starCount; i++) {
        const ang = (i * Math.PI * 2) / starCount + filmTime * 2.5;
        const sx = cx + Math.cos(ang) * (radius + 10 * u);
        const sy = cy + Math.sin(ang) * (radius + 10 * u);
        drawPuffyStar(ctx, sx, sy, 12 * u, ang, i % 2 === 0 ? '#fde047' : '#4ade80');
      }
    }
    ctx.restore();
    return true;
  }

  if (cue.type === 'stripes') {
    // Çizgi film kabarık bulut/yaprak dalgası geçişi (sert kurumsal şeritler yerine dalgalı çizgi film şeritleri)
    const halfDur = 0.50;
    const dt = filmTime - cue.time;
    if (Math.abs(dt) >= halfDur) return false;

    const p = (dt + halfDur) / (2 * halfDur);
    const colors = ['#4ade80', '#facc15', '#fb923c', '#fffbeb'];
    const bandCount = colors.length;
    const bandH = height / bandCount;
    const pad = 160 * u;

    ctx.save();
    for (let i = 0; i < bandCount; i++) {
      const stagger = i * 0.05;
      const localP = clamp((p - stagger) / (1 - (bandCount - 1) * 0.05), 0, 1);

      let startX = 0;
      let endX = 0;
      if (localP < 0.5) {
        const enter = localP * 2;
        const eased = 1 - Math.pow(1 - enter, 3);
        startX = -pad;
        endX = -pad + (width + pad * 2) * eased;
      } else {
        const exit = (localP - 0.5) * 2;
        const eased = Math.pow(exit, 3);
        startX = -pad + (width + pad * 2) * eased;
        endX = width + pad;
      }

      if (endX > startX + 4) {
        const y0 = i * bandH - 8 * u;
        const y1 = y0 + bandH + 16 * u;
        const midY = (y0 + y1) * 0.5;
        const bulge = 55 * u;

        ctx.beginPath();
        ctx.moveTo(startX, y0);
        ctx.lineTo(endX, y0);
        ctx.quadraticCurveTo(endX + bulge, midY, endX, y1);
        ctx.lineTo(startX, y1);
        ctx.quadraticCurveTo(startX - bulge, midY, startX, y0);
        ctx.closePath();

        ctx.fillStyle = colors[i];
        ctx.fill();
        ctx.lineWidth = 7 * u;
        ctx.strokeStyle = CARTOON_INK;
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
    }
    ctx.restore();
    return true;
  }

  if (cue.type === 'flash') {
    const halfDur = 0.28;
    const dt = filmTime - cue.time;
    if (Math.abs(dt) >= halfDur) return false;

    const alpha = Math.pow(1 - Math.abs(dt) / halfDur, 2);
    ctx.save();
    ctx.fillStyle = `rgba(255, 251, 235, ${alpha.toFixed(3)})`;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Ana Motion Graphics Çizici
// ---------------------------------------------------------------------------

export function renderMotionGraphicsLayer(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  fps: number,
  filmTime: number,
  sceneLocalTime: number,
  overlays: readonly OverlayDef[],
  transitions: readonly TransitionCue[],
  _activeAbilities: readonly ActiveAbilityHUDInfo[] = [],
  _camera?: THREE.Camera,
): boolean {
  const activeOverlays = overlays.filter(
    (ov) => ov.type !== 'comic_pop' && sceneLocalTime >= ov.at && sceneLocalTime <= ov.at + ov.duration,
  );
  const activeTransitions = transitions.filter(
    (tr) => tr.type !== 'cut' && tr.type !== 'fade' && Math.abs(filmTime - tr.time) < 0.6,
  );

  if (activeOverlays.length === 0 && activeTransitions.length === 0) {
    return false;
  }

  const u = Math.min(width, height) / 1080;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, width, height);

  let drewAnything = false;

  for (const ov of activeOverlays) {
    const localTime = sceneLocalTime - ov.at;
    if (ov.type === 'interstitial') {
      renderInterstitial(ctx, ov, localTime, fps, width, height, u);
      drewAnything = true;
    } else if (ov.type === 'title_card') {
      renderTitleCard(ctx, ov, localTime, fps, width, height, u);
      drewAnything = true;
    } else if (ov.type === 'lower_third') {
      renderLowerThird(ctx, ov, localTime, fps, width, height, u);
      drewAnything = true;
    }
  }

  for (const cue of activeTransitions) {
    if (renderTransitionCue(ctx, cue, filmTime, width, height, u)) {
      drewAnything = true;
    }
  }

  return drewAnything;
}

