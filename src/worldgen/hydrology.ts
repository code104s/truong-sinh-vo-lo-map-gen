// Hydrology: sea classification, priority-flood, lakes with a single outlet, D8 receivers,
// crossing fixes, explicit topological order, flow accumulation, rivers and basins.
import { DX8, DY8, isEdge } from '../core/grid';
import { hash01, seedToU32 } from '../core/rng';
import type { WorldConfig } from './config';
import { accumulate, d8Receivers, priorityFlood, topoOrder, tracePaths } from './flow';

export interface Lake {
  id: number;
  level: number;
  cells: number;
  /** Cell outside the lake that every lake cell drains to. */
  outlet: number;
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

  // Oversized depressions keep only their deepest part as open water; the shallow rim stays land
  // at the same filled level (a flat marsh that drains along the flood tree).
  const maxArea = Math.max(cfg.minLakeArea, Math.round(cfg.maxLakeArea * n));
  {
    const seen = new Uint8Array(n);
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
      if (group.length <= maxArea) continue;
      const depths = group.map((c) => filled[c] - height[c]).sort((a, b) => b - a);
      const cut = depths[maxArea];
      for (const c of group) if (filled[c] - height[c] <= cut) deep[c] = 0;
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
    if (outlet < 0) {
      // No safe single outlet: keep flood-tree routing. Tests report lakes with >1 exit.
      lakes.push({ id, level, cells: cells.length, outlet: -1 });
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
    lakes.push({ id, level, cells: cells.length, outlet });
  }
  return { lakeId, lakes };
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
