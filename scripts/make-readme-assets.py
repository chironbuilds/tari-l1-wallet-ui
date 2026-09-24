"""Composes the README / announcement images from the raw UI captures.

Run scripts/capture-readme-shots.mjs first; it writes 2x screenshots of a demo wallet to
shots/readme-raw. This lays each one out on a 16:9 card (2400x1350, fine for X/Twitter and GitHub)
with a headline column on the left and the cropped UI on the right. Every element is placed on a
fixed grid inside the canvas, so nothing can run off an edge.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "shots" / "readme-raw"
OUT = ROOT / "docs" / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)

W, H = 2400, 1350
MARGIN = 120
TEXT_W = 760  # left column
SHOT_BOX = (960, 110, W - 90, H - 110)  # right column

FONTS = r"C:\Windows\Fonts"
BOLD = f"{FONTS}\\segoeuib.ttf"
SEMI = f"{FONTS}\\seguisb.ttf"
REG = f"{FONTS}\\segoeui.ttf"

INK = (244, 243, 250)
MUTED = (160, 156, 180)
PURPLE = (157, 92, 255)


def font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.truetype(REG, size)


def background(accent):
    """Near-black with a soft accent glow behind the screenshot and a faint one top-left."""
    base = Image.new("RGB", (W, H), (11, 10, 16))
    glow = Image.new("RGB", (W, H), (0, 0, 0))
    d = ImageDraw.Draw(glow)
    d.ellipse((1100, 150, 2500, 1350), fill=tuple(int(c * 0.55) for c in accent))
    d.ellipse((-400, -500, 700, 500), fill=tuple(int(c * 0.22) for c in accent))
    glow = glow.filter(ImageFilter.GaussianBlur(260))
    img = Image.blend(base, glow, 0.55)
    return img.convert("RGBA")


def wrap(draw, text, fnt, width):
    lines, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if draw.textlength(trial, font=fnt) <= width:
            line = trial
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def text_column(img, step, eyebrow, headline, bullets, accent):
    d = ImageDraw.Draw(img)
    y = 170
    # Step chip + eyebrow.
    chip_f = font(BOLD, 30)
    d.rounded_rectangle((MARGIN, y, MARGIN + 64, y + 64), 18, fill=accent + (255,))
    tw = d.textlength(step, font=chip_f)
    d.text((MARGIN + 32 - tw / 2, y + 11), step, font=chip_f, fill=(12, 10, 18))
    d.text((MARGIN + 88, y + 12), eyebrow.upper(), font=font(BOLD, 30), fill=accent)
    y += 120
    h_f = font(BOLD, 78)
    for line in wrap(d, headline, h_f, TEXT_W):
        d.text((MARGIN, y), line, font=h_f, fill=INK)
        y += 96
    y += 44
    b_f = font(REG, 34)
    for bullet in bullets:
        d.ellipse((MARGIN + 2, y + 17, MARGIN + 16, y + 31), fill=accent)
        for i, line in enumerate(wrap(d, bullet, b_f, TEXT_W - 44)):
            d.text((MARGIN + 40, y), line, font=b_f, fill=MUTED)
            y += 48
        y += 26
    # Footer, pinned to the bottom of the column.
    d.text((MARGIN, H - 150), "universe.tari.mw", font=font(BOLD, 34), fill=INK)
    d.text((MARGIN, H - 104), "Open source · CPAL-1.0 · runs in your browser", font=font(REG, 26), fill=(118, 114, 138))


def place_shot(img, raw_name, crop, accent):
    shot = Image.open(RAW / f"{raw_name}.png").convert("RGBA").crop(crop)
    x1, y1, x2, y2 = SHOT_BOX
    bw, bh = x2 - x1, y2 - y1
    scale = min(bw / shot.width, bh / shot.height)
    size = (round(shot.width * scale), round(shot.height * scale))
    shot = shot.resize(size, Image.Resampling.LANCZOS)
    x = x1 + (bw - size[0]) // 2
    y = y1 + (bh - size[1]) // 2
    radius = 28

    shadow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((x + 8, y + 24, x + size[0] + 8, y + size[1] + 24), radius, fill=(0, 0, 0, 170))
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(34)))

    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius, fill=255)
    img.paste(shot, (x, y), mask)
    ImageDraw.Draw(img).rounded_rectangle(
        (x, y, x + size[0] - 1, y + size[1] - 1), radius, outline=accent + (110,), width=3
    )


CARDS = [
    dict(
        out="hero-wallet.png",
        raw="dashboard",
        crop=(0, 320, 2250, 1800),
        step="1",
        accent=(157, 92, 255),
        eyebrow="Tari L1 Web Wallet",
        headline="Your Tari wallet, in any browser.",
        bullets=[
            "Nothing to install and no chain to sync.",
            "Keys and signing stay local, in WebAssembly.",
            "MainNet and Esmeralda from one recovery phrase.",
        ],
    ),
    dict(
        out="ootle-flow.png",
        raw="burn",
        crop=(690, 140, 2195, 1670),
        step="2",
        accent=(255, 138, 61),
        eyebrow="Burn to Ootle",
        headline="Burn on L1. Claim on Ootle.",
        bullets=[
            "Burn XTM on layer 1, signed in the browser.",
            "The wallet fetches the merkle proof itself.",
            "Claimed into your Ootle account as private TARI, automatically.",
        ],
    ),
    dict(
        out="ootle-apps.png",
        raw="apps",
        crop=(680, 290, 2200, 1510),
        step="3",
        accent=(64, 214, 160),
        eyebrow="Ootle apps",
        headline="Your Ootle account, ready for dApps.",
        bullets=[
            "window.tari, the same provider API as the Sapient extension.",
            "You review and approve every transaction.",
            "Private sends, shield and unshield built in.",
        ],
    ),
    dict(
        out="security-recovery.png",
        raw="pin-gate",
        crop=(170, 480, 2230, 1800),
        step="4",
        accent=(236, 222, 72),
        eyebrow="Security",
        headline="Your seed stays behind your PIN.",
        bullets=[
            "Seed encrypted on this device by your PIN.",
            "Settings ask for the PIN every time.",
            "Auto-lock and 24-word CipherSeed recovery.",
        ],
    ),
]


for card in CARDS:
    image = background(card["accent"])
    place_shot(image, card["raw"], card["crop"], card["accent"])
    text_column(image, card["step"], card["eyebrow"], card["headline"], card["bullets"], card["accent"])
    image.convert("RGB").save(OUT / card["out"], optimize=True)
    print("wrote", card["out"])
