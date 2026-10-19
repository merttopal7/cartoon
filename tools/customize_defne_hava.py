"""
Defne (Jackie / Ch29) kıyafetlerini HAVA elementine göre yeniden boyar.

Girdi : public/models/characters/Jackie/Ch29_1001_Diffuse.jpg (orijinal, değiştirilmez)
        tools/data/jackie_uv_faces.json  (Blender'dan alınan yüz başına UV + 3B konum)
Çıktı : public/models/characters/Jackie/Ch29_1001_Diffuse_hava.jpg

Palet (rüzgâr / gökyüzü / bulut):
  - Pantolon   : lavanta  -> pudra gök mavisi (hafif beyaz rüzgâr çizgileriyle)
  - Kollar     : somon    -> açık nane-aqua; koyu manşetler -> deniz camı turkuazı
  - Crop top   : beyaz kalır; pembe biyeler -> turkuaz, rozetler -> rüzgâr girdabı amblemi
  - Çoraplar   : pembe    -> bulut beyazı (turkuaz bant korunur)
  - Ayakkabı   : sarı     -> bulut beyazı, pembe biye -> turkuaz (açık mavi burun korunur)
  - Saç (pembe + periwinkle ön perçem) kimlik rengi olduğu için korunur.

Kullanım: python tools/customize_defne_hava.py
"""
import json
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEX_DIR = os.path.join(ROOT, "public", "models", "characters", "Jackie")
SRC = os.path.join(TEX_DIR, "Ch29_1001_Diffuse.jpg")
OUT = os.path.join(TEX_DIR, "Ch29_1001_Diffuse_hava.jpg")
FACES = os.path.join(ROOT, "tools", "data", "jackie_uv_faces.json")

# Hava paleti (sRGB)
SKY = np.array([150.0, 198.0, 232.0])       # pudra gök mavisi (pantolon)
MINT = np.array([178.0, 230.0, 226.0])      # açık nane-aqua (kollar)
TEAL = np.array([38.0, 166.0, 160.0])       # turkuaz vurgu (#26a6a0)
CLOUD = np.array([238.0, 245.0, 250.0])     # bulut beyazı


def part_masks(size):
    """Yüzleri 3B konumlarına göre gövde parçalarına ayırıp UV uzayında maskeler."""
    faces = json.load(open(FACES))
    names = ["arms", "torso", "legs", "feet", "head"]
    imgs = {n: Image.new("L", (size, size), 0) for n in names}
    draws = {n: ImageDraw.Draw(imgs[n]) for n in names}
    for mat, z, x, _y, uvs in faces:
        if mat != 0:  # gözlük camı materyali
            continue
        if z > 1.40 and abs(x) < 0.2:
            part = "head"
        elif z > 1.05 and abs(x) >= 0.2:
            part = "arms"
        elif z > 0.98:
            part = "torso"
        elif z > 0.10:
            part = "legs"
        else:
            part = "feet"
        pts = [(u * size, (1.0 - v) * size) for u, v in uvs]
        draws[part].polygon(pts, fill=255)
    # Ada kenarlarındaki taşma piksellerini (bleed) de kapsamak için biraz genişlet
    return {n: np.array(im.filter(ImageFilter.MaxFilter(31))) > 0 for n, im in imgs.items()}


def hsv(arr):
    r, g, b = arr[..., 0] / 255.0, arr[..., 1] / 255.0, arr[..., 2] / 255.0
    mx = np.max(arr, axis=-1) / 255.0
    mn = np.min(arr, axis=-1) / 255.0
    d = mx - mn + 1e-6
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60.0
    s = np.where(mx > 0, (mx - mn) / (mx + 1e-6), 0)
    return h, s, mx


def lum(arr):
    return arr[..., 0] * 0.299 + arr[..., 1] * 0.587 + arr[..., 2] * 0.114


def recolor(arr, mask, target, ref=None, keep=0.10):
    """Maskelenen pikselleri hedef renge çevirir; kumaş gölgesi/dokusu parlaklık oranıyla korunur."""
    if not mask.any():
        return
    L = lum(arr)
    if ref is None:
        ref = float(np.median(L[mask]))
    ratio = np.clip(L[mask] / max(ref, 1.0), 0.0, 1.6)[:, None]
    new = np.clip(target[None, :] * ratio, 0, 255)
    # Çok parlak bölgelerde beyaza doğru yumuşak geçiş (aşırı doygun parlama olmasın)
    over = np.clip(ratio - 1.0, 0, 0.6) / 0.6
    new = new * (1 - over * 0.5) + 255.0 * over * 0.5
    arr[mask] = new * (1 - keep) + arr[mask] * keep


def wind_streaks(size, seed=7):
    """Pantolon için hafif, akışkan rüzgâr çizgileri (0..1 yoğunluk)."""
    rng = np.random.default_rng(seed)
    img = Image.new("L", (size, size), 0)
    dr = ImageDraw.Draw(img)
    for _ in range(46):
        x0 = rng.uniform(-200, size)
        y0 = rng.uniform(0, size)
        length = rng.uniform(260, 620)
        amp = rng.uniform(4, 11)
        freq = rng.uniform(0.003, 0.006)
        ang = math.radians(rng.uniform(-38, -22))
        w = int(rng.integers(3, 7))
        pts = []
        for t in np.linspace(0, length, 60):
            px = t
            py = amp * math.sin(t * freq * 2 * math.pi)
            pts.append((x0 + px * math.cos(ang) - py * math.sin(ang), y0 + px * math.sin(ang) + py * math.cos(ang)))
        dr.line(pts, fill=int(rng.uniform(150, 255)), width=w, joint="curve")
        # Uçta küçük kıvrım (girdap kuyruğu)
        ex, ey = pts[-1]
        r = rng.uniform(12, 22)
        dr.arc([ex - r, ey - 2 * r, ex + r, ey], start=90, end=360, fill=200, width=max(2, w - 1))
    img = img.filter(ImageFilter.GaussianBlur(2.2))
    return np.array(img, dtype=np.float32) / 255.0


def draw_swirl_emblem(img, cx, cy, r, ring=TEAL, bg=(236, 247, 250)):
    """Rüzgâr girdabı amblemi: turkuaz halka içinde üç kollu spiral."""
    dr = ImageDraw.Draw(img)
    ring = tuple(int(c) for c in ring)
    dr.ellipse([cx - r, cy - r, cx + r, cy + r], fill=ring)
    ri = r * 0.82
    dr.ellipse([cx - ri, cy - ri, cx + ri, cy + ri], fill=bg)
    for k in range(3):
        base = k * 2 * math.pi / 3
        pts = []
        for t in np.linspace(0, 1, 40):
            a = base + t * 2.6
            rr = ri * (0.12 + 0.78 * t)
            pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
        dr.line(pts, fill=ring, width=max(3, int(r * 0.13)), joint="curve")
    dr.ellipse([cx - r * 0.12, cy - r * 0.12, cx + r * 0.12, cy + r * 0.12], fill=ring)


def main():
    src = Image.open(SRC).convert("RGB")
    size = src.size[0]
    arr = np.array(src, dtype=np.float32)
    k = size / 1024.0  # koordinatlar 1024'lük atlas üzerinde ölçüldü

    m = part_masks(size)
    h, s, v = hsv(arr)
    L = lum(arr)

    def box(x0, y0, x1, y1):
        b = np.zeros(arr.shape[:2], dtype=bool)
        b[int(y0 * k):int(y1 * k), int(x0 * k):int(x1 * k)] = True
        return b

    lavender = (h > 225) & (h < 280) & (s > 0.18) & (v > 0.12)
    pinkish = ((h > 320) | (h < 22)) & (s > 0.30)

    # Kol üzerindeki kalp rozeti: renkler değişmeden önce, orijinal renklerden seçilir
    heart = box(195, 820, 255, 880) & (h > 35) & (h < 230) & (s > 0.12)

    # --- Pantolon: lavanta -> gök mavisi + rüzgâr çizgileri ---------------
    pants = m["legs"] & lavender
    # --- Kollar: somon -> nane-aqua (gövde adasına taşan kol kısmı dahil) ---
    sleeve = (m["arms"] | m["torso"]) & pinkish & (L > 140)
    cuff = m["arms"] & pinkish & (L <= 140) & ~m["torso"]
    # --- Crop top: koyu pembe biye/kenarlar -> turkuaz ---------------------
    trims = m["torso"] & pinkish & (L <= 140)
    # --- Çoraplar: pembe -> bulut beyazı (turkuaz bant zaten hava rengi) ----
    sock = m["legs"] & pinkish & ~sleeve & ~trims & ~cuff
    # Not: baştaki periwinkle bölge bandana değil, ön perçem (saç) — dokunulmaz.

    recolor(arr, pants, SKY)
    streak = wind_streaks(size) * pants
    arr += (CLOUD[None, None, :] - arr) * (streak[..., None] * 0.42)
    recolor(arr, sleeve, MINT)
    recolor(arr, cuff, TEAL)
    recolor(arr, trims, TEAL)
    recolor(arr, sock, CLOUD)
    recolor(arr, heart & (L > 150), CLOUD, keep=0.0)
    recolor(arr, heart & (L <= 150), TEAL, keep=0.0)

    # --- Ayakkabılar: sarı -> bulut beyazı, pembe biye -> turkuaz -----------
    yellow = (h > 35) & (h < 70) & (s > 0.18)
    recolor(arr, m["feet"] & yellow, CLOUD)
    recolor(arr, m["feet"] & ((h > 290) | (h < 20)) & (s > 0.15), TEAL)

    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))

    # --- Göğüs rozetleri -> rüzgâr girdabı amblemleri -----------------------
    draw_swirl_emblem(img, int(415 * k), int(770 * k), int(44 * k))
    draw_swirl_emblem(img, int(421 * k), int(841 * k), int(36 * k), ring=(96, 170, 220))

    img.save(OUT, quality=93)
    print("Kaydedildi:", OUT, img.size)
    for name, mask in [("pantolon", pants), ("kol", sleeve), ("manset", cuff), ("biye", trims),
                       ("corap", sock)]:
        print(f"  {name:8s}: {int(mask.sum())} px")


if __name__ == "__main__":
    main()
