#!/usr/bin/env python3
"""Pengu, LinguPengu's mascot, from its picture: the app's images and icons.

    python3 -I scripts/make-pengu.py        (needs Pillow: pip install pillow)

art/pengu-logo.png is Pengu: a fluffy emperor penguin chick peeking over an open red book, in a white sticker edge, on a flat
pale blue square (made by Henry with an AI image generator, 2026-11-11). art/pengu-wave.png (a flipper raised, waving) and
art/pengu-cheer.png (both flippers up, eyes closed happily) are the same picture in other poses, made from it the same way, the
book and the frame unchanged: each is cut to the same square as the reading Pengu, so a pose can take another's place without
Pengu moving. The sticker is cut out of the blue (every pixel as
see-through as it is close to the blue, and the blue taken out of the colors along the edge, so it sits cleanly on a light or a
dark page), and its book recolored to the app's vermilion, so Pengu wears the app's own two colors. The mascot inside the app
is that sticker by itself; the logo (the brand mark in the bar, the browser tab's icon, the installed app's icons) is it on a
white square with rounded corners (a home screen wants a solid square anyway: iOS fills a see-through one with black). It writes:

    src/ui/pengu/pengu.webp        the mascot, the sticker cut out (peeking over a card, empty screens), 512 px
    src/ui/pengu/pengu-wave.webp   the mascot waving (the welcome, the walkthrough's first step, nothing to review), 512 px
    src/ui/pengu/pengu-cheer.webp  the mascot cheering (a review finished, the daily goal, a book finished), 512 px
    src/ui/pengu/logo.webp         the logo, the brand mark in the bar, 128 px
    art/pengu-cutout.png           the mascot at full size, for scripts/make-icons.mjs (the link picture)
    public/icon.svg                the logo for the browser tab, a 128 px picture inside an SVG
    public/icons/icon-192.png, icon-512.png       the logo ("any" purpose)
    public/icons/apple-touch-icon.png (180)        the square, full bleed (iOS rounds the corners)
    public/icons/icon-maskable-512.png             the square with Pengu smaller, inside the central safe zone
"""
import base64, colorsys, io, os
from collections import deque
from PIL import Image, ImageDraw

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SRC = os.path.join(REPO, 'art', 'pengu-logo.png')
# The other poses: the picture each comes from and the mascot image it makes.
POSES = {'wave': 'pengu-wave', 'cheer': 'pengu-cheer'}
SOFT = (10, 60)   # distance from the background color (RGB) at which a pixel starts to show, and at which it is solid
GROUND = (255, 255, 255)        # the logo's ground: white
VERMILION = (0xc1, 0x36, 0x16)  # the app's accent (--accent): the book


def background(im: Image.Image) -> tuple[tuple[int, int, int], Image.Image]:
    """The background color (the corners' average) and the region of pixels near it reachable from the edge (255 there)."""
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
    """The sticker on transparent: outside the background region solid; inside it, as see-through as it is close to the background."""
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
            # The background taken out of an edge pixel's color: what it would be without it showing through.
            c = tuple(max(0, min(255, round((p[i] - (1 - a) * bg[i]) / a))) for i in range(3))
            op[x, y] = c + (round(a * 255),)
    return out


def recolor_book(im: Image.Image) -> Image.Image:
    """The book's reds moved to the app's vermilion: hue and saturation taken from it, lightness scaled to match. Only the
    picture's lower part, where the book is (the cheeks and an open mouth, also reddish, stay as they are)."""
    th, tl, ts = colorsys.rgb_to_hls(*[c / 255 for c in VERMILION])
    out = im.copy()
    px = out.load()
    w, h = out.size
    for y in range(int(h * 0.6), h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if not a:
                continue
            hh, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
            if s > 0.45 and (hh > 0.92 or hh < 0.04) and l < 0.8:
                nr, ng, nb = colorsys.hls_to_rgb(th, min(1, l * tl / 0.53), min(1, ts * s / 0.8))
                px[x, y] = (round(nr * 255), round(ng * 255), round(nb * 255), a)
    return out


def on_ground(sticker: Image.Image, size: int, share: float) -> Image.Image:
    """A white square with the sticker taking `share` of its width, a little below the middle."""
    sq = Image.new('RGBA', (size, size), GROUND + (255,))
    k = int(size * share)
    s = sticker.resize((k, k), Image.LANCZOS)
    sq.alpha_composite(s, ((size - k) // 2, (size - k) // 2 + size // 85))
    return sq


def trim_square(im: Image.Image, pad: float = 0.04, box: tuple[int, int, int, int] | None = None) -> Image.Image:
    """The picture cut to `box` (what is not transparent, by default), centered in a square with a little room around it."""
    part = im.crop(box or im.getbbox())
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
    sticker = cutout(src)
    box = sticker.getbbox()
    mascot = recolor_book(trim_square(sticker, box=box))
    mascot.save(os.path.join(REPO, 'art', 'pengu-cutout.png'), optimize=True)
    print('wrote art/pengu-cutout.png')
    save(mascot, os.path.join(REPO, 'src', 'ui', 'pengu', 'pengu.webp'), 512, quality=90, method=6)
    for name, out in POSES.items():
        pose = cutout(Image.open(os.path.join(REPO, 'art', f'pengu-{name}.png')).convert('RGB'))
        if pose.size != sticker.size:
            raise SystemExit(f'art/pengu-{name}.png is {pose.size}, not {sticker.size} like art/pengu-logo.png')
        # Cut to the reading Pengu's box, not its own: the same book in the same place in every pose.
        save(recolor_book(trim_square(pose, box=box)), os.path.join(REPO, 'src', 'ui', 'pengu', f'{out}.webp'), 512, quality=90, method=6)
    square = on_ground(mascot, 1024, 0.86)
    logo = rounded(square)
    save(logo, os.path.join(REPO, 'src', 'ui', 'pengu', 'logo.webp'), 128, quality=90, method=6)
    save(logo, os.path.join(REPO, 'public', 'icons', 'icon-192.png'), 192, optimize=True)
    save(logo, os.path.join(REPO, 'public', 'icons', 'icon-512.png'), 512, optimize=True)
    save(square.convert('RGB'), os.path.join(REPO, 'public', 'icons', 'apple-touch-icon.png'), 180, optimize=True)
    # The safe zone is the middle 80 percent, a circle: Pengu shrunk to fit inside it.
    save(on_ground(mascot, 1024, 0.64).convert('RGB'), os.path.join(REPO, 'public', 'icons', 'icon-maskable-512.png'), 512, optimize=True)
    buf = io.BytesIO()
    logo.resize((128, 128), Image.LANCZOS).save(buf, 'PNG', optimize=True)
    data = base64.b64encode(buf.getvalue()).decode()
    with open(os.path.join(REPO, 'public', 'icon.svg'), 'w') as f:
        f.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><image width="128" height="128" href="data:image/png;base64,{data}"/></svg>\n')
    print(f'wrote public/icon.svg ({os.path.getsize(os.path.join(REPO, "public", "icon.svg")) // 1024} KB)')


if __name__ == '__main__':
    main()
