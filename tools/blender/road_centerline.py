"""Bir haritadaki yol mesh'lerinden yolun orta çizgisini çıkarır (motor koordinatlarında, metre).

Kullanım:
  blender -b --python tools/blender/road_centerline.py -- <harita.fbx> <çıktı.json> <yol_malzemeleri,virgüllü> <x,z;x,z;... kaba rota>

Yöntem: yol üçgenleri 0.5 m ızgaraya rasterize edilir, her hücrenin yol kenarına uzaklığı hesaplanır.
Kaba rota her 3 m'de örneklenir ve her örnek, çevresindeki (6 m) en "orta" hücreye (kenara en uzak)
kaydırılır. Çıktı: düzgünleştirilmiş nokta listesi ve her noktadaki yol genişliği ile yüksekliği.
Not: glTF (motor) koordinatları x = Blender x, z = -Blender y.
"""
import bpy, sys, json, math
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
src, out, mats_arg, route_arg = argv[:4]
road_mats = {m.strip().lower() for m in mats_arg.split(',')}
route = [tuple(map(float, p.split(','))) for p in route_arg.split(';')]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)

tris = []
for o in bpy.data.objects:
    if o.type != 'MESH':
        continue
    names = {s.material.name.lower() for s in o.material_slots if s.material}
    if not names & road_mats:
        continue
    me = o.data
    me.calc_loop_triangles()
    mw = o.matrix_world
    co = [mw @ v.co for v in me.vertices]
    for t in me.loop_triangles:
        a, b, c = (co[i] for i in t.vertices)
        tris.append(((a.x, -a.y, a.z), (b.x, -b.y, b.z), (c.x, -c.y, c.z)))
tris = np.array(tris, dtype=np.float64)   # (n, 3, [x, z, y])
print('road triangles', len(tris))

cell = 0.5
minx, minz = tris[:, :, 0].min() - 2, tris[:, :, 1].min() - 2
maxx, maxz = tris[:, :, 0].max() + 2, tris[:, :, 1].max() + 2
W, H = int((maxx - minx) / cell) + 1, int((maxz - minz) / cell) + 1
mask = np.zeros((H, W), dtype=bool)
height = np.full((H, W), np.nan)
for (a, b, c) in tris:
    x0, x1 = int((min(a[0], b[0], c[0]) - minx) / cell), int((max(a[0], b[0], c[0]) - minx) / cell) + 1
    z0, z1 = int((min(a[1], b[1], c[1]) - minz) / cell), int((max(a[1], b[1], c[1]) - minz) / cell) + 1
    gx, gz = np.meshgrid(np.arange(x0, x1 + 1), np.arange(z0, z1 + 1))
    px, pz = minx + gx * cell, minz + gz * cell
    det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    if abs(det) < 1e-9:
        continue
    w0 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (pz - c[1])) / det
    w1 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (pz - c[1])) / det
    w2 = 1 - w0 - w1
    inside = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
    ok = inside & (gx >= 0) & (gx < W) & (gz >= 0) & (gz < H)
    mask[gz[ok], gx[ok]] = True
    height[gz[ok], gx[ok]] = (w0 * a[2] + w1 * b[2] + w2 * c[2])[ok]

# Kenara uzaklık (iki geçişli yaklaşık Öklid / chamfer dönüşümü)
INF = 1e9
dist = np.where(mask, INF, 0.0)
d1, d2 = 1.0, math.sqrt(2)
for z in range(H):
    for x in range(W):
        if dist[z, x] == 0:
            continue
        v = dist[z, x]
        if x > 0: v = min(v, dist[z, x - 1] + d1)
        if z > 0:
            v = min(v, dist[z - 1, x] + d1)
            if x > 0: v = min(v, dist[z - 1, x - 1] + d2)
            if x < W - 1: v = min(v, dist[z - 1, x + 1] + d2)
        dist[z, x] = v
for z in range(H - 1, -1, -1):
    for x in range(W - 1, -1, -1):
        if dist[z, x] == 0:
            continue
        v = dist[z, x]
        if x < W - 1: v = min(v, dist[z, x + 1] + d1)
        if z < H - 1:
            v = min(v, dist[z + 1, x] + d1)
            if x < W - 1: v = min(v, dist[z + 1, x + 1] + d2)
            if x > 0: v = min(v, dist[z + 1, x - 1] + d2)
        dist[z, x] = v
dist *= cell

# Kaba rotayı 3 m'de örnekle, her örneği yerel olarak en "orta" hücreye kaydır
samples = []
for (ax, az), (bx, bz) in zip(route, route[1:]):
    n = max(1, int(math.hypot(bx - ax, bz - az) / 3))
    for i in range(n):
        samples.append((ax + (bx - ax) * i / n, az + (bz - az) * i / n))
samples.append(route[-1])

R = int(6 / cell)
pts = []
for (sx, sz) in samples:
    cx, cz = int((sx - minx) / cell), int((sz - minz) / cell)
    z0, z1, x0, x1 = max(0, cz - R), min(H, cz + R + 1), max(0, cx - R), min(W, cx + R + 1)
    win = dist[z0:z1, x0:x1]
    if win.max() <= 0:
        continue
    # Merkezden uzaklığa küçük bir ceza: komşu kollara atlamasın
    gz, gx = np.mgrid[z0:z1, x0:x1]
    score = win - 0.08 * np.hypot(gx - cx, gz - cz) * cell
    iz, ix = np.unravel_index(np.argmax(score), score.shape)
    zz, xx = z0 + iz, x0 + ix
    pts.append([round(minx + xx * cell, 2), round(minz + zz * cell, 2), round(float(dist[zz, xx]) * 2, 2), round(float(height[zz, xx]), 2)])

# Hafif düzgünleştirme (3'lü ortalama) ve tekrarları at
sm = []
for i in range(len(pts)):
    seg = pts[max(0, i - 1): i + 2]
    sm.append([round(sum(p[0] for p in seg) / len(seg), 2), round(sum(p[1] for p in seg) / len(seg), 2), pts[i][2], pts[i][3]])
clean = [sm[0]]
for p in sm[1:]:
    if math.hypot(p[0] - clean[-1][0], p[1] - clean[-1][1]) > 1.5:
        clean.append(p)
json.dump({'points': clean, 'note': '[x, z, genişlik_m, yükseklik_y]'}, open(out, 'w'), indent=0)
print('centerline points', len(clean), 'width min/median/max',
      min(p[2] for p in clean), sorted(p[2] for p in clean)[len(clean) // 2], max(p[2] for p in clean))
print('WROTE', out)
