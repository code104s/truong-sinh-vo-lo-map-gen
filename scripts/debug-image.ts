// Debug comparison image: left = shaded heightmap only; right = same with ridge cells, ridge
// paths, peaks, clusters, rivers, lakes and stamp footprints. Usage:
//   npx vite-node scripts/debug-image.ts -- <outDir> <seed...>
import { mkdirSync, writeFileSync } from 'node:fs';
import manifest from '../src/assets/manifest.json';
import { logicOf, type Manifest } from '../src/assets/manifestTypes';
import { generateWorld, type WorldData } from '../src/worldgen/index';
import { encodePng } from './png';

const S = 6;
const logic = logicOf(manifest as unknown as Manifest);

export function renderDebug(world: WorldData): { rgba: Uint8Array; w: number; h: number } {
  const n = world.config.size;
  const PW = n * S, W = PW * 2 + 8, H = n * S;
  const img = new Uint8Array(W * H * 4).fill(255);
  const px = (x: number, y: number, r: number, g: number, b: number, a = 1) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 4;
    img[o] = img[o] * (1 - a) + r * a; img[o + 1] = img[o + 1] * (1 - a) + g * a; img[o + 2] = img[o + 2] * (1 - a) + b * a; img[o + 3] = 255;
  };
  const { hydro, ridges, composition, config } = world;
  const Hh = hydro.height;
  for (let panel = 0; panel < 2; panel++) {
    const ox = panel * (PW + 8);
    for (let y = 0; y < H; y++) for (let x = 0; x < PW; x++) {
      const cx = Math.min(n - 1, Math.floor(x / S)), cy = Math.min(n - 1, Math.floor(y / S)), c = cy * n + cx;
      const e = Hh[c];
      const ex = Hh[cy * n + Math.min(n - 1, cx + 1)] - Hh[cy * n + Math.max(0, cx - 1)];
      const ey = Hh[Math.min(n - 1, cy + 1) * n + cx] - Hh[Math.max(0, cy - 1) * n + cx];
      const shade = Math.max(0, Math.min(1, 0.62 - (ex + ey) * 4));
      let r, g, b;
      if (hydro.sea[c]) { r = 150; g = 175; b = 200; }
      else if (hydro.lakeId[c]) { r = 120; g = 160; b = 205; }
      else {
        const t = (e - config.seaLevel) / (1 - config.seaLevel);
        r = 120 + 120 * t; g = 150 + 70 * t; b = 100 + 110 * t;
        r *= 0.55 + 0.6 * shade; g *= 0.55 + 0.6 * shade; b *= 0.55 + 0.6 * shade;
        if (e >= config.mountainLevel) { r = r * 0.85 + 30; }
      }
      px(ox + x, y, Math.min(255, r), Math.min(255, g), Math.min(255, b));
    }
    if (panel === 0) continue;
    const ctr = (c: number): [number, number] => [ox + ((c % n) + 0.5) * S, (Math.floor(c / n) + 0.5) * S];
    const line = (x0: number, y0: number, x1: number, y1: number, col: number[], a = 1) => {
      const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) + 1;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        px(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), col[0], col[1], col[2], a);
      }
    };
    for (const r of hydro.rivers) for (let k = 1; k < r.cells.length; k++) {
      const [x0, y0] = ctr(r.cells[k - 1]), [x1, y1] = ctr(r.cells[k]);
      line(x0, y0, x1, y1, [20, 70, 200]);
    }
    for (let c = 0; c < n * n; c++) if (ridges.ridge[c]) {
      const [x, y] = ctr(c);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) px(x + dx, y + dy, 200, 40, 40, 0.5);
    }
    for (const p of ridges.paths) for (let k = 1; k < p.length; k++) {
      const [x0, y0] = ctr(p[k - 1]), [x1, y1] = ctr(p[k]);
      line(x0, y0, x1, y1, [160, 0, 0]);
    }
    for (const cl of ridges.clusters) cl.peaks.forEach((pi, k) => {
      const [x, y] = ctr(ridges.peaks[pi].cell);
      const rad = k === 0 ? 5 : 3;
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) if (dx * dx + dy * dy <= rad * rad) px(x + dx, y + dy, k === 0 ? 0 : 90, 0, k === 0 ? 0 : 90);
    });
    for (const s of composition.stamps) {
      const [fw, fh] = logic[s.key].footprint;
      const x0 = ox + (s.x - fw * s.scale / 2) * S, x1 = ox + (s.x + fw * s.scale / 2) * S;
      const y0 = (s.y - fh * s.scale * 0.75) * S, y1 = (s.y + fh * s.scale * 0.25) * S;
      const col = s.role === 'main' ? [255, 140, 0] : s.role === 'hill' ? [60, 140, 60] : [120, 60, 160];
      line(x0, y0, x1, y0, col); line(x0, y1, x1, y1, col); line(x0, y0, x0, y1, col); line(x1, y0, x1, y1, col);
    }
  }
  return { rgba: img, w: W, h: H };
}

const args = process.argv.slice(2).filter((a: string) => a !== '--');
if (args.length) {
  const [out, ...seeds] = args;
  mkdirSync(out, { recursive: true });
  for (const seed of seeds) {
    const world = generateWorld(seed, logic);
    const { rgba, w, h } = renderDebug(world);
    writeFileSync(`${out}/${seed}_ridges.png`, encodePng(rgba, w, h));
  }
}
