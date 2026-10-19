"""
Defne (Jackie / Ch29) ninja kostümüyle giyildiğinde kendi şapkasını (pembe bere, tepede düğme) kostüme uydurur.

Ninja başlığı (maske) şapkanın tamamını örtmüyor; pembe bere maskenin altından ve yanlardan görünüyordu. Bu araç
hava dokusundan (Ch29_1001_Diffuse_hava.jpg) bir ninja varyantı üretir: bere ninja kumaşının çelik mavisine,
tepedeki düğme ninja zırhının gümüşüne boyanır. Renkler doğrudan ninja.fbx'e gömülü kostüm dokusundan ölçülür;
kostüm yeniden boyanırsa araç tekrar çalıştırılınca bere de uyar. Doku yalnızca ninja kostümü giyilince kullanılır
(src/engine/outfits.ts: FEMALE_OUTFITS → ninja → defneTexture).

Girdi : public/models/characters/Jackie/Ch29_1001_Diffuse_hava.jpg
        public/models/outfits/female/ninja.fbx (gömülü defne_ninja dokusu)
        tools/data/jackie_uv_faces.json (Blender'dan yüz başına UV + 3B konum)
Çıktı : public/models/characters/Jackie/Ch29_1001_Diffuse_ninja.jpg

Kullanım: python tools/customize_defne_ninja.py
"""
import io
import json
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from customize_defne_hava import hsv, lum, recolor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEX_DIR = os.path.join(ROOT, "public", "models", "characters", "Jackie")
SRC = os.path.join(TEX_DIR, "Ch29_1001_Diffuse_hava.jpg")
OUT = os.path.join(TEX_DIR, "Ch29_1001_Diffuse_ninja.jpg")
NINJA_FBX = os.path.join(ROOT, "public", "models", "outfits", "female", "ninja.fbx")
FACES = os.path.join(ROOT, "tools", "data", "jackie_uv_faces.json")


def embedded_pngs(path):
    """FBX'e gömülü PNG dokularını sırayla döndürür."""
    data = open(path, "rb").read()
    out = []
    i = 0
    while True:
        i = data.find(b"\x89PNG", i)
        if i < 0:
            return out
        j = data.find(b"IEND", i) + 8
        out.append(Image.open(io.BytesIO(data[i:j])).convert("RGB"))
        i = j


def ninja_palette():
    """Kostüm dokusundan kumaş mavisi (doygun mavi pikseller) ve zırh gümüşü (doygunluğu düşük açık pikseller)."""
    body = max(embedded_pngs(NINJA_FBX), key=lambda im: im.size[0] * im.size[1])
    arr = np.array(body, dtype=np.float32)
    h, s, v = hsv(arr)
    cloth = arr[(h > 195) & (h < 225) & (s > 0.3) & (v > 0.35) & (v < 0.85)]
    silver = arr[(s < 0.15) & (v > 0.6) & (v < 0.92)]
    return np.median(cloth, axis=0), np.median(silver, axis=0)


def cap_mask(size):
    """Berenin UV maskesi: başın üstündeki (z > 1.40 m) ve atlasın sol üst adasındaki yüzler (saç sağ adada)."""
    faces = json.load(open(FACES))
    img = Image.new("L", (size, size), 0)
    dr = ImageDraw.Draw(img)
    n = 0
    for mat, z, _x, _y, uvs in faces:
        if mat != 0 or z <= 1.40:
            continue
        cu = sum(u for u, _ in uvs) / len(uvs)
        cv = sum(v for _, v in uvs) / len(uvs)
        if cu > 0.46 or cv < 0.67:
            continue
        dr.polygon([(u * size, (1.0 - v) * size) for u, v in uvs], fill=255)
        n += 1
    # Ada kenarındaki taşma pikselleri de boyansın
    return np.array(img.filter(ImageFilter.MaxFilter(15))) > 0, n


def main():
    src = Image.open(SRC).convert("RGB")
    size = src.size[0]
    arr = np.array(src, dtype=np.float32)
    cloth, silver = ninja_palette()
    cap, n = cap_mask(size)
    h, s, _v = hsv(arr)
    # Berenin alt kenarı (z ≤ 1.40 m'deki kenar şeridi) ve adanın taşma pikselleri: berenin yakınındaki pembe pikseller
    near = np.array(Image.fromarray((cap * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(81))) > 0
    pink = ((h > 300) | (h < 12)) & (s > 0.35)
    cap = cap | (near & pink)
    # Tepedeki düğme sarı-yeşil; berenin geri kalanı pembe/kırmızı
    button = cap & (h > 35) & (h < 100) & (s > 0.15)
    fabric = cap & ~button
    recolor(arr, fabric, cloth, keep=0.0)
    recolor(arr, button, silver, keep=0.0)
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).save(OUT, quality=93)
    print("Kaydedildi:", OUT, src.size)
    print(f"  kumaş mavisi {cloth.round()}  gümüş {silver.round()}")
    print(f"  bere: {n} yüz, {int(fabric.sum())} px kumaş, {int(button.sum())} px düğme")


if __name__ == "__main__":
    main()
