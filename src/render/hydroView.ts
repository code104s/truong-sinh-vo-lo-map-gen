// Read-only hydrology view for the renderer: Strahler order, how each river path starts and ends,
// lake kind and depth. Derived from WorldData on demand and never written back, so worldgen bytes
// are unaffected. Lake kind lives here only until worldgen 2.0.0 stores it (Phase 2, B2).
import { DX8, DY8 } from '../core/grid';
import type { WorldData } from '../worldgen/index';

export type LakeKind = 'mountain' | 'valley' | 'plain';
/** 1-based codes stored in textures; 0 = not a lake. */
export const LAKE_KIND_CODE: Record<LakeKind, number> = { mountain: 1, valley: 2, plain: 3 };

/** Where a river path ends. Boundary = the path leaves the region across the map edge. */
export type PathEnd = 'ocean' | 'lake' | 'junction' | 'regionBoundary';
/** source = headwater (acc first reaches the river threshold); lakeOutflow = leaves a lake. */
export type PathStart = 'source' | 'lakeOutflow';

export interface LakeView {
  id: number;
  kind: LakeKind;
  cells: number;
  /** Water level minus terrain height, max and mean over the lake (height units). */
  maxDepth: number;
  meanDepth: number;
  /** Lake cell (inside the water) next to the outlet, -1 when the lake has no single outlet. */
  outletDonor: number;
}

export interface PathView {
  start: PathStart;
  end: PathEnd;
  /** Lake the path flows out of (lakeOutflow) or into (end = lake), else 0. */
  fromLake: number;
  toLake: number;
  /** Largest Strahler order along the path. */
  order: number;
}

export interface HydroView {
  /** Strahler order of river cells, 0 elsewhere. */
  order: Uint8Array;
  maxOrder: number;
  /** Lake ids are 1-based: lakes[id - 1]. */
  lakes: LakeView[];
  /** Per cell: lake depth (level - height) on lake cells, 0 elsewhere. */
  depth: Float32Array;
  paths: PathView[];
  /** Donor with the largest flow for every cell (-1 if none): the main stem upstream. */
  mainDonor: Int32Array;
}

export function buildHydroView(world: WorldData): HydroView {
  const { hydro, config: cfg } = world;
  const n = cfg.size, N = n * n, H = hydro.height;

  const mainDonor = new Int32Array(N).fill(-1);
  for (let c = 0; c < N; c++) {
    const r = hydro.receiver[c];
    if (r < 0) continue;
    const m = mainDonor[r];
    if (m < 0 || hydro.acc[c] > hydro.acc[m] || (hydro.acc[c] === hydro.acc[m] && c < m)) mainDonor[r] = c;
  }

  // Strahler order: donors come after receivers in hydro.order, so walk it backwards.
  const order = new Uint8Array(N);
  const best = new Uint8Array(N), ties = new Uint8Array(N);
  let maxOrder = 0;
  for (let k = hydro.order.length - 1; k >= 0; k--) {
    const c = hydro.order[k];
    if (!hydro.river[c]) continue;
    const o = best[c] === 0 ? 1 : ties[c] >= 2 ? best[c] + 1 : best[c];
    order[c] = o;
    if (o > maxOrder) maxOrder = o;
    const r = hydro.receiver[c];
    if (r >= 0) {
      if (o > best[r]) { best[r] = o; ties[r] = 1; } else if (o === best[r]) ties[r]++;
    }
  }

  // Lakes: depth, relief of the rim and shape give the kind.
  const depth = new Float32Array(N);
  const members: number[][] = hydro.lakes.map(() => []);
  for (let c = 0; c < N; c++) {
    const id = hydro.lakeId[c];
    if (!id) continue;
    members[id - 1].push(c);
    depth[c] = hydro.lakes[id - 1].level - H[c];
  }
  const lakes: LakeView[] = hydro.lakes.map((L, i) => {
    const cells = members[i];
    let maxDepth = 0, sum = 0, rimMax = -Infinity, steep = 0, rim = 0;
    let mx = 0, my = 0;
    for (const c of cells) { maxDepth = Math.max(maxDepth, depth[c]); sum += depth[c]; mx += c % n; my += Math.floor(c / n); }
    mx /= cells.length; my /= cells.length;
    let sxx = 1 / 12, syy = 1 / 12, sxy = 0;
    const seen = new Uint8Array(N);
    for (const c of cells) {
      const cx = c % n, cy = (c - cx) / n;
      sxx += (cx - mx) ** 2 / cells.length; syy += (cy - my) ** 2 / cells.length; sxy += (cx - mx) * (cy - my) / cells.length;
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const b = y * n + x;
        if (seen[b] || hydro.lakeId[b] === L.id || hydro.sea[b]) continue;
        seen[b] = 1;
        if (H[b] > rimMax) rimMax = H[b];
      }
      for (let d = 0; d < 8; d += 2) {
        const x = cx + DX8[d], y = cy + DY8[d];
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const b = y * n + x;
        if (hydro.lakeId[b] === L.id) continue;
        rim++;
        if (H[b] - L.level > 0.02) steep++;
      }
    }
    const tr = sxx + syy, det = sxx * syy - sxy * sxy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const elongation = Math.sqrt((tr / 2 + disc) / Math.max(1e-9, tr / 2 - disc));
    const relief = rimMax - L.level;
    const kind: LakeKind =
      L.level >= cfg.mountainLevel - 0.04 || (relief >= 0.25 && L.level >= cfg.hillLevel) ? 'mountain'
        : relief >= 0.12 && (elongation >= 1.8 || steep / Math.max(1, rim) >= 0.5) ? 'valley'
          : 'plain';
    let outletDonor = -1;
    if (L.outlet >= 0) {
      for (const c of cells) if (hydro.receiver[c] === L.outlet && (outletDonor < 0 || c < outletDonor)) outletDonor = c;
    }
    return { id: L.id, kind, cells: cells.length, maxDepth, meanDepth: sum / Math.max(1, cells.length), outletDonor };
  });

  const paths: PathView[] = hydro.rivers.map((r) => {
    const s = r.cells[0], e = r.cells[r.cells.length - 1];
    // A path whose first cell is a lake outlet starts at that lake.
    let fromLake = 0;
    for (const L of lakes) if (L.outletDonor >= 0 && hydro.receiver[L.outletDonor] === s) { fromLake = L.id; break; }
    let end: PathEnd;
    let toLake = 0;
    if (hydro.sea[e]) end = 'ocean';
    else if (hydro.lakeId[e]) { end = 'lake'; toLake = hydro.lakeId[e]; }
    else if (hydro.receiver[e] < 0) end = 'regionBoundary';
    else end = 'junction';
    let o = 0;
    for (const c of r.cells) if (order[c] > o) o = order[c];
    return { start: fromLake ? 'lakeOutflow' : 'source', end, fromLake, toLake, order: o };
  });

  return { order, maxOrder, lakes, depth, paths, mainDonor };
}
