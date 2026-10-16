"""Çam ağaçları için LOD seviyeleri üretir ve haritadaki her ağaca bağlar.

Açık .blend üzerinde çalışır (build_realistic_forest_map.py sonunda ya da elle):
  blender -b Dirt_road_forest.blend --python tools/blender/pine_lods.py

- "Pine 2" (76k üçgen) kaynak olarak korunur (fake user).
- İğne yaprak kartlarının bir kısmı tutulur, kalanlar merkezlerinden büyütülür ki tacın dolgunluğu kalsın.
  Gövdede kısa dallar atılır; ana gövde (tek ada, 116 yüz) her seviyede kalır.
- Her Realistic_Pine_* nesnesi LOD0'ı kullanır; "<ad>_LOD1" ve "<ad>_LOD2" alt nesneleri eklenir.
  Motor (src/engine/lod.ts) bu alt nesnelerden THREE.LOD kurar.
"""
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

SOURCE_MESH = "Pine 2"
# (ad, tutulan iğne kartı oranı, kart büyütme, gövde/dal adası en az uzunluk m)
LEVELS = [
    ("Pine_LOD0", 0.32, 1.38, 0.5),
    ("Pine_LOD1", 0.14, 1.70, 1.0),
    ("Pine_LOD2", 0.06, 2.30, 2.0),
]
NEEDLE_MAT = 1  # Pine 2 malzemeleri: [Bark_Mat, Pine_v2_Mat]


def build_level(src, name, keep_frac, grow, min_extent):
    bm = bmesh.new()
    bm.from_mesh(src)
    bm.faces.ensure_lookup_table()
    rnd = random.Random(777)
    seen, kill = set(), []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack, comp = [f], []
        seen.add(f.index)
        while stack:
            g = stack.pop()
            comp.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        stack.append(h)
        verts = {v for g in comp for v in g.verts}
        if comp[0].material_index == NEEDLE_MAT:
            if rnd.random() > keep_frac:
                kill.extend(comp)
                continue
            c = sum((v.co for v in verts), Vector()) / len(verts)
            for v in verts:
                v.co = c + (v.co - c) * grow
        else:
            extent = max(max(v.co[i] for v in verts) - min(v.co[i] for v in verts) for i in range(3))
            if extent < min_extent:
                kill.extend(comp)
    bmesh.ops.delete(bm, geom=kill, context='FACES')

    me = bpy.data.meshes.get(name) or bpy.data.meshes.new(name)
    me.clear_geometry()
    # Malzemeler geometriden önce atanır: materials.clear() yüzlerin malzeme indeksini sıfırlar
    me.materials.clear()
    for mat in src.materials:
        me.materials.append(mat)
    bm.to_mesh(me)
    bm.free()
    me.use_fake_user = True
    per_mat = [sum(1 for p in me.polygons if p.material_index == i) for i in range(len(me.materials))]
    print(f"{name}: {len(me.polygons)} üçgen, malzeme başına {per_mat}")
    return me


def main():
    src = bpy.data.meshes[SOURCE_MESH]
    src.use_fake_user = True
    lods = [build_level(src, *lv) for lv in LEVELS]

    pines = [o for o in bpy.data.objects
             if o.type == 'MESH' and o.name.startswith("Realistic_Pine") and "_LOD" not in o.name
             and o.data in (src, lods[0])]
    for tree in pines:
        tree.data = lods[0]
        for i, me in enumerate(lods[1:], start=1):
            name = f"{tree.name}_LOD{i}"
            child = bpy.data.objects.get(name) or bpy.data.objects.new(name, me)
            child.data = me
            for coll in tree.users_collection:
                if child.name not in coll.objects:
                    coll.objects.link(child)
            child.parent = tree
            child.matrix_parent_inverse = Matrix.Identity(4)
            child.location = (0, 0, 0)
            child.rotation_euler = (0, 0, 0)
            child.scale = (1, 1, 1)
    print(f"{len(pines)} ağaca LOD bağlandı")


main()
