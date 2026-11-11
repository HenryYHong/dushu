#!/usr/bin/env python3
"""Pengu, LinguPengu's mascot, from its source picture: the app's images and icons.

    python3 -I scripts/make-pengu.py        (needs Pillow: pip install pillow)

art/pengu-source.jpg is the picture Pengu was chosen from: generated on 2026-11-11 with Leonardo's Lucid Origin model through
Cloudflare Workers AI (a penguin sticker on a pale blue circle, on white). This cuts the penguin out of its background (everything
white or circle-blue that touches the picture's edge), puts a clean white sticker edge and a soft shadow back around it, and
makes the logo: its top half peeking up out of a crisp circle. It writes:

    src/ui/pengu/pengu.webp        the mascot (welcome screen, walkthrough, empty screens, Review), 512 px, transparent
    src/ui/pengu/logo.webp         the logo: Pengu's top half peeking out of its circle (the brand mark in the bar), 192 px
    art/pengu-sticker.png          the mascot at full size, for scripts/make-icons.mjs (the link picture)
    public/icon.svg                the logo for the browser tab, a 128 px picture inside an SVG
    public/icons/icon-192.png, icon-512.png       the logo on transparent ("any" purpose)
    public/icons/apple-touch-icon.png (180)        full bleed: Pengu peeking up from the bottom of a blue square (iOS rounds it)
    public/icons/icon-maskable-512.png             full bleed, Pengu inside the central safe zone
"""
import base64, io, os
from collections import deque
from PIL import Image, ImageChops, ImageDraw, ImageFilter

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SRC = os.path.join(REPO, 'art', 'pengu-source.jpg')
CIRCLE = (176, 201, 219)          # the source's circle, as sampled
CENTER, RADIUS = (512, 512), 392  # where it is in the 1024 source
STICKER = 14                      # the white edge around the penguin, in source pixels


def background_mask(im: Image.Image) -> Image.Image:
    """255 where the picture is background: white or circle-blue pixels reachable from its edge."""
    w, h = im.size
    px = im.load()
    # White, the circle's blue, and anything blended between the two (the circle's anti-aliased rim): close to the line from one
    # color to the other.
    span = [255 - c for c in CIRCLE]
    span2 = sum(d * d for d in span)
    def bg(x, y):
        p = px[x, y]
        t = max(0.0, min(1.0, sum((p[i] - CIRCLE[i]) * span[i] for i in range(3)) / span2))
        return sum((p[i] - (CIRCLE[i] + t * span[i])) ** 2 for i in range(3)) < 26 ** 2
    seen = bytearray(w * h)
    q = deque((x, y) for x in range(w) for y in (0, h - 1))
    q.extend((x, y) for y in range(h) for x in (0, w - 1))
    out = Image.new('L', (w, h), 0)
    op = out.load()
    while q:
        x, y = q.popleft()
        i = y * w + x
        if seen[i]:
            continue
        seen[i] = 1
        if not bg(x, y):
            continue
        op[x, y] = 255
        if x > 0: q.append((x - 1, y))
        if x < w - 1: q.append((x + 1, y))
        if y > 0: q.append((x, y - 1))
        if y < h - 1: q.append((x, y + 1))
    return out


def keep_largest(mask: Image.Image) -> Image.Image:
    """Only the largest connected shape of a mask (the penguin): specks along the circle's rim and the like are dropped."""
    w, h = mask.size
    m = mask.load()
    label = [0] * (w * h)
    best, best_n, n = 0, 0, 0
    for y0 in range(h):
        for x0 in range(w):
            if m[x0, y0] < 128 or label[y0 * w + x0]:
                continue
            n += 1
            size = 0
            q = deque([(x0, y0)])
            label[y0 * w + x0] = n
            while q:
                x, y = q.popleft()
                size += 1
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if 0 <= nx < w and 0 <= ny < h and not label[ny * w + nx] and m[nx, ny] >= 128:
                        label[ny * w + nx] = n
                        q.append((nx, ny))
            if size > best_n:
                best, best_n = n, size
    out = Image.new('L', (w, h), 0)
    o = out.load()
    for y in range(h):
        for x in range(w):
            if label[y * w + x] == best:
                o[x, y] = 255
    return out


def sticker(src: Image.Image) -> Image.Image:
    """The penguin with a white sticker edge and a soft shadow, on transparent, the source's size."""
    fg = keep_largest(ImageChops.invert(background_mask(src)))
    # Gaps the flood left (a stray light pixel in the outline) are closed; the edge is smoothed a little.
    fg = fg.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.7))
    edge = fg.filter(ImageFilter.MaxFilter(STICKER * 2 + 1)).filter(ImageFilter.GaussianBlur(1.6))
    shadow = edge.filter(ImageFilter.GaussianBlur(10)).point(lambda a: int(a * 0.22))
    out = Image.new('RGBA', src.size, (0, 0, 0, 0))
    out.paste(Image.new('RGBA', src.size, (31, 42, 92, 255)), (0, 8), shadow)
    out.paste(Image.new('RGBA', src.size, (255, 255, 255, 255)), (0, 0), edge)
    out.paste(src.convert('RGBA'), (0, 0), fg)
    return out


def trim_square(im: Image.Image, pad: float = 0.04) -> Image.Image:
    """The picture cut to what is not transparent, centered in a square with a little room around it."""
    box = im.getbbox()
    part = im.crop(box)
    side = int(max(part.size) * (1 + 2 * pad))
    sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    sq.paste(part, ((side - part.width) // 2, (side - part.height) // 2), part)
    return sq


def peeking(stk: Image.Image, square: bool = False, share: float = 1.55, drop: float = 0.20) -> Image.Image:
    """The logo: Pengu's top half peeking up out of a pale blue circle (or a full square, for icons a platform rounds or masks).
    Below the middle Pengu is cut by the circle, so it rises from inside it; above, the head and flippers may pop past its edge.
    `share` is Pengu's size against half the picture, `drop` how far down it sits."""
    n = 2048
    c = n // 2
    r = int(n * 0.40)
    base = Image.new('RGBA', (n, n), CIRCLE + (255,) if square else (0, 0, 0, 0))
    if not square:
        ImageDraw.Draw(base).ellipse((c - r, c - r, c + r, c + r), fill=CIRCLE + (255,))
    p = trim_square(stk, 0)
    size = int(n * 0.5 * share)
    p = p.resize((size, size), Image.LANCZOS)
    layer = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    layer.alpha_composite(p, ((n - size) // 2, c - size // 2 + int(drop * n)))
    keep = Image.new('L', (n, n), 0)
    d = ImageDraw.Draw(keep)
    if square:
        d.rectangle((0, 0, n, n), fill=255)
    else:
        d.ellipse((c - r, c - r, c + r, c + r), fill=255)
        d.rectangle((0, 0, n, c), fill=255)
    layer.putalpha(ImageChops.multiply(layer.getchannel('A'), keep))
    base.alpha_composite(layer)
    return base if square else trim_square(base, 0.03)


def save(im: Image.Image, path: str, size: int, **kw) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.resize((size, size), Image.LANCZOS).save(path, **kw)
    print(f'wrote {os.path.relpath(path, REPO)} ({size} px, {os.path.getsize(path) // 1024} KB)')


def main() -> None:
    src = Image.open(SRC).convert('RGB')
    stk = sticker(src)
    mascot = trim_square(stk)
    mark = peeking(stk)
    mascot.save(os.path.join(REPO, 'art', 'pengu-sticker.png'))
    print('wrote art/pengu-sticker.png')
    save(mascot, os.path.join(REPO, 'src', 'ui', 'pengu', 'pengu.webp'), 512, quality=90, method=6)
    save(mark, os.path.join(REPO, 'src', 'ui', 'pengu', 'logo.webp'), 192, quality=90, method=6)
    save(mark, os.path.join(REPO, 'public', 'icons', 'icon-192.png'), 192, optimize=True)
    save(mark, os.path.join(REPO, 'public', 'icons', 'icon-512.png'), 512, optimize=True)
    peeking(stk, square=True, share=1.75, drop=0.24).resize((180, 180), Image.LANCZOS).save(os.path.join(REPO, 'public', 'icons', 'apple-touch-icon.png'), optimize=True)
    print('wrote public/icons/apple-touch-icon.png (180 px)')
    # The safe zone is the middle 80 percent: Pengu's face a little smaller and higher there.
    peeking(stk, square=True, share=1.35, drop=0.20).resize((512, 512), Image.LANCZOS).save(os.path.join(REPO, 'public', 'icons', 'icon-maskable-512.png'), optimize=True)
    print('wrote public/icons/icon-maskable-512.png (512 px)')
    buf = io.BytesIO()
    mark.resize((128, 128), Image.LANCZOS).save(buf, 'PNG', optimize=True)
    data = base64.b64encode(buf.getvalue()).decode()
    with open(os.path.join(REPO, 'public', 'icon.svg'), 'w') as f:
        f.write(f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 128 128">'
                f'<image width="128" height="128" href="data:image/png;base64,{data}"/></svg>\n')
    print(f'wrote public/icon.svg ({os.path.getsize(os.path.join(REPO, "public", "icon.svg")) // 1024} KB)')


if __name__ == '__main__':
    main()
