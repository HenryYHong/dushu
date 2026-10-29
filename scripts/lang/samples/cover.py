#!/usr/bin/env python3 -I
"""Cover helper (curl for downloads; Pillow for images). Originals are deleted right after use.
  cover.py sheet OUT.jpg NAME_OR_URL ...        contact sheet of small thumbnails of Commons files (numbered) or direct image URLs
  cover.py make LANG ID NAME_OR_URL CX CY [Z]   crop 5:7 around focus (CX, CY in 0..1; Z>1 zooms in), 600x840 JPEG <200 KB
NAME is a Commons file name (File: prefix optional); a value starting with http is fetched as is."""
import io, os, subprocess, sys, urllib.parse
from PIL import Image, ImageDraw
UA = 'Dushu-cover-finder/0.1 (personal reading app)'
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))

def url_for(name, width):
    if name.startswith('http'): return name
    n = name.replace('File:', '').replace(' ', '_')
    return f'https://commons.wikimedia.org/wiki/Special:FilePath/{urllib.parse.quote(n)}?width={width}'

def fetch(name, width):
    # A width at or past the original's is served from the original, which Wikimedia rate-limits; a smaller thumbnail is
    # tried next.
    for w in (width, 960, 800):
        r = subprocess.run(['curl', '-sfL', '-m', '90', '-A', UA, url_for(name, w)], capture_output=True)
        if not r.returncode and r.stdout: break
    if r.returncode or not r.stdout: raise RuntimeError('download failed: ' + name)
    im = Image.open(io.BytesIO(r.stdout)); im.load()
    return im.convert('RGB')

def crop(im, cx, cy, z=1.0):
    w, h = im.size; R = 5 / 7
    cw, ch = (round(h * R), h) if w / h > R else (w, round(w / R))
    cw, ch = round(cw / z), round(ch / z)
    x = min(max(round(cx * w - cw / 2), 0), w - cw); y = min(max(round(cy * h - ch / 2), 0), h - ch)
    return im.crop((x, y, x + cw, y + ch)).resize((600, 840), Image.LANCZOS)

def main():
    a = sys.argv[1:]
    if a[0] == 'sheet':
        out, names = a[1], a[2:]
        W, H = 220, 300
        sheet = Image.new('RGB', (W * len(names), H + 18), 'white'); d = ImageDraw.Draw(sheet)
        for i, n in enumerate(names):
            try:
                im = fetch(n, 360); sz = im.size; im.thumbnail((W - 6, H - 6)); sheet.paste(im, (i * W + 3, 3))
                d.text((i * W + 4, H + 3), f'{i}: {sz[0]}x{sz[1]}', fill='black')
            except Exception as e:
                d.text((i * W + 4, 100), 'FAILED', fill='red'); d.text((i * W + 4, H + 3), f'{i}: fail', fill='black')
            if i < len(names) - 1: pass
        sheet.save(out, quality=80)
    elif a[0] == 'make':
        lang, bid, name, cx, cy = a[1], a[2], a[3], float(a[4]), float(a[5]); z = float(a[6]) if len(a) > 6 else 1.0
        im = fetch(name, 1200)  # 1280 px thumbnails come from the thumbnail servers, which are not rate-limited like originals
        c = crop(im, cx, cy, z)
        path = os.path.join(REPO, 'public', 'samples', lang, 'covers', bid + '.jpg')
        os.makedirs(os.path.dirname(path), exist_ok=True)
        for q in (86, 82, 78, 74, 70):
            c.save(path, quality=q, optimize=True, progressive=True)
            if os.path.getsize(path) < 200_000: break
        print(path, im.size, os.path.getsize(path), 'q', q)

main()
