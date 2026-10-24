// Shared flow routing used by hydrology (on H) and ridge extraction (on inverted H).
//
// Priority-flood (Barnes, Lehman & Mulla 2014) without epsilon: `filled` is the water surface,
// `parent` is the flood tree (each cell points at the cell that reached it). D8 then picks the
// steepest strictly-lower neighbour on `filled`, falling back to `parent` on flats and lakes.
//
// Downstream ordering is NOT taken from the flood's pop order: callers reroute receivers after
// routing (lake outlets, crossing fixes), which can break pop-order monotonicity. Instead
// `topoOrder` builds an explicit order from the final receiver graph and detects cycles.
import { CellHeap } from '../core/heap';
import { DIST8, DX8, DY8 } from '../core/grid';

export interface FloodResult {
  filled: Float32Array;
  parent: Int32Array;
  /** Pop sequence of the flood; kept only for diagnostics. */
  popOrder: Int32Array;
}

/**
 * @param height  surface to flood (float32, compared as stored)
 * @param isSeed  cells that start in the queue (outlets: sea, map edge, or peaks for ridges)
 * @param blocked cells excluded from flooding entirely (may be null)
 */
export function priorityFlood(
  height: Float32Array,
  w: number,
  h: number,
  isSeed: Uint8Array,
  blocked: Uint8Array | null,
): FloodResult {
  const n = w * h;
  const filled = new Float32Array(n);
  const parent = new Int32Array(n).fill(-1);
  const popOrder = new Int32Array(n).fill(-1);
  const seen = new Uint8Array(n);
  const heap = new CellHeap(Math.max(1024, n >> 2));

  for (let i = 0; i < n; i++) {
    if (isSeed[i] && !(blocked && blocked[i])) {
      filled[i] = height[i];
      seen[i] = 1;
      heap.push(i, filled[i]);
    }
  }

  let k = 0;
  while (heap.size > 0) {
    const c = heap.pop();
    popOrder[k++] = c;
    const cx = c % w, cy = (c - cx) / w;
    for (let d = 0; d < 8; d++) {
      const nx = cx + DX8[d], ny = cy + DY8[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nb = ny * w + nx;
      if (seen[nb] || (blocked && blocked[nb])) continue;
      seen[nb] = 1;
      filled[nb] = height[nb] > filled[c] ? height[nb] : filled[c];
      parent[nb] = c;
      heap.push(nb, filled[nb]);
    }
  }
  return { filled, parent, popOrder: popOrder.subarray(0, k) };
}

/**
 * D8 receivers on `filled`. Seeds get -1 unless they have a strictly lower neighbour.
 * Cells with no strictly lower neighbour follow the flood tree (`parent`).
 */
export function d8Receivers(
  filled: Float32Array,
  parent: Int32Array,
  w: number,
  h: number,
  isRoot: Uint8Array,
  blocked: Uint8Array | null,
): Int32Array {
  const n = w * h;
  const receiver = new Int32Array(n).fill(-1);
  for (let c = 0; c < n; c++) {
    if (isRoot[c] || (blocked && blocked[c])) continue;
    const cx = c % w, cy = (c - cx) / w;
    let best = -1, bestSlope = 0;
    for (let d = 0; d < 8; d++) {
      const nx = cx + DX8[d], ny = cy + DY8[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nb = ny * w + nx;
      if (blocked && blocked[nb]) continue;
      const drop = filled[c] - filled[nb];
      if (drop <= 0) continue;
      const slope = drop / DIST8[d];
      if (slope > bestSlope || (slope === bestSlope && nb < best)) {
        bestSlope = slope;
        best = nb;
      }
    }
    receiver[c] = best >= 0 ? best : parent[c];
  }
  return receiver;
}

export interface TopoResult {
  /** Cells ordered so every receiver precedes its donors. Only cells reachable from roots. */
  order: Int32Array;
  /** Position of each cell in `order`, -1 if unreachable (blocked, or part of a cycle). */
  position: Int32Array;
  /** Donor adjacency in CSR form: donors of c are donors[donorStart[c] .. donorStart[c+1]). */
  donorStart: Int32Array;
  donors: Int32Array;
}

/**
 * Builds a topological order from the receiver graph by breadth-first search from the roots
 * (receiver === -1) over donor lists. Any non-blocked cell left unreached sits on a cycle.
 */
export function topoOrder(receiver: Int32Array, blocked: Uint8Array | null): TopoResult {
  const n = receiver.length;
  const donorStart = new Int32Array(n + 1);
  for (let c = 0; c < n; c++) {
    const r = receiver[c];
    if (r >= 0) donorStart[r + 1]++;
  }
  for (let c = 0; c < n; c++) donorStart[c + 1] += donorStart[c];
  const donors = new Int32Array(donorStart[n]);
  const fill = donorStart.slice(0, n);
  for (let c = 0; c < n; c++) {
    const r = receiver[c];
    if (r >= 0) donors[fill[r]++] = c;
  }

  const order = new Int32Array(n);
  const position = new Int32Array(n).fill(-1);
  let head = 0, tail = 0;
  for (let c = 0; c < n; c++) {
    if (receiver[c] === -1 && !(blocked && blocked[c])) {
      position[c] = tail;
      order[tail++] = c;
    }
  }
  while (head < tail) {
    const c = order[head++];
    for (let k = donorStart[c]; k < donorStart[c + 1]; k++) {
      const d = donors[k];
      position[d] = tail;
      order[tail++] = d;
    }
  }
  return { order: order.subarray(0, tail), position, donorStart, donors };
}

/** Accumulates `rain` downstream along `receiver`, visiting donors before receivers. */
export function accumulate(order: Int32Array, receiver: Int32Array, rain: Float32Array): Float32Array {
  const acc = Float32Array.from(rain);
  for (let k = order.length - 1; k >= 0; k--) {
    const c = order[k];
    const r = receiver[c];
    if (r >= 0) acc[r] += acc[c];
  }
  return acc;
}

/**
 * Polylines over a masked sub-network: each path starts at a masked cell with no masked donor and
 * follows its main stem (largest-acc donor) downstream until it joins a larger stem or leaves the
 * mask. The last cell of a path is the junction or exit cell.
 */
export function tracePaths(
  mask: Uint8Array,
  receiver: Int32Array,
  acc: Float32Array,
  donorStart: Int32Array,
  donors: Int32Array,
): number[][] {
  const n = mask.length;
  const mainDonor = new Int32Array(n).fill(-1);
  const hasMaskedDonor = new Uint8Array(n);
  for (let c = 0; c < n; c++) {
    let best = -1;
    for (let k = donorStart[c]; k < donorStart[c + 1]; k++) {
      const d = donors[k];
      if (!mask[d]) continue;
      hasMaskedDonor[c] = 1;
      if (best < 0 || acc[d] > acc[best] || (acc[d] === acc[best] && d < best)) best = d;
    }
    mainDonor[c] = best;
  }
  const paths: number[][] = [];
  for (let s = 0; s < n; s++) {
    if (!mask[s] || hasMaskedDonor[s]) continue;
    const cells = [s];
    let c = s;
    for (;;) {
      const r = receiver[c];
      if (r < 0) break;
      cells.push(r);
      if (!mask[r] || mainDonor[r] !== c) break;
      c = r;
    }
    paths.push(cells);
  }
  return paths;
}
