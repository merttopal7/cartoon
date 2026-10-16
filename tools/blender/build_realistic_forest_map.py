import bpy
import json
import math
import os
import random
import numpy as np
from mathutils import Vector

orig_glb_path = r"public/models/maps/update-dirt-road-through-forest/Dirt_road_forest.glb"
blend_path = r"public/models/maps/update-dirt-road-through-forest/Dirt_road_forest.blend"
obj_path = r"public/models/maps/update-dirt-road-through-forest/extra/realistic-pine/source/pine_obj/Pine OBJ/Pine 2.obj"
tex_dir = r"public/models/maps/update-dirt-road-through-forest/extra/realistic-pine/source/pine_obj/Pine OBJ"
road_json_path = r"assets-src/maps/dirt-road/road.json"
out_glb = r"public/models/maps/dirt-road.glb"

print("=== 1. STARTING FROM PRISTINE ORIGINAL BASE GLB ===")
bpy.ops.wm.read_homefile(use_empty=True)
bpy.ops.import_scene.gltf(filepath=orig_glb_path)

print("=== 2. REMOVING ONLY DRY BARE TRUNKS & OLD BILLBOARDS ===")
# All bushes (Mesh_Forest_Bush), roadside grass, rocks and logs STAY IN THE SCENE!
to_remove = [
    "Mesh_Background_Tree_Atlas",
    "Mesh_Trunk_Birch",
    "Mesh_Trunk_Oak",
]

for name in to_remove:
    obj = bpy.data.objects.get(name)
    if obj:
        bpy.data.objects.remove(obj, do_unlink=True)
        print(f"Removed: {name}")

print("=== 3. IMPORTING REALISTIC SPEEDTREE PINE ===")
bpy.ops.wm.obj_import(filepath=obj_path)
master = bpy.context.selected_objects[0]
master.name = "Realistic_Pine_Master"

master.rotation_euler = (0, 0, 0)
bpy.context.view_layer.update()

# Target height: 15.0 meters (mature Scots Pine)
raw_min_z = min(v.co.z for v in master.data.vertices)
raw_max_z = max(v.co.z for v in master.data.vertices)
curr_h = raw_max_z - raw_min_z
s = 15.0 / curr_h
master.scale = (s, s, s)
bpy.context.view_layer.update()

# Bake transform so vertex coordinates are strictly upright along +Z with base at Z=0.0
bpy.ops.object.select_all(action='DESELECT')
master.select_set(True)
bpy.context.view_layer.objects.active = master
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# Optimize to balanced game-ready polycount (~76k polys, 50k lush needles preserved!)
mod = master.modifiers.new("Decimate", 'DECIMATE')
mod.ratio = 0.16
bpy.ops.object.modifier_apply(modifier="Decimate")
print(f"Master Pine prepared: dimensions = {master.dimensions}")
print(f"  Trunk base Z: {min(v.co.z for v in master.data.vertices):.2f}m, Top: {max(v.co.z for v in master.data.vertices):.2f}m")
print(f"  Optimized total polygons: {len(master.data.polygons)}")

print("=== 4. PREPARING PBR MATERIALS ===")
pine_rgba_path = os.path.join(tex_dir, "Pine_v2_RGBA.png")
rgba_img = bpy.data.images.load(os.path.abspath(pine_rgba_path), check_existing=True)

bark_diff_path = os.path.join(tex_dir, "Bark.png")
bark_norm_path = os.path.join(tex_dir, "Bark_Normal.png")
pine_norm_path = os.path.join(tex_dir, "Pine_v2_Normal.png")

for slot in master.material_slots:
    mat = slot.material
    if not mat:
        continue
    mat.use_nodes = True
    mat.use_backface_culling = False
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    
    out_node = nodes.new('ShaderNodeOutputMaterial')
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    links.new(bsdf.outputs['BSDF'], out_node.inputs['Surface'])
    
    mat_name = mat.name.lower()
    if "bark" in mat_name or slot.name == "Bark_Mat":
        # Bark trunk
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = bpy.data.images.load(os.path.abspath(bark_diff_path), check_existing=True)
        links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = 0.85
        
        if os.path.exists(bark_norm_path):
            ntex = nodes.new('ShaderNodeTexImage')
            ntex.image = bpy.data.images.load(os.path.abspath(bark_norm_path), check_existing=True)
            ntex.image.colorspace_settings.name = 'Non-Color'
            nmap = nodes.new('ShaderNodeNormalMap')
            links.new(ntex.outputs['Color'], nmap.inputs['Color'])
            links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    else:
        # Pine Needles
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = rgba_img
        links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
        bsdf.inputs['Roughness'].default_value = 0.50
        if hasattr(mat, 'blend_method'):
            mat.blend_method = 'CLIP'
            mat.alpha_threshold = 0.35
            
        if os.path.exists(pine_norm_path):
            ntex = nodes.new('ShaderNodeTexImage')
            ntex.image = bpy.data.images.load(os.path.abspath(pine_norm_path), check_existing=True)
            ntex.image.colorspace_settings.name = 'Non-Color'
            nmap = nodes.new('ShaderNodeNormalMap')
            links.new(ntex.outputs['Color'], nmap.inputs['Color'])
            links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])

print("=== 5. PLANTING REALISTIC PINES (INCLUDING DIRECTLY BEHIND CHARACTERS) ===")
with open(road_json_path, 'r', encoding='utf-8') as f:
    road_data = json.load(f)['points']

road_segments = []
for i in range(len(road_data) - 1):
    p1 = np.array([road_data[i][0], -road_data[i][1]])
    p2 = np.array([road_data[i+1][0], -road_data[i+1][1]])
    w = max(road_data[i][2], road_data[i+1][2])
    road_segments.append((p1, p2, w))

def dist_to_road(px, py):
    p = np.array([px, py])
    min_clearance = float('inf')
    for p1, p2, w in road_segments:
        v = p2 - p1
        l2 = np.dot(v, v)
        if l2 == 0:
            d = np.linalg.norm(p - p1)
        else:
            t = max(0.0, min(1.0, np.dot(p - p1, v) / l2))
            proj = p1 + t * v
            d = np.linalg.norm(p - proj)
        clearance = d - (w / 2.0)
        if clearance < min_clearance:
            min_clearance = clearance
    return min_clearance

random.seed(777)
candidates = []

# --- 1. BEHIND THE CHARACTERS (X: -35 to 15, directly visible in camera framing) ---
# Hill crest behind characters (X: -25 to 16, Y: -18 to -34)
for x in np.arange(-25, 16, 4.5):
    for y in np.arange(-18, -34, -4.5):
        candidates.append((x + random.uniform(-1, 1), y + random.uniform(-1, 1)))

# Road curve verges behind characters (X: -30 to 10, Y: -50 to -86)
for x in np.arange(-30, 10, 5.0):
    for y in np.arange(-52, -86, -6.0):
        candidates.append((x + random.uniform(-1.5, 1.5), y + random.uniform(-1.5, 1.5)))

# --- 2. WALKING CORRIDOR (X: 10 to 76) ---
# Left verge
for x in np.arange(8, 76, 4.8):
    candidates.append((x, -49.5 + random.uniform(-1.0, 0.5)))

# Right verge
for x in np.arange(10, 76, 4.8):
    candidates.append((x, -35.2 + random.uniform(-0.5, 1.0)))

# Mid Left Forest (depth)
for x in np.arange(5, 78, 6.5):
    for y in np.arange(-55, -75, -6.5):
        candidates.append((x + random.uniform(-1.5, 1.5), y + random.uniform(-1.5, 1.5)))

# Mid Right Forest (depth)
for x in np.arange(12, 75, 7.0):
    for y in np.arange(-30, -12, 6.5):
        candidates.append((x + random.uniform(-1.5, 1.5), y + random.uniform(-1.5, 1.5)))

# --- 3. HAIRPIN CURVE & EASTERN BACKDROP (X: 75 to 105) ---
for x in np.arange(76, 105, 7.0):
    for y in np.arange(-50, 25, 8.0):
        candidates.append((x + random.uniform(-2, 2), y + random.uniform(-2, 2)))

# Filter candidates:
# Clearance >= 1.0m ensures trunk is strictly on the grass verge outside dirt path
valid_pines = []
for px, py in candidates:
    clr = dist_to_road(px, py)
    if clr >= 1.0:
        if all(np.hypot(px - ex, py - ey) >= 4.0 for ex, ey, _, _ in valid_pines):
            sc = round(random.uniform(0.95, 1.30), 2)
            rz = round(random.uniform(0, 6.28), 2)
            valid_pines.append((round(px, 1), round(py, 1), sc, rz))

print(f"Generated {len(valid_pines)} pine locations (including behind characters).")

# Snap each tree to the actual terrain ground using Blender raycasting
dg = bpy.context.evaluated_depsgraph_get()

def get_ground_z(scene, dg, x, y):
    hit, loc, norm, idx, obj, mw = scene.ray_cast(dg, Vector((x, y, 120.0)), Vector((0.0, 0.0, -1.0)))
    if hit:
        return loc.z
    hit, loc, norm, idx, obj, mw = scene.ray_cast(dg, Vector((x, y, 220.0)), Vector((0.0, 0.0, -1.0)))
    if hit:
        return loc.z
    return None

pines_coll = bpy.data.collections.new("Realistic_Pines")
bpy.context.scene.collection.children.link(pines_coll)
pines_coll.objects.link(master)

planted_count = 0
for i, (px, py, sc, rz) in enumerate(valid_pines):
    gz = get_ground_z(bpy.context.scene, dg, px, py)
    if gz is None:
        continue
        
    pz = gz - 0.25
    
    if planted_count == 0:
        inst = master
    else:
        inst = bpy.data.objects.new(f"Realistic_Pine_{planted_count:03d}", master.data)
        pines_coll.objects.link(inst)
        
    inst.location = (px, py, pz)
    inst.scale = (sc, sc, sc)
    inst.rotation_euler = (0, 0, rz)
    planted_count += 1

behind_planted = sum(1 for p in valid_pines if p[0] <= 15)
print(f"Successfully planted {planted_count} realistic pines! ({behind_planted} directly behind characters)")

print("=== 5B. GENERATING PINE LODS (LOD0 ~24k, LOD1 ~10k, LOD2 ~4k triangles) ===")
lods_script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pine_lods.py")
exec(compile(open(lods_script, encoding="utf-8").read(), lods_script, "exec"))

print("=== 6. SAVING BLEND FILE ===")
bpy.ops.wm.save_as_mainfile(filepath=blend_path)
print("Saved blend file to:", blend_path)

print("=== 7. EXPORTING GAME-READY GLB TO PUBLIC/MODELS/MAPS ===")
bpy.ops.export_scene.gltf(
    filepath=out_glb,
    export_format='GLB',
    export_image_format='AUTO',
    export_yup=True,
    export_materials='EXPORT',
    export_animations=False,
)
print("SUCCESSFULLY EXPORTED TO:", out_glb)
print("GLB file size:", os.path.getsize(out_glb) / 1024 / 1024, "MB")
