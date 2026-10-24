"""A3 proposal (wave 2): lake tone by kind at equal depth, pooled over the 20 Z1 shots.
   python3 scripts/qa/lake-tone.py <shotsDir> <analysisDir>
L* at interior lake cell centres (all 8 neighbours in the same lake, not under a stamp or mist),
binned by render depth. Reports, per kind: mean L* per bin and deepest-vs-shallowest spread; and
per bin with >= 30 samples of both: mountain minus plain L* (negative = mountain darker)."""
import json, os, sys
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'analysis'))
OX, OY, PX, n = 320, 20, 7.5, 128
BINS = [(0, 0.02), (0.02, 0.04), (0.04, 0.06), (0.06, 9)]
NAMES = {1: 'mountain', 2: 'valley', 3: 'plain'}

def lab_L(rgb):
    c = rgb / 255.0
    c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    y = c @ np.array([0.2126, 0.7152, 0.0722])
    f = np.where(y > 0.008856, np.cbrt(y), 7.787 * y + 16 / 116)
    return 116 * f - 16

shots, an = sys.argv[1:3]
vals = {(k, b): [] for k in NAMES for b in range(len(BINS))}
for i in range(1, 21):
    seed = f'tsvl-{i:02d}'
    if not os.path.exists(f'{shots}/{seed}_Z1.png'):
        continue
    L = lab_L(np.asarray(Image.open(f'{shots}/{seed}_Z1.png').convert('RGB')).astype(float))
    S = json.load(open(f'{an}/{seed}_samples.json'))
    lid = np.array(S['lakeId']).reshape(n, n)
    kd = np.array(S['lakeKind']).reshape(n, n)
    dep = np.array(S['lakeDepth']).reshape(n, n)
    cov = np.array(S['covered']).reshape(n, n)
    inner = lid > 0
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            inner &= np.roll(np.roll(lid, dy, 0), dx, 1) == lid
    ys, xs = np.where(inner & (cov == 0))
    for y, x in zip(ys, xs):
        l = L[int(OY + (y + 0.5) * PX), int(OX + (x + 0.5) * PX)]
        b = next(j for j, (a, z) in enumerate(BINS) if a <= dep[y, x] < z)
        vals[(kd[y, x], b)].append(l)

print('bin            ' + '  '.join(f'{NAMES[k]:>16}' for k in NAMES))
for b, (a, z) in enumerate(BINS):
    cells = [f'{np.mean(vals[(k, b)]):6.1f} (n={len(vals[(k, b)]):4d})' if vals[(k, b)] else '      -         ' for k in NAMES]
    print(f'{a:.2f}-{min(z, 0.99):.2f}      ' + '  '.join(cells))
for k in NAMES:
    m = [np.mean(vals[(k, b)]) for b in range(len(BINS)) if len(vals[(k, b)]) >= 30]
    mono = all(m[i] >= m[i + 1] for i in range(len(m) - 1))
    print(f'{NAMES[k]}: L* falls with depth: {mono}; shallowest - deepest bin (n>=30): {m[0] - m[-1]:.1f}' if len(m) >= 2 else f'{NAMES[k]}: <2 bins with n>=30')
for b, (a, z) in enumerate(BINS):
    mt, pl = vals[(1, b)], vals[(3, b)]
    if len(mt) >= 30 and len(pl) >= 30:
        print(f'bin {a:.2f}: mountain - plain L* = {np.mean(mt) - np.mean(pl):+.1f}')
