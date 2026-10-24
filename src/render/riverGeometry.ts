// River geometry for the renderer, kept free of Pixi so Node tests can check it: centrelines with
// width and opacity per point, how each path meets lakes, the sea and the map edge, and the brush
// runs of the ink lines. Reads WorldData and never writes it, so worldgen bytes are unaffected.
import type { WorldData } from '../worldgen/index';
import { createSimplex2D, type Noise2D } from '../core/noise';
import { rngFor } from '../core/rng';
import { CELL_PX } from './constants';
import type { HydroView, PathEnd, PathStart } from './hydroView';

/**
 * x, y and width in render pixels; a = opacity factor (0..1) for faded headwaters; t = local rank
 * of the flow (0 at the river threshold, 1 at the largest flow of the map), which sets the tone.
 */
export interface RiverPoint { x: number; y: number; w: number; a: number; t: number }

export interface RiverGeom {
  /** Index into hydro.rivers. */
  index: number;
  start: PathStart;
  end: PathEnd;
  order: number;
  /** 0 for the smallest rivers, 1 for the main stem of the map (by flow at the path end). */
  rank: number;
  /** Drawn as one brush line (small streams) or a washed ribbon with banks. */
  kind: 'stream' | 'ribbon';
  pts: RiverPoint[];
  /** Width the flow formula gives at the first river cell, before any taper (A7). */
  fullStartW: number;
  /** Signed distance to water (cells) of each point; < 0 is water. */
  sd: number[];
}

/** A river end that meets a lake or the sea is pushed into the water until the warped shore
 * (warp up to ±0.35 cells) is certainly behind it. */
export const MOUTH_DEPTH = 0.45;
/** Headwaters are drawn further upstream than the river threshold, down to this share of it. */
const HEAD_FRACTION = 0.25;
const HEAD_MAX_CELLS = 6;

export function riverWidth(acc: number, thr: number, widthScale: number): number {
  return widthScale * CELL_PX * Math.min(0.34, 0.035 + 0.032 * Math.sqrt(acc / thr));
}

function chaikin(pts: RiverPoint[], fixed: boolean[], rounds: number): RiverPoint[] {
  let p = pts;
  let f = fixed;
  for (let r = 0; r < rounds; r++) {
    if (p.length < 3) return p;
    const out: RiverPoint[] = [p[0]];
    const of: boolean[] = [f[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      const mix = (t: number): RiverPoint => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t, a: a.a + (b.a - a.a) * t, t: a.t + (b.t - a.t) * t });
      out.push(mix(0.25), mix(0.75));
      of.push(f[i] && f[i + 1], f[i] && f[i + 1]);
    }
    out.push(p[p.length - 1]);
    of.push(f[f.length - 1]);
    p = out;
    f = of;
  }
  return p;
}

/** Walks from (x, y) (cells) down the distance field until it is MOUTH_DEPTH inside water. */
function intoWater(sdAt: (x: number, y: number) => number, x: number, y: number, maxCells: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const STEP = 0.1, H = 0.05;
  let d = sdAt(x, y);
  for (let k = 0; k * STEP < maxCells && d > -MOUTH_DEPTH; k++) {
    const gx = (sdAt(x + H, y) - sdAt(x - H, y)) / (2 * H);
    const gy = (sdAt(x, y + H) - sdAt(x, y - H)) / (2 * H);
    const g = Math.hypot(gx, gy);
    if (g < 1e-4) break;
    const nx = x - (gx / g) * STEP, ny = y - (gy / g) * STEP;
    const nd = sdAt(nx, ny);
    if (nd >= d) break; // deepest point of a small lake
    x = nx; y = ny; d = nd;
    if (k % 2 === 1 || d <= -MOUTH_DEPTH) out.push([x, y]);
  }
  return out;
}

/**
 * Centrelines of all river paths.
 * @param sdAt signed distance to rendered water in cells (fields.sampleSdf).
 * @param widthScale 1 at true scale, larger for the overview LOD.
 */
export function riverGeometry(world: WorldData, view: HydroView, sdAt: (x: number, y: number) => number, widthScale = 1): RiverGeom[] {
  const n = world.config.size;
  const { hydro } = world;
  const thr = hydro.riverThreshold;
  const noise = createSimplex2D(rngFor(world.seed, 'render:rivers'));
  let maxEndAcc = thr * 2;
  for (let c = 0; c < hydro.acc.length; c++) if (hydro.river[c] && hydro.acc[c] > maxEndAcc) maxEndAcc = hydro.acc[c];

  const out: RiverGeom[] = [];
  hydro.rivers.forEach((r, index) => {
    const pv = view.paths[index];
    const cx = (c: number) => (c % n) + 0.5, cy = (c: number) => Math.floor(c / n) + 0.5;
    // Data cells: everything but a final lake or sea cell, which only marks where the path ends.
    const cells = pv.end === 'ocean' || pv.end === 'lake' ? r.cells.slice(0, -1) : r.cells.slice();
    if (cells.length === 0) cells.push(r.cells[0]);
    const wOf = (c: number) => riverWidth(hydro.acc[c], thr, widthScale);
    // In cells (x, y) until the end, then converted to pixels.
    type P = RiverPoint & { fixed: boolean };
    const tOf = (c: number) => Math.max(0, Math.min(1, Math.log(Math.max(1, hydro.acc[c] / thr)) / Math.log(maxEndAcc / thr)));
    const pts: P[] = cells.map((c) => ({ x: cx(c), y: cy(c), w: wOf(c), a: 1, t: tOf(c), fixed: false }));
    const t0 = pts[0].t;
    const fullStartW = pts[0].w;

    if (pv.start === 'lakeOutflow') {
      // Start inside the lake at full width: the outflow leaves the water, it is not a new spring.
      const L = view.lakes[pv.fromLake - 1];
      const head: P[] = [{ x: cx(L.outletDonor), y: cy(L.outletDonor), w: fullStartW, a: 1, t: t0, fixed: true }];
      for (const [x, y] of intoWater(sdAt, head[0].x, head[0].y, 1.5)) head.push({ x, y, w: fullStartW, a: 1, t: t0, fixed: true });
      pts.unshift(...head.reverse());
    } else {
      // Headwater: continue up the main donor chain as a fading hairline instead of starting abruptly.
      const head: P[] = [];
      let c = cells[0];
      for (let k = 0; k < HEAD_MAX_CELLS; k++) {
        const d = view.mainDonor[c];
        if (d < 0 || hydro.sea[d] || hydro.lakeId[d] || hydro.acc[d] < thr * HEAD_FRACTION) break;
        head.push({ x: cx(d), y: cy(d), w: 0, a: 0, t: 0, fixed: false });
        c = d;
      }
      const m = head.length;
      head.forEach((p, k) => { const t = (m - k) / (m + 1); p.w = fullStartW * (1 - 0.65 * t); p.a = 1 - t; });
      if (m === 0) pts[0].w = fullStartW * 0.6;
      pts.unshift(...head.reverse());
    }

    const last = pts[pts.length - 1];
    if (pv.end === 'ocean' || pv.end === 'lake') {
      // Run on into the water so no paper shows between the river and the lake or sea.
      const e = r.cells[r.cells.length - 1];
      const tail: P[] = [{ x: cx(e), y: cy(e), w: last.w, a: 1, t: last.t, fixed: true }];
      for (const [x, y] of intoWater(sdAt, tail[0].x, tail[0].y, 2)) tail.push({ x, y, w: last.w, a: 1, t: last.t, fixed: true });
      last.fixed = true;
      pts.push(...tail);
    } else if (pv.end === 'regionBoundary') {
      // The river leaves the region: carry it at full width to the map edge.
      const e = cells[cells.length - 1];
      const ex = e % n, ey = Math.floor(e / n);
      const prev = cells.length > 1 ? cells[cells.length - 2] : e;
      const dx = ex - (prev % n), dy = ey - Math.floor(prev / n);
      const edges: Array<[number, number, number]> = []; // [dist, ox, oy]
      if (ex === 0) edges.push([dx < 0 ? 0 : 1, -1, 0]);
      if (ex === n - 1) edges.push([dx > 0 ? 0 : 1, 1, 0]);
      if (ey === 0) edges.push([dy < 0 ? 0 : 1, 0, -1]);
      if (ey === n - 1) edges.push([dy > 0 ? 0 : 1, 0, 1]);
      edges.sort((a, b) => a[0] - b[0]);
      const [, ox, oy] = edges[0] ?? [0, 0, 0];
      last.fixed = true;
      pts.push({ x: last.x + ox * 0.25, y: last.y + oy * 0.25, w: last.w, a: 1, t: last.t, fixed: true });
      pts.push({ x: last.x + ox * 0.5, y: last.y + oy * 0.5, w: last.w, a: 1, t: last.t, fixed: true });
    } else if (pts.length > 1) {
      // Junction: keep the tributary's own width into the main river, no swelling or taper.
      last.w = pts[pts.length - 2].w;
      last.t = pts[pts.length - 2].t;
    }

    // Densify, then push free interior points sideways by smooth noise (visual meander).
    const dense: P[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const steps = a.fixed && b.fixed ? 1 : 3;
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        dense.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t, a: a.a + (b.a - a.a) * t, t: a.t + (b.t - a.t) * t, fixed: a.fixed && (k === 0 || b.fixed) });
      }
    }
    dense.push(pts[pts.length - 1]);
    for (let i = 1; i < dense.length - 1; i++) {
      if (dense[i].fixed) continue;
      const a = dense[i - 1], b = dense[i + 1];
      let nx = -(b.y - a.y), ny = b.x - a.x;
      const len = Math.hypot(nx, ny) || 1;
      nx /= len; ny /= len;
      const m = noise(dense[i].x * 0.35, dense[i].y * 0.35) * 0.32;
      dense[i].x += nx * m;
      dense[i].y += ny * m;
    }
    const smooth = chaikin(dense.map(({ x, y, w, a, t }) => ({ x, y, w, a, t })), dense.map((p) => p.fixed), 2);
    const px = smooth.map((p) => ({ x: p.x * CELL_PX, y: p.y * CELL_PX, w: p.w, a: p.a, t: p.t }));
    const sd = smooth.map((p) => sdAt(p.x, p.y));
    const rank = tOf(cells[cells.length - 1]);
    let maxW = 0;
    for (const c of cells) maxW = Math.max(maxW, wOf(c));
    out.push({
      index, start: pv.start, end: pv.end, order: pv.order, rank,
      kind: maxW < CELL_PX * 0.09 * widthScale ? 'stream' : 'ribbon',
      pts: px, fullStartW, sd,
    });
  });
  return out;
}

/** Gap threshold for brushRuns: some dry-brush breaks at true scale, none on the overview LOD. */
export function gapThreshold(widthScale: number, bias: number): number {
  return widthScale > 1 ? -Infinity : -0.95 + 0.6 * bias;
}

export interface BrushRun { xy: number[]; width: number; alpha: number }

/**
 * Splits a polyline into short brush runs whose width and opacity follow smooth noise. Runs whose
 * gap noise falls below `gapBelow` are left out (dry brush); pass -Infinity for an unbroken line.
 */
export function brushRuns(xy: number[], fade: number[], noise: Noise2D, width: number, alpha: number, gapBelow: number): BrushRun[] {
  const n = xy.length / 2;
  const RUN = 4;
  const runs: BrushRun[] = [];
  for (let i = 0; i < n - 1; i += RUN) {
    const j = Math.min(n - 1, i + RUN);
    const mx = xy[i * 2] / CELL_PX, my = xy[i * 2 + 1] / CELL_PX;
    const pressure = 0.5 + 0.5 * noise(mx * 0.9 + 3.1, my * 0.9);
    if (noise(mx * 1.7, my * 1.7 + 9.3) < gapBelow) continue;
    let f = 0;
    for (let k = i; k <= j; k++) f += fade[k];
    f /= j - i + 1;
    const seg: number[] = [];
    for (let k = i; k <= j; k++) seg.push(xy[k * 2], xy[k * 2 + 1]);
    runs.push({ xy: seg, width: width * (0.6 + 0.8 * pressure), alpha: alpha * (0.55 + 0.45 * pressure) * f });
  }
  return runs;
}

export function riverNoise(world: WorldData): Noise2D {
  return createSimplex2D(rngFor(world.seed, 'render:rivers'));
}
