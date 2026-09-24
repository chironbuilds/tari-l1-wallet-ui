from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)
REG = r"C:\Windows\Fonts\segoeui.ttf"
BOLD = r"C:\Windows\Fonts\segoeuib.ttf"


def font(size, bold=False):
    return ImageFont.truetype(BOLD if bold else REG, size)


def gradient(size, top, bottom):
    w, h = size
    image = Image.new("RGB", size)
    px = image.load()
    for y in range(h):
        t = y / max(1, h - 1)
        color = tuple(int(top[i] * (1 - t) + bottom[i] * t) for i in range(3))
        for x in range(w):
            px[x, y] = color
    return image


def rounded(image, box, radius, fill=None, outline=None, width=1):
    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)
    image.alpha_composite(layer)


def fit(image, size):
    copy = image.copy().convert("RGBA")
    copy.thumbnail(size, Image.Resampling.LANCZOS)
    return copy


def shadow(image, box, radius):
    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    x1, y1, x2, y2 = box
    draw.rounded_rectangle((x1 + 10, y1 + 14, x2 + 10, y2 + 14), radius, fill=(0, 0, 0, 100))
    layer = layer.filter(ImageFilter.GaussianBlur(18))
    image.alpha_composite(layer)


def label(draw, xy, text, color, fill):
    text_font = font(18, True)
    box = draw.textbbox((0, 0), text, font=text_font)
    x, y = xy
    draw.rounded_rectangle((x, y, x + box[2] - box[0] + 36, y + 50), 12, fill=fill)
    draw.text((x + 18, y + 10), text, font=text_font, fill=color)


def make_hero():
    w, h = 1600, 900
    image = gradient((w, h), (10, 13, 18), (20, 15, 35)).convert("RGBA")
    draw = ImageDraw.Draw(image)
    draw.text((80, 62), "TARI L1 WEB WALLET", font=font(24, True), fill=(151, 242, 193))
    draw.text((80, 105), "Your keys. Your browser. Your layer 2.", font=font(48, True), fill=(245, 245, 248))
    draw.text((84, 173), "Self-custodial Minotari with Ootle built in.", font=font(24), fill=(172, 170, 190))
    shadow(image, (60, 245, 1540, 805), 28)
    rounded(image, (60, 245, 1540, 805), 28, fill=(25, 27, 34, 255), outline=(83, 74, 112, 255), width=2)
    draw = ImageDraw.Draw(image)
    draw.ellipse((88, 270, 102, 284), fill=(255, 104, 72))
    draw.ellipse((112, 270, 126, 284), fill=(255, 190, 70))
    draw.ellipse((136, 270, 150, 284), fill=(91, 230, 164))
    draw.text((190, 266), "universe.tari.mw", font=font(18), fill=(166, 163, 184))
    shot = fit(Image.open(OUT / "dashboard.jpg"), (1370, 475))
    image.alpha_composite(shot, ((1600 - shot.width) // 2, 310))
    label(draw, (92, 690), "LOCAL SIGNING", (177, 250, 208), (30, 65, 45, 255))
    label(draw, (405, 690), "Ootle L2", (224, 194, 255), (61, 37, 91, 255))
    label(draw, (650, 690), "SUB-ADDRESSES", (183, 220, 255), (26, 55, 83, 255))
    label(draw, (966, 690), "DAPPS", (255, 222, 166), (82, 55, 25, 255))
    image.convert("RGB").save(OUT / "hero-wallet.png", quality=95)


def make_ootle():
    w, h = 1600, 900
    image = gradient((w, h), (11, 14, 20), (28, 18, 22)).convert("RGBA")
    draw = ImageDraw.Draw(image)
    draw.text((80, 60), "BURN TO OOTLE", font=font(24, True), fill=(255, 151, 77))
    draw.text((80, 103), "From L1 to private layer 2, in one flow.", font=font(48, True), fill=(248, 246, 250))
    draw.text((84, 171), "Burn locally. Claim automatically when the proof is ready.", font=font(24), fill=(185, 178, 187))
    cards = [(70, 280, 680, 760), (920, 280, 1530, 760)]
    for box in cards:
        shadow(image, box, 28)
        rounded(image, box, 28, fill=(25, 27, 34, 255), outline=(92, 72, 76, 255), width=2)
    burn = fit(Image.open(OUT / "burn.png"), (540, 400))
    ootle = fit(Image.open(OUT / "ootle-claimed.png"), (540, 400))
    image.alpha_composite(burn, (105, 320))
    image.alpha_composite(ootle, (955, 305))
    draw = ImageDraw.Draw(image)
    draw.text((112, 670), "01  BURN ON L1", font=font(22, True), fill=(255, 190, 143))
    draw.text((962, 670), "02  CLAIM ON Ootle", font=font(22, True), fill=(183, 247, 203))
    draw.line((700, 510, 900, 510), fill=(191, 126, 255), width=5)
    draw.polygon([(900, 510), (870, 492), (870, 528)], fill=(191, 126, 255))
    draw.text((710, 455), "signed", font=font(18, True), fill=(205, 194, 224))
    draw.text((710, 540), "in your browser", font=font(18), fill=(164, 158, 177))
    image.convert("RGB").save(OUT / "ootle-flow.png", quality=95)


def make_security():
    w, h = 1600, 900
    image = gradient((w, h), (9, 15, 20), (15, 28, 25)).convert("RGBA")
    draw = ImageDraw.Draw(image)
    draw.text((80, 60), "SELF-CUSTODIAL BY DESIGN", font=font(24, True), fill=(139, 235, 188))
    draw.text((80, 103), "Security that stays in your hands.", font=font(48, True), fill=(247, 248, 246))
    draw.text((84, 171), "Recovery, lock and signing controls built into the wallet.", font=font(24), fill=(171, 187, 181))
    shadow(image, (90, 270, 1510, 790), 30)
    rounded(image, (90, 270, 1510, 790), 30, fill=(239, 243, 239, 255), outline=(111, 156, 137, 255), width=2)
    shot = fit(Image.open(ROOT / "shots" / "05-scan.png"), (1320, 430))
    image.alpha_composite(shot, (140, 305))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((180, 650, 560, 730), 18, fill=(35, 66, 49, 255))
    draw.rounded_rectangle((620, 650, 990, 730), 18, fill=(52, 48, 83, 255))
    draw.rounded_rectangle((1050, 650, 1410, 730), 18, fill=(80, 59, 30, 255))
    draw.text((210, 677), "PIN LOCK + AUTO-LOCK", font=font(19, True), fill=(177, 249, 204))
    draw.text((650, 677), "LOCAL WEBASSEMBLY SIGNING", font=font(19, True), fill=(225, 211, 255))
    draw.text((1080, 677), "CIPHERSEED RECOVERY", font=font(19, True), fill=(255, 220, 161))
    image.convert("RGB").save(OUT / "security-recovery.png", quality=95)


make_hero()
make_ootle()
make_security()
