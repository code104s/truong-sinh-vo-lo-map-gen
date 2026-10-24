// Rivers as variable-width ink ribbons: a pale indigo wash between two thin bank lines that
// widen downstream (width ~ sqrt(flow)). Logic stays on the grid; smoothing is visual only.
import { Graphics } from 'pixi.js';
import type { Manifest } from '../assets/manifestTypes';
import type { WorldData } from '../worldgen/index';
import { createSimplex2D } from '../core/noise';
import { rngFor } from '../core/rng';
import { CELL_PX, hexToNumber } from './constants';

type Pt = { x: number; y: number; w: number };

function chaikin(pts: Pt[], rounds: number): Pt[] {
  let p = pts;
  for (let r = 0; r < rounds; r++) {
    if (p.length < 3) return p;
    const out: Pt[] = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25, w: a.w * 0.75 + b.w * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75, w: a.w * 0.25 + b.w * 0.75 });
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

/**
 * @param widthScale widens ribbons and lines for the overview LOD, where true-scale rivers would
 *                   be thinner than a pixel and the river network would vanish from the map frame.
 */
export function createRiverLayer(world: WorldData, manifest: Manifest, widthScale = 1): Graphics {
  const n = world.config.size;
  const { hydro } = world;
  const g = new Graphics();
  g.label = 'rivers';
  const wash = hexToNumber(manifest.palette.indigo);
  const ink = hexToNumber(manifest.palette.ink[2]);
  const thr = hydro.riverThreshold;
  // Visual-only meander so D8's straight runs read as brushed water, not survey lines.
  const noise = createSimplex2D(rngFor(world.seed, 'render:rivers'));

  const paths = [...hydro.rivers].sort((a, b) => hydro.acc[b.cells[b.cells.length - 1]] - hydro.acc[a.cells[a.cells.length - 1]]);
  for (const r of paths) {
    const raw: Pt[] = r.cells.map((c) => ({
      x: ((c % n) + 0.5) * CELL_PX,
      y: (Math.floor(c / n) + 0.5) * CELL_PX,
      w: widthScale * CELL_PX * Math.min(0.34, 0.035 + 0.032 * Math.sqrt(hydro.acc[c] / thr)),
    }));
    raw[0].w *= 0.2;
    // Densify, then push interior points sideways by smooth noise.
    const dense: Pt[] = [];
    for (let i = 0; i < raw.length - 1; i++) {
      const a = raw[i], b = raw[i + 1];
      for (let k = 0; k < 3; k++) {
        const t = k / 3;
        dense.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t });
      }
    }
    dense.push(raw[raw.length - 1]);
    for (let i = 1; i < dense.length - 1; i++) {
      const a = dense[i - 1], b = dense[i + 1];
      let nx = -(b.y - a.y), ny = b.x - a.x;
      const len = Math.hypot(nx, ny) || 1;
      nx /= len; ny /= len;
      const m = noise(dense[i].x / CELL_PX * 0.35, dense[i].y / CELL_PX * 0.35) * CELL_PX * 0.32;
      dense[i].x += nx * m;
      dense[i].y += ny * m;
    }
    const pts = chaikin(dense, 2);
    if (pts.length < 2) continue;
    const left: number[] = [], right: number[] = [], centre: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let nx = -(b.y - a.y), ny = b.x - a.x;
      const len = Math.hypot(nx, ny) || 1;
      nx /= len; ny /= len;
      const hw = pts[i].w / 2;
      left.push(pts[i].x + nx * hw, pts[i].y + ny * hw);
      right.push(pts[i].x - nx * hw, pts[i].y - ny * hw);
      centre.push(pts[i].x, pts[i].y);
    }
    const maxW = Math.max(...pts.map((p) => p.w));
    if (maxW < CELL_PX * 0.09 * widthScale) {
      // Stream: one brush line that swells and thins and fades towards its source.
      brush(g, centre, noise, ink, Math.max(0.8, maxW * 0.9), 0.5, 0.25);
      continue;
    }
    const poly: number[] = [...left];
    for (let i = right.length - 2; i >= 0; i -= 2) poly.push(right[i], right[i + 1]);
    g.poly(poly).fill({ color: wash, alpha: 0.42 });
    // Round the mouth so a tributary blends into the river or lake it joins.
    const end = pts[pts.length - 1];
    g.circle(end.x, end.y, end.w / 2).fill({ color: wash, alpha: 0.42 });
    // Banks drawn with a loaded-then-dry brush: the shaded (south/east) bank stays firmer.
    const bankW = Math.max(0.8, CELL_PX * 0.026 * widthScale);
    brush(g, left, noise, ink, bankW, 0.5, 0.1);
    brush(g, right, noise, ink, bankW * 0.8, 0.32, 0.45);
  }
  return g;
}

/**
 * Strokes a polyline in short runs whose width and opacity follow smooth noise, with dry-brush
 * gaps, and fades in over the first fifth (the upstream end).
 */
function brush(g: Graphics, xy: number[], noise: (x: number, y: number) => number, color: number, width: number, alpha: number, gapBias: number): void {
  const n = xy.length / 2;
  const RUN = 4;
  for (let i = 0; i < n - 1; i += RUN) {
    const j = Math.min(n - 1, i + RUN);
    const mx = xy[i * 2] / CELL_PX, my = xy[i * 2 + 1] / CELL_PX;
    const pressure = 0.5 + 0.5 * noise(mx * 0.9 + 3.1, my * 0.9);
    if (noise(mx * 1.7, my * 1.7 + 9.3) < -0.75 + gapBias) continue;
    const fadeIn = Math.min(1, (i / n) * 5 + 0.25);
    const seg: number[] = [];
    for (let k = i; k <= j; k++) seg.push(xy[k * 2], xy[k * 2 + 1]);
    g.poly(seg, false).stroke({ width: width * (0.6 + 0.8 * pressure), color, alpha: alpha * (0.55 + 0.45 * pressure) * fadeIn, cap: 'round', join: 'round' });
  }
}
