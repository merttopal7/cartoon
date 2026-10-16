"""Doku yolları kırık bir FBX haritayı motor için GLB'ye çevirir.

Kullanım:
  blender -b --python tools/blender/export_map.py -- <girdi.fbx> <dokular_klasörü> <çıktı.glb> [maks_doku=1024]

- Dokular, FBX'teki (başka bilgisayara ait) yollar yerine dosya adına göre <dokular_klasörü> altında
  (alt klasörler dahil) aranır.
- Malzemede renk dokusu bağlı değilse, aynı önekli diğer dokulardan (X_Normal → X_Diffuse) ya da
  malzeme adından tahmin edilir.
- Saydamlık (Opacity) dokusu renk dokusunun alfa kanalına gömülür (glTF tek doku bekler).
- Pürüzlülük haritaları atılır (cel-shade kullanmıyor); renk ve normal dokuları küçültülür.
"""
import bpy, os, re, sys
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
src, tex_root, out = (os.path.abspath(a) for a in argv[:3])
max_tex = int(argv[3]) if len(argv) > 3 else 1024

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)

# Doku dizini: küçük harfli dosya adı (uzantısız) → yol
index = {}
for root, _, files in os.walk(tex_root):
    for f in files:
        if f.lower().endswith(('.png', '.jpg', '.jpeg', '.tga')):
            index.setdefault(os.path.splitext(f)[0].lower().replace(' ', '_'), os.path.join(root, f))

def find(stem):
    return index.get(stem.lower().replace(' ', '_'))

def stem_of(image):
    name = re.sub(r'\.\d{3}$', '', image.name)          # "X.png.002" → "X.png"
    return os.path.splitext(name)[0]

# Malzeme adı → doku öneki (adlar uyuşmayanlar)
ALIAS = {
    'forest_bush': 'bush_leaves', 'wood_fence': 'wooden_fence', 'sloped_rock': 'rock_sloped',
    'mud_pile': 'wall_mud', 'road_edge_gravel_dusty': 'dusty_road_edge_gravel',
}

cache = {}
def load(path, colorspace='sRGB'):
    key = (path, colorspace)
    if key not in cache:
        img = bpy.data.images.load(path, check_existing=False)
        img.colorspace_settings.name = colorspace
        if max(img.size) > max_tex:
            s = max_tex / max(img.size)
            img.scale(max(1, int(img.size[0] * s)), max(1, int(img.size[1] * s)))
        cache[key] = img
    return cache[key]

def with_alpha(diffuse_path, opacity_path):
    """Renk + saydamlık → tek RGBA görsel (aynı boyuta getirilerek)."""
    key = ('rgba', diffuse_path, opacity_path)
    if key in cache:
        return cache[key]
    d = load(diffuse_path)
    o = bpy.data.images.load(opacity_path, check_existing=False)
    o.colorspace_settings.name = 'Non-Color'
    if tuple(o.size) != tuple(d.size):
        o.scale(d.size[0], d.size[1])
    w, h = d.size
    dp = np.empty(w * h * 4, dtype=np.float32); d.pixels.foreach_get(dp)
    op = np.empty(w * h * 4, dtype=np.float32); o.pixels.foreach_get(op)
    dp[3::4] = op[0::4]                                   # opaklık = maskenin kırmızı kanalı
    img = bpy.data.images.new(os.path.basename(diffuse_path).rsplit('.', 1)[0] + '_RGBA', w, h, alpha=True)
    img.pixels.foreach_set(dp)
    img.file_format = 'PNG'
    img.pack()
    bpy.data.images.remove(o)
    cache[key] = img
    return img

report = []
for mat in list(bpy.data.materials):
    if not mat.use_nodes:
        continue
    stems = [stem_of(n.image) for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image]
    # Öncelik malzemenin kendi adında; sonra bağlı dokuların önekleri
    base = mat.name.lower()
    prefixes = [ALIAS.get(base, base)]
    for st in stems:
        p = re.sub(r'_(diffuse|normal|roughness|opacity)$', '', st, flags=re.I).lower()
        if p not in prefixes:
            prefixes.append(p)

    def pick(kind):
        for p in prefixes:
            hit = find(f'{p}_{kind}')
            if hit:
                return hit
        # Ortak maske/pürüzlülük dosyaları (ör. Grass_Vegetation_Opacity)
        for s in stems:
            if s.lower().endswith(kind):
                hit = find(s)
                if hit:
                    return hit
        return None

    diffuse, normal, opacity = pick('diffuse'), pick('normal'), pick('opacity')

    # Malzemeyi sade bir yapıyla yeniden kur
    color = (0.6, 0.6, 0.6, 1.0)
    nt = mat.node_tree
    old = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if old and not old.inputs['Base Color'].is_linked:
        color = tuple(old.inputs['Base Color'].default_value)
    nt.nodes.clear()
    out_node = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Roughness'].default_value = 1.0
    nt.links.new(bsdf.outputs['BSDF'], out_node.inputs['Surface'])
    if diffuse:
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = with_alpha(diffuse, opacity) if opacity else load(diffuse)
        nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        if opacity:
            nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
    if normal:
        ntex = nt.nodes.new('ShaderNodeTexImage')
        ntex.image = load(normal, 'Non-Color')
        nmap = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(ntex.outputs['Color'], nmap.inputs['Color'])
        nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    report.append(f"{mat.name:24} diffuse={os.path.basename(diffuse) if diffuse else '-':38} normal={'+' if normal else '-'} alpha={'+' if opacity else '-'}")

print('\n'.join(report))
# Kullanılmayan (kırık yollu) görselleri temizle
for img in list(bpy.data.images):
    if img.users == 0:
        bpy.data.images.remove(img)

# Renk dokuları JPEG (saydamlar PNG) yazılsın
bpy.ops.export_scene.gltf(
    filepath=out,
    export_format='GLB',
    export_image_format='AUTO',
    export_yup=True,
    export_animations=False,
    export_materials='EXPORT',
)
print('EXPORTED', out)
