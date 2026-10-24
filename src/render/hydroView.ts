// Read-only hydrology view for the renderer: Strahler order, how each river path starts and ends,
// lake depth. Derived from WorldData on demand and never written back, so worldgen bytes are
// unaffected. Lake kind and outlet type are stored by worldgen since 2.0.0 (Phase 2, B2).
import type { WorldData } from '../worldgen/index';

export type LakeKind = 'mountain' | 'valley' | 'plain';
/** 1-based codes stored in textures; 0 = not a lake. */
export const LAKE_KIND_CODE: Record<LakeKind, number> = { mountain: 1, valley: 2, plain: 3 };

/** Where a river path ends. Boundary = the path leaves the region across the map edge. */
export type PathEnd = 'ocean' | 'lake' | 'junction' | 'regionBoundary';
/** source = headwater (acc first reaches the river threshold); lakeOutflow = leaves a lake. */
export type PathStart = 'source' | 'lakeOutflow';

/** Where a lake's outflow goes first; none = no single outlet. */
export type LakeOutlet = 'none' | 'ocean' | 'lake' | 'regionBoundary';

export interface LakeView {
  id: number;
  kind: LakeKind;
  outlet: LakeOutlet;
  cells: number;
  /** Water surface minus terrain height, max and mean over the lake (height units). */
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
  /** Per cell: lake depth (surface - height) on lake cells, 0 elsewhere. */
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

  // Lakes: kind and water surface come from worldgen (2.0.0); depth is measured from the surface.
  const KIND_NAME: LakeKind[] = ['plain', 'mountain', 'valley', 'plain'];
  const OUTLET_NAME: LakeOutlet[] = ['none', 'ocean', 'lake', 'regionBoundary'];
  const depth = new Float32Array(N);
  const members: number[][] = hydro.lakes.map(() => []);
  for (let c = 0; c < N; c++) {
    const id = hydro.lakeId[c];
    if (!id) continue;
    members[id - 1].push(c);
    depth[c] = hydro.lakes[id - 1].surface - H[c];
  }
  const lakes: LakeView[] = hydro.lakes.map((L, i) => {
    const cells = members[i];
    let maxDepth = 0, sum = 0;
    for (const c of cells) { maxDepth = Math.max(maxDepth, depth[c]); sum += depth[c]; }
    let outletDonor = -1;
    if (L.outlet >= 0) {
      for (const c of cells) if (hydro.receiver[c] === L.outlet && (outletDonor < 0 || c < outletDonor)) outletDonor = c;
    }
    return {
      id: L.id, kind: KIND_NAME[L.kind], outlet: OUTLET_NAME[L.outletType], cells: cells.length,
      maxDepth, meanDepth: sum / Math.max(1, cells.length), outletDonor,
    };
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
