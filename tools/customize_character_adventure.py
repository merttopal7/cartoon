import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

def build_adventure_textures():
    tex_dir = r"public/models/characters/main-character/textures"
    diff_path = os.path.join(tex_dir, "Boy01_diffuse.jpg")
    norm_path = os.path.join(tex_dir, "Boy01_normal.jpg")
    spec_path = os.path.join(tex_dir, "Boy01_spec.jpg")

    diff_img = Image.open(diff_path).convert("RGB")
    norm_img = Image.open(norm_path).convert("RGB")
    spec_img = Image.open(spec_path).convert("RGB")

    w, h = diff_img.size
    print(f"Base textures: {w}x{h}")

    diff_arr = np.array(diff_img, dtype=np.float32)
    norm_arr = np.array(norm_img, dtype=np.float32)
    spec_arr = np.array(spec_img, dtype=np.float32)

    # =========================================================================
    # 1. BELT BUCKLE: COMPLETE BRAND REMOVAL & BRONZE MOUNTAIN EMBLEM
    # Exact center in 2048x2048: (751, 1124)
    # =========================================================================
    print("1. Customizing Belt Buckle (Complete Mixamo Erase)...")
    bcx, bcy = 751, 1124
    rx, ry = 50, 24
    rx_border, ry_border = 55, 29

    yy, xx = np.indices((h, w))
    dist_oval = ((xx - bcx) / float(rx))**2 + ((yy - bcy) / float(ry))**2
    dist_border = ((xx - bcx) / float(rx_border))**2 + ((yy - bcy) / float(ry_border))**2

    buckle_inner = dist_oval <= 1.0
    buckle_border = (dist_border <= 1.0) & (~buckle_inner)

    # Border: dark gunmetal / antique iron
    diff_arr[buckle_border] = [38.0, 36.0, 32.0]

    # Inner buckle: clean brushed antique brass (NO remnant of original text luminance)
    brush = (np.sin(yy * 0.9) * 3.5 + np.sin(xx * 0.15) * 2.0).astype(np.float32)
    diff_arr[buckle_inner, 0] = np.clip(185.0 + brush[buckle_inner], 160, 215)
    diff_arr[buckle_inner, 1] = np.clip(152.0 + brush[buckle_inner], 130, 180)
    diff_arr[buckle_inner, 2] = np.clip(88.0 + brush[buckle_inner] * 0.6, 70, 115)

    # Normal map: erase "mixamo" emboss
    norm_arr[buckle_border] = [128.0, 128.0, 255.0]
    norm_arr[buckle_inner] = [128.0, 128.0, 255.0]

    # Specular map: uniform metallic sheen
    spec_arr[buckle_border] = [80.0, 80.0, 80.0]
    spec_arr[buckle_inner] = [175.0, 175.0, 175.0]

    # Draw crisp engraved mountain emblem on buckle
    diff_img = Image.fromarray(np.clip(diff_arr, 0, 255).astype(np.uint8))
    norm_img = Image.fromarray(np.clip(norm_arr, 0, 255).astype(np.uint8))
    draw_diff = ImageDraw.Draw(diff_img)
    draw_norm = ImageDraw.Draw(norm_img)

    # Mountain peaks
    m1 = [(bcx - 26, bcy + 10), (bcx - 9, bcy - 11), (bcx + 8, bcy + 10)]
    m2 = [(bcx - 6, bcy + 10), (bcx + 13, bcy - 7), (bcx + 27, bcy + 10)]
    draw_diff.polygon(m1, fill=(132, 108, 62), outline=(50, 40, 25), width=1)
    draw_diff.polygon(m2, fill=(148, 122, 72), outline=(50, 40, 25), width=1)
    # Snowcap peaks
    draw_diff.polygon([(bcx - 13, bcy - 2), (bcx - 9, bcy - 11), (bcx - 5, bcy - 2)], fill=(245, 245, 235))
    draw_diff.polygon([(bcx + 9, bcy - 1), (bcx + 13, bcy - 7), (bcx + 17, bcy - 1)], fill=(245, 245, 235))
    # Compass sun / star
    draw_diff.ellipse([bcx - 4, bcy - 17, bcx + 4, bcy - 9], fill=(245, 230, 160), outline=(60, 50, 30))

    # Emboss on normal map for mountain
    draw_norm.line([(bcx - 9, bcy - 11), (bcx + 8, bcy + 10)], fill=(210, 128, 240), width=2)
    draw_norm.line([(bcx - 26, bcy + 10), (bcx - 9, bcy - 11)], fill=(50, 128, 240), width=2)
    draw_norm.line([(bcx + 13, bcy - 7), (bcx + 27, bcy + 10)], fill=(210, 128, 240), width=2)

    # =========================================================================
    # 2. STRAPS & MIXAMO PIN CLEANUP
    # =========================================================================
    print("2. Erasing strap text ('ANIMATOR' / 'SAN FRAN') and replacing Mixamo pin...")
    diff_arr = np.array(diff_img, dtype=np.float32)

    # Clean strap text at x: 20..220, y: 220..500
    strap_crop = diff_arr[220:500, 20:220]
    strap_lum = strap_crop[:, :, 0] * 0.3 + strap_crop[:, :, 1] * 0.59 + strap_crop[:, :, 2] * 0.11
    text_mask = (strap_lum > 50) & (strap_lum < 165)
    for c in range(3):
        channel = strap_crop[:, :, c]
        channel[text_mask] = 25.0  # dark tactical canvas
        strap_crop[:, :, c] = channel
    diff_arr[220:500, 20:220] = strap_crop

    # Replace Mixamo pin at (1435, 712) with Explorer Club badge
    diff_img = Image.fromarray(np.clip(diff_arr, 0, 255).astype(np.uint8))
    draw_diff = ImageDraw.Draw(diff_img)

    pin_cx, pin_cy, pin_r = 1435, 712, 44
    draw_diff.ellipse([pin_cx - pin_r, pin_cy - pin_r, pin_cx + pin_r, pin_cy + pin_r], 
                      fill=(28, 48, 34), outline=(210, 180, 100), width=3)
    draw_diff.ellipse([pin_cx - pin_r + 5, pin_cy - pin_r + 5, pin_cx + pin_r - 5, pin_cy + pin_r - 5], 
                      outline=(170, 145, 75), width=1)
    # 4-point compass star
    star_pts = [
        (pin_cx, pin_cy - 26), (pin_cx + 7, pin_cy - 7),
        (pin_cx + 26, pin_cy), (pin_cx + 7, pin_cy + 7),
        (pin_cx, pin_cy + 26), (pin_cx - 7, pin_cy + 7),
        (pin_cx - 26, pin_cy), (pin_cx - 7, pin_cy - 7)
    ]
    draw_diff.polygon(star_pts, fill=(238, 215, 135), outline=(45, 55, 35), width=1)
    draw_diff.ellipse([pin_cx - 4, pin_cy - 4, pin_cx + 4, pin_cy + 4], fill=(175, 45, 30))

    # =========================================================================
    # 3. HOODIE: DOĞA & MACERA KHAKI/OLIVE COLOR
    # =========================================================================
    print("3. Transforming Hoodie to Olive Khaki Green...")
    diff_arr = np.array(diff_img, dtype=np.float32)

    def recolor_cloth(sub_arr, target_rgb, exclude_orange=True):
        lum = (sub_arr[:, :, 0] * 0.299 + sub_arr[:, :, 1] * 0.587 + sub_arr[:, :, 2] * 0.114)
        r_diff = sub_arr[:, :, 0] - sub_arr[:, :, 1]
        b_diff = sub_arr[:, :, 1] - sub_arr[:, :, 2]
        
        is_gray_cloth = (lum > 30) & (lum < 235) & (abs(r_diff) < 28) & (abs(b_diff) < 28)
        if exclude_orange:
            is_orange = (sub_arr[:, :, 0] > 140) & (sub_arr[:, :, 1] < 110) & (sub_arr[:, :, 2] < 70)
            is_gray_cloth = is_gray_cloth & (~is_orange)

        norm_lum = lum / 128.0
        new_sub = sub_arr.copy()
        for i in range(3):
            recolored = np.clip(norm_lum * target_rgb[i], 0, 255)
            new_sub[:, :, i][is_gray_cloth] = (recolored[is_gray_cloth] * 0.88 + 
                                                sub_arr[:, :, i][is_gray_cloth] * 0.12)
        return new_sub

    olive_khaki = [76.0, 98.0, 64.0]

    # Sleeves
    diff_arr[0:640, 220:875] = recolor_cloth(diff_arr[0:640, 220:875], olive_khaki)

    # Front torso
    diff_arr[0:640, 1380:2048] = recolor_cloth(diff_arr[0:640, 1380:2048], olive_khaki)

    # Preserve badges at top left of torso
    orig_badges = np.array(Image.open(diff_path).convert("RGB"), dtype=np.float32)[0:190, 1380:1580]
    diff_arr[0:190, 1380:1580] = orig_badges

    # =========================================================================
    # 4. UNDERSHIRT / COLLAR / CUFFS: EARTHY TERRACOTTA / AMBER
    # =========================================================================
    print("4. Shifting bright orange accents to Earthy Terracotta...")
    orange_mask = (diff_arr[:, :, 0] > 140) & (diff_arr[:, :, 1] < 115) & (diff_arr[:, :, 2] < 70)
    cap_region = np.zeros_like(orange_mask)
    cap_region[550:1080, 0:450] = True
    shirt_orange = orange_mask & (~cap_region)

    r_factor = 178.0 / 235.0
    g_factor = 92.0 / 78.0
    b_boost = 32.0

    diff_arr[:, :, 0][shirt_orange] = np.clip(diff_arr[:, :, 0][shirt_orange] * r_factor, 0, 255)
    diff_arr[:, :, 1][shirt_orange] = np.clip(diff_arr[:, :, 1][shirt_orange] * g_factor, 0, 255)
    diff_arr[:, :, 2][shirt_orange] = np.clip(diff_arr[:, :, 2][shirt_orange] + b_boost, 0, 255)

    # =========================================================================
    # 5. CAP: FOREST PINE GREEN & ADVENTURE PATCH
    # =========================================================================
    print("5. Converting Cap to Forest Pine Green and adding mountain crest...")
    cap_cx, cap_cy = 210, 765
    cap_r = 188

    yy, xx = np.indices((h, w))
    dist_cap = np.sqrt((xx - cap_cx)**2 + (yy - cap_cy)**2)
    cap_mask = dist_cap <= cap_r

    cap_lum = (diff_arr[:, :, 0] * 0.3 + diff_arr[:, :, 1] * 0.59 + diff_arr[:, :, 2] * 0.11)
    norm_cap_lum = cap_lum / 130.0

    forest_green = np.array([46.0, 70.0, 52.0])
    for i in range(3):
        diff_arr[:, :, i][cap_mask] = np.clip(norm_cap_lum[cap_mask] * forest_green[i] * 1.05, 0, 255)

    diff_img = Image.fromarray(np.clip(diff_arr, 0, 255).astype(np.uint8))
    draw_diff = ImageDraw.Draw(diff_img)

    # Embroidered mountain patch on cap (facing back)
    patch_cx = cap_cx - 10
    patch_cy = cap_cy - 120
    draw_diff.rounded_rectangle([patch_cx - 48, patch_cy - 30, patch_cx + 48, patch_cy + 30], 
                                radius=8, fill=(35, 45, 36), outline=(190, 160, 95), width=2)
    draw_diff.rounded_rectangle([patch_cx - 43, patch_cy - 25, patch_cx + 43, patch_cy + 25], 
                                radius=5, outline=(150, 125, 75), width=1)
    m1 = [(patch_cx - 36, patch_cy + 18), (patch_cx - 12, patch_cy - 16), (patch_cx + 12, patch_cy + 18)]
    m2 = [(patch_cx - 4, patch_cy + 18), (patch_cx + 20, patch_cy - 10), (patch_cx + 38, patch_cy + 18)]
    draw_diff.polygon(m1, fill=(195, 170, 105), outline=(50, 55, 40))
    draw_diff.polygon(m2, fill=(215, 190, 125), outline=(50, 55, 40))
    draw_diff.polygon([(patch_cx - 17, patch_cy - 7), (patch_cx - 12, patch_cy - 16), (patch_cx - 7, patch_cy - 7)], fill=(245, 245, 240))
    draw_diff.polygon([(patch_cx + 15, patch_cy - 3), (patch_cx + 20, patch_cy - 10), (patch_cx + 25, patch_cy - 3)], fill=(245, 245, 240))

    # Also clean the cap brim / visor area (x: 0..240, y: 980..1060)
    # Recolor any remaining orange in cap brim to forest green
    brim_orange = orange_mask & (xx < 260) & (yy > 970) & (yy < 1080)
    diff_arr = np.array(diff_img, dtype=np.float32)
    for i in range(3):
        diff_arr[:, :, i][brim_orange] = forest_green[i] * 0.75

    # =========================================================================
    # 6. BACKPACK: EXPEDITION CANVAS & BRAND CLEANUP
    # Coordinates: x in [1430, 2048], y in [550, 980]
    # Erase "mixamo", "ANIMATOR 4 LIFE", and replace "MANSPORT" badge
    # =========================================================================
    print("6. Transforming Backpack to Rugged Expedition Tan Canvas and cleaning scribbles...")
    bag_x1, bag_x2 = 1440, 2048
    bag_y1, bag_y2 = 550, 980
    bag_crop = diff_arr[bag_y1:bag_y2, bag_x1:bag_x2]

    # Blue backpack pixels: B > R and B > 50
    is_blue_bag = (bag_crop[:, :, 2] > bag_crop[:, :, 0] + 15) & (bag_crop[:, :, 2] > 40)
    bag_lum = bag_crop[:, :, 0] * 0.2 + bag_crop[:, :, 1] * 0.3 + bag_crop[:, :, 2] * 0.5
    norm_bag_lum = bag_lum / 110.0

    # Rugged Expedition Canvas / Desert Tan: [152, 130, 95]
    tan_canvas = np.array([152.0, 130.0, 95.0])
    for i in range(3):
        recolored_bag = np.clip(norm_bag_lum * tan_canvas[i], 0, 255)
        bag_crop[:, :, i][is_blue_bag] = recolored_bag[is_blue_bag]

    diff_arr[bag_y1:bag_y2, bag_x1:bag_x2] = bag_crop
    diff_img = Image.fromarray(np.clip(diff_arr, 0, 255).astype(np.uint8))
    draw_diff = ImageDraw.Draw(diff_img)

    # Replace the red MANSPORT badge (x: 1610..1690, y: 645..685) with an embossed leather expedition badge
    lbl_cx, lbl_cy = 1650, 665
    draw_diff.rounded_rectangle([lbl_cx - 48, lbl_cy - 20, lbl_cx + 48, lbl_cy + 20], 
                                radius=4, fill=(55, 40, 28), outline=(180, 145, 90), width=2)
    # Stitched border
    draw_diff.rounded_rectangle([lbl_cx - 44, lbl_cy - 16, lbl_cx + 44, lbl_cy + 16], 
                                radius=3, outline=(130, 100, 60), width=1)
    # Mountain logo in center of badge
    bm1 = [(lbl_cx - 24, lbl_cy + 10), (lbl_cx - 8, lbl_cy - 8), (lbl_cx + 8, lbl_cy + 10)]
    bm2 = [(lbl_cx - 4, lbl_cy + 10), (lbl_cx + 12, lbl_cy - 4), (lbl_cx + 26, lbl_cy + 10)]
    draw_diff.polygon(bm1, fill=(210, 185, 125))
    draw_diff.polygon(bm2, fill=(185, 160, 105))
    draw_diff.polygon([(lbl_cx - 12, lbl_cy - 1), (lbl_cx - 8, lbl_cy - 8), (lbl_cx - 4, lbl_cy - 1)], fill=(250, 250, 245))

    # =========================================================================
    # 7. SNEAKERS: TRAIL ADVENTURE ACCENTS
    # Coordinates: x in [1000, 1650], y in [850, 1450]
    # =========================================================================
    print("7. Adding trail adventure accents to sneakers...")
    diff_arr = np.array(diff_img, dtype=np.float32)
    # Subtly tint shoe side stripes with earthy khaki
    shoe_region = diff_arr[850:1450, 1000:1650]
    shoe_lum = shoe_region[:, :, 0] * 0.3 + shoe_region[:, :, 1] * 0.59 + shoe_region[:, :, 2] * 0.11
    # Stripe pixels: darker stripes on shoe
    stripes = (shoe_lum > 30) & (shoe_lum < 90)
    shoe_region[stripes, 0] = np.clip(shoe_region[stripes, 0] * 0.8 + 20, 0, 255)
    shoe_region[stripes, 1] = np.clip(shoe_region[stripes, 1] * 0.9 + 30, 0, 255)
    shoe_region[stripes, 2] = np.clip(shoe_region[stripes, 2] * 0.7 + 15, 0, 255)
    diff_arr[850:1450, 1000:1650] = shoe_region

    diff_img = Image.fromarray(np.clip(diff_arr, 0, 255).astype(np.uint8))

    # Save final textures
    out_diff = os.path.join(tex_dir, "Boy01_diffuse_adventure.png")
    out_norm = os.path.join(tex_dir, "Boy01_normal_adventure.png")
    out_spec = os.path.join(tex_dir, "Boy01_spec_adventure.png")

    diff_img.save(out_diff, quality=95)
    norm_img.save(out_norm, quality=95)
    spec_img.save(out_spec, quality=95)

    print("SUCCESS: Perfected Adventure textures generated!")

if __name__ == "__main__":
    build_adventure_textures()
