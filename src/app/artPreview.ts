// Shows every procedural stamp variant on paper, for reviewing placeholder art in isolation.
import manifestJson from '../assets/manifest.json';
import type { Manifest } from '../assets/manifestTypes';
import { paintProceduralArt } from '../render/stampArt';

const manifest = manifestJson as unknown as Manifest;
const scale = Number(new URLSearchParams(location.search).get('scale') ?? '0.5');
const art = paintProceduralArt(manifest);

// Composite everything into one canvas: one row per asset key.
const pad = 8;
let width = 0, height = pad;
const rows: { key: string; list: HTMLCanvasElement[]; h: number }[] = [];
for (const [key, list] of art) {
  const rowW = list.reduce((a, c) => a + c.width * scale + pad, pad);
  const rowH = Math.max(...list.map((c) => c.height * scale)) + 22;
  rows.push({ key, list, h: rowH });
  width = Math.max(width, rowW);
  height += rowH + pad;
}
const out = document.createElement('canvas');
out.width = Math.ceil(width);
out.height = Math.ceil(height);
const ctx = out.getContext('2d')!;
ctx.fillStyle = manifest.palette.paper;
ctx.fillRect(0, 0, out.width, out.height);
ctx.font = '12px monospace';
let y = pad;
for (const r of rows) {
  ctx.fillStyle = '#3a362e';
  ctx.fillText(`${r.key} · ${r.list.length} variants`, pad, y + 12);
  let x = pad;
  const base = y + r.h;
  for (const c of r.list) {
    ctx.drawImage(c, x, base - c.height * scale, c.width * scale, c.height * scale);
    x += c.width * scale + pad;
  }
  y += r.h + pad;
}
document.getElementById('root')!.appendChild(out);
document.body.dataset.ready = '1';

// QA hook: silhouette descriptors per variant, read by scripts/art-metrics.mjs.
(window as unknown as { __art: unknown }).__art = Object.fromEntries([...art].map(([key, list]) => [key, list.map((c) => {
  const { data, width: w, height: h } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
  // Silhouette = pixels with alpha ≥ 0.25; the column top gives the profile.
  const top = new Array<number>(w).fill(-1);
  let x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] < 64) continue;
    if (top[x] < 0) top[x] = y;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  // 48×48 mask of the tight box, scaled by its longer side and anchored bottom-centre.
  const N = 48, bw = x1 - x0 + 1, bh = y1 - y0 + 1, s = Math.max(bw, bh) / N;
  const mask: number[] = new Array(N * N).fill(0);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const sx = Math.floor(x0 + bw / 2 + (i - N / 2) * s), sy = Math.floor(y1 - (N - 1 - j) * s);
    if (sx >= 0 && sy >= 0 && sx < w && sy < h && data[(sy * w + sx) * 4 + 3] >= 64) mask[j * N + i] = 1;
  }
  const prof = top.slice(x0, x1 + 1).map((t) => (t < 0 ? 0 : (y1 - t) / bh));
  const near = prof.filter((p) => p >= 0.93).length / prof.length;
  let peaks = 0;
  const win = Math.max(3, Math.round(prof.length * 0.06));
  for (let k = win; k < prof.length - win; k++) {
    let isMax = prof[k] > 0.35;
    for (let d = -win; d <= win && isMax; d++) if (prof[k + d] > prof[k]) isMax = false;
    if (isMax && (peaks === 0 || prof[k] !== prof[k - 1])) peaks++;
  }
  let sym = 0, tot = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = mask[j * N + i], b = mask[j * N + (N - 1 - i)]; if (a || b) { tot++; if (a && b) sym++; } }
  return { aspect: bw / bh, topFlat: near, peaks, symmetry: sym / Math.max(1, tot), mask };
})]));
