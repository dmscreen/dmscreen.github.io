#!/usr/bin/env python3
"""Rasterize the home-screen and favicon set from the sidebar d20 mark.

    py tools/make-icons.py

Writes apple-touch-icon.png and favicon.ico at the site root (the paths
browsers probe when a page does not say otherwise) and assets/icon-192.png
and assets/icon-512.png for the manifest.

Home-screen icons are an opaque tile, never a transparent outline: iOS fills
transparency with black, Android drops it onto a white plate, and a thin
stroke on nothing reads as a blank icon on both. The mark stays inside the
centre 80% circle so the same file serves as a maskable icon that any
launcher shape can crop.

The tab favicons (assets/icon-16.png, assets/icon-32.png, assets/favicon.svg)
keep their transparent outline; favicon.ico just packs the two PNGs.
"""

import pathlib

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
BG = (0x19, 0x15, 0x12, 255)    # theme_color in manifest.webmanifest
GOLD = (0xC9, 0x96, 0x3C, 255)  # stroke colour in assets/favicon.svg
SUPERSAMPLE = 8

# The sidebar logo in its 24-unit viewBox: a hexagon plus three diagonals.
HEXAGON = [(12, 2), (21, 7), (21, 17), (12, 22), (3, 17), (3, 7)]
SPOKES = [((12, 2), (12, 22)), ((3, 7), (21, 17)), ((21, 7), (3, 17))]
MARK_HEIGHT = 0.60   # of the tile; furthest vertex lands at 0.31, inside 0.40
STROKE_UNITS = 1.75  # a touch heavier than the 1.5 in the SVG, for launchers


def tile(size):
    big = size * SUPERSAMPLE
    img = Image.new("RGBA", (big, big), BG)
    draw = ImageDraw.Draw(img)
    scale = big * MARK_HEIGHT / 20  # the hexagon is 20 units tall
    width = max(1, round(STROKE_UNITS * scale))

    def pt(p):
        return (big / 2 + (p[0] - 12) * scale, big / 2 + (p[1] - 12) * scale)

    segments = list(zip(HEXAGON, HEXAGON[1:] + HEXAGON[:1])) + SPOKES
    for a, b in segments:
        draw.line([pt(a), pt(b)], fill=GOLD, width=width)
    r = width / 2
    for p in HEXAGON:  # round joins and caps, as in the SVG
        x, y = pt(p)
        draw.ellipse([x - r, y - r, x + r, y + r], fill=GOLD)
    return img.resize((size, size), Image.LANCZOS).convert("RGB")


def main():
    tile(180).save(ROOT / "apple-touch-icon.png", optimize=True)
    tile(192).save(ROOT / "assets" / "icon-192.png", optimize=True)
    tile(512).save(ROOT / "assets" / "icon-512.png", optimize=True)

    small = [Image.open(ROOT / "assets" / f"icon-{n}.png") for n in (32, 16)]
    small[0].save(ROOT / "favicon.ico", sizes=[(32, 32), (16, 16)],
                  append_images=small[1:])
    print("wrote apple-touch-icon.png, favicon.ico, assets/icon-192.png, assets/icon-512.png")


if __name__ == "__main__":
    main()
