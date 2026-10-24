// Hydrology: sea classification, priority-flood, lakes with a single outlet, D8 receivers,
// crossing fixes, explicit topological order, flow accumulation, rivers and basins.
import { CellHeap } from '../core/heap';
import { DX8, DY8, isEdge } from '../core/grid';
import { hash01, seedToU32 } from '../core/rng';
import type { WorldConfig } from './config';
import { accumulate, d8Receivers, priorityFlood, topoOrder, tracePaths } from './flow';

/** Lake setting, from the water level and the ground around it. Codes are stored in the stream. */
export const LAKE_KIND = { mountain: 1, valley: 2, plain: 3 } as const;
/** Where a lake's outflow goes first: the sea, another lake, or out of the region at the map edge. */
export const OUTLET_TYPE = { none: 0, ocean: 1, lake: 2, regionBoundary: 3 } as const;

export interface Lake {
  id: number;
  /** Spill level of the depression (the filled surface); routing uses it. */
  level: number;
  cells: number;
  /** Cell outside the lake that every lake cell drains to. */
  outlet: number;
  /** Water surface: the highest lake cell. Below `level` when the lake fills only the deep core. */
  surface: number;
  maxDepth: number;
  /** Land cells draining into the depression before lakes were formed. */
  catchment: number;
  /** LAKE_KIND code. */
  kind: number;
  /** OUTLET_TYPE code. */
  outletType: number;
}

export interface RiverPath {
  /** Cell indices from upstream to the mouth (last cell may be sea or lake). */
  cells: number[];
}

export interface HydrologyResult {
  /** Height after the deterministic jitter, used by everything downstream. */
  height: Float32Array;
  filled: Float32Array;
  /** 1 = sea */
  sea: Uint8Array;
  /** 0 = none, otherwise lake id (1-based) */
  lakeId: Uint16Array;
  lakes: Lake[];
  receiver: Int32Array;
  /** Downstream-first order built from the receiver graph. */
  order: Int32Array;
  acc: Float32Array;
  river: Uint8Array;
  riverThreshold: number;
  rivers: RiverPath[];
  basinId: Int32Array;
  popOrder: Int32Array;
  landCells: number;
}

export function generateHydrology(seed: string, input: Float32Array, cfg: WorldConfig): HydrologyResult {
  const w = cfg.size, h = cfg.size, n = w * h;
  const s32 = seedToU32(seed);

  // 1. Jitter to break perfect flats.
  const height = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i % w, y = (i - x) / w;
    height[i] = input[i] + cfg.jitter * (hash01(s32, x, y, 101) - 0.5);
  }

  // 2. Sea = below sea level and connected to the map edge.
  const sea = new Uint8Array(n);
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = i % w, y = (i - x) / w;
    if (isEdge(w, h, x, y) && height[i] < cfg.seaLevel) {
      sea[i] = 1;
      stack.push(i);
    }
  }
  while (stack.length) {
    const c = stack.pop()!;
    const cx = c % w, cy = (c - cx) / w;
    for (let d = 0; d < 8; d += 2) {
      const nx = cx + DX8[d], ny = cy + DY8[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nb = ny * w + nx;
      if (!sea[nb] && height[nb] < cfg.seaLevel) {
        sea[nb] = 1;
        stack.push(nb);
      }
    }
  }

  // 3. Priority-flood from the sea and the map edge.
  const isSeed = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const x = i % w, y = (i - x) / w;
    if (sea[i] || isEdge(w, h, x, y)) isSeed[i] = 1;
  }
  const flood = priorityFlood(height, w, h, isSeed, null);
  const { filled, parent } = flood;

  // Roots: sea cells drain nowhere. Edge land cells may still flow inland-downhill via D8.
  const receiver = d8Receivers(filled, parent, w, h, sea, null);

  // 4–5. Lakes and their single outlet.
  const { lakeId, lakes } = findLakes(height, filled, receiver, sea, w, h, cfg);

  let topo = topoOrder(receiver, null);
  assertAcyclic(topo.position, null, 'hydrology');

  // 7. Accumulation (rain = 1 per land cell).
  const rain = new Float32Array(n);
  let landCells = 0;
  for (let i = 0; i < n; i++) {
    if (!sea[i]) {
      rain[i] = 1;
      landCells++;
    }
  }
  let acc = accumulate(topo.order, receiver, rain);
  const riverThreshold = Math.max(8, Math.round(cfg.riverFraction * landCells));

  // Diagonal X crossings among river cells: reroute the smaller flow orthogonally.
  if (fixCrossings(receiver, filled, acc, sea, lakeId, riverThreshold, w, h) > 0) {
    topo = topoOrder(receiver, null);
    assertAcyclic(topo.position, null, 'hydrology after crossing fix');
    acc = accumulate(topo.order, receiver, rain);
  }

  // 8. Rivers.
  const river = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!sea[i] && !lakeId[i] && acc[i] >= riverThreshold) river[i] = 1;
  }
  const rivers: RiverPath[] = tracePaths(river, receiver, acc, topo.donorStart, topo.donors).map((cells) => ({ cells }));

  // 9. Basins: each root (sea cell or map exit) labels everything upstream of it.
  const basinId = new Int32Array(n).fill(-1);
  for (let k = 0; k < topo.order.length; k++) {
    const c = topo.order[k];
    const r = receiver[c];
    basinId[c] = r < 0 ? c : basinId[r];
  }

  // 10. Where each lake's outflow goes first.
  for (const L of lakes) {
    if (L.outlet < 0) continue;
    let c = L.outlet;
    for (let steps = 0; steps < n; steps++) {
      if (sea[c]) { L.outletType = OUTLET_TYPE.ocean; break; }
      if (lakeId[c] && lakeId[c] !== L.id) { L.outletType = OUTLET_TYPE.lake; break; }
      if (receiver[c] < 0) { L.outletType = OUTLET_TYPE.regionBoundary; break; }
      c = receiver[c];
    }
  }

  return {
    height, filled, sea, lakeId, lakes, receiver, order: topo.order, acc, river,
    riverThreshold, rivers, basinId, popOrder: flood.popOrder, landCells,
  };
}

export function assertAcyclic(position: Int32Array, blocked: Uint8Array | null, label: string): void {
  for (let i = 0; i < position.length; i++) {
    if (position[i] < 0 && !(blocked && blocked[i])) {
      throw new Error(`${label}: cell ${i} is unreachable from any outlet (cycle in receiver graph)`);
    }
  }
}

function findLakes(
  height: Float32Array,
  filled: Float32Array,
  receiver: Int32Array,
  sea: Uint8Array,
  w: number,
  h: number,
  cfg: WorldConfig,
): { lakeId: Uint16Array; lakes: Lake[] } {
  const n = w * h;
  const deep = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!sea[i] && filled[i] - height[i] > cfg.minLakeDepth) deep[i] = 1;
  }

  // Water balance (worldgen 2.0.0): each depression holds open water only in its deepest core,
  // filled from the lowest cell upwards like rising water, up to catchment / lakeCatchmentRatio
  // cells (and maxLakeArea). The shallow rest stays land at the filled level, a flat marsh that
  // drains along the flood tree. A small catchment gives a small lake or none.
  const maxArea = Math.max(cfg.minLakeArea, Math.round(cfg.maxLakeArea * n));
  const pre = topoOrder(receiver, null);
  const rain0 = new Float32Array(n);
  for (let i = 0; i < n; i++) rain0[i] = sea[i] ? 0 : 1;
  const acc0 = accumulate(pre.order, receiver, rain0);
  const catchmentOf = new Float32Array(n);
  {
    const seen = new Uint8Array(n);
    const inLake = new Uint8Array(n);
    const dropped = new Uint8Array(n);
    const cand = new Uint8Array(n);
    const heap = new CellHeap(256);
    for (let start = 0; start < n; start++) {
      if (!deep[start] || seen[start]) continue;
      const group = [start];
      seen[start] = 1;
      for (let head = 0; head < group.length; head++) {
        const c = group[head];
        const cx = c % w, cy = (c - cx) / w;
        for (let d = 0; d < 8; d += 2) {
          const nx = cx + DX8[d], ny = cy + DY8[d];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const nb = ny * w + nx;
          if (deep[nb] && !seen[nb]) { seen[nb] = 1; group.push(nb); }
        }
      }
      // Every cell of a depression drains along the flood tree to its spill, so the largest
      // accumulation inside it is the inflow from its whole catchment.
      let catchment = 0, low = group[0];
      for (const c of group) {
        if (acc0[c] > catchment) catchment = acc0[c];
        if (height[c] < height[low] || (height[c] === height[low] && c < low)) low = c;
      }
      for (const c of group) { deep[c] = 0; catchmentOf[c] = catchment; }
      const allowed = Math.min(maxArea, Math.floor(catchment / cfg.lakeCatchmentRatio), group.length);
      if (allowed < cfg.minLakeArea) continue;
      // Rising water from the lowest cell, 4-connected, lowest ground first. A cell popped below
      // the water level so far means the water crossed a saddle into another pit. All of that pit
      // below the saddle pops before anything higher; if it is deeper than lakeSaddleDepth below
      // the saddle and holds at least half of minLakeArea (a basin of its own, not a dip in a
      // channel floor), the water stops at the saddle and the lake keeps its own sub-basin; the
      // other pit stays marsh at the filled level.
      const lake: number[] = [];
      heap.push(low, height[low]);
      inLake[low] = 1;
      let top = -Infinity, cut = -1, saddle = 0, minSince = 0;
      const ownBasin = () => saddle - minSince > cfg.lakeSaddleDepth && 2 * (lake.length - cut) >= cfg.minLakeArea;
      while (heap.size > 0 && lake.length < allowed) {
        const c = heap.pop();
        if (height[c] < top) {
          if (cut < 0) { cut = lake.length; saddle = top; minSince = height[c]; }
          else if (height[c] < minSince) minSince = height[c];
        } else {
          if (cut >= 0 && height[c] > saddle) {
            if (ownBasin()) { inLake[c] = 0; break; }
            cut = -1;
          }
          top = height[c];
        }
        lake.push(c);
        const cx = c % w, cy = (c - cx) / w;
        for (let d = 0; d < 8; d += 2) {
          const nx = cx + DX8[d], ny = cy + DY8[d];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const nb = ny * w + nx;
          if (seen[nb] && !inLake[nb] && catchmentOf[nb] === catchment && filled[nb] === filled[low]) {
            inLake[nb] = 1;
            heap.push(nb, height[nb]);
          }
        }
      }
      if (cut >= 0 && ownBasin()) while (lake.length > cut) inLake[lake.pop()!] = 0;
      // inLake now marks exactly this lake's cells.
      while (heap.size > 0) inLake[heap.pop()] = 0;
      // Shore clean-up. Arms one cell wide (cells with at most one lake neighbour) read as hooks
      // and are dropped. Before that, a shore corner next to a stub (a cell of the same depression,
      // at the same filled level, with two or more lake neighbours) fills, lowest ground first and
      // within the water budget, so the pointed end of a long lake widens instead of being cut. Dropped cells never come back. A lake that would fall below
      // minLakeArea is dropped whole.
      const budget = Math.min(maxArea, Math.floor(catchment / cfg.lakeCatchmentRatio));
      const level = filled[low];
      let size = lake.length;
      const lakeNbs = (c: number) => {
        const cx = c % w, cy = (c - cx) / w;
        let k = 0;
        for (let d = 0; d < 8; d += 2) {
          const nx = cx + DX8[d], ny = cy + DY8[d];
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && inLake[ny * w + nx]) k++;
        }
        return k;
      };
      // A stub is a tip whose one lake neighbour has three or more: a one-cell point on a body at
      // least two cells wide, not the end of a one-cell-wide arm.
      const stub = (c: number) => {
        const cx = c % w, cy = (c - cx) / w;
        for (let d = 0; d < 8; d += 2) {
          const nx = cx + DX8[d], ny = cy + DY8[d];
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && inLake[ny * w + nx]) return lakeNbs(ny * w + nx) >= 3;
        }
        return false;
      };
      for (let round = 0, changed = true; changed && round < 16; round++) {
        changed = false;
        if (size < budget) {
          const corners: number[] = [];
          for (const c of lake) {
            if (!inLake[c] || lakeNbs(c) !== 1 || !stub(c)) continue;
            const cx = c % w, cy = (c - cx) / w;
            for (let d = 0; d < 8; d += 2) {
              const nx = cx + DX8[d], ny = cy + DY8[d];
              if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
              const nb = ny * w + nx;
              if (inLake[nb] || cand[nb] || dropped[nb] || deep[nb] || sea[nb] || filled[nb] !== level) continue;
              if (lakeNbs(nb) >= 2) { cand[nb] = 1; corners.push(nb); }
            }
          }
          corners.sort((a, b) => height[a] - height[b] || a - b);
          for (const c of corners) {
            cand[c] = 0;
            if (size >= budget) continue;
            inLake[c] = 1; seen[c] = 1; catchmentOf[c] = catchment; lake.push(c); size++; changed = true;
          }
        }
        for (const c of lake) {
          if (!inLake[c] || lakeNbs(c) > 1) continue;
          inLake[c] = 0; dropped[c] = 1; size--; changed = true;
        }
      }
      for (const c of lake) if (inLake[c]) { inLake[c] = 0; if (size >= cfg.minLakeArea) deep[c] = 1; }
    }
  }

  const lakeId = new Uint16Array(n);
  const lakes: Lake[] = [];
  const comp = new Int32Array(n).fill(-1);
  const cells: number[] = [];
  let compCount = 0;

  for (let start = 0; start < n; start++) {
    if (!deep[start] || comp[start] >= 0) continue;
    // Gather the 4-connected component in index order.
    cells.length = 0;
    const queue = [start];
    comp[start] = compCount;
    while (queue.length) {
      const c = queue.shift()!;
      cells.push(c);
      const cx = c % w, cy = (c - cx) / w;
      for (let d = 0; d < 8; d += 2) {
        const nx = cx + DX8[d], ny = cy + DY8[d];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nb = ny * w + nx;
        if (deep[nb] && comp[nb] < 0) {
          comp[nb] = compCount;
          queue.push(nb);
        }
      }
    }
    compCount++;
    if (cells.length < cfg.minLakeArea) continue;

    const id = lakes.length + 1;
    const level = filled[cells[0]];
    for (const c of cells) lakeId[c] = id;

    // Candidate exits: non-lake cells adjacent to the lake at the lake's water level or lower.
    const exits: number[] = [];
    const isExit = new Set<number>();
    for (const c of cells) {
      const cx = c % w, cy = (c - cx) / w;
      for (let d = 0; d < 8; d++) {
        const nx = cx + DX8[d], ny = cy + DY8[d];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nb = ny * w + nx;
        if (lakeId[nb] === id || isExit.has(nb) || filled[nb] > level) continue;
        isExit.add(nb);
        exits.push(nb);
      }
    }
    exits.sort((a, b) => filled[a] - filled[b] || a - b);

    let outlet = -1;
    for (const e of exits) {
      if (!chainReturnsToLake(e, id, level, receiver, filled, lakeId)) {
        outlet = e;
        break;
      }
    }
    let surface = -Infinity;
    for (const c of cells) if (height[c] > surface) surface = height[c];
    let maxDepth = 0;
    for (const c of cells) if (surface - height[c] > maxDepth) maxDepth = surface - height[c];
    const info = { surface, maxDepth, catchment: catchmentOf[cells[0]], kind: lakeKind(cells, id, surface, height, sea, lakeId, w, h, cfg), outletType: OUTLET_TYPE.none };
    if (outlet < 0) {
      // No safe single outlet: keep flood-tree routing. Tests report lakes with >1 exit.
      lakes.push({ id, level, cells: cells.length, outlet: -1, ...info });
      continue;
    }

    // Reroute every lake cell along a BFS tree towards the outlet.
    const inTree = new Uint8Array(n);
    const ox = outlet % w, oy = (outlet - ox) / w;
    const bfs: number[] = [];
    for (let d = 0; d < 8; d++) {
      const nx = ox + DX8[d], ny = oy + DY8[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nb = ny * w + nx;
      if (lakeId[nb] === id) bfs.push(nb);
    }
    bfs.sort((a, b) => a - b);
    for (const c of bfs) {
      inTree[c] = 1;
      receiver[c] = outlet;
    }
    for (let head = 0; head < bfs.length; head++) {
      const c = bfs[head];
      const cx = c % w, cy = (c - cx) / w;
      for (let d = 0; d < 8; d++) {
        const nx = cx + DX8[d], ny = cy + DY8[d];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nb = ny * w + nx;
        if (lakeId[nb] !== id || inTree[nb]) continue;
        inTree[nb] = 1;
        receiver[nb] = c;
        bfs.push(nb);
      }
    }
    lakes.push({ id, level, cells: cells.length, outlet, ...info });
  }
  return { lakeId, lakes };
}

/**
 * Lake setting: mountain if the water sits near mountain level or in a deep upland bowl; valley if
 * the rim stands well above the water and the lake is long or mostly steep-sided; else plain.
 * Rim = highest ground within 6 cells; elongation from the second moments of the lake cells.
 */
function lakeKind(cells: number[], id: number, surface: number, height: Float32Array, sea: Uint8Array, lakeId: Uint16Array, w: number, h: number, cfg: WorldConfig): number {
  const n = w * h;
  let mx = 0, my = 0;
  for (const c of cells) { mx += c % w; my += (c - (c % w)) / w; }
  mx /= cells.length; my /= cells.length;
  let sxx = 1 / 12, syy = 1 / 12, sxy = 0, rimMax = -Infinity, steep = 0, rim = 0;
  const seen = new Uint8Array(n);
  for (const c of cells) {
    const cx = c % w, cy = (c - cx) / w;
    sxx += (cx - mx) * (cx - mx) / cells.length; syy += (cy - my) * (cy - my) / cells.length; sxy += (cx - mx) * (cy - my) / cells.length;
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const b = y * w + x;
      if (seen[b] || lakeId[b] === id || sea[b]) continue;
      seen[b] = 1;
      if (height[b] > rimMax) rimMax = height[b];
    }
    for (let d = 0; d < 8; d += 2) {
      const x = cx + DX8[d], y = cy + DY8[d];
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const b = y * w + x;
      if (lakeId[b] === id) continue;
      rim++;
      if (height[b] - surface > 0.02) steep++;
    }
  }
  const tr = sxx + syy, det = sxx * syy - sxy * sxy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const elongation = Math.sqrt((tr / 2 + disc) / Math.max(1e-9, tr / 2 - disc));
  const relief = rimMax - surface;
  if (surface >= cfg.mountainLevel - 0.04 || (relief >= 0.25 && surface >= cfg.hillLevel)) return LAKE_KIND.mountain;
  if (relief >= 0.12 && (elongation >= 1.8 || steep / Math.max(1, rim) >= 0.5)) return LAKE_KIND.valley;
  return LAKE_KIND.plain;
}

/** Follows receivers while the surface stays at the lake level; true if it re-enters the lake. */
function chainReturnsToLake(
  start: number,
  id: number,
  level: number,
  receiver: Int32Array,
  filled: Float32Array,
  lakeId: Uint16Array,
): boolean {
  let c = start;
  for (let steps = 0; steps < receiver.length && c >= 0 && filled[c] >= level; steps++) {
    if (lakeId[c] === id) return true;
    c = receiver[c];
  }
  return false;
}

/** Counts and fixes river-cell X crossings in 2×2 blocks. Returns the number rerouted. */
function fixCrossings(
  receiver: Int32Array,
  filled: Float32Array,
  acc: Float32Array,
  sea: Uint8Array,
  lakeId: Uint16Array,
  threshold: number,
  w: number,
  h: number,
): number {
  let fixed = 0;
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const a = y * w + x, b = a + 1, c = a + w, d = a + w + 1;
      // Diagonal pairs: a<->d and b<->c.
      const ad = receiver[a] === d || receiver[d] === a;
      const bc = receiver[b] === c || receiver[c] === b;
      if (!ad || !bc) continue;
      const p1 = receiver[a] === d ? a : d;
      const p2 = receiver[b] === c ? b : c;
      const relevant = (i: number) => !sea[i] && !lakeId[i] && acc[i] >= threshold;
      if (!relevant(p1) && !relevant(p2)) continue;
      const loser = acc[p1] < acc[p2] || (acc[p1] === acc[p2] && p1 > p2) ? p1 : p2;
      // Orthogonal options inside the block that are strictly lower than the loser.
      const options = loser === a || loser === d ? [b, c] : [a, d];
      let best = -1;
      for (const o of options) {
        if (filled[o] < filled[loser] && (best < 0 || filled[o] < filled[best] || (filled[o] === filled[best] && o < best))) {
          best = o;
        }
      }
      if (best >= 0) {
        receiver[loser] = best;
        fixed++;
      }
    }
  }
  return fixed;
}
