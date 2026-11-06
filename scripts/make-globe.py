#!/usr/bin/env python3
# The continents of the app's globe (src/ui/globe.svg, scripts/make-icons.mjs): Natural Earth's 1:110m land (public domain,
# github.com/nvkelso/natural-earth-vector, geojson/ne_110m_land.geojson) in an orthographic view, as SVG path data.
#   python3 -I scripts/make-globe.py ne_110m_land.geojson 55 25 17 0.3 32 29   (center lon, lat; radius; simplify; center x, y)
# 55E 25N shows Europe, Africa and Asia. Land behind the globe is pressed onto its rim; slivers and specks are dropped.
import json, math, sys
src, lon0, lat0, R, tol = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5])
cx, cy = float(sys.argv[6]), float(sys.argv[7])
L0, P0 = math.radians(lon0), math.radians(lat0)
def proj(lon, lat):
    l, p = math.radians(lon), math.radians(lat)
    cosc = math.sin(P0) * math.sin(p) + math.cos(P0) * math.cos(p) * math.cos(l - L0)
    x = math.cos(p) * math.sin(l - L0)
    y = math.cos(P0) * math.sin(p) - math.sin(P0) * math.cos(p) * math.cos(l - L0)
    if cosc < 0:  # behind: pushed onto the rim
        n = math.hypot(x, y) or 1
        x, y = x / n, y / n
    return cx + R * x, cy - R * y, cosc >= 0
def dp(pts, eps):
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]
    dx, dy = b[0] - a[0], b[1] - a[1]
    n = math.hypot(dx, dy) or 1e-9
    i, dmax = 0, 0
    for k in range(1, len(pts) - 1):
        d = abs(dy * pts[k][0] - dx * pts[k][1] + b[0] * a[1] - b[1] * a[0]) / n
        if d > dmax: i, dmax = k, d
    if dmax > eps: return dp(pts[:i + 1], eps)[:-1] + dp(pts[i:], eps)
    return [a, b]
def area(pts):
    return abs(sum(pts[i][0] * pts[i - 1][1] - pts[i - 1][0] * pts[i][1] for i in range(len(pts)))) / 2
geo = json.load(open(src))
out = []
for f in geo['features']:
    g = f['geometry']
    polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
    for poly in polys:
        ring = poly[0]
        # densify so rim-hugging edges follow the circle
        dense = []
        for (a, b) in zip(ring, ring[1:] + ring[:1]):
            steps = max(1, int(max(abs(b[0] - a[0]), abs(b[1] - a[1])) / 2))
            for s in range(steps):
                t = s / steps
                dense.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
        pp = [proj(lo, la) for lo, la in dense]
        if not any(v for _, _, v in pp): continue
        pts = [(x, y) for x, y, _ in pp]
        per = sum(math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) for i in range(len(pts)))
        # Too small to see, or a sliver of the far side pressed onto the rim (thin: little area for its length).
        if area(pts) < 0.5 or area(pts) / per < 0.12: continue
        k = max(range(len(pts)), key=lambda i: (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2)
        s = dp(pts[:k + 1], tol)[:-1] + dp(pts[k:] + [pts[0]], tol)[:-1]
        if len(s) < 3: continue
        out.append('M' + 'L'.join(f'{x:.1f} {y:.1f}' for x, y in s) + 'Z')
print(''.join(out))
