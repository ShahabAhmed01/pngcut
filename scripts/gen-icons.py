"""Generate PNGCut brand assets programmatically — no copyrighted material.

Outputs (all in public/):
  icons/icon-192.png, icons/icon-512.png          — PWA "any" icons
  icons/icon-maskable-192.png, icons/icon-maskable-512.png — PWA maskable
  apple-touch-icon.png (180)                      — iOS home screen
  og-image.png (1200×630)                         — social sharing card
  favicon.svg                                     — refreshed vector logo

Design language matches the app: near-black panel #0b0d12, coral #ff5c7a
"cut frame", cyan #16c3d8 subject line, coral dot.
"""

import glob
import os

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, "public")
ICONS = os.path.join(PUBLIC, "icons")
os.makedirs(ICONS, exist_ok=True)

BG = (11, 13, 18)        # #0b0d12
CORAL = (255, 92, 122)   # #ff5c7a
CYAN = (22, 195, 216)    # #16c3d8
WHITE = (232, 236, 244)  # #e8ecf4

FAVICON = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs>
    <linearGradient id="cut" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="#16c3d8"/>
      <stop offset="1" stop-color="#4dd6e8"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="14" fill="#0b0d12"/>
  <rect x="9" y="9" width="46" height="46" rx="11" fill="none" stroke="#ff5c7a" stroke-width="4" stroke-dasharray="58 22" stroke-linecap="round" transform="rotate(-45 32 32)"/>
  <path d="M20 40 L29 27 L35 33 L45 19" fill="none" stroke="url(#cut)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="45" cy="19" r="4.5" fill="#ff5c7a"/>
</svg>
"""


def rounded_rect_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def apply_round_mask(img, radius):
    mask = rounded_rect_mask(img.width, radius)
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def draw_mark(size, canvas, line_w_ratio=0.075, frame_w_ratio=0.062, content=1.0):
    """Draw the PNGCut mark into a transparent RGBA layer at pixel size `size`.

    `content` < 1 shrinks the mark toward the center (maskable safe zone).
    """
    lw = max(2, round(size * line_w_ratio * content))
    fw = max(2, round(size * frame_w_ratio * content))
    shrink = size * (1 - content) / 2

    # ---- coral "cut frame": rounded ring with two diagonal gaps -----------
    inset = size * 0.16 * content + shrink
    frame = [inset, inset, size - inset, size - inset]
    radius = size * 0.19 * content
    ring = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(ring).rounded_rectangle(frame, radius=radius, outline=CORAL + (255,), width=fw)

    gap_r = size * 0.10 * content
    gap_mask = Image.new("L", (size, size), 0)
    gd = ImageDraw.Draw(gap_mask)
    diag = size * 0.30 * content
    for sign in (-1, 1):
        cx = size / 2 + sign * diag
        cy = size / 2 - sign * diag
        gd.ellipse([cx - gap_r, cy - gap_r, cx + gap_r, cy + gap_r], fill=255)
    solid = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ring = Image.composite(solid, ring, gap_mask)
    canvas.alpha_composite(ring)

    # ---- cyan subject line: ascending polyline, round caps ----------------
    pts_base = [(0.24, 0.62), (0.435, 0.34), (0.56, 0.46), (0.76, 0.24)]
    scaled = [(size * x * content + shrink, size * y * content + shrink) for (x, y) in pts_base]
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    ld.line(scaled, fill=CYAN + (255,), width=lw, joint="curve")
    for p in (scaled[0], scaled[-1]):
        ld.ellipse([p[0] - lw / 2, p[1] - lw / 2, p[0] + lw / 2, p[1] + lw / 2], fill=CYAN + (255,))
    canvas.alpha_composite(layer)

    # ---- coral dot at the line's peak -------------------------------------
    r_dot = max(2, size * 0.062 * content)
    px, py = scaled[-1]
    dd = ImageDraw.Draw(canvas)
    dd.ellipse([px - r_dot, py - r_dot, px + r_dot, py + r_dot], fill=CORAL + (255,))


def make_icon(px, maskable=False):
    if maskable:
        # full-bleed background; mark inside the 80% maskable safe zone
        img = Image.new("RGBA", (px, px), BG + (255,))
        inner = Image.new("RGBA", (px, px), (0, 0, 0, 0))
        draw_mark(px, inner, content=0.72)
        img.alpha_composite(inner)
        return img
    # rounded app tile on transparency
    img = Image.new("RGBA", (px, px), BG + (255,))
    inner = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    draw_mark(px, inner, content=1.0)
    img.alpha_composite(inner)
    return apply_round_mask(img, round(px * 0.22))


def find_font(candidates, fallback_size):
    from PIL import ImageFont

    for pattern in candidates:
        matches = sorted(glob.glob(pattern, recursive=True))
        if matches:
            return ImageFont.truetype(matches[0], fallback_size)
    return ImageFont.load_default()


def make_apple_touch_icon():
    # iOS masks this itself: full-bleed square, generous padding
    px = 180
    img = Image.new("RGBA", (px, px), BG + (255,))
    inner = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    draw_mark(px, inner, content=0.78)
    img.alpha_composite(inner)
    img.convert("RGB").save(os.path.join(PUBLIC, "apple-touch-icon.png"))


def make_og_image():
    w, h = 1200, 630
    img = Image.new("RGB", (w, h), BG)

    # subtle ambient glow
    glow = Image.new("RGB", (w, h), BG)
    gd = ImageDraw.Draw(glow)
    gd.ellipse([60, 90, 560, 590], fill=(16, 26, 34))
    gd.ellipse([520, 120, 900, 500], fill=(30, 18, 26))
    glow = glow.filter(ImageFilter.GaussianBlur(90))
    img = Image.blend(img, glow, 0.9)
    d = ImageDraw.Draw(img)

    # border frame
    d.rounded_rectangle([16, 16, w - 17, h - 17], radius=28, outline=(36, 42, 56), width=2)

    # big mark on the left
    mark_size = 340
    mark = Image.new("RGBA", (mark_size, mark_size), BG + (255,))
    inner = Image.new("RGBA", (mark_size, mark_size), (0, 0, 0, 0))
    draw_mark(mark_size, inner, line_w_ratio=0.07, frame_w_ratio=0.055, content=1.0)
    mark.alpha_composite(inner)
    mark = apply_round_mask(mark, 76)
    img.paste(mark, (110, 145), mark)

    # text block
    title_font = find_font(
        [
            "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/**/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/**/*Bold*.ttf",
        ],
        118,
    )
    sub_font = find_font(
        ["/usr/share/fonts/dejavu/DejaVuSans.ttf", "/usr/share/fonts/**/DejaVuSans.ttf"], 40
    )
    tiny_font = find_font(
        ["/usr/share/fonts/dejavu/DejaVuSans.ttf", "/usr/share/fonts/**/DejaVuSans.ttf"], 30
    )

    tx = 520
    d.text((tx, 205), "PNGCut", font=title_font, fill=WHITE)

    # gradient underline
    for i in range(330):
        t = i / 330
        r = int(CORAL[0] + (CYAN[0] - CORAL[0]) * t)
        g = int(CORAL[1] + (CYAN[1] - CORAL[1]) * t)
        b = int(CORAL[2] + (CYAN[2] - CORAL[2]) * t)
        d.rectangle([tx + i, 350, tx + i + 1, 360], fill=(r, g, b))

    d.text((tx, 395), "Free background removal", font=sub_font, fill=(154, 163, 181))
    d.text((tx, 445), "in your browser — nothing uploaded", font=sub_font, fill=(154, 163, 181))
    d.text((tx, 540), "pngcut.vercel.app", font=tiny_font, fill=(107, 115, 132))

    img.save(os.path.join(PUBLIC, "og-image.png"), quality=95)


make_apple_touch_icon()
for px in (192, 512):
    make_icon(px, maskable=False).convert("RGB").save(
        os.path.join(ICONS, f"icon-{px}.png"), optimize=True
    )
    make_icon(px, maskable=True).convert("RGB").save(
        os.path.join(ICONS, f"icon-maskable-{px}.png"), optimize=True
    )
make_og_image()

with open(os.path.join(PUBLIC, "favicon.svg"), "w") as f:
    f.write(FAVICON)

print("brand assets generated:", os.path.relpath(ICONS, ROOT))
