# Analysis only: contrast of rivers and land-class colour differences in the Z1 QA screenshots.
#   python3 scripts/analysis/measure_shots.py <shotsDir> <analysisDir>
import json, sys
import numpy as np
from PIL import Image

shots, an = sys.argv[1], sys.argv[2]
OX, OY, PX = 320, 20, 7.5  # Z1 map placement in a 1600×1000 shot

def lab(rgb):
    c = rgb / 255.0
    c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = c @ M.T / np.array([0.9505, 1.0, 1.089])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)

out = []
for k in range(1, 21):
    seed = f"tsvl-{k:02d}"
    im = np.asarray(Image.open(f"{shots}/{seed}_Z1.png").convert('RGB')).astype(float)
    L = lab(im)
    S = json.load(open(f"{an}/{seed}_samples.json"))
    n = 128
    cls = np.array(S['landClass']).reshape(n, n)
    cov = np.array(S['covered']).reshape(n, n)
    # River contrast: darkest L* within ±2 px of the cell centre vs the median L* of a 21 px window.
    rows = []
    for r in S['rivers']:
        if r['occluded']:
            continue
        sx, sy = int(OX + r['x'] * PX), int(OY + r['y'] * PX)
        win = L[sy - 2:sy + 3, sx - 2:sx + 3, 0]
        bg = L[sy - 10:sy + 11, sx - 10:sx + 11, 0]
        rows.append((r['ratio'], np.median(bg) - win.min()))
    rows = np.array(rows)
    small = rows[rows[:, 0] < 3, 1] if len(rows) else np.array([])
    big = rows[rows[:, 0] >= 10, 1] if len(rows) else np.array([])
    # Land colour by class (uncovered cells only), and the stamp ink for reference.
    means = {}
    for c, name in [(0, 'lowland'), (1, 'rolling'), (2, 'hill'), (3, 'mountain')]:
        ys, xs = np.where((cls == c) & (cov == 0))
        if len(ys) < 20:
            continue
        px = L[(OY + (ys + 0.5) * PX).astype(int), (OX + (xs + 0.5) * PX).astype(int)]
        means[name] = px.mean(0)
    dE = {}
    if 'lowland' in means:
        for name, m in means.items():
            dE[name] = round(float(np.linalg.norm(m - means['lowland'])), 2)
    # Lake fill: L* spread inside lakes (uniformity) and contrast to nearby land.
    lid = np.array(S['lakeId']).reshape(n, n)
    ys, xs = np.where(lid > 0)
    lakeL = L[(OY + (ys + 0.5) * PX).astype(int), (OX + (xs + 0.5) * PX).astype(int), 0] if len(ys) else np.array([0])
    landL = L[(OY + (np.where(cls >= 0)[0] + 0.5) * PX).astype(int), (OX + (np.where(cls >= 0)[1] + 0.5) * PX).astype(int), 0]
    out.append({
        'seed': seed,
        'riverContrastL_small_p50': round(float(np.median(small)), 2) if len(small) else None,
        'riverContrastL_big_p50': round(float(np.median(big)), 2) if len(big) else None,
        'riverContrastL_all_p50': round(float(np.median(rows[:, 1])), 2),
        'riverCellsBelow4L': round(float((rows[:, 1] < 4).mean()), 3),
        'landDeltaE_vs_lowland': dE,
        'lakeL_mean': round(float(lakeL.mean()), 1), 'lakeL_std': round(float(lakeL.std()), 2),
        'landL_mean': round(float(landL.mean()), 1),
    })
json.dump(out, open(f"{an}/shots_measure.json", 'w'), indent=1)
for o in out:
    print(o)
