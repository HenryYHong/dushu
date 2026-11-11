#!/usr/bin/env python3
"""Pengu, LinguPengu's mascot, from its picture: the app's images and icons.

    python3 -I scripts/make-pengu.py        (needs Pillow: pip install pillow)

art/pengu-logo.png is the logo: a fluffy emperor penguin chick peeking over an open red book, on a flat pink square (made by
Henry with an AI image generator, 2026-11-11). The icons are that square; the mascot inside the app is the chick and its book cut
out of the pink: every pixel is as see-through as it is close to the pink, and the pink is taken out of the colors along the edge,
so it sits cleanly on a light or a dark page. It writes:

    src/ui/pengu/pengu.webp        the mascot (welcome screen, walkthrough, empty screens, Review), 512 px, transparent
    src/ui/pengu/logo.webp         the logo with rounded corners (the brand mark in the bar), 192 px
    art/pengu-cutout.png           the mascot at full size, for scripts/make-icons.mjs (the link picture)
    public/icon.svg                the logo for the browser tab, a 128 px picture inside an SVG
    public/icons/icon-192.png, icon-512.png       the logo with rounded corners ("any" purpose)
    public/icons/apple-touch-icon.png (180)        the square as it is (iOS rounds the corners)
    public/icons/icon-maskable-512.png             the square with the chick smaller, inside the central safe zone
"""
import base64, io, os
from collections import deque
from PIL import Image, ImageDraw

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SRC = os.path.join(REPO, 'art', 'pengu-logo.png')
SOFT = (10, 60)   # distance from the pink (RGB) at which a pixel starts to show, and at which it is solid


def background(im: Image.Image) -> tuple[tuple[int, int, int], Image.Image]:
    """The pink (the corners' average) and the region of near-pink pixels reachable from the edge (255 there)."""
    w, h = im.size
    px = im.load()
    corners = [px[2, 2], px[w - 3, 2], px[2, h - 3], px[w - 3, h - 3]]
    bg = tuple(sum(c[i] for c in corners) // 4 for i in range(3))
    def near(x, y):
        p = px[x, y]
        return sum((p[i] - bg[i]) ** 2 for i in range(3)) < SOFT[1] ** 2
    region = Image.new('L', (w, h), 0)
    rp = region.load()
    seen = bytearray(w * h)
    q = deque((x, y) for x in range(w) for y in (0, h - 1))
    q.extend((x, y) for y in range(h) for x in (0, w - 1))
    while q:
        x, y = q.popleft()
        if seen[y * w + x]:
            continue
        seen[y * w + x] = 1
        if not near(x, y):
            continue
        rp[x, y] = 255
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx]:
                q.append((nx, ny))
    return bg, region


def cutout(im: Image.Image) -> Image.Image:
    """The chick and its book on transparent: outside the background region solid; inside it, as see-through as it is pink."""
    bg, region = background(im)
    w, h = im.size
    px = im.load()
    rp = region.load()
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    op = out.load()
    lo, hi = SOFT
    for y in range(h):
        for x in range(w):
            p = px[x, y]
            if not rp[x, y]:
                op[x, y] = p + (255,)
                continue
            d = sum((p[i] - bg[i]) ** 2 for i in range(3)) ** 0.5
            a = max(0.0, min(1.0, (d - lo) / (hi - lo)))
            if a <= 0:
                continue
            # The pink taken out of an edge pixel's color: what it would be without the background showing through.
            c = tuple(max(0, min(255, round((p[i] - (1 - a) * bg[i]) / a))) for i in range(3))
            op[x, y] = c + (round(a * 255),)
    return out


def trim_square(im: Image.Image, pad: float = 0.04) -> Image.Image:
    """The picture cut to what is not transparent, centered in a square with a little room around it."""
    part = im.crop(im.getbbox())
    side = int(max(part.size) * (1 + 2 * pad))
    sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    sq.paste(part, ((side - part.width) // 2, (side - part.height) // 2), part)
    return sq


def rounded(im: Image.Image, radius: float = 0.22) -> Image.Image:
    """The square with rounded corners (drawn at four times the size, so the curve is smooth)."""
    n = im.width * 4
    mask = Image.new('L', (n, n), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, n - 1, n - 1), radius=int(n * radius), fill=255)
    out = im.convert('RGBA')
    out.putalpha(mask.resize(im.size, Image.LANCZOS))
    return out


def save(im: Image.Image, path: str, size: int, **kw) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.resize((size, size), Image.LANCZOS).save(path, **kw)
    print(f'wrote {os.path.relpath(path, REPO)} ({size} px, {os.path.getsize(path) // 1024} KB)')


def main() -> None:
    src = Image.open(SRC).convert('RGB')
    bg, _ = background(src)
    cut = cutout(src)
    mascot = trim_square(cut)
    mascot.save(os.path.join(REPO, 'art', 'pengu-cutout.png'), optimize=True)
    print('wrote art/pengu-cutout.png')
    save(mascot, os.path.join(REPO, 'src', 'ui', 'pengu', 'pengu.webp'), 512, quality=90, method=6)
    logo = rounded(src)
    save(logo, os.path.join(REPO, 'src', 'ui', 'pengu', 'logo.webp'), 192, quality=90, method=6)
    save(logo, os.path.join(REPO, 'public', 'icons', 'icon-192.png'), 192, optimize=True)
    save(logo, os.path.join(REPO, 'public', 'icons', 'icon-512.png'), 512, optimize=True)
    save(src, os.path.join(REPO, 'public', 'icons', 'apple-touch-icon.png'), 180, optimize=True)
    # The safe zone is the middle 80 percent, a circle: the chick and book shrunk to fit inside it on the same pink.
    mask = Image.new('RGB', src.size, bg)
    part = trim_square(cut, 0)
    k = int(src.width * 0.64)
    part = part.resize((k, k), Image.LANCZOS)
    mask.paste(part, ((src.width - k) // 2, (src.height - k) // 2), part)
    save(mask, os.path.join(REPO, 'public', 'icons', 'icon-maskable-512.png'), 512, optimize=True)
    buf = io.BytesIO()
    logo.resize((128, 128), Image.LANCZOS).save(buf, 'PNG', optimize=True)
    data = base64.b64encode(buf.getvalue()).decode()
    with open(os.path.join(REPO, 'public', 'icon.svg'), 'w') as f:
        f.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><image width="128" height="128" href="data:image/png;base64,{data}"/></svg>\n')
    print(f'wrote public/icon.svg ({os.path.getsize(os.path.join(REPO, "public", "icon.svg")) // 1024} KB)')


if __name__ == '__main__':
    main()
