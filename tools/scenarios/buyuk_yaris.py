"""'Büyük Yarış' senaryosunu (public/scenarios/bolum-5-buyuk-yaris.yaml) yol verisinden üretir.

Kullanım: python tools/scenarios/buyuk_yaris.py
Karakterlerin yol üzerindeki şeritleri, varış zamanları, düşme noktası ve bitiş çizgisi
assets-src/maps/dirt-road/road.json orta çizgisinden hesaplanır; çekim zamanlamaları buna göre kurulur.
"""
import json, math, os

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
P = [p[:2] for p in json.load(open(os.path.join(ROOT, 'assets-src/maps/dirt-road/road.json')))['points']]
OUT = os.path.join(ROOT, 'public/scenarios/bolum-5-buyuk-yaris.yaml')
A = 'models/characters/main-character/animations'

# ------------------------------------------------------------------ yol yardımcıları
def direction(i):
    a, b = P[max(0, i - 1)], P[min(len(P) - 1, i + 1)]
    dx, dz = b[0] - a[0], b[1] - a[1]
    n = math.hypot(dx, dz) or 1
    return dx / n, dz / n

def at(i, off=0.0, ahead=0.0):
    """i. noktadan 'off' m sola (yürüme yönüne göre), 'ahead' m ileri."""
    dx, dz = direction(i)
    lx, lz = dz, -dx           # yürüme yönünün solu (motorda +x sağ, +z ileri bakışta)
    x, z = P[i]
    return [round(x + lx * off + dx * ahead, 2), round(z + lz * off + dz * ahead, 2)]

def lane(i0, i1, off):
    step = 1 if i1 >= i0 else -1
    return [at(i, off) for i in range(i0, i1 + step, step)]

def length(pts):
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:]))

def facing(i, back=False):
    dx, dz = direction(i)
    if back:
        dx, dz = -dx, -dz
    return round(math.degrees(math.atan2(dx, dz)), 1)

def toward(a, b):
    return round(math.degrees(math.atan2(b[0] - a[0], b[1] - a[1])), 1)

def pts(lst):
    return '[' + ', '.join(f'[{p[0]}, {p[1]}]' for p in lst) + ']'

def xz(p):
    return f'[{p[0]}, 0, {p[1]}]'

# ================================================================== SAHNE 1: sabah + yarış
# Açıklık (yol çok geniş: 20–28 m) idx 8–16; yarış idx 16 → 76; düşme idx 48.
K_START = at(8, 0.0)
K_SPOT = at(12, 0.8)
J_START = at(23, -0.5)
J_SPOT = at(12, 0.8, ahead=2.6)               # çocuğun 2.6 m önünde (yolun ilerisi)
A_START = at(2, 0.0)
A_SPOT = at(11, -2.8)

START_I, FALL_I, FINISH_I = 16, 48, 76
K_LINE, J_LINE = at(START_I, 1.1), at(START_I, -1.1)
A_REF = at(START_I + 1, 4.2)                  # hakem: yolun kenarında, biraz önde
RACE_DIR = facing(START_I)

k_walk_in = length([K_START, K_SPOT]) / 1.1
T_RACE = 10 + 9 + 4.5 + 9 + 4 + 6.5 + 4 + 4.5 + 3.5 + 5 + 6 + 3.5 + 5.5 + 3.5   # 1–13. çekimlerin toplamı
K_SPEED, J_SPEED, A_SPEED = 4.0, 4.35, 2.4

kid_lane1 = lane(START_I, FALL_I, 1.1)
kid_lane2 = lane(FALL_I, FINISH_I, 1.1)
jackie_lane = lane(START_I, FINISH_I, -1.1)
t_fall = T_RACE + length([K_LINE] + kid_lane1[1:]) / K_SPEED
FALL_DUR, STAND_DUR = 2.5, 2.6
t_resume = t_fall + FALL_DUR + STAND_DUR - 0.4
t_kid_finish = t_resume + length(kid_lane2) / (K_SPEED + 0.3)
t_jackie_finish = T_RACE + length([J_LINE] + jackie_lane[1:]) / J_SPEED

# Amy kestirmeden (yolun iç kısmındaki çayırdan) bitişe gider; kadraj dışında kalır.
A_FINISH = at(FINISH_I + 1, 3.6)
a_short = [A_REF, [9.0, 22.0], A_FINISH]
T_AMY_GO = T_RACE + 3.0
t_amy_finish = T_AMY_GO + length(a_short) / A_SPEED

print(f'çocuk yürüyerek gelir: {k_walk_in:.1f} sn')
print(f'yarış başlar {T_RACE}  | çocuk düşer {t_fall:.1f} | kalkar {t_resume:.1f} | çocuk bitiş {t_kid_finish:.1f}')
print(f'jackie bitiş {t_jackie_finish:.1f} | amy bitiş {t_amy_finish:.1f}')
assert t_amy_finish < t_jackie_finish - 4, 'Amy önce varmalı'

TJ = round(t_jackie_finish, 1)
TK = round(t_kid_finish, 1)
TF = round(t_fall, 1)
S1_END = round(TK + 15, 1)

# ================================================================== SAHNE 2: gün batımı
W0, W1, W2 = 92, 100, 106
s2_lane = {'jackie': -1.3, 'amy': 0.0, 'cocuk': 1.3}
s2_walk_t = length(lane(W0, W1, 0)) / 1.05

yaml = f'''# Bölüm 5: Büyük Yarış  (~5 dk, sessiz / pandomim)
# Bu dosya tools/scenarios/buyuk_yaris.py ile üretildi; konumlar ve zamanlar yolun orta çizgisinden
# (assets-src/maps/dirt-road/road.json) hesaplandı. Değiştirmek için betiği düzenleyip yeniden çalıştırın.
#
# 1. perde (sabah): Çocuk yoldaki açıklıkta ısınır. Jackie gelip meydan okur, yolu göstererek yarış teklif eder.
#    Amy koşarak gelir ve hakem olur.
# 2. perde (yarış): Düz yol, firkete, iniş. Çocuk tökezleyip kapaklanır, kalkıp devam eder. Jackie önde
#    bitişe varıp sevinir… ama Amy kestirmeden çoktan gelmiştir. İkisi de yıkılır, Amy dans eder.
# 3. perde (gün batımı): Eve dönerken manzara, Amy'nin şarkısı, şakadan kavga, dans düellosu ve
#    birlikte gün batımına yürüyüş.
# Ctrl+Enter ile uygula.

film:
  title: bolum-5-buyuk-yaris
  fps: 30
  fade_in: 1.5
  fade_out: 3
  handheld: 0.3

assets:
  cocuk:
    src: models/characters/main-character/kid.fbx
    height: 1.4
    animations:
      idle:       {A}/Neutral Idle.fbx
      walk:       {A}/Walking.fbx
      kosu:       {A}/Running.fbx
      esneme:     {A}/Arm Stretching.fbx
      sinav:      {A}/Jump Push Up.fbx
      sasirma:    {A}/Surprised.fbx
      tekme:      {A}/Martelo 2.fbx
      hazir:      {A}/Action Idle To Fight Idle.fbx
      dusme:      {A}/Fall Flat.fbx
      kalkma:     {A}/Crouch To Stand.fbx
      yenilgi:    {A}/Defeated.fbx
      isaret:     {A}/Kneeling Pointing.fbx
      mma:        {A}/Mma Kick.fbx
      olum:       {A}/Standing Death Left 01.fbx
      flair:      {A}/Flair.fbx
      hiphop:     {A}/Hip Hop Dancing.fbx
      sevinc:     {A}/Joyful Jump.fbx
  jackie:
    src: models/characters/Jackie/character.fbx
    height: 1.68
    animations:
      idle:       {A}/Neutral Idle.fbx
      walk:       {A}/Walking.fbx
      jogging:    {A}/Jogging.fbx
      kosu:       {A}/Running.fbx
      meydan:     {A}/Taunt.fbx
      isaret:     {A}/Kneeling Pointing.fbx
      hazir:      {A}/Action Idle To Fight Idle.fbx
      sevinc:     {A}/Joyful Jump.fbx
      sasirma:    {A}/Surprised.fbx
      yenilgi:    {A}/Defeated.fbx
      kacinma:    {A}/Standing Dodge Backward.fbx
      martelo:    {A}/Martelo 2.fbx
      breakdance: {A}/Breakdance 1990.fbx
      hiphop:     {A}/Hip Hop Dancing.fbx
  amy:
    src: models/characters/Amy/amy.glb
    height: 1.3
    eyelids: {{ axis: y, open: -0.6 }}
    animations:
      idle:       {A}/Neutral Idle.fbx
      walk:       {A}/Walking.fbx
      kosu:       {A}/Running.fbx
      jogging:    {A}/Jogging.fbx
      sevinc:     {A}/Joyful Jump.fbx
      isaret:     {A}/Kneeling Pointing.fbx
      meydan:     {A}/Taunt.fbx
      dans:       {A}/Silly Dancing.fbx
      sarki:      {A}/Singing.fbx
  harita: {{ src: models/maps/dirt-road.glb, align: none }}

scenes:
  # ================================================================== 1. PERDE: SABAH
  - id: sabah
    environment:
      preset: day
      ground_plane: false
      fog_near: 80
      fog_far: 320
    props:
      - asset: harita
        at: [0, 0, 0]
        terrain: [Aerial_Grass, Dirt_Road, Dirt_Road_Bare, Ground_Dirt, Grass_Close]
    characters:
      - {{ id: cocuk,  asset: cocuk,  at: {xz(K_START)}, facing: {toward(K_START, K_SPOT)} }}
      - {{ id: jackie, asset: jackie, at: {xz(J_START)}, facing: {facing(23, back=True)} }}
      - {{ id: amy,    asset: amy,    at: {xz(A_START)}, facing: {toward(A_START, A_SPOT)} }}
    shots:
      # 0) Siyahtan açılış: ormanın üstünden kuşbakışı, kamera yolu izleyerek açıklığa süzülür
      - duration: 10
        camera: {{ target: {xz(at(10, 0))}, size: {{ from: 60, to: 26 }}, angle: {{ from: 230, to: 200 }}, elevation: {{ from: 40, to: 28 }}, ease: inOut }}

      # 1) Kamera açıklığa alçalır; çocuk yürüyerek gelir
      - duration: 9
        camera: {{ target: cocuk, size: {{ from: 8, to: full }}, angle: {{ from: 20, to: 10 }}, elevation: {{ from: 28, to: 6 }}, relative: true }}
        actions:
          - {{ who: cocuk, do: walk_to, at: 0.5, speed: 1.1, to: {pts([K_SPOT])} }}

      # 2) Durur, sabah havasını koklar gibi etrafına bakınır
      - duration: 4.5
        camera: {{ target: cocuk, size: medium, angle: 25, elevation: 4, relative: true }}
        actions:
          - {{ who: cocuk, do: look_at, target: [-20, 6, 40], at: 0.3, duration: 1.8 }}
          - {{ who: cocuk, do: look_at, target: [10, 6, 60], at: 2.2, duration: 2.0 }}

      # 3) Kocaman esner, kollarını gerer
      - duration: 9
        camera: {{ target: cocuk, size: full, angle: -35, elevation: 6, relative: true }}
        actions:
          - {{ who: cocuk, do: clip, name: esneme, at: 0.2, duration: 8.6 }}

      # 4) Isınma: zıplamalı şınav
      - duration: 4
        camera: {{ target: cocuk, size: full, angle: 70, elevation: 8, relative: true }}
        actions:
          - {{ who: cocuk, do: clip, name: sinav, loop: true, at: 0.3, duration: 3.4, fade: 0.3 }}
          - {{ who: jackie, do: walk_to, at: 0, speed: 1.8, clip: jogging, to: {pts(lane(23, 13, -0.5)[1:] + [J_SPOT])} }}

      # 5) Geniş plan: yolun ilerisinden Jackie hafif koşuyla gelir
      - duration: 6.5
        camera: {{ target: [cocuk, jackie], size: full, angle: 200, elevation: 10, relative: true }}

      # 6) Çocuk onu görür: şaşkınlık
      - duration: 4
        camera: {{ target: cocuk, size: medium, angle: 20, elevation: 4, relative: true }}
        actions:
          - {{ who: cocuk, do: turn, to: jackie, at: 0, duration: 0.6 }}
          - {{ who: cocuk, do: clip, name: sasirma, at: 0.3, duration: 3.6 }}

      # 7) Jackie gelir, durur ve meydan okur
      - duration: 4.5
        camera: {{ target: jackie, size: full, angle: 25, elevation: 6, relative: true }}
        actions:
          - {{ who: jackie, do: turn, to: cocuk, at: 0, duration: 0.5 }}
          - {{ who: jackie, do: clip, name: meydan, at: 0.9, duration: 2.83 }}

      # 8) Çocuk tekmesiyle cevap verir
      - duration: 3.5
        camera: {{ target: cocuk, size: full, angle: 40, elevation: 6, relative: true }}
        actions:
          - {{ who: cocuk, do: clip, name: tekme, at: 0.4, duration: 1.4 }}
          - {{ who: cocuk, do: look_at, target: jackie, at: 1.9, duration: 1.6 }}

      # 9) Jackie yolun aşağısını gösterir: "Oraya kadar yarış!"
      - duration: 5
        camera: {{ target: [cocuk, jackie], size: full, angle: 100, elevation: 10, relative: true }}
        actions:
          - {{ who: jackie, do: turn, to: {RACE_DIR}, at: 0.2, duration: 0.6 }}
          - {{ who: jackie, do: clip, name: isaret, at: 0.8, duration: 3.9 }}
          - {{ who: cocuk, do: look_at, target: [60, 4, 40], at: 1.2, duration: 3.5 }}
          - {{ who: amy, do: walk_to, at: 3.5, speed: 3.4, clip: kosu, to: {pts(lane(3, 10, 0)[1:] + [A_SPOT])} }}

      # 10) Arkadan, güneyden Amy koşarak gelir
      - duration: 6
        camera: {{ target: amy, size: 1.8, angle: 200, elevation: 12, relative: true }}
        actions:
          - {{ who: cocuk, do: turn, to: amy, at: 3.0, duration: 0.7 }}
          - {{ who: jackie, do: turn, to: amy, at: 3.4, duration: 0.7 }}

      # 11) Amy sevinçle zıplar: "Ben de varım!"
      - duration: 3.5
        camera: {{ target: amy, size: full, angle: 15, elevation: 6, relative: true }}
        actions:
          - {{ who: amy, do: clip, name: sevinc, at: 0.4, duration: 1.85 }}

      # 12) Başlangıç çizgisine geçerler; Amy hakem olur
      - duration: 5.5
        camera: {{ target: [cocuk, jackie, amy], size: full, angle: 150, elevation: 14, relative: true }}
        actions:
          - {{ who: cocuk,  do: walk_to, at: 0.3, speed: 1.3, to: {pts([K_LINE])} }}
          - {{ who: jackie, do: walk_to, at: 0.5, speed: 1.3, to: {pts([J_LINE])} }}
          - {{ who: amy,    do: walk_to, at: 0.8, speed: 1.3, to: {pts([A_REF])} }}
          - {{ who: cocuk,  do: turn, to: {RACE_DIR}, at: 4.4, duration: 0.6 }}
          - {{ who: jackie, do: turn, to: {RACE_DIR}, at: 4.4, duration: 0.6 }}
          - {{ who: amy,    do: turn, to: {RACE_DIR}, at: 4.6, duration: 0.6 }}

      # 13) Hazır ol… (ikisi dövüş duruşunda bekler; Amy işaret verir)
      - duration: 3.5
        camera: {{ target: [cocuk, jackie], size: medium, angle: 10, elevation: 3, relative: true }}
        actions:
          - {{ who: cocuk,  do: clip, name: hazir, at: 0.2, duration: 3.3, fade: 0.25 }}
          - {{ who: jackie, do: clip, name: hazir, at: 0.3, duration: 3.2, fade: 0.25 }}
          - {{ who: amy,    do: clip, name: isaret, at: 0.6, duration: 3.6 }}

      # ================================================================ 2. PERDE: YARIŞ
      # 14) Başla! Önden alçak takip
      - duration: 5
        camera: {{ target: [cocuk, jackie], size: full, angle: 8, elevation: 3, relative: true }}
        actions:
          - {{ who: cocuk,  do: walk_to, at: 0.1, speed: {K_SPEED}, clip: kosu, to: {pts(kid_lane1[1:])} }}
          - {{ who: jackie, do: walk_to, at: 0.0, speed: {J_SPEED}, clip: kosu, to: {pts(jackie_lane[1:])} }}
          - {{ who: amy,    do: clip, name: sevinc, at: 1.0, duration: 1.85 }}
          - {{ who: amy,    do: walk_to, at: 3.0, speed: {A_SPEED}, clip: jogging, to: {pts(a_short[1:])} }}

      # 15) Çapraz plan: ağaçların önünden geçerler
      - duration: 6
        camera: {{ target: [cocuk, jackie], size: 1.5, angle: 50, elevation: 9, relative: true }}

      # 16) Arkadan takip: Jackie öne geçiyor
      - duration: 6
        camera: {{ target: [cocuk, jackie], size: full, angle: 180, elevation: 10, relative: true }}

      # 17) Çocuğa yakın: kararlı
      - duration: 5
        camera: {{ target: cocuk, size: medium, angle: 12, elevation: 3, relative: true }}

      # 18) Firkete: yüksekten geniş plan
      - duration: {round(TF - 2 - (T_RACE + 22), 1)}
        camera: {{ target: [cocuk, jackie], size: 3, angle: 190, elevation: 24, relative: true }}

      # 19) Çocuk tökezler ve yüzüstü kapaklanır!
      - duration: 4.5
        camera: {{ target: cocuk, size: full, angle: 35, elevation: 6, relative: true }}
        actions:
          - {{ who: cocuk, do: clip, name: dusme, at: 2.0, duration: {FALL_DUR}, fade: 0.15 }}
          - {{ who: cocuk, do: clip, name: kalkma, at: {2.0 + FALL_DUR - 0.2}, duration: {STAND_DUR}, fade: 0.3 }}

      # 20) Toparlanıp kalkar ve yeniden koşar
      - duration: {round(t_resume + 0.6 - (TF + 2.5), 1)}
        camera: {{ target: cocuk, size: medium, angle: 25, elevation: 4, relative: true }}
        actions:
          - {{ who: cocuk, do: walk_to, at: {round(t_resume - (TF + 2.5), 2)}, speed: {K_SPEED + 0.3}, clip: kosu, to: {pts(kid_lane2[1:])} }}

      # 21) Jackie koşarken arkasına bakar
      - duration: 5
        camera: {{ target: jackie, size: full, angle: 10, elevation: 5, relative: true }}
        actions:
          - {{ who: jackie, do: look_at, target: cocuk, at: 1.0, duration: 2.2 }}

      # 22) Çocuk hırsla koşar
      - duration: {round(TJ - 4 - (t_resume + 5.6), 1)}
        camera: {{ target: cocuk, size: full, angle: 170, elevation: 8, relative: true }}

      # 23) Bitiş: Jackie gelir ve zafer zıplaması yapar
      - duration: 6
        camera: {{ target: jackie, size: full, angle: 20, elevation: 6, relative: true }}
        actions:
          - {{ who: jackie, do: clip, name: sevinc, at: 4.5, duration: 1.85 }}

      # 24) …döner ve Amy'yi görür! Amy çoktan oradadır
      - duration: 5
        camera: {{ target: [jackie, amy], size: full, angle: 190, elevation: 10, relative: true }}
        actions:
          - {{ who: jackie, do: turn, to: amy, at: 0.3, duration: 0.6 }}
          - {{ who: jackie, do: clip, name: sasirma, at: 0.9, duration: 3.98 }}
          - {{ who: amy,    do: turn, to: jackie, at: 0.0, duration: 0.5 }}
          - {{ who: amy,    do: clip, name: meydan, at: 1.6, duration: 2.83 }}

      # 25) Çocuk nefes nefese gelir… ve o da Amy'yi görür
      - duration: {round(TK + 4.5 - (TJ + 7), 1)}
        camera: {{ target: cocuk, size: full, angle: 15, elevation: 6, relative: true }}
        actions:
          - {{ who: cocuk, do: look_at, target: amy, at: {round(TK - (TJ + 7) + 0.5, 1)}, duration: 3 }}

      # 26) İkisi birden yıkılır; Amy zafer dansı yapar
      - duration: 14
        camera: {{ target: [cocuk, jackie, amy], size: {{ from: full, to: 1.8 }}, angle: {{ from: 195, to: 215 }}, elevation: 12, relative: true, ease: linear }}
        actions:
          - {{ who: cocuk,  do: clip, name: yenilgi, at: 0.4, duration: 6.7, fade: 0.5 }}
          - {{ who: jackie, do: clip, name: yenilgi, at: 0.6, duration: 6.7, fade: 0.5 }}
          - {{ who: amy,    do: turn, to: cocuk, at: 0, duration: 0.5 }}
          - {{ who: amy,    do: clip, name: dans, loop: true, at: 1.0, duration: 12.6, fade: 0.5 }}

  # ================================================================== 3. PERDE: GÜN BATIMI
  - id: gun-batimi
    environment:
      preset: sunset
      ground_plane: false
      fog_near: 70
      fog_far: 280
    props:
      - asset: harita
        at: [0, 0, 0]
        terrain: [Aerial_Grass, Dirt_Road, Dirt_Road_Bare, Ground_Dirt, Grass_Close]
    characters:
      - {{ id: jackie, asset: jackie, at: {xz(at(W0, s2_lane['jackie']))}, facing: {facing(W0)} }}
      - {{ id: amy,    asset: amy,    at: {xz(at(W0, s2_lane['amy']))}, facing: {facing(W0)} }}
      - {{ id: cocuk,  asset: cocuk,  at: {xz(at(W0, s2_lane['cocuk']))}, facing: {facing(W0)} }}
    shots:
      # 27) Karartmadan açılır: akşamüstü, üçü eve doğru yürür
      - duration: 12
        transition: fade
        camera: {{ target: [jackie, amy, cocuk], size: {{ from: 6, to: full }}, angle: {{ from: 20, to: 5 }}, elevation: {{ from: 25, to: 6 }}, relative: true }}
        actions:
          - {{ who: jackie, do: walk_to, at: 0.6, speed: 1.05, to: {pts(lane(W0, W1, s2_lane['jackie'])[1:])} }}
          - {{ who: amy,    do: walk_to, at: 0.4, speed: 1.05, to: {pts(lane(W0, W1, s2_lane['amy'])[1:])} }}
          - {{ who: cocuk,  do: walk_to, at: 0.8, speed: 1.05, to: {pts(lane(W0, W1, s2_lane['cocuk'])[1:])} }}

      # 28) Önden: yorgun ama mutlu
      - duration: 9
        camera: {{ target: [jackie, amy, cocuk], size: 1.1, angle: 6, elevation: 4, relative: true }}
        actions:
          - {{ who: amy, do: look_at, target: cocuk, at: 2, duration: 1.6 }}
          - {{ who: cocuk, do: look_at, target: jackie, at: 4, duration: 1.8 }}

      # 29) Arkadan: güneş ağaçların arasından
      - duration: {round(s2_walk_t + 1.5 - 21, 1)}
        camera: {{ target: [jackie, amy, cocuk], size: full, angle: 180, elevation: 9, relative: true }}

      # 30) Çocuk durur, diz çöküp manzarayı gösterir
      - duration: 5
        camera: {{ target: cocuk, size: full, angle: 40, elevation: 5, relative: true }}
        actions:
          - {{ who: cocuk, do: clip, name: isaret, at: 0.5, duration: 3.9 }}
          - {{ who: amy, do: look_at, target: [-90, 10, -90], at: 1.2, duration: 3.5 }}
          - {{ who: jackie, do: look_at, target: [-90, 10, -90], at: 1.6, duration: 3.2 }}

      # 31) Gösterdiği yer: yolun ötesinde gün batımı
      - duration: 6
        camera: {{ target: [jackie, amy, cocuk], size: 3.5, angle: 175, elevation: 14, relative: true }}

      # 32) Amy şarkı söylemeye başlar
      - duration: 8
        camera: {{ target: amy, size: medium, angle: 10, elevation: 3, relative: true }}
        actions:
          - {{ who: amy, do: turn, to: cocuk, at: 0, duration: 0.6 }}
          - {{ who: amy, do: clip, name: sarki, at: 0.6, duration: 18.4, fade: 0.6 }}
          - {{ who: cocuk, do: turn, to: amy, at: 0.3, duration: 0.7 }}
          - {{ who: jackie, do: turn, to: amy, at: 0.5, duration: 0.7 }}

      # 33) İkisi dinler
      - duration: 4.5
        camera: {{ target: [cocuk, jackie], size: full, angle: 200, elevation: 8, relative: true }}
        actions:
          - {{ who: cocuk, do: look_at, target: amy, at: 0, duration: 4.5 }}
          - {{ who: jackie, do: look_at, target: amy, at: 0, duration: 4.5 }}

      # 34) Şarkının sonu: geniş, yavaş dönen plan
      - duration: 7
        camera: {{ target: [jackie, amy, cocuk], size: full, angle: {{ from: 150, to: 125 }}, elevation: 10, relative: true, ease: linear }}

      # 35) Jackie çocuğa meydan okur: "Şimdi dans!"… çocuk tekmeyle şaka yapar, Jackie kaçar
      - duration: 5
        camera: {{ target: [cocuk, jackie], size: full, angle: 100, elevation: 7, relative: true }}
        actions:
          - {{ who: jackie, do: turn, to: cocuk, at: 0, duration: 0.5 }}
          - {{ who: cocuk, do: turn, to: jackie, at: 0.2, duration: 0.5 }}
          - {{ who: jackie, do: clip, name: meydan, at: 0.4, duration: 2.83 }}
          - {{ who: cocuk, do: clip, name: mma, at: 3.0, duration: 1.6 }}
          - {{ who: jackie, do: clip, name: kacinma, at: 3.2, duration: 1.62 }}

      # 36) Jackie dönerek tekme atar; çocuk "vuruldum!" diye abartarak yere yığılır
      - duration: 4.5
        camera: {{ target: [cocuk, jackie], size: full, angle: 80, elevation: 9, relative: true }}
        actions:
          - {{ who: jackie, do: clip, name: martelo, at: 0.3, duration: 1.3 }}
          - {{ who: cocuk, do: clip, name: olum, at: 0.6, duration: 6.4, fade: 0.25 }}

      # 37) Amy gülerek onu gösterir; Jackie sevinir
      - duration: 4
        camera: {{ target: [amy, jackie], size: full, angle: 190, elevation: 9, relative: true }}
        actions:
          - {{ who: amy, do: turn, to: cocuk, at: 0, duration: 0.4 }}
          - {{ who: amy, do: clip, name: isaret, at: 0.3, duration: 3.6 }}
          - {{ who: jackie, do: clip, name: sevinc, at: 0.8, duration: 1.85 }}

      # 38) Çocuk kalkar… ve flair ile cevap verir
      - duration: 8
        camera: {{ target: cocuk, size: full, angle: {{ from: 30, to: 70 }}, elevation: 8, relative: true, ease: linear }}
        actions:
          - {{ who: cocuk, do: clip, name: kalkma, at: 0.2, duration: 2.5, fade: 0.4 }}
          - {{ who: cocuk, do: clip, name: flair, loop: true, at: 2.7, duration: 5.3, fade: 0.4 }}

      # 39) Jackie breakdance ile karşılık verir
      - duration: 7
        camera: {{ target: jackie, size: full, angle: {{ from: -20, to: -60 }}, elevation: 8, relative: true, ease: linear }}
        actions:
          - {{ who: jackie, do: clip, name: breakdance, loop: true, at: 0.2, duration: 6.8, fade: 0.4 }}
          - {{ who: cocuk, do: look_at, target: jackie, at: 0, duration: 7 }}

      # 40) Amy de katılır; sonra üçü birlikte dans eder
      - duration: 8
        camera: {{ target: amy, size: full, angle: 15, elevation: 6, relative: true }}
        actions:
          - {{ who: amy, do: clip, name: dans, loop: true, at: 0.2, duration: 25.6, fade: 0.4 }}

      - duration: 9
        camera: {{ target: [jackie, amy, cocuk], size: full, angle: {{ from: 200, to: 160 }}, elevation: 10, relative: true, ease: linear }}
        actions:
          - {{ who: cocuk, do: clip, name: hiphop, loop: true, at: 0.2, duration: 17.6, fade: 0.4 }}
          - {{ who: jackie, do: clip, name: hiphop, loop: true, at: 0.5, duration: 17.3, fade: 0.4 }}

      - duration: 9
        camera: {{ target: [jackie, amy, cocuk], size: {{ from: full, to: 2 }}, angle: {{ from: 160, to: 130 }}, elevation: {{ from: 10, to: 16 }}, relative: true, ease: linear }}

      # 41) Hep birlikte sevinçle zıplarlar
      - duration: 4
        camera: {{ target: [jackie, amy, cocuk], size: full, angle: 185, elevation: 8, relative: true }}
        actions:
          - {{ who: cocuk,  do: clip, name: sevinc, at: 0.4, duration: 1.85 }}
          - {{ who: jackie, do: clip, name: sevinc, at: 0.5, duration: 1.85 }}
          - {{ who: amy,    do: clip, name: sevinc, at: 0.6, duration: 1.85 }}

      # 42) Gün batımına doğru birlikte yürürler; kamera kalır ve yükselir, perde kapanır
      - duration: 26
        camera:
          target: [jackie, amy, cocuk]
          size: {{ from: full, to: 4 }}
          angle: {{ from: 185, to: 200 }}
          elevation: {{ from: 8, to: 22 }}
          relative: true
          ease: inOut
        actions:
          - {{ who: jackie, do: turn, to: {facing(W1)}, at: 0, duration: 0.6 }}
          - {{ who: amy,    do: turn, to: {facing(W1)}, at: 0, duration: 0.6 }}
          - {{ who: cocuk,  do: turn, to: {facing(W1)}, at: 0, duration: 0.6 }}
          - {{ who: jackie, do: walk_to, at: 0.8, speed: 1.0, to: {pts(lane(W1, W2 + 6, s2_lane['jackie'])[1:])} }}
          - {{ who: amy,    do: walk_to, at: 0.6, speed: 1.0, to: {pts(lane(W1, W2 + 6, s2_lane['amy'])[1:])} }}
          - {{ who: cocuk,  do: walk_to, at: 1.0, speed: 1.0, to: {pts(lane(W1, W2 + 6, s2_lane['cocuk'])[1:])} }}
'''
open(OUT, 'w', encoding='utf-8').write(yaml)
print('yazıldı:', OUT, f'(1. sahne ~{S1_END} sn)')
