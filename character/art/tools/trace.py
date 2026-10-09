"""Measure the reference cat and rebuild it as clean, layered cubic Bezier parts.

Writes parts.json (path data + measurements) next to this script.
"""
import json
import cv2
import numpy as np

import os
HERE = os.path.dirname(os.path.abspath(__file__))
im = cv2.imread(f"{HERE}/ref.png")
H, W_IMG = im.shape[:2]
PAL = {  # BGR
    "bg": (231, 246, 249), "orange": (106, 167, 240), "cream": (181, 219, 246),
    "dark": (62, 65, 110), "blush": (114, 136, 237),
}
names = list(PAL)
pal = np.array([PAL[n] for n in names], np.float32)
d = ((im[:, :, None, :].astype(np.float32) - pal[None, None]) ** 2).sum(-1)
lab = d.argmin(-1)
M = {n: (lab == i) for i, n in enumerate(names)}
u8 = lambda m: (m.astype(np.uint8) * 255)


def disk(r):
    r = max(1, int(round(r)))
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))


def fill_holes(m):
    m = u8(m)
    ff = m.copy()
    h, w = m.shape
    mask = np.zeros((h + 2, w + 2), np.uint8)
    cv2.floodFill(ff, mask, (0, 0), 255)
    return (m > 0) | (ff == 0)


# ---------- stroke width ----------
dist = cv2.distanceTransform(u8(M["dark"]), cv2.DIST_L2, 5)
STROKE = float(np.percentile(dist[M["dark"]], 97) * 2)

# ---------- silhouette + interior components ----------
S = fill_holes(~M["bg"])
S = cv2.morphologyEx(u8(S), cv2.MORPH_OPEN, disk(2)) > 0
inner = S & ~M["dark"]
n, cc, stats, cents = cv2.connectedComponentsWithStats(u8(inner), 8)
comps = sorted(range(1, n), key=lambda i: -stats[i, cv2.CC_STAT_AREA])
body_id = comps[0]
ear_ids, tail_id = [], None
for i in comps[1:]:
    a = stats[i, cv2.CC_STAT_AREA]
    cx, cy = cents[i]
    if a < 800:
        continue
    if cy < 330 and (cx < 340 or cx > 610):
        ear_ids.append(i)
    elif cx > 640 and cy > 700 and tail_id is None:
        tail_id = i
ear_ids.sort(key=lambda i: cents[i][0])
R = STROKE / 2


def smooth_closed(pts, sigma=2.5, step=2.0):
    pts = pts.astype(np.float64)
    k = int(sigma * 3)
    ker = np.exp(-0.5 * (np.arange(-k, k + 1) / sigma) ** 2)
    ker /= ker.sum()
    ext = np.vstack([pts[-k:], pts, pts[:k]])
    sm = np.column_stack([np.convolve(ext[:, j], ker, "valid") for j in range(2)])
    seg = np.linalg.norm(np.diff(np.vstack([sm, sm[:1]]), axis=0), axis=1)
    s = np.r_[0, np.cumsum(seg)]
    t = np.arange(0, s[-1], step)
    loop = np.vstack([sm, sm[:1]])
    return np.column_stack([np.interp(t, s, loop[:, j]) for j in range(2)])


def smooth_open(pts, sigma=2.0, step=2.0):
    pts = pts.astype(np.float64)
    k = int(sigma * 3)
    ker = np.exp(-0.5 * (np.arange(-k, k + 1) / sigma) ** 2)
    ker /= ker.sum()
    ext = np.vstack([np.repeat(pts[:1], k, 0), pts, np.repeat(pts[-1:], k, 0)])
    sm = np.column_stack([np.convolve(ext[:, j], ker, "valid") for j in range(2)])
    sm[0], sm[-1] = pts[0], pts[-1]
    seg = np.linalg.norm(np.diff(sm, axis=0), axis=1)
    s = np.r_[0, np.cumsum(seg)]
    t = np.linspace(0, s[-1], max(4, int(s[-1] / step)))
    return np.column_stack([np.interp(t, s, sm[:, j]) for j in range(2)])


# ---------- Schneider curve fitting ----------
def bq(c, t):
    mt = 1 - t
    return (mt**3)[:, None] * c[0] + (3 * mt**2 * t)[:, None] * c[1] + (3 * mt * t**2)[:, None] * c[2] + (t**3)[:, None] * c[3]


def bq1(c, t):
    mt = 1 - t
    return (3 * mt**2)[:, None] * (c[1] - c[0]) + (6 * mt * t)[:, None] * (c[2] - c[1]) + (3 * t**2)[:, None] * (c[3] - c[2])


def bq2(c, t):
    return (6 * (1 - t))[:, None] * (c[2] - 2 * c[1] + c[0]) + (6 * t)[:, None] * (c[3] - 2 * c[2] + c[1])


def nrm(v):
    l = np.linalg.norm(v)
    return v / l if l > 1e-9 else v


def gen(p, u, t1, t2):
    a, b = p[0], p[-1]
    A1 = t1[None] * (3 * (1 - u) ** 2 * u)[:, None]
    A2 = t2[None] * (3 * (1 - u) * u**2)[:, None]
    C = np.array([[(A1 * A1).sum(), (A1 * A2).sum()], [(A1 * A2).sum(), (A2 * A2).sum()]])
    base = bq(np.array([a, a, b, b]), u)
    tmp = p - base
    X = np.array([(A1 * tmp).sum(), (A2 * tmp).sum()])
    det = C[0, 0] * C[1, 1] - C[0, 1] ** 2
    seg = np.linalg.norm(b - a)
    if abs(det) > 1e-9:
        al = (X[0] * C[1, 1] - X[1] * C[0, 1]) / det
        ar = (C[0, 0] * X[1] - C[0, 1] * X[0]) / det
    else:
        al = ar = seg / 3
    if al < 1e-6 * seg or ar < 1e-6 * seg:
        al = ar = seg / 3
    return np.array([a, a + t1 * al, b + t2 * ar, b])


def maxerr(c, p, u):
    e = np.linalg.norm(bq(c, u) - p, axis=1)
    i = int(e.argmax())
    return e[i], i


def fit_cubic(p, t1, t2, err, depth=0):
    if len(p) <= 2 or depth > 12:
        s = np.linalg.norm(p[-1] - p[0]) / 3
        return [np.array([p[0], p[0] + t1 * s, p[-1] + t2 * s, p[-1]])]
    dd = np.r_[0, np.cumsum(np.linalg.norm(np.diff(p, axis=0), axis=1))]
    u = dd / dd[-1]
    c = gen(p, u, t1, t2)
    e, sp = maxerr(c, p, u)
    if e < err:
        return [c]
    if e < err * 4:
        for _ in range(25):
            d1 = bq(c, u) - p
            q1, q2 = bq1(c, u), bq2(c, u)
            den = (q1 * q1).sum(1) + (d1 * q2).sum(1)
            u = np.clip(np.where(np.abs(den) > 1e-9, u - (d1 * q1).sum(1) / np.where(np.abs(den) > 1e-9, den, 1), u), 0, 1)
            c = gen(p, u, t1, t2)
            e, sp = maxerr(c, p, u)
            if e < err:
                return [c]
    sp = min(max(sp, 1), len(p) - 2)
    tc = nrm(p[sp - 1] - p[sp + 1])
    return fit_cubic(p[: sp + 1], t1, tc, err, depth + 1) + fit_cubic(p[sp:], -tc, t2, err, depth + 1)


def tangent(p, i, k=3):
    n = len(p)
    return nrm(p[(i + k) % n] - p[(i - k) % n])


def fit_closed(p, err=1.2, splits=4):
    n = len(p)
    # split at the points of highest curvature so corners (ear tips) stay crisp
    cross2 = lambda u, v: u[0] * v[1] - u[1] * v[0]
    a = np.array([cross2(nrm(p[i] - p[i - 4]), nrm(p[(i + 4) % n] - p[i])) for i in range(n)])
    order = np.argsort(-np.abs(a))
    idx = []
    for i in order:
        if all(min(abs(i - j), n - abs(i - j)) > n / (splits * 2.2) for j in idx):
            idx.append(int(i))
        if len(idx) == splits:
            break
    idx.sort()
    segs = []
    for a_, b_ in zip(idx, idx[1:] + [idx[0] + n]):
        q = np.array([p[k % n] for k in range(a_, b_ + 1)])
        segs += fit_cubic(q, tangent(p, a_), -tangent(p, b_ % n), err)
    return segs


def fit_open(p, err=1.0):
    return fit_cubic(p, nrm(p[min(3, len(p) - 1)] - p[0]), nrm(p[max(-4, -len(p))] - p[-1]), err)


def to_d(segs, closed):
    f = lambda v: f"{v:.1f}".rstrip("0").rstrip(".")
    out = f"M{f(segs[0][0][0])} {f(segs[0][0][1])}"
    for c in segs:
        out += f"C{f(c[1][0])} {f(c[1][1])} {f(c[2][0])} {f(c[2][1])} {f(c[3][0])} {f(c[3][1])}"
    return out + ("Z" if closed else "")


def contour_of(mask):
    cs, _ = cv2.findContours(u8(mask), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    c = max(cs, key=cv2.contourArea)
    return c[:, 0, :]


def closed_path(mask, err=1.2, splits=4, sigma=2.5):
    return to_d(fit_closed(smooth_closed(contour_of(mask), sigma), err, splits), True)


out = {"size": [W_IMG, H], "stroke": round(STROKE, 1)}

# ---------- body ----------
B = fill_holes(cc == body_id)
B = cv2.morphologyEx(u8(B), cv2.MORPH_CLOSE, disk(STROKE * 1.4)) > 0
if tail_id is not None:
    T_int = cc == tail_id
    hull = cv2.convexHull(contour_of(B))
    hm = np.zeros_like(u8(B))
    cv2.fillPoly(hm, [hull], 255)
    near_tail = cv2.dilate(u8(T_int), disk(STROKE * 3)) > 0
    B = B | ((hm > 0) & near_tail & S)
body_mask = cv2.dilate(u8(B), disk(R)) > 0
out["body"] = closed_path(body_mask, splits=6)

# ---------- ears (extended down under the head so they can rotate) ----------
out["ears"] = []
for i in ear_ids:
    e = cv2.dilate(u8(cc == i), disk(R))
    stack = e.copy()
    for dy in range(10, 90, 10):
        stack = np.maximum(stack, np.roll(e, dy, axis=0))
    hull = cv2.convexHull(contour_of(stack > 0))
    hm = np.zeros_like(e)
    cv2.fillPoly(hm, [hull], 255)
    fill = "cream" if M["cream"][cc == i].mean() > 0.5 else "orange"
    ys, xs = np.nonzero(cc == i)
    hm = (hm > 0) & (cv2.dilate(u8(S), disk(1)) > 0)  # never poke outside the drawn silhouette
    out["ears"].append({"d": closed_path(hm, splits=3, sigma=3), "fill": fill,
                        "tip": [int(xs[ys.argmin()]), int(ys.min())], "base": [float(xs.mean()), float(ys.max())]})

# ---------- tail ----------
if tail_id is not None:
    tm = cv2.dilate(u8(cc == tail_id), disk(R)) > 0
    out["tail"] = closed_path(tm, splits=4)
    # The stroke only runs along the tail's free edge; the stretch it shares with the body outline stays unstroked,
    # so the tail can swing without dragging a line across the body.
    tp = smooth_closed(contour_of(tm), 2.5)
    bp = smooth_closed(contour_of(body_mask), 2.5)
    dmin = np.sqrt(((tp[:, None, :] - bp[None, :, :]) ** 2).sum(-1)).min(1)
    free = dmin > 3.0
    n_ = len(tp)
    best, run, start = (0, 0), 0, 0
    for k in range(2 * n_):
        if free[k % n_]:
            if run == 0:
                start = k
            run += 1
            if run > best[0] and run <= n_:
                best = (run, start)
        else:
            run = 0
    seg = np.array([tp[(best[1] + k) % n_] for k in range(best[0])])
    out["tailLine"] = to_d(fit_open(seg, 1.0), False)
    ends = [seg[0], seg[-1]]
    pivot = min(ends, key=lambda q: q[1])
    out["tailPivot"] = [round(float(pivot[0]), 1), round(float(pivot[1]), 1)]
    # fill reaches a little into the body so a swing never opens a gap at the base
    near = np.zeros_like(u8(tm))
    cv2.circle(near, (int(pivot[0]), int(pivot[1])), 46, 255, -1)
    grow = (cv2.dilate(u8(tm), disk(26)) > 0) & (cv2.erode(u8(B), disk(R + 2)) > 0) & (near > 0)
    out["tailFill"] = closed_path(tm | grow, splits=4)

# ---------- outline band (for separating inner strokes) ----------
band = np.zeros((H, W_IMG), np.uint8)
for m in [body_mask] + ([tm] if tail_id is not None else []):
    cv2.polylines(band, [contour_of(m).reshape(-1, 1, 2)], True, 255, int(round(STROKE + 1)))
for i in ear_ids:
    e = cv2.dilate(u8(cc == i), disk(R)) > 0
    cv2.polylines(band, [contour_of(e).reshape(-1, 1, 2)], True, 255, int(round(STROKE + 1)))
# shrink the band to the actual outline pixels
inner_dark = M["dark"] & ~(band > 0)
inner_dark = cv2.morphologyEx(u8(inner_dark), cv2.MORPH_OPEN, disk(1.2)) > 0


def thin(img):
    img = img.astype(np.uint8).copy()
    while True:
        changed = False
        for step in (0, 1):
            P = np.pad(img, 1)
            p2, p3, p4, p5 = P[:-2, 1:-1], P[:-2, 2:], P[1:-1, 2:], P[2:, 2:]
            p6, p7, p8, p9 = P[2:, 1:-1], P[2:, :-2], P[1:-1, :-2], P[:-2, :-2]
            Bn = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
            seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2]
            A = sum(((seq[k] == 0) & (seq[k + 1] == 1)).astype(np.uint8) for k in range(8))
            c = ((p2 * p4 * p6 == 0) & (p4 * p6 * p8 == 0)) if step == 0 else ((p2 * p4 * p8 == 0) & (p2 * p6 * p8 == 0))
            m = (img == 1) & (Bn >= 2) & (Bn <= 6) & (A == 1) & c
            if m.any():
                img[m] = 0
                changed = True
        if not changed:
            return img.astype(bool)


def longest_path(sk):
    ys, xs = np.nonzero(sk)
    pts = set(zip(ys.tolist(), xs.tolist()))
    nb = lambda p: [(p[0] + dy, p[1] + dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if (dy or dx) and (p[0] + dy, p[1] + dx) in pts]

    def bfs(s):
        prev, dist_, q = {s: None}, {s: 0}, [s]
        for p in q:
            for v in nb(p):
                if v not in dist_:
                    dist_[v] = dist_[p] + 1
                    prev[v] = p
                    q.append(v)
        far = max(dist_, key=dist_.get)
        return far, prev
    a, _ = bfs(next(iter(pts)))
    b, prev = bfs(a)
    path, p = [], b
    while p is not None:
        path.append((p[1], p[0]))
        p = prev[p]
    return np.array(path, np.float64)


n2, cc2, st2, ce2 = cv2.connectedComponentsWithStats(u8(inner_dark), 8)
out["eyes"], out["strokes"] = [], []
for i in range(1, n2):
    if st2[i, cv2.CC_STAT_AREA] < 60:
        continue
    comp = cc2 == i
    cnt = contour_of(comp)
    area = st2[i, cv2.CC_STAT_AREA]
    (ex, ey), (ea, eb), ang = cv2.fitEllipse(cnt) if len(cnt) >= 5 else ((0, 0), (0, 0), 0)
    solidity = area / max(1, np.pi * ea * eb / 4)
    if solidity > 0.85 and min(ea, eb) > STROKE * 1.3:
        out["eyes"].append({"cx": round(ex, 1), "cy": round(ey, 1), "rx": round(ea / 2, 1), "ry": round(eb / 2, 1), "rot": round(ang, 1)})
        continue
    sk = thin(comp)
    if sk.sum() < 6:
        continue
    p = longest_path(sk)
    w = float(np.median(dist[sk]) * 2)
    p = smooth_open(p, 1.0, 1.5)
    out["strokes"].append({"d": to_d(fit_open(p, 0.7), False), "w": round(w, 1),
                           "cx": float(p[:, 0].mean()), "cy": float(p[:, 1].mean()),
                           "x0": float(p[:, 0].min()), "x1": float(p[:, 0].max()), "y0": float(p[:, 1].min()), "y1": float(p[:, 1].max())})

# ---------- blush ----------
out["blush"] = []
n3, cc3, st3, _ = cv2.connectedComponentsWithStats(u8(cv2.morphologyEx(u8(M["blush"]), cv2.MORPH_OPEN, disk(2)) > 0), 8)
for i in range(1, n3):
    if st3[i, cv2.CC_STAT_AREA] > 300:
        (bx, by), (ba, bb), ang = cv2.fitEllipse(contour_of(cc3 == i))
        out["blush"].append({"cx": round(bx, 1), "cy": round(by, 1), "rx": round(ba / 2, 1), "ry": round(bb / 2, 1), "rot": round(ang, 1)})
out["blush"].sort(key=lambda b: b["cx"])

# ---------- cream markings inside the body ----------
cream = M["cream"] & (cc == body_id) | (M["cream"] & S & ~(np.isin(cc, ear_ids)))
cream = cv2.morphologyEx(u8(cream), cv2.MORPH_OPEN, disk(2)) > 0
n4, cc4, st4, ce4 = cv2.connectedComponentsWithStats(u8(cream), 8)
out["stripes"], out["markings"] = [], []
for i in range(1, n4):
    a = st4[i, cv2.CC_STAT_AREA]
    if a < 300:
        continue
    x, y, w, h = st4[i, :4]
    cx, cy = ce4[i]
    comp = cc4 == i
    if h > w * 1.6 and cy < 420:
        # stripe: measure width at its middle and its visible bottom
        rows = comp[y + h // 3: y + 2 * h // 3]
        width = float(np.median(rows.sum(1)))
        out["stripes"].append({"cx": round(float(cx), 1), "w": round(width, 1), "top": int(y), "bottom": int(y + h)})
        continue
    if cx > 560 and cy < 470 and a > 5000:
        # head patch: fit a circle to the boundary points that do not touch the outline
        cnt = contour_of(comp).astype(np.float64)
        free = np.array([dist[int(py), int(px)] == 0 and not M["dark"][max(0, int(py) - 6):int(py) + 7, max(0, int(px) - 6):int(px) + 7].any() for px, py in cnt])
        q = cnt[free]
        A = np.column_stack([2 * q[:, 0], 2 * q[:, 1], np.ones(len(q))])
        sol = np.linalg.lstsq(A, (q**2).sum(1), rcond=None)[0]
        r = float(np.sqrt(sol[2] + sol[0] ** 2 + sol[1] ** 2))
        out["patch"] = {"cx": round(float(sol[0]), 1), "cy": round(float(sol[1]), 1), "r": round(r, 1)}
        continue
    # grow only underneath the dark lines, never into the orange fur
    grown = (cv2.dilate(u8(comp), disk(R + 1)) > 0) & body_mask & (M["cream"] | M["dark"])
    grown = cv2.morphologyEx(u8(grown), cv2.MORPH_OPEN, disk(2)) > 0
    out["markings"].append({"d": closed_path(grown, splits=4, sigma=2.0), "cx": float(cx), "cy": float(cy), "area": int(a)})
out["stripes"].sort(key=lambda s: s["cx"])
out["ear_ids"] = len(ear_ids)
json.dump(out, open(f"{HERE}/parts.json", "w"), indent=1)
print("stroke", out["stroke"], "ears", len(out["ears"]), "tail", "tail" in out, "eyes", len(out["eyes"]),
      "strokes", len(out["strokes"]), "blush", len(out["blush"]), "stripes", out["stripes"], "patch", out.get("patch"),
      "markings", [(round(m["cx"]), round(m["cy"]), m["area"]) for m in out["markings"]])
for s in out["strokes"]:
    print("  stroke w", s["w"], "c", round(s["cx"]), round(s["cy"]), "box", round(s["x0"]), round(s["y0"]), round(s["x1"]), round(s["y1"]))
