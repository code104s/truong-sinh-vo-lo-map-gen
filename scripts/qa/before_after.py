# Before/after boards for the QA set: one PNG per seed (Z1, Z2, Z3 rows; before | after columns) and
# one overview of all Z1 maps. Same seed, camera and zoom on both sides.
#   python3 scripts/qa/before_after.py <beforeShots> <afterShots> <outDir>
import os, sys
from PIL import Image, ImageDraw

before, after, out = sys.argv[1:4]
os.makedirs(out, exist_ok=True)
seeds = sorted({f.split('_')[0] for f in os.listdir(after) if f.endswith('_Z1.png')})
W = 800  # width of one panel

def panel(path, z):
    im = Image.open(path).convert('RGB')
    if z == 'Z1':
        im = im.crop((320, 20, 1280, 980))
    return im.resize((W, round(im.height * W / im.width)))

def label(im, text):
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, 8 * len(text) + 12, 20), fill=(250, 246, 236))
    d.text((6, 4), text, fill=(40, 36, 30))

for s in seeds:
    rows = []
    for z in ('Z1', 'Z2', 'Z3'):
        a, b = panel(f'{before}/{s}_{z}.png', z), panel(f'{after}/{s}_{z}.png', z)
        label(a, f'{s} {z} before'); label(b, f'{s} {z} after')
        row = Image.new('RGB', (2 * W + 8, max(a.height, b.height)), 'white')
        row.paste(a, (0, 0)); row.paste(b, (W + 8, 0))
        rows.append(row)
    board = Image.new('RGB', (2 * W + 8, sum(r.height for r in rows) + 8 * (len(rows) - 1)), 'white')
    y = 0
    for r in rows:
        board.paste(r, (0, y)); y += r.height + 8
    board.save(f'{out}/{s}.png', optimize=True)

# Overview: Z1 before/after pairs, 4 pairs per row.
T = 360
pairs = []
for s in seeds:
    a, b = panel(f'{before}/{s}_Z1.png', 'Z1').resize((T, T)), panel(f'{after}/{s}_Z1.png', 'Z1').resize((T, T))
    label(a, f'{s} before'); label(b, f'{s} after')
    p = Image.new('RGB', (2 * T + 4, T), 'white'); p.paste(a, (0, 0)); p.paste(b, (T + 4, 0))
    pairs.append(p)
cols = 2
rows = (len(pairs) + cols - 1) // cols
ov = Image.new('RGB', (cols * (2 * T + 4) + (cols - 1) * 16, rows * T + (rows - 1) * 12), 'white')
for i, p in enumerate(pairs):
    ov.paste(p, ((i % cols) * (2 * T + 4 + 16), (i // cols) * (T + 12)))
ov.save(f'{out}/overview_Z1.png', optimize=True)
print(len(seeds), 'boards in', out)
