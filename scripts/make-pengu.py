#!/usr/bin/env python3
"""Pengu, LinguPengu's mascot, from its pictures: the app's images and icons.

    python3 -I scripts/make-pengu.py        (needs Pillow: pip install pillow)

Two pictures by Henry (an AI image generator, 2026-11-12), the same flat Pengu, a round emperor penguin chick peeking over an
open terracotta book, on white, the same size and in the same place:

    art/pengu-logo.png   Pengu calm, beak closed: the logo (the brand mark in the bar, the browser tab, the app's icons)
    art/pengu-read.png   Pengu happy, beak open: the mascot inside the app

Pengu is animated a drawing at a time (ui/pengu.ts swaps them), from drawings made in ChatGPT (2026-11-12), all 1254 px
square. Over its book, each an edit of art/pengu-read.png with one thing changed:

    art/pengu-blink-half.png  eyes half shut                 (a blink: half, shut, half)
    art/pengu-blink.png       eyes shut
    art/pengu-wave-1.png      one flipper up, tipped outward (a wave: out, up, in, up, out...)
    art/pengu-wave-mid.png    the same flipper straight up
    art/pengu-wave-2.png      the same flipper tipped inward

An edit redraws the whole picture a hair differently, so swapping to it would make every line shimmer. Only what the edit
really changed is taken from it (where it differs from the mascot by more than a thin line's worth, grown and softened at the
edge) and laid over the mascot; everything else is the mascot's own pixels, so the frames hold still but for the part that moves.

And on its own feet, without the book, for good news (a jump: stand, crouch, rise, air, and back down):

    art/pengu-stand.png    standing, room above it to jump into
    art/pengu-crouch.png   crouched to jump, the feet where they were
    art/pengu-rise.png     on the way up
    art/pengu-air.png      at the top, flippers in the air

These change all over, so they are used whole. Each is set down on the standing Pengu's ground (moved down by however far
up it was drawn), so the drawings change Pengu's pose and nothing else, and the app moves Pengu up and down along a smooth
arc while they change (ui/pengu.ts): drawings alone would jump in steps. How far up each was drawn, a share of the square, is
written to src/ui/pengu/jump.json for that arc. All four are framed in one square that holds the whole jump.

Each picture is cut out of its white (every pixel outside Pengu's dark outline as see-through as it is close to the white, so it
sits cleanly on a light or a dark page) and kept in its own colors. The logo is the cutout filling a white square with rounded
corners, the book running into its bottom edge and Pengu's head near the top (a home screen wants a solid square anyway: iOS
fills a see-through one with black). It writes:

    src/ui/pengu/pengu.webp        the mascot (peeking over a card, empty screens), 384 px
    src/ui/pengu/pengu-<frame>.webp  each drawing above, 384 px (the book ones framed exactly like the mascot)
    src/ui/pengu/logo.webp         the logo, the brand mark in the bar, 128 px
    art/pengu-cutout.png           the mascot at full size, for scripts/make-icons.mjs (the link picture)
    public/icon.svg                the logo for the browser tab, a 128 px picture inside an SVG
    public/icons/icon-192.png, icon-512.png       the logo ("any" purpose)
    public/icons/apple-touch-icon.png (180)        the square, full bleed (iOS rounds the corners)
    public/icons/icon-maskable-512.png             the square with Pengu smaller, inside the central safe zone
"""
import base64, io, json, os
from collections import deque
from PIL import Image, ImageChops, ImageDraw, ImageFilter

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
LOGO = os.path.join(REPO, 'art', 'pengu-logo.png')
MASCOT = os.path.join(REPO, 'art', 'pengu-read.png')
# The animation's drawings (see above): edits of the mascot over its book, and the jump.
FRAMES = ['blink-half', 'blink', 'wave-1', 'wave-mid', 'wave-2']
JUMP = ['stand', 'crouch', 'rise', 'air']
MASCOT_PX = 384   # three times the largest Pengu on a page (128 px), for a phone's screen
SOFT = (10, 60)   # distance from the background color (RGB) at which a pixel starts to show, and at which it is solid
GROUND = (255, 255, 255)        # the logo's ground: white


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


def changed_part(base: Image.Image, edit: Image.Image) -> Image.Image:
    """`edit` where it really differs from `base`, and `base` everywhere else (both RGB, the same size).

    A difference only a few pixels wide (a line redrawn a hair to one side) is dropped by an opening; what is left is grown, to
    take in the new part's own edges and the lines it touches, and softened, so the seam does not show."""
    if edit.size != base.size:
        raise SystemExit(f'a frame is {edit.size}, not {base.size} like art/pengu-read.png')
    diff = ImageChops.difference(base, edit).convert('L').point(lambda v: 255 if v > 24 else 0)
    mask = diff.filter(ImageFilter.MinFilter(9)).filter(ImageFilter.MaxFilter(9))
    # Grown well past the change, so every line it touches is the edit's own whole line; the seam lands where the two pictures
    # agree, and is softened there.
    for _ in range(3):
        mask = mask.filter(ImageFilter.MaxFilter(15))
    mask = mask.filter(ImageFilter.GaussianBlur(6))
    return Image.composite(edit, base, mask)


def logo_square(sticker: Image.Image, size: int, top: float = 0.07, bleed: float = 0.025) -> Image.Image:
    """A white square filled by the sticker: its top `top` of the side down from the square's top, the book running a little
    past the bottom edge (`bleed`), so the book sits on the edge with its bottom line cut off, centered left to right."""
    part = sticker.crop(sticker.getbbox())
    h = round(size * (1 - top + bleed))
    w = round(part.width * h / part.height)
    if w > size * 0.96:
        raise SystemExit(f'the logo is too wide for its square at this height ({w} of {size} px)')
    s = part.resize((w, h), Image.LANCZOS)
    sq = Image.new('RGBA', (size, size), GROUND + (255,))
    sq.paste(s, ((size - w) // 2, round(size * top)), s)
    return sq


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
    logo_cut = cutout(Image.open(LOGO).convert('RGB'))
    read_rgb = Image.open(MASCOT).convert('RGB')
    read_cut = cutout(read_rgb)
    if read_cut.size != logo_cut.size:
        raise SystemExit(f'art/pengu-read.png is {read_cut.size}, not {logo_cut.size} like art/pengu-logo.png')
    union = lambda boxes: tuple(f(v) for f, v in zip((min, min, max, max), zip(*boxes)))
    # The logo and the mascot cut to the same box (the two together), so they frame Pengu alike.
    box = union([logo_cut.getbbox(), read_cut.getbbox()])
    frames = {name: cutout(changed_part(read_rgb, Image.open(os.path.join(REPO, 'art', f'pengu-{name}.png')).convert('RGB'))) for name in FRAMES}
    # The mascot and its frames in one box that holds them all (a raised flipper may reach past the mascot), so swapping one
    # picture for another moves nothing but the part that changed.
    still = union([box] + [f.getbbox() for f in frames.values()])
    mascot = trim_square(read_cut, box=still)
    mascot.save(os.path.join(REPO, 'art', 'pengu-cutout.png'), optimize=True)
    print('wrote art/pengu-cutout.png')
    save(mascot, os.path.join(REPO, 'src', 'ui', 'pengu', 'pengu.webp'), MASCOT_PX, quality=90, method=6)
    for name, cut in frames.items():
        save(trim_square(cut, box=still), os.path.join(REPO, 'src', 'ui', 'pengu', f'pengu-{name}.webp'), MASCOT_PX, quality=90, method=6)
    jump = {name: cutout(Image.open(os.path.join(REPO, 'art', f'pengu-{name}.png')).convert('RGB')) for name in JUMP}
    # The square holds the whole jump as drawn (the highest drawing's top down to the ground).
    whole = union([cut.getbbox() for cut in jump.values()])
    floor = jump['stand'].getbbox()[3]
    side = int(max(whole[2] - whole[0], whole[3] - whole[1]) * (1 + 2 * 0.04))
    lifts = {}
    for name, cut in jump.items():
        up = floor - cut.getbbox()[3]
        lifts[name] = round(100 * up / side, 2)
        landed = Image.new('RGBA', cut.size, (0, 0, 0, 0))
        landed.paste(cut, (0, up), cut)
        save(trim_square(landed, box=whole), os.path.join(REPO, 'src', 'ui', 'pengu', f'pengu-{name}.webp'), MASCOT_PX, quality=90, method=6)
    with open(os.path.join(REPO, 'src', 'ui', 'pengu', 'jump.json'), 'w') as f:
        f.write(json.dumps(lifts) + '\n')
    print(f'wrote src/ui/pengu/jump.json {lifts}')
    mark = trim_square(logo_cut, box=box)
    square = logo_square(logo_cut, 1024)
    logo = rounded(square)
    save(logo, os.path.join(REPO, 'src', 'ui', 'pengu', 'logo.webp'), 128, quality=90, method=6)
    save(logo, os.path.join(REPO, 'public', 'icons', 'icon-192.png'), 192, optimize=True)
    save(logo, os.path.join(REPO, 'public', 'icons', 'icon-512.png'), 512, optimize=True)
    save(square.convert('RGB'), os.path.join(REPO, 'public', 'icons', 'apple-touch-icon.png'), 180, optimize=True)
    # The safe zone is the middle 80 percent, a circle: Pengu shrunk to fit inside it.
    save(on_ground(mark, 1024, 0.64).convert('RGB'), os.path.join(REPO, 'public', 'icons', 'icon-maskable-512.png'), 512, optimize=True)
    buf = io.BytesIO()
    logo.resize((128, 128), Image.LANCZOS).save(buf, 'PNG', optimize=True)
    data = base64.b64encode(buf.getvalue()).decode()
    with open(os.path.join(REPO, 'public', 'icon.svg'), 'w') as f:
        f.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><image width="128" height="128" href="data:image/png;base64,{data}"/></svg>\n')
    print(f'wrote public/icon.svg ({os.path.getsize(os.path.join(REPO, "public", "icon.svg")) // 1024} KB)')


if __name__ == '__main__':
    main()
