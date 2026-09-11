"""Generate sample images used by the "Try a sample" buttons.

Each output is a clean, synthetic subject on a busy/clear background so the
in-browser segmentation model has something meaningful to cut out.
Drawn programmatically with Pillow — no copyrighted assets.
"""
import math
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

OUT = "public/samples"


def radial_bg(size, inner, outer):
    w, h = size
    img = Image.new("RGB", size)
    px = img.load()
    cx, cy = w / 2, h / 2
    maxd = math.hypot(cx, cy)
    for y in range(h):
        for x in range(w):
            d = math.hypot(x - cx, y - cy) / maxd
            r = inner[0] + (outer[0] - inner[0]) * d
            g = inner[1] + (outer[1] - inner[1]) * d
            b = inner[2] + (outer[2] - inner[2]) * d
            px[x, y] = (int(r), int(g), int(b))
    return img


def make_portrait():
    size = (900, 900)
    img = radial_bg(size, (90, 118, 150), (30, 40, 60))
    d = ImageDraw.Draw(img)
    # shoulders / torso
    d.ellipse([130, 430, 770, 960], fill=(214, 178, 150))
    # shirt
    d.polygon([(215, 600), (685, 600), (740, 960), (160, 960)], fill=(56, 88, 128))
    # neck
    d.rectangle([390, 470, 510, 610], fill=(206, 168, 141))
    # head
    d.ellipse([322, 250, 578, 540], fill=(219, 183, 155))
    # hair
    d.ellipse([318, 230, 582, 430], fill=(62, 44, 34))
    d.polygon([(322, 360), (280, 300), (340, 340)], fill=(62, 44, 34))
    d.polygon([(578, 360), (620, 300), (560, 340)], fill=(62, 44, 34))
    # subtle vignette
    img = _vignette(img)
    img = img.filter(ImageFilter.GaussianBlur(0.4))
    img.save(f"{OUT}/portrait.jpg", quality=88)


def make_product():
    size = (900, 900)
    img = Image.new("RGB", size, (236, 236, 240))
    d = ImageDraw.Draw(img)
    # soft floor shadow
    shadow = Image.new("L", size, 0)
    sd = ImageDraw.Draw(shadow)
    sd.ellipse([220, 720, 680, 810], fill=70)
    shadow = shadow.filter(ImageFilter.GaussianBlur(22))
    img = Image.composite(Image.new("RGB", size, (24, 24, 28)), img, shadow.point(lambda v: 255 - v))
    d = ImageDraw.Draw(img)
    # bottle
    d.rounded_rectangle([395, 210, 505, 760], radius=46, fill=(18, 20, 26))
    d.rounded_rectangle([422, 120, 478, 320], radius=20, fill=(18, 20, 26))
    d.rounded_rectangle([404, 130, 496, 180], radius=12, fill=(245, 245, 248))
    # label gradient
    for i in range(60):
        t = i / 60
        r = int(255 - 40 * t)
        g = int(120 + 60 * t)
        b = int(60 + 90 * t)
        d.rectangle([408, 420 + i * 4, 492, 424 + i * 4], fill=(r, g, b))
    d.rounded_rectangle([408, 418, 492, 660], outline=(0, 0, 0), width=2)
    d.text((440, 520), "24/7", fill=(20, 20, 24), anchor="mm")
    img = _vignette(img)
    img.save(f"{OUT}/product.jpg", quality=90)


def make_animal():
    size = (900, 900)
    img = radial_bg(size, (120, 170, 120), (40, 70, 50))
    d = ImageDraw.Draw(img)
    # cat body
    d.ellipse([180, 300, 720, 760], fill=(236, 180, 80))
    d.ellipse([300, 190, 600, 470], fill=(240, 188, 92))
    # ears
    d.polygon([(330, 240), (300, 120), (410, 190)], fill=(240, 188, 92))
    d.polygon([(570, 240), (600, 120), (490, 190)], fill=(240, 188, 92))
    d.polygon([(340, 230), (318, 150), (390, 196)], fill=(120, 60, 50))
    d.polygon([(560, 230), (582, 150), (510, 196)], fill=(120, 60, 50))
    # eyes
    d.ellipse([382, 300, 432, 350], fill=(40, 35, 30))
    d.ellipse([468, 300, 518, 350], fill=(40, 35, 30))
    d.ellipse([398, 312, 420, 336], fill=(255, 255, 255))
    d.ellipse([484, 312, 506, 336], fill=(255, 255, 255))
    # nose/mouth
    d.polygon([(436, 362), (464, 362), (450, 378)], fill=(220, 120, 120))
    d.arc([430, 368, 470, 405], 20, 160, fill=(120, 70, 50), width=3)
    # whiskers
    for dx in (-1, 1):
        for dy in (-8, 0, 8):
            x0 = 390 if dx < 0 else 510
            d.line([x0, 370 + dy, x0 + dx * 70, 360 + dy], fill=(90, 60, 40), width=2)
    img = _vignette(img)
    img = img.filter(ImageFilter.GaussianBlur(0.4))
    img.save(f"{OUT}/animal.jpg", quality=90)


def _vignette(img):
    w, h = img.size
    mask = Image.new("L", (w, h), 0)
    md = ImageDraw.Draw(mask)
    md.ellipse([-w * 0.2, -h * 0.2, w * 1.2, h * 1.2], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(160))
    black = Image.new("RGB", (w, h), (0, 0, 0))
    return Image.composite(img, black, mask)


make_portrait()
make_product()
make_animal()
print("samples generated")