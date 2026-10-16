"""Amy'yi orijinal .blend dosyasından temiz bir GLB olarak dışa aktarır.

- Fazlalıkları siler (telefon, küp, boş mesh, kullanılmayan iskelet, ışıklar, smd görselleri).
- Mesh'lerin negatif/ölçekli dönüşümlerini uygular.
- Göz dokusunu göz malzemelerine bağlar (orijinalde bağlı değil, gözler bembeyaz kalıyor).
- Yalnızca Amy_skeleton.001 ve ona bağlı mesh'leri, animasyonsuz GLB olarak yazar.
"""
import bpy, sys

out = sys.argv[sys.argv.index('--') + 1]
arm = bpy.data.objects['Amy_skeleton.001']

keep_meshes = [o for o in arm.children if o.type == 'MESH' and o.name != 'Cube']
keep = set([arm] + keep_meshes)
for ob in list(bpy.data.objects):
    if ob not in keep:
        bpy.data.objects.remove(ob, do_unlink=True)

# Animasyon/poz sıfırla: dinlenme (bind) pozunda dışa aktar
if arm.animation_data:
    arm.animation_data.action = None
for pb in arm.pose.bones:
    pb.location = (0, 0, 0)
    pb.rotation_quaternion = (1, 0, 0, 0)
    pb.rotation_euler = (0, 0, 0)
    pb.scale = (1, 1, 1)

# Dönüşümleri uygula (negatif ölçek ve 0.307 gibi ölçekler)
bpy.ops.object.select_all(action='DESELECT')
for ob in keep_meshes:
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    if any(abs(s - 1) > 1e-6 for s in ob.scale) or any(abs(v) > 1e-6 for v in ob.location) or any(abs(v) > 1e-6 for v in ob.rotation_euler):
        bpy.ops.object.select_all(action='DESELECT')
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        print('applied transform', ob.name)

# Malzemeleri sade bir yapıyla yeniden kur: tek Principled BSDF + tek çıktı. Orijinal ağaçta iki çıktı
# ve çerçeveler var; glTF dışa aktarıcısı rengi bulamıyor (malzemeler boş çıkıyor).
eye_img = None
for im in bpy.data.images:
    if im.name.startswith('OfficialAmyEyeAlpah') and im.packed_file:
        eye_img = im
        break
print('eye image', eye_img.name if eye_img else None)

used = set()
for ob in keep_meshes:
    for slot in ob.material_slots:
        if slot.material:
            used.add(slot.material)
for m in used:
    color = (0.8, 0.8, 0.8, 1.0)
    if m.use_nodes:
        bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        diff = next((n for n in m.node_tree.nodes if n.type == 'BSDF_DIFFUSE'), None)
        if bsdf and not bsdf.inputs['Base Color'].is_linked:
            color = tuple(bsdf.inputs['Base Color'].default_value)
        elif diff and not diff.inputs['Color'].is_linked:
            color = tuple(diff.inputs['Color'].default_value)
    else:
        color = tuple(m.diffuse_color)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out_node = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Roughness'].default_value = 1.0
    nt.links.new(bsdf.outputs['BSDF'], out_node.inputs['Surface'])
    if m.name.startswith('chr_amy_eye_dif_HD') and eye_img:
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = eye_img
        nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        print('eye texture ->', m.name)
    print('material', m.name, tuple(round(c, 2) for c in color))

bpy.ops.object.select_all(action='DESELECT')
for ob in keep:
    ob.select_set(True)
bpy.context.view_layer.objects.active = arm

bpy.ops.export_scene.gltf(
    filepath=out,
    export_format='GLB',
    use_selection=True,
    export_skins=True,
    export_morph=True,
    export_animations=False,
    export_yup=True,
    export_apply=False,
)
print('EXPORTED', out)
