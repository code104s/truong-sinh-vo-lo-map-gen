// Ridge graph from the inverted heightmap.
//
// On -H, crests become valley floors: flow routed on the inverted surface converges onto crests
// and runs along them towards the summits. Cells with high inverted accumulation are ridge cells.
// Local maxima of H are the outlets of that inverted flow, so every ridge tree ends at a summit.
import { DX8, DY8 } from '../core/grid';
import type { WorldConfig } from './config';
import { accumulate, d8Receivers, priorityFlood, topoOrder, tracePaths } from './flow';
import { assertAcyclic } from './hydrology';

export interface Peak {
  cell: number;
  height: number;
  /** H minus the lowest H within the relief radius. */
  relief: number;
}

export interface Pass {
  /** The two adjacent ridge cells that meet at the saddle. */
  a: number;
  b: number;
  height: number;
}

export interface MountainCluster {
  id: number;
  /** Peak indices into RidgeResult.peaks, highest first. peaks[0] is the main peak (chủ phong). */
  peaks: number[];
  /** Indices into RidgeResult.paths. */
  paths: number[];
  passes: Pass[];
}

export interface RidgeResult {
  /** 1 = ridge cell */
  ridge: Uint8Array;
  invAcc: Float32Array;
  invReceiver: Int32Array;
  /** Root summit (local max of H) each land cell's inverted flow ends at; -1 for sea. */
  root: Int32Array;
  peaks: Peak[];
  /** Ridge polylines from spur end towards the summit. */
  paths: number[][];
  clusters: MountainCluster[];
  /** Fraction of ridge cells that are a cross-section maximum on at least one axis. */
  coherence: number;
  ridgeThreshold: number;
}

export function generateRidges(height: Float32Array, sea: Uint8Array, cfg: WorldConfig): RidgeResult {
  const w = cfg.size, h = cfg.size, n = w * h;

  // Inverted surface of a lightly smoothed heightmap (two 3×3 box passes) so cell-scale noise
  // does not spawn spurs; sea is excluded.
  const smooth = boxBlur(boxBlur(height, w, h), w, h);
  const inv = new Float32Array(n);
  for (let i = 0; i < n; i++) inv[i] = 1 - smooth[i];

  // Seeds: local maxima of H (minima of inv) and coast cells, so islands are covered too.
  const seed = new Uint8Array(n);
  const isRoot = new Uint8Array(n);
  for (let c = 0; c < n; c++) {
    if (sea[c]) continue;
    const cx = c % w, cy = (c - cx) / w;
    let isMax = true, coast = false;
    for (let d = 0; d < 8; d++) {
      const nx = cx + DX8[d], ny = cy + DY8[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nb = ny * w + nx;
      if (sea[nb]) coast = true;
      else if (smooth[nb] > smooth[c] || (smooth[nb] === smooth[c] && nb < c)) isMax = false;
    }
    if (isMax || coast) seed[c] = 1;
    if (isMax) isRoot[c] = 1;
  }

  const flood = priorityFlood(inv, w, h, seed, sea);
  const invReceiver = d8Receivers(flood.filled, flood.parent, w, h, isRoot, sea);
  const topo = topoOrder(invReceiver, sea);
  assertAcyclic(topo.position, sea, 'ridges');

  // Only high ground feeds the inverted flow: lowland would otherwise drive long spurs uphill.
  const rain = new Float32Array(n);
  let highCells = 0;
  for (let i = 0; i < n; i++) {
    if (!sea[i] && smooth[i] >= cfg.hillLevel) { rain[i] = 1; highCells++; }
  }
  const invAcc = accumulate(topo.order, invReceiver, rain);

  const root = new Int32Array(n).fill(-1);
  for (let k = 0; k < topo.order.length; k++) {
    const c = topo.order[k];
    const r = invReceiver[c];
    root[c] = r < 0 ? c : root[r];
  }

  const ridgeThreshold = Math.max(6, Math.round(cfg.ridgeFraction * highCells));
  const ridge = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!sea[i] && height[i] >= cfg.hillLevel && invAcc[i] >= ridgeThreshold) ridge[i] = 1;
  }

  const peaks = findPeaks(height, sea, w, h, cfg);
  for (const p of peaks) ridge[p.cell] = 1;

  const peakCell = new Uint8Array(n);
  for (const p of peaks) peakCell[p.cell] = 1;
  // Short spurs are noise at this resolution; keep them only when they end on a peak.
  const paths = tracePaths(ridge, invReceiver, invAcc, topo.donorStart, topo.donors)
    .filter((p) => p.length >= 5 || peakCell[p[p.length - 1]] === 1);
  const clusters = buildClusters(ridge, root, paths, peaks, height, w, h, cfg);
  const coherence = ridgeCoherence(ridge, height, w, h);

  return { ridge, invAcc, invReceiver, root, peaks, paths, clusters, coherence, ridgeThreshold };
}

function findPeaks(height: Float32Array, sea: Uint8Array, w: number, h: number, cfg: WorldConfig): Peak[] {
  const R = cfg.peakRadius, RR = 6;
  const peaks: Peak[] = [];
  for (let c = 0; c < w * h; c++) {
    if (sea[c] || height[c] < cfg.mountainLevel) continue;
    const cx = c % w, cy = (c - cx) / w;
    let isMax = true, lowest = height[c];
    for (let dy = -RR; dy <= RR && isMax; dy++) {
      for (let dx = -RR; dx <= RR; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || (dx === 0 && dy === 0)) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 > RR * RR) continue;
        const nb = ny * w + nx;
        if (height[nb] < lowest) lowest = height[nb];
        if (d2 <= R * R && (height[nb] > height[c] || (height[nb] === height[c] && nb < c))) {
          isMax = false;
          break;
        }
      }
    }
    const relief = height[c] - lowest;
    if (isMax && relief >= cfg.minPeakRelief) peaks.push({ cell: c, height: height[c], relief });
  }
  return peaks;
}

/**
 * A range (dãy núi) = 8-connected component of land cells at or above passLevel. Peaks and ridge
 * paths join the range they sit in. Passes record the highest saddle between summit trees that
 * meet inside a range.
 */
function buildClusters(
  ridge: Uint8Array,
  root: Int32Array,
  paths: number[][],
  peaks: Peak[],
  height: Float32Array,
  w: number,
  h: number,
  cfg: WorldConfig,
): MountainCluster[] {
  const n = w * h;
  const comp = new Int32Array(n).fill(-1);
  let count = 0;
  const stack: number[] = [];
  for (let s = 0; s < n; s++) {
    if (comp[s] >= 0 || root[s] < 0 || height[s] < cfg.passLevel) continue;
    comp[s] = count;
    stack.push(s);
    while (stack.length) {
      const c = stack.pop()!;
      const cx = c % w, cy = (c - cx) / w;
      for (let d = 0; d < 8; d++) {
        const nx = cx + DX8[d], ny = cy + DY8[d];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nb = ny * w + nx;
        if (comp[nb] < 0 && root[nb] >= 0 && height[nb] >= cfg.passLevel) {
          comp[nb] = count;
          stack.push(nb);
        }
      }
    }
    count++;
  }

  // Ranges that contain at least one peak become clusters, numbered by first cell index.
  const peaksOf = new Map<number, number[]>();
  peaks.forEach((p, i) => {
    const k = comp[p.cell];
    if (k < 0) return;
    if (!peaksOf.has(k)) peaksOf.set(k, []);
    peaksOf.get(k)!.push(i);
  });
  const comps = [...peaksOf.keys()].sort((a, b) => a - b);
  const clusterOf = new Map<number, number>();
  const clusters: MountainCluster[] = comps.map((k, id) => {
    clusterOf.set(k, id);
    const ps = peaksOf.get(k)!.sort((a, b) => peaks[b].height - peaks[a].height || peaks[a].cell - peaks[b].cell);
    return { id, peaks: ps, paths: [], passes: [] };
  });

  paths.forEach((cells, i) => {
    // A path belongs to the range most of its cells lie in (first cell index breaks ties).
    const votes = new Map<number, number>();
    for (const c of cells) if (comp[c] >= 0) votes.set(comp[c], (votes.get(comp[c]) ?? 0) + 1);
    let best = -1, bestVotes = 0;
    for (const [k, v] of [...votes.entries()].sort((x, y) => x[0] - y[0])) if (v > bestVotes) { best = k; bestVotes = v; }
    const id = clusterOf.get(best);
    if (id !== undefined) clusters[id].paths.push(i);
  });

  // Highest saddle between each pair of summit trees whose ridge cells touch.
  const saddles = new Map<string, Pass>();
  for (let c = 0; c < n; c++) {
    if (!ridge[c]) continue;
    const cx = c % w, cy = (c - cx) / w;
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX8[d], ny = cy + DY8[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nb = ny * w + nx;
      if (!ridge[nb] || root[nb] === root[c]) continue;
      const key = Math.min(root[c], root[nb]) + ',' + Math.max(root[c], root[nb]);
      const sh = Math.min(height[c], height[nb]);
      const prev = saddles.get(key);
      if (!prev || sh > prev.height) saddles.set(key, { a: Math.min(c, nb), b: Math.max(c, nb), height: sh });
    }
  }
  for (const [, s] of [...saddles.entries()].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))) {
    const id = clusterOf.get(comp[s.a]);
    if (id !== undefined && comp[s.a] === comp[s.b]) clusters[id].passes.push(s);
  }
  return clusters;
}

function boxBlur(src: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, cnt = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          sum += src[yy * w + xx];
          cnt++;
        }
      }
      out[y * w + x] = sum / cnt;
    }
  }
  return out;
}

/** Share of ridge cells that are (within a small tolerance) a maximum across at least one axis. */
export function ridgeCoherence(ridge: Uint8Array, height: Float32Array, w: number, h: number): number {
  const tol = 0.004;
  const axes = [[1, 0], [0, 1], [1, 1], [1, -1]];
  let total = 0, ok = 0;
  for (let c = 0; c < w * h; c++) {
    if (!ridge[c]) continue;
    const cx = c % w, cy = (c - cx) / w;
    if (cx === 0 || cy === 0 || cx === w - 1 || cy === h - 1) continue;
    total++;
    for (const [ax, ay] of axes) {
      const a = height[(cy - ay) * w + (cx - ax)], b = height[(cy + ay) * w + (cx + ax)];
      if (height[c] >= a - tol && height[c] >= b - tol) {
        ok++;
        break;
      }
    }
  }
  return total ? ok / total : 1;
}
