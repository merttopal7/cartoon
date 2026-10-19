"""
Bölüm 1 — "Devrilen Çamın Sırrı" senaryo üreteci.

Senaryonun kendisi (replikler, yürüyüşler, kamera vuruşları) bu dosyadaki SCRIPT'te yazılır; zaman çizelgesi
buradan hesaplanıp public/scenarios/bolum-1-ormanin-bekcileri.yaml yazılır. Böylece 10 dakikalık bölümde bir replik
uzayınca ya da kısalınca sonraki her şey kendiliğinden kayar.

Replik süreleri:
  - Ses dosyası varsa (public/audio/bolum-1-ormanin-bekcileri/<kim>_<metin özeti>.mp3) gerçek süresi,
  - yoksa metin uzunluğundan tahmin (karakterin konuşma hızıyla) kullanılır; YAML'a `audio` yazılmaz (ağız
    yordamsal oynar).
Dosya adı replik metninin özetinden türer: metin değişmedikçe ses dosyası eşleşir, metin değişirse yeniden üretilir.

Eksik sesler: tools/data/bolum1_lines.json (her replik: dosya, kim, ses kimliği, metin, ses var mı) yazılır;
ElevenLabs ile yalnızca eksikleri üretmek için: node tools/tts-missing.mjs tools/data/bolum1_lines.json
(kredi harcar). Ardından bu üreteç yeniden çalıştırılır: süreler gerçek seslere göre güncellenir.

Kullanım: python tools/build_bolum1.py
"""
import hashlib
import json
import math
import os
import re
import struct

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "scenarios", "bolum-1-ormanin-bekcileri.yaml")
AUDIO_REL = "audio/bolum-1-ormanin-bekcileri"
AUDIO_DIR = os.path.join(ROOT, "public", AUDIO_REL)
LINES_JSON = os.path.join(ROOT, "tools", "data", "bolum1_lines.json")
ROAD = json.load(open(os.path.join(ROOT, "public", "roads", "dirt-road.json")))["points"]

# Ses kimlikleri ortak karakter kataloğundan (src/data/characters.yaml; tek kaynak)
def _shared_voices():
    voices = {}
    who = None
    for line in open(os.path.join(ROOT, "src", "data", "characters.yaml"), encoding="utf8"):
        m = re.match(r"^([a-z_]+):\s*$", line)
        if m:
            who = m.group(1)
        m = re.match(r"^\s+voice:\s*(\S+)", line)
        if m and who:
            voices[who] = m.group(1)
    return voices


VOICES = _shared_voices()
# Tahmini konuşma hızı (karakter/sn; açılış repliklerinden ölçüldü) ve replik sonu payı
RATE = {"toprak": 11.5, "defne": 12.5, "mese": 13.0}
TAIL = 0.25
CAST = ["toprak", "defne", "mese"]
# Devrik çam (koridorun batı ucu, güney sıra): kuzeye, yolun karşısına, kuzey sıradaki iki çamın arasına yatar
FALLEN = "Realistic_Pine_059"
FALLEN_AT = (29.2, 35.6)
FALLEN_TOWARD = (29.6, 50.2)
# Koridorda zemin yüksekliği (m; harita y=0'da değil): mutlak kamera hedefleri buna göre
GY = 17.2


# ---------------------------------------------------------------------------------------------------
# Yol: s (yol boyunca metre) → dünya konumu; yürüyüş süresi tahmini
# ---------------------------------------------------------------------------------------------------
_SEG = []
_acc = 0.0
for _a, _b in zip(ROAD, ROAD[1:]):
    _l = math.hypot(_b[0] - _a[0], _b[1] - _a[1])
    _SEG.append((_a, _b, _acc, _l))
    _acc += _l


def road_at(s, lane=0.0, toward_smaller=True):
    """Yolun s metresindeki nokta; lane: yürüme yönüne göre sağa (+) metre. Kuzeye yürüyüş s'yi azaltır."""
    for a, b, s0, l in _SEG:
        if s <= s0 + l or (a, b, s0, l) == _SEG[-1]:
            t = min(1.0, max(0.0, (s - s0) / max(l, 1e-6)))
            x = a[0] + (b[0] - a[0]) * t
            z = a[1] + (b[1] - a[1]) * t
            dx, dz = (b[0] - a[0]) / l, (b[1] - a[1]) / l
            if toward_smaller:
                dx, dz = -dx, -dz
            # Yürüme yönünün sağı: yön (dx, dz) iken (-dz, dx) solu... y yukarı, z ileri: sağ = (dz, -dx)
            rx, rz = -dz, dx
            return (round(x + rx * lane, 2), round(z + rz * lane, 2))
    raise ValueError(s)


def yaw_deg(frm, to):
    return round(math.degrees(math.atan2(to[0] - frm[0], to[1] - frm[1])), 1)


# ---------------------------------------------------------------------------------------------------
# MP3 süresi (bağımlılıksız; MPEG-1/2 Layer III çerçeveleri sayılır)
# ---------------------------------------------------------------------------------------------------
def mp3_duration(path):
    data = open(path, "rb").read()
    i = 0
    if data[:3] == b"ID3":
        size = (data[6] & 0x7F) << 21 | (data[7] & 0x7F) << 14 | (data[8] & 0x7F) << 7 | (data[9] & 0x7F)
        i = 10 + size
    br1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
    br2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]
    sr = {3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000]}
    total = 0.0
    while i + 4 <= len(data):
        if data[i] != 0xFF or (data[i + 1] & 0xE0) != 0xE0:
            i += 1
            continue
        ver = (data[i + 1] >> 3) & 3
        bri = (data[i + 2] >> 4) & 15
        sri = (data[i + 2] >> 2) & 3
        pad = (data[i + 2] >> 1) & 1
        if ver == 1 or bri in (0, 15) or sri == 3:
            i += 1
            continue
        rate = sr[ver][sri]
        bitrate = (br1 if ver == 3 else br2)[bri] * 1000
        spf = 1152 if ver == 3 else 576
        flen = int((spf / 8) * bitrate / rate) + pad
        if flen <= 4:
            i += 1
            continue
        total += spf / rate
        i += flen
    return total


# ---------------------------------------------------------------------------------------------------
# Senaryo yazımı: imleç (sn) boyunca replik, eylem, yürüyüş ve kamera vuruşları
# ---------------------------------------------------------------------------------------------------
class Script:
    def __init__(self):
        self.t = 0.0
        self.actions = []
        self.cams = []  # (başlangıç, kamera sözlüğü, coverage, geçiş)
        self.overlays = []
        self.lines = []
        self.walk_end = 0.0
        self.busy = {c: 0.0 for c in CAST}  # karakterin son eylem/yürüyüş bitişi
        self.looks = []
        self.birds = []  # kuş sesi anahtarları (sahne zamanı): susma / yeniden ötme

    def act(self, who, do, at=None, **kw):
        a = {"who": who, "at": round(self.t if at is None else at, 2), "do": do}
        a.update(kw)
        self.actions.append(a)
        return a

    def pause(self, sec):
        self.t += sec

    def cam(self, camera, coverage=None, transition="cut", at=None):
        self.cams.append((round(self.t if at is None else at, 2), camera, coverage, transition))

    def say(self, who, text, gap=0.24, look=None, emote=None, listeners_look=True, clip=None):
        # Meşe konuşurken kameraya bakar (sakin, doğrudan anlatım; kapsamada orta → yakın plana kesilir)
        if who == "mese" and look is None:
            look = "camera"
        """Replik: imleçten `gap` sonra başlar; imleç replik sonuna gider. Dinleyenler konuşana bakar."""
        name = f"{who}_{hashlib.sha1(text.encode('utf8')).hexdigest()[:10]}.mp3"
        path = os.path.join(AUDIO_DIR, name)
        has = os.path.exists(path)
        dur = round(mp3_duration(path), 2) if has else round(len(text) / RATE[who] + TAIL, 2)
        start = self.t + gap
        a = {"who": who, "at": round(start, 2), "do": "talk", "duration": dur, "text": text}
        if has:
            a["audio"] = f"{AUDIO_REL}/{name}"
        self.actions.append(a)
        self.lines.append({"file": name, "who": who, "voice": VOICES[who], "text": text, "has_audio": has, "duration": dur})
        if look:
            self.act(who, "look_at", at=start - 0.2, target=look, duration=round(dur + 0.4, 2))
        if emote:
            self.act(who, "emote", at=start, expression=emote, duration=round(min(dur + 0.6, 3.5), 2))
        if clip:
            name_, cdur = clip
            self.act(who, "clip", at=start, name=name_, duration=cdur, loop=False, fade=0.3)
        if listeners_look:
            for other in CAST:
                if other != who:
                    self.looks.append((other, round(start - 0.15, 2), who, round(dur + 0.3, 2)))
        self.t = start + dur
        return start

    def walk(self, moves, speed=1.38, clip=None, stagger=0.1, lead=0.0):
        """moves: {kim: (s, şerit)} ya da {kim: (x, z) mutlak} — yol boyunca yürür. İmleç değişmez."""
        end = self.t
        for k, (who, target) in enumerate(moves.items()):
            at = self.t + lead + k * stagger
            if isinstance(target[0], str):
                raise ValueError(target)
            frm = self.pos_of(who, at)
            if len(target) == 3 and target[2] == "abs":
                to = [target[0], target[1]]
                kw = {}
                dist = math.hypot(to[0] - frm[0], to[1] - frm[1])
                self._s[who] = None
            else:
                s, lane = target
                to = list(road_at(s, lane))
                kw = {"road": True, "lane": lane}
                # Süre tahmini: yol boyunca mesafe (kıvrımlarda düz mesafe kısa kalıyordu)
                s0 = self._s.get(who)
                dist = abs(s0 - s) + 1.0 if s0 is not None else math.hypot(to[0] - frm[0], to[1] - frm[1]) * 1.15
                self._s[who] = s
            a = self.act(who, "walk_to", at=at, to=to, speed=speed, **kw)
            if clip:
                a["clip"] = clip
            self.busy[who] = at + dist / speed
            self._pos[who] = (to[0], to[1])
            end = max(end, at + dist / speed)
        self.walk_end = end
        return end

    def wait_walk(self, extra=0.0):
        self.t = max(self.t, self.walk_end + extra)

    # Konum izleme (yürüyüş süresi tahmini için yalnızca son hedef ve yoldaysa s konumu)
    _pos = {}
    _s = {}

    def pos_of(self, who, _t):
        return self._pos[who]


# ---------------------------------------------------------------------------------------------------
# SENARYO
# ---------------------------------------------------------------------------------------------------
S = Script()
GROUP = ["toprak", "defne", "mese"]

# Başlangıç: doğu yolu (s≈172), kuzeye bakıyorlar; Defne kıvrımın ötesinden (s≈150) karşıdan koşarak gelir
P0 = {"toprak": road_at(172.0, 0.9), "mese": road_at(171.6, -1.0), "defne": road_at(150.0, 0.0)}
S._pos = dict(P0)
S._s = {"toprak": 172.0, "mese": 171.6, "defne": 150.0}
NORTH0 = yaw_deg(road_at(172.0), road_at(162.0))

# --- 1. Sabah buluşması --------------------------------------------------------------------------
S.cam({"target": ["toprak", "mese"], "size": {"from": 15, "to": 4.2},
       "angle": {"from": 200, "to": 188}, "elevation": {"from": 36, "to": 12}, "ease": "inOut", "relative": False})
S.overlays.append({"type": "title_card", "at": 0.6, "duration": 4.0, "badge": "BÖLÜM 1", "title": "Devrilen Çamın Sırrı",
                   "subtitle": "Ormanın Bekçileri", "accent": "#16a34a", "position": "top"})
# Toprak beklerken şınav çeker; kamera inerken hemen ayağa fırlar (giriş hızlı ve enerjik)
S.act("toprak", "clip", name="pushup", at=0.6, duration=3.2, loop=True, fade=0.35)
S.act("toprak", "clip", name="crouch_to_stand", at=3.8, duration=1.2, loop=False, fade=0.25)
S.pause(4.8)
S.cam({"target": ["toprak", "mese"], "size": {"from": 2.6, "to": 2.3}, "angle": {"from": 20, "to": 8}, "elevation": 7,
       "relative": True, "ease": "inOut"}, coverage="dialogue")
S.say("toprak", "Defne nerede kaldı? Güneş çoktan doğdu!", gap=0.15)
S.say("mese", "Sabırlı ol Toprak. Rüzgâr nereye eserse, Defne de oradan gelir.")
S.say("toprak", "Ya rüzgâr bugün ters eserse?")
# Defne hızla koşarak gelir
S.walk({"defne": (169.6, 0.0)}, speed=4.2, clip="run")
S.cam({"target": "defne", "size": {"from": 3.0, "to": 2.5}, "angle": {"from": 12, "to": 0}, "elevation": 6,
       "relative": True, "ease": "out"})
S.say("defne", "Geldim geldim! Yetiştim!", gap=0.35, listeners_look=True)
S.wait_walk(0.05)
for who in ["toprak", "mese"]:
    S.act(who, "turn", to="defne", duration=0.45)
# Varışta geriye takla (gösteriş)
S.act("defne", "clip", name="backflip", duration=2.0, loop=False, fade=0.2)
S.pause(1.6)
S.act("defne", "turn", to="toprak", duration=0.45)
S.cam({"target": GROUP, "size": {"from": 2.6, "to": 2.4}, "angle": {"from": -12, "to": 4}, "elevation": 7,
       "relative": True, "ease": "inOut"}, coverage="dialogue")
S.say("toprak", "Sonunda! Az kalsın sensiz gidiyorduk.", gap=0.15, emote="happy")
S.say("defne", "Bensiz mi? Ormanın gözcüsü benim, unuttun mu?", clip=("taunt", 2.2))
S.say("mese", "Günaydın Defne. Bugün kuzey patikasını dolaşacağız.")
S.say("defne", "Kuzey mi? Harika! Orası en uzun yol.", emote="happy")
S.say("toprak", "En uzun yol, en çok macera demek!", clip=("jump_joy", 1.8))
S.say("mese", "En çok dikkat demek. Gözümüzü dört açalım.")
S.say("defne", "Benim gözlerim zaten dört! Hadi, yürüyelim!")

# --- 2. Devriye yürüyüşü (1. etap: s 172 → 156) ve Element Gösterisi -----------------------------
S.pause(0.15)
S.walk({"defne": (156.4, 0.0), "toprak": (156.0, 1.0), "mese": (155.6, -1.0)}, speed=1.42)
S.cam({"target": GROUP, "size": {"from": 3.3, "to": 2.9}, "angle": {"from": 14, "to": 4}, "elevation": {"from": 17, "to": 13},
       "relative": True, "ease": "inOut"}, at=S.t + 0.6)
S.pause(0.8)
S.say("toprak", "Bu sabah toprak çok yumuşak. Gece çiğ düşmüş.")
S.say("mese", "Ağaçlar suyunu içmiş. Yapraklarına bak, nasıl parlıyorlar.")
# İkinci yürüyüş açısı: daha yakın ve dinamik yan-ön takip
S.cam({"target": GROUP, "size": {"from": 2.8, "to": 2.5}, "angle": {"from": -12, "to": 6}, "elevation": {"from": 15, "to": 12},
       "relative": True, "ease": "inOut"})
S.say("defne", "Bence en güzeli rüzgâr. Bugün tam uçurtma havası!")
S.say("toprak", "Senin için her gün uçurtma havası.")
S.wait_walk(0.05)

# Durak (s≈156): Defne hortumla yükselir, Toprak kaya kulesiyle karşılık verir!
S.act("defne", "ability", name="hortum_gosterisi", at=S.t)
S.cam({"target": "defne", "size": {"from": 2.8, "to": 2.3}, "angle": {"from": -16, "to": 6}, "elevation": {"from": 8, "to": 5},
       "relative": True, "ease": "inOut"})
S.say("defne", "Çünkü ben her gün uçarım!", gap=1.35, emote="happy")
S.pause(1.1)
S.cam({"target": GROUP, "size": {"from": 2.7, "to": 2.4}, "angle": {"from": 10, "to": -6}, "elevation": 8,
       "relative": True, "ease": "inOut"}, coverage="dialogue")
S.say("mese", "Toprak, geçen hafta diktiğin fidanlar nasıl?", gap=0.25)
S.say("toprak", "Büyüyorlar! Biri neredeyse dizime geldi.", emote="happy")
S.say("defne", "Dizine mi? O zaman yakında benden uzun olur!")
# Toprak kaya kulesiyle yükselerek boyunu gösterir
S.act("toprak", "ability", name="kaya_yukselisi", at=S.t)
S.cam({"target": "toprak", "size": {"from": 2.6, "to": 2.1}, "angle": {"from": -14, "to": 8}, "elevation": {"from": 11, "to": 6},
       "relative": True, "ease": "inOut"})
S.say("toprak", "Hey! Ben de büyüyorum ama!", gap=0.95, emote="happy")
S.cam({"target": GROUP, "size": {"from": 2.8, "to": 2.5}, "angle": {"from": 12, "to": -4}, "elevation": 8,
       "relative": True, "ease": "inOut"}, coverage="dialogue")
S.say("mese", "Her şey zamanında büyür. Orman acele etmez.", gap=0.35)
S.pause(0.6)
S.say("defne", "Ama ben acele ederim. Kim önce kıvrıma varır?")
S.say("toprak", "Yarış yok! Devriyedeyiz, unuttun mu?")
S.say("defne", "Peki peki... Sıkıcı bekçi Toprak.", clip=("taunt", 2.0))
S.say("toprak", "Sıkıcı değil, dikkatli!")

# --- 2b. Devriye yürüyüşü (2. etap: s 156 → 128, bilmece oyunu; 3 dinamik açı) ------------------
S.walk({"defne": (128.4, 0.0), "toprak": (128.0, 1.0), "mese": (127.6, -1.0)}, speed=1.38)
S.cam({"target": GROUP, "size": {"from": 3.2, "to": 2.9}, "angle": {"from": 12, "to": 2}, "elevation": 15,
       "relative": True, "ease": "inOut"})
S.say("defne", "Sıkıldım ama. Hadi bilmece oynayalım!", gap=0.35)
S.say("mese", "Peki. Ağzı var, dili yok. Durmadan akar, hiç yorulmaz. Nedir?")
S.say("toprak", "Kolay! Dere!", emote="happy")
S.say("mese", "Bildin Toprak.")
# Bilmece 2 için yeni kamera açısı
S.cam({"target": GROUP, "size": {"from": 2.9, "to": 2.6}, "angle": {"from": -14, "to": -2}, "elevation": {"from": 16, "to": 13},
       "relative": True, "ease": "inOut"})
S.say("toprak", "Şimdi benim sıram. Kökü var ama ağaç değil. Taşları tutar, yağmuru içer. Nedir?")
S.say("defne", "Hmm... Dağ mı?")
S.say("toprak", "Toprak! Benim adım!")
S.say("defne", "Bu haksızlık! Kendi adını sordun!", emote="angry")
S.say("mese", "Bence gayet adil bir bilmeceydi.", emote="happy")
# Bilmece 3 için arkadan-yüksekten koridor girişi açısı
S.cam({"target": GROUP, "size": {"from": 3.4, "to": 3.0}, "angle": {"from": 168, "to": 176}, "elevation": {"from": 14, "to": 11},
       "relative": True, "ease": "inOut"})
S.say("defne", "Tamam, son bilmece benden. Görünmem ama saçlarını dağıtırım. Kimim ben?")
S.say("toprak", "Sensin! Defne!")
S.say("defne", "Rüzgâr diyecektin ama... Olsun, kabul!", emote="happy")
S.wait_walk(-0.2)

# --- 3. İzler (durak 1, s≈128; kıvrımda, koridorun girişi) ------------------------------------------------------------------
S.cam({"target": "toprak", "size": {"from": 2.4, "to": 1.8}, "angle": {"from": 35, "to": 20}, "elevation": {"from": 12, "to": 7},
       "relative": True, "ease": "inOut"}, coverage="dialogue")
S.say("toprak", "Durun! Şuraya bakın.", gap=0.25, emote="surprised")
S.act("toprak", "clip", name="point", duration=6.5, loop=False, fade=0.35)
S.say("mese", "Ne buldun?")
S.say("toprak", "Ayak izleri. Bunlar geyik izi... hem de bir sürü.")
S.say("defne", "Geyikler sabah yürüyüşüne çıkmış, ne var bunda?")
S.say("toprak", "Ama izler derin. Koşarak geçmişler. Hem de güneye doğru.")
S.say("mese", "Çamur hâlâ ıslak. Bu izler bu sabah olmuş.")
S.say("mese", "Geyikler sabahları sakin sakin otlar. Neden koşsunlar ki?")
S.say("defne", "Belki onlar da yarışıyordur!")
S.say("toprak", "Bence bir şeyden kaçıyorlardı.", gap=0.3)
# Kuzey koridoruna dramatik bakış açısı
S.cam({"target": GROUP, "size": {"from": 3.2, "to": 3.8}, "angle": {"from": 170, "to": 178}, "elevation": {"from": 10, "to": 13},
       "relative": True, "ease": "inOut"})
S.say("mese", "Kuzeyden... Bizim gittiğimiz yönden.", look=[road_at(110.0)[0], GY + 1.3, road_at(110.0)[1]])
S.cam({"target": GROUP, "size": {"from": 2.5, "to": 2.3}, "angle": {"from": 18, "to": 6}, "elevation": 7,
       "relative": True, "ease": "inOut"}, coverage="dialogue")
S.say("defne", "Hmm. Tamam, bu biraz garip.")
S.say("mese", "Acele etmeden ama dikkatle devam edelim.")

# --- 4. Yürüyüş 2 (s 128 → 112, koridorda batıya; 2 hızlı kamera açısı) -------------------------
S.pause(0.2)
# Meşe antrenmanı yolun kenarından izler (kamera yol boyunca bakıyor; arada kalmasın)
S.walk({"defne": (112.0, -1.2), "toprak": (112.0, 1.2), "mese": (110.6, 3.0)}, speed=1.38)
S.cam({"target": GROUP, "size": {"from": 3.2, "to": 2.9}, "angle": {"from": 8, "to": -6}, "elevation": {"from": 17, "to": 13},
       "relative": True, "ease": "inOut"})
S.pause(0.7)
S.say("defne", "Belki bir ayı gördüler. Koca, tüylü bir ayı!")
S.say("toprak", "Bu ormanda ayı yok ki.")
S.say("defne", "Belki yeni taşınmıştır!")
S.say("mese", "Defne, ayılar öyle ev değiştirmez.")
S.cam({"target": GROUP, "size": {"from": 2.9, "to": 2.6}, "angle": {"from": -10, "to": 6}, "elevation": {"from": 15, "to": 12},
       "relative": True, "ease": "inOut"})
S.say("defne", "Nereden biliyorsun? Hiç sordun mu?")
S.say("toprak", "Ayıya mı soracak?", emote="happy")
S.say("mese", "Ormanı dinlemek, sormaktan iyidir.")
S.say("defne", "Ayı çıkarsa diye hazırlıklı olalım. Hadi biraz antrenman yapalım!", emote="happy")
S.wait_walk(0.0)

# --- 4b. Antrenman: dövüş + gerçek element yetenekleriyle hızlı düello (s≈112) -------------------
S.act("defne", "turn", to="toprak", duration=0.45)
S.act("toprak", "turn", to="defne", duration=0.45)
S.act("mese", "turn", to="defne", duration=0.5)
# Karşılıklı (yolun enine) duruyorlar: yol boyunca bakan kamera onları yandan görür
S.cam({"target": ["defne", "toprak"], "size": {"from": 2.9, "to": 2.6}, "angle": {"from": 84, "to": 92}, "elevation": 7,
       "relative": False, "ease": "inOut"})
S.say("toprak", "Antrenman mı? Hazırım! Bu sefer beni yenemezsin.", gap=0.2, emote="happy")
S.say("mese", "Dikkatli olun. Kimse yaralanmasın.", listeners_look=False)
t0 = S.t + 0.2
for who in ["defne", "toprak"]:
    S.act(who, "clip", at=t0, name="fight_idle", duration=0.9, loop=True, fade=0.25)
    S.act(who, "emote", at=t0, expression="angry", duration=1.0)
# 1) Yakın dövüş ısınması: Defne hilal tekmesi, Toprak eğilip kaçar; Toprak tekme atar, Defne taklayla kaçar
S.act("defne", "clip", at=t0 + 0.9, name="crescent_kick", duration=2.2, loop=False, fade=0.2)
S.act("toprak", "clip", at=t0 + 1.15, name="esquiva", duration=2.1, loop=False, fade=0.2)
S.act("toprak", "clip", at=t0 + 3.3, name="mma_kick", duration=1.58, loop=False, fade=0.2)
S.act("defne", "clip", at=t0 + 3.55, name="backflip", duration=2.15, loop=False, fade=0.2)
# 2) Element düellosu: Toprak Yer Dikenleri gönderir, Defne Rüzgar Hortumu ile karşılık verir!
S.cam({"target": ["toprak", "defne"], "size": {"from": 2.6, "to": 3.0}, "angle": {"from": -96, "to": -86}, "elevation": 6,
       "relative": False, "ease": "inOut"}, coverage="fight", at=t0 + 5.5)
S.act("toprak", "ability", at=t0 + 5.7, name="yer_dikeni", target="defne", knockback=0, impact_clip="dodge_back", impact=0.7)
S.act("defne", "ability", at=t0 + 8.9, name="ruzgar_hortumu", target="toprak", knockback=0, impact_clip="dodge_back", impact=0.7)
# 3) Final: Defne uçan tekme, Toprak ayağını yakalar
S.cam({"target": ["defne", "toprak"], "size": {"from": 2.4, "to": 2.2}, "angle": {"from": 86, "to": 94}, "elevation": 5,
       "relative": False, "ease": "inOut"}, at=t0 + 13.1)
S.act("defne", "clip", at=t0 + 13.2, name="flying_kick", duration=1.5, loop=False, fade=0.2)
S.act("toprak", "clip", at=t0 + 13.25, name="goalkeeper", duration=2.4, loop=False, fade=0.2)
S.t = t0 + 15.4
S.cam({"target": GROUP, "size": {"from": 2.6, "to": 2.4}, "angle": {"from": 15, "to": 0}, "elevation": 6,
       "relative": True, "ease": "inOut"}, coverage="dialogue")
S.say("toprak", "Yakaladım!", gap=0.0, emote="happy")
S.say("defne", "Bu sefer şanslıydın!", emote="angry")
S.say("mese", "İkiniz de iyiydiniz. Hızlı da olmalı, dikkatli de.", emote="happy")
S.say("defne", "Duydun mu? Hızlı!")
S.say("toprak", "Duydum. Dikkatli!")

# --- 4c. Meşe'nin Su Dalgası Gösterisi ve Koridor Yürüyüşü (s 112 → 96) --------------------------
S.say("toprak", "Meşe, sen ormanı nasıl dinliyorsun?", gap=0.3)
# Meşe su dalgasıyla yükselerek elementini gösterir
S.act("mese", "ability", name="dalga_gosterisi", at=S.t)
S.cam({"target": "mese", "size": {"from": 2.8, "to": 2.4}, "angle": {"from": -52, "to": -36}, "elevation": {"from": 14, "to": 9},
       "relative": True, "ease": "inOut"})
S.say("mese", "Su gibi. Sessizce akarsın, her sesi duyarsın.", gap=0.85)
S.cam({"target": GROUP, "size": {"from": 2.7, "to": 2.4}, "angle": {"from": 12, "to": -6}, "elevation": 7,
       "relative": True, "ease": "inOut"}, coverage="dialogue")
S.say("defne", "Ben de rüzgâr gibi dinlerim. Her yere bir anda!", gap=0.35, clip=("northern_soul_spin", 2.0))
S.say("toprak", "Ben de toprak gibi. Ayağımın altında her adımı hissederim.")
S.say("mese", "İşte bu yüzden birlikte güçlüyüz.")
# Yürüyüş (s 112 → 96): hızlı tempo, 2 ayrı kamera açısı
S.walk({"defne": (96.4, 0.0), "toprak": (96.0, 1.3), "mese": (95.6, -1.3)}, speed=1.42)
S.cam({"target": GROUP, "size": {"from": 3.6, "to": 3.2}, "angle": {"from": 164, "to": 174}, "elevation": {"from": 14, "to": 10},
       "relative": True, "ease": "inOut"})
S.say("defne", "Meşe, senin en sevdiğin ağaç hangisi?", gap=0.5)
S.say("mese", "Adımı aldığım ağaç. Meşe. Yüz yıl yaşar, hep sabırlıdır.")
S.cam({"target": GROUP, "size": {"from": 3.2, "to": 2.9}, "angle": {"from": 176, "to": 168}, "elevation": {"from": 11, "to": 9},
       "relative": True, "ease": "inOut"})
S.say("toprak", "Benimki çam. Kışın bile yeşil kalıyor!")
S.say("defne", "Benimki en uzun olanı. Tepesinden bütün ormanı görürüm!")
S.wait_walk(-0.2)

# --- 5. Sessizlik (durak 2, s≈96) --------------------------------------------------------------
S.cam({"target": "mese", "size": {"from": 2.2, "to": 1.8}, "angle": {"from": -20, "to": -8}, "elevation": 6,
       "relative": True, "ease": "inOut"}, coverage="dialogue")
# Kuşlar koridora yaklaştıkça yavaş yavaş susar; "Şşş" anında tam sessizlik
S.birds.append({"at": round(S.t - 8.0, 2), "on": False, "fade": 7.5})
S.say("mese", "Şşş. Durun bir saniye.", gap=0.2)
S.act("mese", "clip", name="idle_2", duration=4.5, loop=False, fade=0.35)
for who in ["toprak", "defne"]:
    S.act(who, "turn", to="mese", duration=0.5)
S.say("toprak", "Ne oldu?")
S.say("mese", "Dinleyin. Kuşlar... Hiç ses yok.", gap=0.4)
# Sessiz orman: koridorun yolu boyunca arkadan, grup ve iki yandaki çam sıraları
S.cam({"target": GROUP, "size": {"from": 4.4, "to": 5.2}, "angle": {"from": 176, "to": 182}, "elevation": {"from": 10, "to": 14},
       "relative": True, "ease": "inOut"})
S.pause(2.2)
S.cam({"target": "mese", "size": {"from": 2.2, "to": 1.9}, "angle": {"from": -14, "to": -6}, "elevation": 6,
       "relative": True, "ease": "inOut"}, coverage="dialogue")
S.say("defne", "Gerçekten. Bu saatte burası cıvıl cıvıl olur.")
S.say("toprak", "Önce geyikler, şimdi de kuşlar... Burada bir tuhaflık var.")
S.say("defne", "Ben önden bakayım! Rüzgârdan hızlıyım!", emote="happy")
S.say("mese", "Defne, bekle! Uzaklaşma!", emote="surprised")
# Defne hızla koşarak koridora (batıya) girer
S.walk({"defne": (82.5, 0.0)}, speed=4.2, clip="run")
S.say("defne", "Merak etme, hemen dönerim!", gap=0.15, listeners_look=False)
# Arkasından ve yüksekten takip
S.cam({"target": "defne", "size": {"from": 3.4, "to": 4.0}, "angle": {"from": 175, "to": 180}, "elevation": 22,
       "relative": True, "ease": "linear"}, at=S.t - 1.2)
S.say("toprak", "Hep böyle yapıyor.", gap=0.2, listeners_look=False)
S.say("mese", "Hadi, peşinden gidelim.", listeners_look=False)

# --- 6. Keşif (koridorun batısı, s≈83; çam s≈76'da yolun karşısında) -------------------------------------------------------------------
S.walk({"toprak": (84.2, 1.2), "mese": (83.8, -1.2)}, speed=3.4, clip="run")
S.cam({"target": [[40.5, GY + 1.2, 40.9], [38.5, GY + 1.2, 41.0]], "size": {"from": 4.0, "to": 3.4}, "angle": {"from": 95, "to": 92},
       "elevation": 6, "relative": False, "ease": "inOut"})
S.pause(0.6)
S.say("defne", "Toprak! Meşe! Çabuk gelin!", gap=0.0, emote="surprised", listeners_look=False)
S.say("toprak", "Ne oldu? Bir şey mi var?", listeners_look=False)
S.wait_walk(0.05)
for who in ["toprak", "mese"]:
    S.act(who, "turn", to=yaw_deg(road_at(84.0), road_at(74.0)), duration=0.5)
S.act("defne", "turn", to=yaw_deg(road_at(82.5), road_at(74.0)), duration=0.45)
S.say("defne", "Şuna bakın...", gap=0.2, listeners_look=False)
# Ağacın açılışı: devrik çam yolun karşısında
S.cam({"target": [[31.0, GY + 1.2, 42.0], [30.0, GY + 1.0, 41.8]], "size": {"from": 6.5, "to": 5.2}, "angle": {"from": 93, "to": 88},
       "elevation": {"from": 12, "to": 9}, "relative": False, "ease": "inOut"})
for who in GROUP:
    S.act(who, "emote", expression="surprised", duration=2.4)
S.pause(2.6)
S.cam({"target": GROUP, "size": {"from": 2.4, "to": 2.2}, "angle": {"from": 20, "to": 10}, "elevation": 5,
       "relative": True, "ease": "inOut"}, coverage="dialogue")
S.say("toprak", "Koca çam... devrilmiş!", gap=0.15)
S.say("mese", "Yolu tamamen kapatmış.")
S.say("defne", "Dün akşam buradan geçtim. Dimdikti!")
S.say("toprak", "Bir gecede nasıl devrilir ki böyle bir ağaç?")
S.say("mese", "Yaklaşalım. Ama dikkatli olun.")

# --- 7. İnceleme (kütüğün yanında) -------------------------------------------------------------
STUMP = FALLEN_AT
T_POS = (31.0, 36.6, "abs")
M_POS = (32.2, 39.4, "abs")
D_POS = (32.4, 42.6, "abs")
S.walk({"toprak": T_POS, "mese": M_POS, "defne": D_POS}, speed=1.45)
S.cam({"target": [[31.8, GY + 1.0, 39.0], [31.3, GY + 1.0, 38.0]], "size": {"from": 4.8, "to": 4.0}, "angle": {"from": 60, "to": 75},
       "elevation": {"from": 16, "to": 12}, "relative": False, "ease": "inOut"})
S.say("defne", "Belki fırtına olmuştur?", gap=0.35)
S.say("mese", "Dün gece fırtına yoktu. Gökyüzü tertemizdi.")
S.say("defne", "Doğru. Rüzgâr olsaydı, ben bilirdim.")
S.wait_walk(0.0)
S.act("toprak", "turn", to=yaw_deg(T_POS, STUMP), duration=0.5)
S.act("mese", "turn", to="toprak", duration=0.5)
S.act("defne", "turn", to="toprak", duration=0.5)
S.cam({"target": ["toprak", "mese", "defne"], "size": {"from": 2.6, "to": 2.3}, "angle": {"from": 30, "to": 15}, "elevation": 8,
       "relative": True, "ease": "inOut"}, coverage="dialogue")
S.act("toprak", "clip", name="point", duration=7.5, loop=False, fade=0.35, at=S.t + 0.2)
S.say("toprak", "Bakın, kökleri sağlam. Toprağın altında hâlâ duruyorlar.", gap=0.25)
S.say("mese", "Yani ağaç kökünden sökülmemiş.")
S.say("toprak", "Hayır. Gövdesi... kesilmiş gibi.")
S.say("defne", "Kesilmiş mi? Kim keser ki koca bir çamı?", emote="surprised")
# Kütüğün yanık kesik yerine yakın plan (tek 60 sn'lik konuşma bloğunu böler)
S.cam({"target": [[29.6, GY + 1.1, 36.0], [29.3, GY + 1.0, 35.8]], "size": {"from": 2.8, "to": 2.1}, "angle": {"from": 48, "to": 32},
       "elevation": {"from": 16, "to": 11}, "relative": False, "ease": "inOut"})
S.say("toprak", "Kesik çok düzgün. Bıçakla kesilmiş gibi pürüzsüz.")
S.say("mese", "Kenarları da kararmış. Sanki... yanmış.", gap=0.25)
S.cam({"target": ["toprak", "mese", "defne"], "size": {"from": 2.5, "to": 2.2}, "angle": {"from": 24, "to": 12}, "elevation": 7,
       "relative": True, "ease": "inOut"}, coverage="dialogue")
S.say("defne", "Yanmış mı? Ama etrafta hiç yangın izi yok.")
S.say("toprak", "Bir koku var... Duman gibi.")
S.say("mese", "Evet, ben de alıyorum. Çok hafif.")
S.say("defne", "Yoksa bir yıldırım mı düştü?")
S.say("mese", "Yıldırım ağacı yarar, parçalar. Böyle düzgün kesmez.")
S.say("toprak", "O zaman bunu biri yaptı.", gap=0.3)
S.say("defne", "Ama kim? Neden?")
S.pause(0.6)
# Ani hışırtı ve savunma pozisyonu için dinamik aksiyon açısı
S.cam({"target": GROUP, "size": {"from": 2.9, "to": 2.5}, "angle": {"from": -22, "to": -8}, "elevation": 6,
       "relative": True, "ease": "out"})
st = S.say("defne", "Ne o?! Arkada bir şey kıpırdadı!", gap=0.1, emote="surprised", clip=("mma_kick", 1.58))
S.act("defne", "clip", at=st + 1.5, name="fight_idle", duration=2.4, loop=True, fade=0.25)
S.act("mese", "clip", at=st + 0.1, name="equip_bow", duration=0.88, loop=False, fade=0.2)
S.act("mese", "clip", at=st + 0.95, name="aim_overdraw", duration=2.6, loop=False, fade=0.2)
S.act("toprak", "clip", at=st + 0.2, name="crouch_to_stand", duration=2.0, loop=False, fade=0.25)
S.pause(0.6)
S.cam({"target": ["toprak", "mese", "defne"], "size": {"from": 2.5, "to": 2.3}, "angle": {"from": 28, "to": 16}, "elevation": 7,
       "relative": True, "ease": "inOut"}, coverage="dialogue")
S.say("toprak", "Bir yaprak, Defne. Sadece bir yaprak.")
S.act("mese", "clip", name="disarm_bow", duration=1.08, loop=False, fade=0.2)
S.say("defne", "Biliyordum... Seni denedim sadece.")
S.say("mese", "Korkmak ayıp değil. Ama aklımızı kullanalım.", gap=0.25)
S.say("toprak", "Durun... Burada başka izler de var.", gap=0.35, emote="surprised")
S.walk({"toprak": (33.0, 34.4, "abs"), "mese": (34.2, 36.0, "abs"), "defne": (35.0, 37.6, "abs")}, speed=1.4)
S.cam({"target": [[33.4, GY + 0.4, 34.6], [33.6, GY + 0.3, 34.2]], "size": {"from": 3.4, "to": 2.6}, "angle": {"from": 80, "to": 65},
       "elevation": {"from": 30, "to": 22}, "relative": False, "ease": "inOut"})
S.say("defne", "Geyik izi mi yine?")
S.wait_walk(0.0)
S.act("toprak", "clip", name="point", duration=5.0, loop=False, fade=0.35)
S.act("mese", "look_at", target=[33.0, GY, 33.6], duration=4.5)
S.act("defne", "look_at", target=[33.0, GY, 33.6], duration=4.5)
S.say("toprak", "Hayır. Bunlar ayakkabı izi. Hem de çok büyük... Bir yetişkininki gibi.", gap=0.2, listeners_look=False)
S.say("mese", "Ve ağır basmış. Toprak iyice çökmüş.", listeners_look=False)
S.cam({"target": GROUP, "size": {"from": 2.4, "to": 2.2}, "angle": {"from": 40, "to": 25}, "elevation": 7,
       "relative": True, "ease": "inOut"}, coverage="dialogue")
S.say("defne", "Ormanda bizden başka kim dolaşır ki?")
S.say("toprak", "İzler çalılığa doğru gidiyor... Sonra kayboluyor.")
S.say("defne", "Takip edelim! Hemen yakalarız!", emote="happy")
S.say("mese", "Hayır. Önce ağaç. O beklerse kurur, izler ise kaçmaz.")
S.say("toprak", "Meşe haklı. Önce ağacı kurtaralım.")
S.say("defne", "Peki... Ama sonra o izlerin peşine düşüyoruz!")
S.walk({"toprak": T_POS, "mese": M_POS, "defne": D_POS}, speed=1.45)
S.wait_walk(0.05)
S.act("mese", "turn", to=yaw_deg(M_POS, (29.4, 41.0)), duration=0.5)
S.say("mese", "Bu ağaç hâlâ yaşıyor. Reçinesi taze, kökleri nemli.")
S.say("toprak", "Yani kurtarabilir miyiz?", emote="happy")
S.say("mese", "Hemen kökünün üstüne dikilirse, iyileşebilir.")
S.say("toprak", "Ama bu ağaç çok ağır! Üçümüz bile kaldıramayız.")
S.say("defne", "Siz kaldıramazsınız. Ama rüzgâr kaldırır!", emote="happy")
S.say("toprak", "Ciddi misin? Bu koca çamı mı?")
S.say("defne", "Hiç bu kadar ciddi olmamıştım. Geri çekilin!")

# --- 8. Defne ağacı diker, Meşe suyla ve Toprak kayayla kökünü iyileştirir ------------------------
S.walk({"toprak": (33.4, 37.0, "abs"), "mese": (34.2, 39.6, "abs"), "defne": (34.6, 42.2, "abs")}, speed=1.5)
S.say("mese", "Dikkatli ol Defne. Yavaşça, kökünün tam üstüne.", gap=0.2)
S.wait_walk(0.0)
S.say("defne", "Rüzgâr, bana güç ver!", gap=0.2, emote="angry")
# Ağaç dikme yeteneğinin kendi kamerası: Defne'nin omzunun üstünden ağaca bakar
S.cam({"target": "defne", "size": {"from": 3.0, "to": 3.4}, "angle": {"from": 160, "to": 150}, "elevation": 10,
       "relative": True, "ease": "inOut"})
S.act("defne", "ability", name="agac_dikme", target=FALLEN)
for who in ["toprak", "mese"]:
    S.act(who, "look_at", target=[29.4, GY + 4.0, 41.0], duration=6.5)
S.pause(4.8)
S.act("toprak", "clip", name="jump_joy", duration=2.2, loop=True, fade=0.3)
S.act("mese", "emote", expression="happy", duration=2.4)
S.pause(1.4)
S.cam({"target": GROUP, "size": {"from": 2.6, "to": 2.4}, "angle": {"from": -20, "to": -6}, "elevation": 6,
       "relative": True, "ease": "inOut"}, coverage="dialogue")
S.act("defne", "turn", to="toprak", duration=0.5)
S.say("toprak", "Vay canına! Yaptı!", gap=0.1, emote="happy")
S.say("mese", "Tam yerine oturdu. Aferin Defne.", emote="happy")
S.say("defne", "Söylemiştim! Rüzgâr benim kanadım!", clip=("breakdance", 3.2), emote="happy")
# Kutlama: Defne dans eder, Toprak zıplar, Meşe güler
S.act("defne", "clip", name="hip_hop", duration=2.6, loop=False, fade=0.3)
S.act("toprak", "clip", name="jump_joy", duration=2.6, loop=True, fade=0.3)
S.act("mese", "emote", expression="happy", duration=2.6)
S.pause(2.2)
# Meşe su dalgasıyla, Toprak kaya yükselmesiyle ağacın köküne güç verir (3 element işbirliği!)
S.act("mese", "ability", name="dalga_gosterisi", at=S.t)
S.cam({"target": "mese", "size": {"from": 2.8, "to": 2.4}, "angle": {"from": -45, "to": -28}, "elevation": 9,
       "relative": True, "ease": "inOut"})
S.say("mese", "Şimdi biraz su. Yarası kapansın.", gap=0.75)
S.act("toprak", "ability", name="kaya_yukselisi", at=S.t)
S.cam({"target": "toprak", "size": {"from": 2.6, "to": 2.2}, "angle": {"from": 24, "to": 10}, "elevation": 9,
       "relative": True, "ease": "inOut"})
S.say("toprak", "Ben de kökünü toprakla sarayım.", gap=0.85)
S.cam({"target": GROUP, "size": {"from": 2.6, "to": 2.4}, "angle": {"from": -18, "to": -6}, "elevation": 6,
       "relative": True, "ease": "inOut"}, coverage="dialogue")
S.say("defne", "Bak, şimdiden daha mutlu görünüyor!", gap=0.35)
S.say("toprak", "Ağaçlar mutlu olur mu?")
S.say("mese", "Elbette. Dinlersen, teşekkür ettiğini duyarsın.")
S.pause(0.9)
S.say("defne", "Duydum! Hışırdadı!", emote="happy")
S.say("toprak", "Bence o sadece rüzgârdı.")
S.say("defne", "Rüzgâr da benim, teşekkür de!")
S.pause(0.8)
st_birds = S.say("mese", "Şşş! Dinleyin...", gap=0.2, emote="surprised")
# Ağaç dikildi: kuşlar yeniden öter (Toprak "Kuşlar geri döndü!" demeden hemen önce)
S.birds.append({"at": round(st_birds + 0.8, 2), "on": True, "fade": 2.0})
S.pause(1.2)
S.say("toprak", "Kuşlar! Kuşlar geri döndü!", emote="happy", clip=("jump_joy", 1.85))
S.say("defne", "Demek onlar da ağaç için endişelenmiş.")
S.say("mese", "Orman tek bir aile gibidir. Biri incinirse, hepsi hisseder.")
S.say("toprak", "O zaman geyikler de geri gelir, değil mi?")
S.say("mese", "Gelirler. Korkuları geçince.")

# --- 9. Kapanış ---------------------------------------------------------------------------------
S.cam({"target": "mese", "size": {"from": 2.0, "to": 1.7}, "angle": {"from": 15, "to": 5}, "elevation": 4,
       "relative": True, "ease": "inOut"}, coverage="dialogue")
S.say("mese", "Yine de bir şey içimi rahatsız ediyor.", gap=0.5)
S.say("toprak", "Kesik mi?")
S.say("mese", "Evet. Kim yaptıysa, bir sebebi vardı.")
S.say("defne", "Ve muhtemelen hâlâ ormanda bir yerde.")
S.say("toprak", "O zaman gözümüzü daha da dört açacağız.")
S.say("defne", "Ormanın bekçileri her zaman nöbette!", emote="happy", clip=("macaco_side", 3.28))
S.pause(0.4)
S.say("mese", "Hadi, devriyeye devam edelim. Ama birlikte.")
S.walk({"defne": (56.0, 0.0), "toprak": (55.4, 1.3), "mese": (55.0, -1.3)}, speed=1.45, lead=0.2)
S.cam({"target": GROUP, "size": {"from": 3.0, "to": 4.2}, "angle": {"from": 160, "to": 175}, "elevation": {"from": 8, "to": 14},
       "relative": True, "ease": "inOut"})
S.pause(4.8)
# Son çekim: kesik yer (kütük hizası); kamera yaklaşır, gizemli kapanış
S.cam({"target": [[29.3, GY + 1.6, 36.0], [29.2, GY + 1.2, 35.8]], "size": {"from": 3.2, "to": 2.0}, "angle": {"from": -12, "to": 4},
       "elevation": {"from": 16, "to": 10}, "relative": False, "ease": "inOut"}, transition="fade")
S.pause(4.8)
S.overlays.append({"type": "title_card", "at": round(S.t - 3.4, 2), "duration": 3.4, "badge": "BÖLÜM 1",
                   "title": "Devam edecek...", "subtitle": "Ormanın Bekçileri", "accent": "#16a34a", "position": "top"})
S.pause(0.6)
END = round(S.t, 2)


# ---------------------------------------------------------------------------------------------------
# Bakışlar: dinleyen konuşana bakar (karakterin kendi look_at'i olmayan aralıkta)
# ---------------------------------------------------------------------------------------------------
own = [(a["who"], a["at"], a["at"] + a["duration"]) for a in S.actions if a["do"] == "look_at"]
# Aynı dinleyenin ardışık bakışları arasında kısa boşluk varsa bakış bir sonrakine kadar uzar (baş düze dönüp geri
# gelmesin); 0.5 sn bindirme yumuşak geçiş sağlar
by_who = {}
for i, (who, at, target, dur) in enumerate(S.looks):
    by_who.setdefault(who, []).append(i)
for who, idx in by_who.items():
    for k, i in enumerate(idx[:-1]):
        w, at, target, dur = S.looks[i]
        nxt = S.looks[idx[k + 1]][1]
        # Karakterin kendi bakışı (ör. Meşe kameraya konuşurken) araya giriyorsa oraya kadar uzar
        mine = [s0 for ww, s0, _ in own if ww == who and at + dur <= s0 < nxt + 0.5]
        end = min([nxt + 0.5] + [s0 - 0.05 for s0 in mine])
        if 0 <= nxt - (at + dur) < 3.0 and end > at + dur:
            S.looks[i] = (w, at, target, round(end - at, 2))
for who, at, target, dur in S.looks:
    if any(w == who and not (at + dur <= s0 or at >= s1) for w, s0, s1 in own):
        continue
    S.actions.append({"who": who, "at": at, "do": "look_at", "target": target, "duration": dur})


# ---------------------------------------------------------------------------------------------------
# YAML
# ---------------------------------------------------------------------------------------------------
def js(v):
    return json.dumps(v, ensure_ascii=False)


def flow(d):
    return "{ " + ", ".join(f"{k}: {js(v) if not isinstance(v, dict) else flow(v)}" for k, v in d.items()) + " }"


cams_yaml = []
for i, (at, cam, cov, tr) in enumerate(S.cams):
    end = S.cams[i + 1][0] if i + 1 < len(S.cams) else END
    dur = round(end - at, 2)
    lines = [f"      - at: {at}", f"        duration: {dur}"]
    if i > 0:
        lines.append(f"        transition: {tr}")
    if cov:
        lines.append(f"        coverage: {cov}")
    lines.append(f"        camera: {flow(cam)}")
    cams_yaml.append("\n".join(lines))

S.actions.sort(key=lambda a: (a["at"], a["who"]))
acts_yaml = "\n".join(f"      - {flow(a)}" for a in S.actions)
over_yaml = "\n".join(f"      - {flow(o)}" for o in S.overlays)
talk_n = sum(1 for a in S.actions if a["do"] == "talk")
talk_s = sum(a["duration"] for a in S.actions if a["do"] == "talk")
mm, ss = divmod(END, 60)

CLEAR = [((P0["toprak"][0] + P0["mese"][0]) / 2, (P0["toprak"][1] + P0["mese"][1]) / 2, 7.0),
         (*road_at(165.0), 5.0), (*road_at(157.0), 6.0), (*road_at(150.0), 4.5), (*road_at(128.0), 6.0),
         (*road_at(112.0), 5.5), (*road_at(96.0), 5.0)]
birds_yaml = "\n".join(f"        - {{ at: {b['at']}, on: {str(b['on']).lower()}, fade: {b['fade']} }}" for b in S.birds)
clear_yaml = "\n".join(f"      - {{ at: [{round(x, 2)}, {round(z, 2)}], radius: {r} }}" for x, z, r in CLEAR)
char_yaml = "\n".join(
    f"      - {{ id: {c}, asset: {c}, at: [{P0[c][0]}, 0, {P0[c][1]}], facing: {NORTH0 if c != 'defne' else NORTH0} }}" for c in CAST
)

yaml = f"""# senaryo: Bölüm 1 — Devrilen Çamın Sırrı
# açıklama: Bekçiler sabah devriyesinde sohbet ederek yürür, kuzey koridorunda yolu kapatan gizemli devrik bir çam bulur; kesik düzgün ve kararmıştır. Defne çamı rüzgârla diker. Ağacı kimin devirdiği henüz bilinmez.
# etiketler: bölüm, devriye, gizem, ağaç dikme
# =============================================================================
# ORMANIN BEKÇİLERİ — BÖLÜM 1: DEVRİLEN ÇAMIN SIRRI (≈{int(mm)} dk {int(ss)} sn; açılış klibi ayrıca başa eklenir)
# -----------------------------------------------------------------------------
# BU DOSYA ÜRETİLİR: düzenlemek için tools/build_bolum1.py içindeki senaryoyu değiştirip `python tools/build_bolum1.py`
# çalıştırın (replik süreleri seslerden ya da tahminden hesaplanır, sonraki her şey kayar).
#
# Akış: 1) Sabah buluşması (yolun güney kıvrımı)  2) Devriye yürüyüşü ve sohbet  3) Kaçan geyiklerin izleri
#       4) Kıvrımı dönüş  5) Kuşların sessizliği, Defne önden koşar  6) Koridorda devrik çam  7) İnceleme: kökler
#       sağlam, kesik düzgün ve kararmış, duman kokusu; kim yaptı?  8) Defne çamı rüzgârla diker  9) Kapanış: şüphe
#       sürer, devriye devam eder; son çekim kesik yer.
# {talk_n} replik, toplam konuşma ≈{talk_s:.0f} sn.
# =============================================================================

film:
  title: bolum-1-ormanin-bekcileri
  intro: acilis        # açılış klibi (public/scenarios/acilis.yaml) bölümün başına eklenir
  look:
    grade: soft
  fps: 30
  fade_in: 0
  fade_out: 1.5
  handheld: 0.1
  music:
    src: procedural:main   # yordamsal ana tema (telifsiz); konuşma boyunca kısılır
    volume: 0.22
    ducking: 0.25
    loop: true
    fade_in: 0.2
    fade_out: 1.5

assets:
  # toprak, defne, mese, karabey (src/data/characters.yaml) ve harita (src/data/maps.yaml): ortak tanımlar; burada yalnızca farklı olan alan yazılır

scenes:
  - id: devriye
    environment:
      preset: day
      ground_plane: false
      fog_near: 120
      fog_far: 450
      wind:
        enabled: true
      # Kuşlar: koridorda susar (gizemli sessizlik), ağaç dikilince yeniden öter
      birds:
{birds_yaml}
    props:
      - asset: harita
        at: [0, 0, 0]
        terrain: [Dirt_Road, Dirt_Road_Bare, Dirt_Road_Trails, Road_Edge_Gravel_Dusty, Cobblestone, Grass_Close, Ground_Dirt, Aerial_Grass, Sloped_Rock, Broken_Rocks, Mud_Pile]
    # Oynanan yerlerde uzun kuru otlar ve çalılar kaldırılır (göz hizasındaki kamera karakterleri görsün):
    # buluşma yeri, Defne'nin geliş yolu, izler durağı, antrenman ve sessizlik durakları
    clear_vegetation:
{clear_yaml}
    # Gizemli devrik çam: kuzey koridorunda yolu kapatıyor (kesik düzgün ve kararmış — kimin yaptığı henüz bilinmiyor)
    fallen_trees:
      - {{ tree: {FALLEN}, toward: [{FALLEN_TOWARD[0]}, {FALLEN_TOWARD[1]}] }}
    characters:
{char_yaml}

    cameras:
{chr(10).join(cams_yaml)}

    overlays:
{over_yaml}

    actions:
{acts_yaml}
"""
open(OUT, "w", encoding="utf8", newline="\n").write(yaml)
os.makedirs(os.path.dirname(LINES_JSON), exist_ok=True)
json.dump({"audio_dir": AUDIO_REL, "lines": S.lines}, open(LINES_JSON, "w", encoding="utf8"), ensure_ascii=False, indent=1)
missing = [l for l in S.lines if not l["has_audio"]]
print(f"Yazıldı: {OUT}")
print(f"  süre {int(mm)} dk {ss:.1f} sn, {talk_n} replik ({talk_s:.0f} sn konuşma), {len(S.cams)} kamera girişi")
print(f"  sesi olmayan replik: {len(missing)} ({sum(len(l['text']) for l in missing)} karakter)")
