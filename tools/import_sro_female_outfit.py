"""
Ortak Kadın Kostüm İçe Aktarıcı (Silkroad Online .bsr -> public/models/outfits/female/<id>.fbx)
================================================================================================
Kullanım (Blender içinden veya MCP execute_blender_code ile):

    from tools.import_sro_female_outfit import import_and_export_female_outfit
    import_and_export_female_outfit(
        outfit_id="yeni_kostum",
        body_bsr=r"C:\Users\DELL\Desktop\VSRODevelopment\PK2\Data\res\item\avatar\avatar_w_example.bsr",
        hat_bsr=r"C:\Users\DELL\Desktop\VSRODevelopment\PK2\Data\res\item\avatar\avatar_w_example_hat.bsr",       # İsteğe bağlı
        attach_bsr=r"C:\Users\DELL\Desktop\VSRODevelopment\PK2\Data\res\item\avatar\avatar_w_example_attach.bsr", # İsteğe bağlı
        is_pants=True,  # Pantolon/çizme ise True, uzun etek ise False
    )

Çıktı:
    `public/models/outfits/female/<outfit_id>.fbx`
    Ardından `src/engine/outfits.ts` içindeki `FEMALE_OUTFITS` dizisine 1 satır eklenmesi yeterlidir;
    hem Defne hem Meşe otomatik olarak kendi vücut ölçülerine uyarlanmış şekilde giyebilir.
"""

import os
import math
import bpy
import bmesh
from mathutils import Vector

PK2_DATA_PATH = r"C:\Users\DELL\Desktop\VSRODevelopment\PK2\Data"
PROJECT_ROOT = r"C:\Users\DELL\Desktop\VSRODevelopment\EYLUL2026\cartoon"
OUT_DIR = os.path.join(PROJECT_ROOT, "public", "models", "outfits", "female")


def smoothstep(e0: float, e1: float, x: float) -> float:
    t = max(0.0, min(1.0, (x - e0) / max(1e-6, e1 - e0)))
    return t * t * (3.0 - 2.0 * t)


def piecewise(x: float, pts: list[tuple[float, float]]) -> float:
    if x <= pts[0][0]:
        x0, y0 = pts[0]
        x1, y1 = pts[1]
        return y0 + (x - x0) * (y1 - y0) / max(1e-5, x1 - x0)
    if x >= pts[-1][0]:
        x0, y0 = pts[-2]
        x1, y1 = pts[-1]
        return y1 + (x - x1) * (y1 - y0) / max(1e-5, x1 - x0)
    for i in range(len(pts) - 1):
        x0, y0 = pts[i]
        x1, y1 = pts[i + 1]
        if x0 <= x <= x1:
            t = (x - x0) / max(1e-5, x1 - x0)
            return y0 + t * (y1 - y0)
    return pts[-1][1]


def strip_ddj_alpha_to_png(src_img: bpy.types.Image, out_png_path: str) -> bpy.types.Image:
    """Silkroad DDS/DDJ dokularındaki düşük specular alfa kanalını (0.067) opak PNG'ye çevirir."""
    w, h = src_img.size
    px = list(src_img.pixels[:])
    for i in range(3, len(px), 4):
        px[i] = 1.0
    out_img = bpy.data.images.new("_tmp_opaque", width=w, height=h, alpha=True)
    out_img.pixels[:] = px
    out_img.filepath_raw = out_png_path
    out_img.file_format = 'PNG'
    out_img.save()
    bpy.data.images.remove(out_img)
    loaded = bpy.data.images.load(out_png_path, check_existing=True)
    loaded.pack()
    return loaded


def assign_weights(obj: bpy.types.Object, arm_obj: bpy.types.Object, mode: str = 'BODY', is_pants: bool = True):
    """Kanonik kadın Mixamo iskeletine (Armature) otomatik ve pürüzsüz kemik ağırlığı atar."""
    obj.vertex_groups.clear()
    obj.parent = arm_obj
    obj.matrix_parent_inverse = arm_obj.matrix_world.inverted()
    mod = next((m for m in obj.modifiers if m.type == 'ARMATURE'), None)
    if not mod:
        mod = obj.modifiers.new(name='Armature', type='ARMATURE')
    mod.object = arm_obj

    bone_names = {b.name for b in arm_obj.data.bones}
    prefix = 'mixamorig1:' if 'mixamorig1:Hips' in bone_names else 'mixamorig:'
    mw = obj.matrix_world.copy()
    groups = {}

    def add_w(vi: int, bname: str, w: float):
        if w <= 1e-4:
            return
        full_name = prefix + bname
        vg = groups.get(full_name)
        if vg is None:
            vg = obj.vertex_groups.new(name=full_name)
            groups[full_name] = vg
        vg.add([vi], w, 'REPLACE')

    for v in obj.data.vertices:
        vi = v.index
        wco = mw @ v.co
        x = wco.x
        hm = wco.z
        ax = abs(x)

        if mode == 'HAT':
            if hm < 1.26:
                add_w(vi, 'Spine2', 1.0)
            elif hm < 1.36:
                t = smoothstep(1.26, 1.36, hm)
                add_w(vi, 'Spine2', (1.0 - t) * 0.5)
                add_w(vi, 'Neck', (1.0 - t) * 0.5)
                add_w(vi, 'Head', t)
            else:
                add_w(vi, 'Head', 1.0)
            continue

        if mode == 'ATTACH':
            add_w(vi, 'Spine2', 0.85)
            add_w(vi, 'Spine1', 0.15)
            continue

        # Kol bölgesi
        if hm > 0.96 and ax > 0.12:
            side = 'Left' if x > 0 else 'Right'
            w_torso = 1.0 - smoothstep(0.12, 0.17, ax)
            w_arm_total = 1.0 - w_torso
            if w_torso > 0:
                add_w(vi, 'Spine2', w_torso * 0.65)
                add_w(vi, f'{side}Shoulder', w_torso * 0.35)
            if ax < 0.33:
                t = smoothstep(0.14, 0.33, ax)
                add_w(vi, f'{side}Shoulder', w_arm_total * (1.0 - t) * 0.35)
                add_w(vi, f'{side}Arm', w_arm_total * ((1.0 - t) * 0.65 + t * 0.75))
                add_w(vi, f'{side}ForeArm', w_arm_total * t * 0.25)
            elif ax < 0.54:
                t = smoothstep(0.31, 0.54, ax)
                add_w(vi, f'{side}Arm', w_arm_total * (1.0 - t) * 0.4)
                add_w(vi, f'{side}ForeArm', w_arm_total * ((1.0 - t) * 0.6 + t * 0.8))
                add_w(vi, f'{side}Hand', w_arm_total * t * 0.2)
            else:
                t = smoothstep(0.52, 0.60, ax)
                add_w(vi, f'{side}ForeArm', w_arm_total * (1.0 - t) * 0.35)
                add_w(vi, f'{side}Hand', w_arm_total * ((1.0 - t) * 0.65 + t))
            continue

        # Bacaklar & Üst Gövde
        if hm < 0.90:
            side = 'Left' if x >= 0 else 'Right'
            k_split = smoothstep(0.005, 0.035, ax) if is_pants else smoothstep(0.02, 0.08, ax)
            other = 'Right' if side == 'Left' else 'Left'
            w_main = 0.5 + 0.5 * k_split
            w_other = 0.5 * (1.0 - k_split)

            def add_leg_pair(bone_suffix: str, weight: float):
                add_w(vi, f'{side}{bone_suffix}', weight * w_main)
                if w_other > 0.01:
                    add_w(vi, f'{other}{bone_suffix}', weight * w_other)

            if hm < 0.09:
                t = smoothstep(0.03, 0.09, hm)
                add_leg_pair('ToeBase', 1.0 - t)
                add_leg_pair('Foot', t)
            elif hm < 0.52:
                t = smoothstep(0.08, 0.50, hm)
                add_leg_pair('Foot', (1.0 - t) * 0.7)
                add_leg_pair('Leg', (1.0 - t) * 0.3 + t)
            else:
                t = smoothstep(0.48, 0.86, hm)
                w_hip = smoothstep(0.76, 0.90, hm)
                rem = 1.0 - w_hip
                add_leg_pair('Leg', rem * (1.0 - t) * 0.75)
                add_leg_pair('UpLeg', rem * ((1.0 - t) * 0.25 + t))
                if w_hip > 0:
                    add_w(vi, 'Hips', w_hip)
        else:
            if hm < 1.04:
                t = smoothstep(0.88, 1.04, hm)
                add_w(vi, 'Hips', 1.0 - t)
                add_w(vi, 'Spine', t)
            elif hm < 1.15:
                t = smoothstep(1.04, 1.15, hm)
                add_w(vi, 'Spine', 1.0 - t)
                add_w(vi, 'Spine1', t)
            elif hm < 1.27:
                t = smoothstep(1.15, 1.27, hm)
                add_w(vi, 'Spine1', 1.0 - t)
                add_w(vi, 'Spine2', t)
            else:
                t = smoothstep(1.26, 1.33, hm)
                add_w(vi, 'Spine2', 1.0 - t)
                add_w(vi, 'Neck', t)
