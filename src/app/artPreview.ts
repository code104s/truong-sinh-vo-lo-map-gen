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
