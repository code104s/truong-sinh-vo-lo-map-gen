// Automated checks behind gate G0: hydrology invariants and the V2–V6 composition metrics.
// Pure functions over WorldData so vitest, the QA scripts and the browser can share them.
import type { Manifest } from '../assets/manifestTypes';
import type { WorldData } from '../worldgen/index';
import type { StampInstance } from '../worldgen/composition';
import { footBox } from '../worldgen/composition';

export function isNeighbour8(a: number, b: number, w: number): boolean {
  const ax = a % w, ay = (a - ax) / w, bx = b % w, by = (b - bx) / w;
  return a !== b && Math.abs(ax - bx) <= 1 && Math.abs(ay - by) <= 1;
}

/** Number of edges c → receiver[c] where the receiver does not come before c in `order`. */
export function orderViolations(order: ArrayLike<number>, receiver: Int32Array): number {
  const pos = new Int32Array(receiver.length).fill(-1);
  for (let k = 0; k < order.length; k++) pos[order[k]] = k;
  let bad = 0;
  for (let c = 0; c < receiver.length; c++) {
    const r = receiver[c];
    if (r < 0) continue;
    if (pos[c] < 0 || pos[r] < 0 || pos[r] >= pos[c]) bad++;
  }
  return bad;
}

export interface HydroReport {
  problems: string[];
  /** Edges that a pop-order traversal would get wrong (diagnostic only). */
  popOrderViolations: number;
  lakesWithoutOutlet: number;
  crossings: number;
}

export function checkHydrology(world: WorldData): HydroReport {
  const { hydro } = world;
  const w = world.config.size, n = w * w;
  const { receiver, order, acc, sea, lakeId, filled } = hydro;
  const problems: string[] = [];

  // Receivers: sea cells are roots; every other receiver is an 8-neighbour (single receiver = no bifurcation).
  for (let c = 0; c < n; c++) {
    const r = receiver[c];
    if (sea[c] && r !== -1) problems.push(`sea cell ${c} has a receiver`);
    if (r >= 0 && !isNeighbour8(c, r, w)) problems.push(`cell ${c} drains to non-neighbour ${r}`);
  }
  if (order.length !== n) problems.push(`topological order covers ${order.length}/${n} cells`);
  const tv = orderViolations(order, receiver);
  if (tv) problems.push(`${tv} receiver edges out of topological order`);

  // Mass balance: acc = rain + sum of donors; total at roots = land cells.
  const inflow = new Float64Array(n);
  for (let c = 0; c < n; c++) if (receiver[c] >= 0) inflow[receiver[c]] += acc[c];
  let atRoots = 0, worst = 0;
  for (let c = 0; c < n; c++) {
    const rain = sea[c] ? 0 : 1;
    worst = Math.max(worst, Math.abs(acc[c] - rain - inflow[c]));
    if (receiver[c] < 0) atRoots += acc[c];
  }
  if (worst > 1e-3 * Math.max(1, hydro.landCells)) problems.push(`accumulation imbalance ${worst}`);
  if (Math.abs(atRoots - hydro.landCells) > 1e-3 * hydro.landCells) problems.push(`flow reaching outlets ${atRoots} != land ${hydro.landCells}`);

  // Every chain ends at the sea or the map edge (no internal sinks).
  for (let c = 0; c < n; c++) {
    if (receiver[c] >= 0) continue;
    const x = c % w, y = (c - x) / w;
    if (!sea[c] && x > 0 && y > 0 && x < w - 1 && y < w - 1) problems.push(`internal sink at ${c}`);
  }

  // Lakes: flat surface, and every lake cell leaves the lake through the single outlet.
  let lakesWithoutOutlet = 0;
  for (const lake of hydro.lakes) {
    if (lake.outlet < 0) { lakesWithoutOutlet++; problems.push(`lake ${lake.id} has no outlet`); continue; }
    for (let c = 0; c < n; c++) {
      if (lakeId[c] !== lake.id) continue;
      if (filled[c] !== lake.level) { problems.push(`lake ${lake.id} surface not flat at ${c}`); break; }
      let k = c, steps = 0;
      while (lakeId[k] === lake.id && steps++ < n) k = receiver[k];
      if (k !== lake.outlet) { problems.push(`lake ${lake.id} cell ${c} exits at ${k}, not outlet ${lake.outlet}`); break; }
    }
  }

  // Rivers: no diagonal X crossings, flow non-decreasing downstream, each path ends in water or at the edge.
  let crossings = 0;
  const { river } = hydro;
  for (let y = 0; y < w - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const a = y * w + x, b = a + 1, c = a + w, d = a + w + 1;
      if (river[a] && river[d] && receiver[a] === d && river[b] && river[c] && (receiver[b] === c || receiver[c] === b)) crossings++;
      if (river[b] && river[c] && receiver[b] === c && river[a] && river[d] && receiver[d] === a) crossings++;
    }
  }
  if (crossings) problems.push(`${crossings} diagonal river crossings`);
  for (const r of hydro.rivers) {
    for (let k = 1; k < r.cells.length; k++) {
      if (acc[r.cells[k]] < acc[r.cells[k - 1]]) { problems.push('river flow decreases downstream'); break; }
    }
    const last = r.cells[r.cells.length - 1];
    const nxt = receiver[last];
    const lx = last % w, ly = (last - lx) / w;
    const ends = sea[last] || lakeId[last] || nxt < 0 || sea[nxt] || lakeId[nxt] || river[nxt] || lx === 0 || ly === 0 || lx === w - 1 || ly === w - 1;
    if (!ends) problems.push(`river ending at ${last} does not reach water, another river or the edge`);
  }

  return { problems, popOrderViolations: orderViolations(hydro.popOrder, receiver), lakesWithoutOutlet, crossings };
}

export interface CompositionMetrics {
  stamps: number;
  /** V2: clusters with ≥ 3 stamps, and how many of them have exactly one main peak. */
  rangesWith3: number;
  rangesWithOneMain: number;
  /** V2: footprints touching water. */
  footprintsOnWater: number;
  /** V3: neighbouring stamps with the same key, variant and flip. */
  repeatedNeighbours: number;
  /** V3: largest share of one variant within any (cluster, key) group of ≥ 8 stamps. */
  maxVariantShare: number;
  /** V4: consecutive ridge stamps whose images overlap 20–45% along the chain (see chainOverlap). */
  adjacentPairs: number;
  overlapInBand: number;
  /** V6: share of land cells not covered by any stamp's visual bounds. */
  bareLand: number;
}

export function visualRect(s: StampInstance, manifest: Manifest) {
  const v = manifest.assets[s.key].visual;
  const vw = v.visualSize[0] * s.scale, vh = v.visualSize[1] * s.scale * s.squash;
  return { x0: s.x - vw * v.anchor[0], x1: s.x + vw * (1 - v.anchor[0]), y0: s.y - vh * v.anchor[1], y1: s.y + vh * (1 - v.anchor[1]) };
}

/**
 * Overlap of two neighbouring stamps measured along the line joining them: each image's extent
 * in that direction is |ux|·width + |uy|·height; overlap = (mean extent − distance) / min extent.
 * Negative means a gap (the comb-tooth look V4 forbids).
 */
export function chainOverlap(a: StampInstance, b: StampInstance, manifest: Manifest): number {
  const ra = visualRect(a, manifest), rb = visualRect(b, manifest);
  const ax = (ra.x0 + ra.x1) / 2, ay = (ra.y0 + ra.y1) / 2, bx = (rb.x0 + rb.x1) / 2, by = (rb.y0 + rb.y1) / 2;
  const d = Math.hypot(bx - ax, by - ay);
  if (d === 0) return 1;
  const ux = Math.abs(bx - ax) / d, uy = Math.abs(by - ay) / d;
  const ea = ux * (ra.x1 - ra.x0) + uy * (ra.y1 - ra.y0), eb = ux * (rb.x1 - rb.x0) + uy * (rb.y1 - rb.y0);
  return ((ea + eb) / 2 - d) / Math.min(ea, eb);
}

export function compositionMetrics(world: WorldData, manifest: Manifest): CompositionMetrics {
  const { hydro } = world;
  const w = world.config.size;
  const stamps = world.composition.stamps;

  const byCluster = new Map<number, StampInstance[]>();
  for (const s of stamps) {
    if (s.clusterId < 0) continue;
    const list = byCluster.get(s.clusterId) ?? [];
    list.push(s);
    byCluster.set(s.clusterId, list);
  }
  let rangesWith3 = 0, rangesWithOneMain = 0;
  for (const list of byCluster.values()) {
    const mountains = list.filter((s) => s.key !== 'hill');
    if (mountains.length < 3) continue;
    rangesWith3++;
    if (mountains.filter((s) => s.role === 'main').length === 1) rangesWithOneMain++;
  }

  let footprintsOnWater = 0;
  for (const s of stamps) {
    const b = footBox(manifest.assets[s.key].logic.footprint, s.scale, s.x, s.y);
    let wet = false;
    for (let cy = Math.max(0, Math.floor(b.y0)); cy <= Math.min(w - 1, Math.floor(b.y1)) && !wet; cy++) {
      for (let cx = Math.max(0, Math.floor(b.x0)); cx <= Math.min(w - 1, Math.floor(b.x1)); cx++) {
        const ccx = cx + 0.5, ccy = cy + 0.5;
        if (ccx < b.x0 || ccx > b.x1 || ccy < b.y0 || ccy > b.y1) continue;
        const c = cy * w + cx;
        if (hydro.sea[c] || hydro.lakeId[c] || hydro.river[c]) { wet = true; break; }
      }
    }
    if (wet) footprintsOnWater++;
  }

  // Neighbours: ground points closer than the larger stamp's footprint width.
  let repeatedNeighbours = 0;
  for (let i = 0; i < stamps.length; i++) {
    for (let j = i + 1; j < stamps.length; j++) {
      const a = stamps[i], b = stamps[j];
      if (a.key !== b.key || a.variant !== b.variant || a.flip !== b.flip) continue;
      const r = manifest.assets[a.key].logic.footprint[0];
      if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 < r * r) repeatedNeighbours++;
    }
  }

  let maxVariantShare = 0;
  const groups = new Map<string, StampInstance[]>();
  for (const s of stamps) {
    if (s.clusterId < 0) continue;
    const k = `${s.clusterId}|${s.key}`;
    const list = groups.get(k) ?? [];
    list.push(s);
    groups.set(k, list);
  }
  for (const list of groups.values()) {
    if (list.length < 8) continue;
    const counts = new Map<number, number>();
    for (const s of list) counts.set(s.variant, (counts.get(s.variant) ?? 0) + 1);
    maxVariantShare = Math.max(maxVariantShare, Math.max(...counts.values()) / list.length);
  }

  // V4 along ridge paths: consecutive mountain stamps on the same path (foothill chains excluded).
  const onPath = stamps.filter((s) => s.path >= 0 && s.key !== 'hill').sort((a, b) => a.path - b.path || a.pathPos - b.pathPos);
  let adjacentPairs = 0, overlapInBand = 0;
  for (let k = 1; k < onPath.length; k++) {
    const a = onPath[k - 1], b = onPath[k];
    if (a.path !== b.path || b.pathPos !== a.pathPos + 1) continue;
    const ov = chainOverlap(a, b, manifest);
    adjacentPairs++;
    if (ov >= 0.2 && ov <= 0.45) overlapInBand++;
  }

  // V6: land not covered by visual bounds (the mountain image, not the footprint).
  const covered = new Uint8Array(w * w);
  for (const s of stamps) {
    const r = visualRect(s, manifest);
    for (let cy = Math.max(0, Math.floor(r.y0)); cy <= Math.min(w - 1, Math.floor(r.y1)); cy++) {
      for (let cx = Math.max(0, Math.floor(r.x0)); cx <= Math.min(w - 1, Math.floor(r.x1)); cx++) covered[cy * w + cx] = 1;
    }
  }
  let land = 0, bare = 0;
  for (let c = 0; c < w * w; c++) {
    if (hydro.sea[c] || hydro.lakeId[c]) continue;
    land++;
    if (!covered[c]) bare++;
  }

  return {
    stamps: stamps.length, rangesWith3, rangesWithOneMain, footprintsOnWater, repeatedNeighbours,
    maxVariantShare, adjacentPairs, overlapInBand, bareLand: land ? bare / land : 0,
  };
}

/** Share of cells whose terrain class (sea, lake, low, hill, mountain) differs between two worlds. */
export function terrainClassDifference(a: WorldData, b: WorldData): number {
  const cls = (wd: WorldData, c: number) => {
    const { hydro, config } = wd;
    if (hydro.sea[c]) return 0;
    if (hydro.lakeId[c]) return 1;
    const h = hydro.height[c];
    return h >= config.mountainLevel ? 4 : h >= config.hillLevel ? 3 : 2;
  };
  const n = a.config.size * a.config.size;
  let diff = 0;
  for (let c = 0; c < n; c++) if (cls(a, c) !== cls(b, c)) diff++;
  return diff / n;
}

export const QA_SEEDS = Array.from({ length: 20 }, (_, i) => `tsvl-${String(i + 1).padStart(2, '0')}`);

export interface RidgeMetrics {
  ridgeCells: number;
  /** Mean H of ridge cells minus mean H of land at or above hillLevel. */
  heightLift: number;
  /** Ridge cells that are cross-section maxima on at least one axis. */
  coherence: number;
  /** Ridge cells that sit on a drainage divide (hydrological flow ≤ 5 cells). */
  onDivide: number;
  /** Ridge cells that are also river cells (should be ~0: crests and rivers do not mix). */
  onRiver: number;
  /** Steps along ridge paths (spur end → summit) that go up or stay level. */
  uphillSteps: number;
  /** Ridge paths that end on a summit (a local maximum of the smoothed surface). */
  pathsEndingHigh: number;
}

export function ridgeMetrics(world: WorldData): RidgeMetrics {
  const { hydro, ridges, config } = world;
  const n = config.size * config.size;
  const H = hydro.height;
  let rc = 0, rh = 0, lc = 0, lh = 0, divide = 0, river = 0;
  for (let c = 0; c < n; c++) {
    if (hydro.sea[c]) continue;
    if (H[c] >= config.hillLevel) { lc++; lh += H[c]; }
    if (!ridges.ridge[c]) continue;
    rc++;
    rh += H[c];
    if (hydro.acc[c] <= 5) divide++;
    if (hydro.river[c]) river++;
  }
  let steps = 0, up = 0, ending = 0;
  for (const p of ridges.paths) {
    for (let k = 1; k < p.length; k++) {
      steps++;
      if (H[p[k]] >= H[p[k - 1]] - 0.005) up++;
    }
    if (ridges.invReceiver[p[p.length - 1]] < 0 || ridges.peaks.some((pk) => pk.cell === p[p.length - 1])) ending++;
  }
  return {
    ridgeCells: rc,
    heightLift: rc && lc ? rh / rc - lh / lc : 0,
    coherence: ridges.coherence,
    onDivide: rc ? divide / rc : 0,
    onRiver: rc ? river / rc : 0,
    uphillSteps: steps ? up / steps : 1,
    pathsEndingHigh: ridges.paths.length ? ending / ridges.paths.length : 1,
  };
}
