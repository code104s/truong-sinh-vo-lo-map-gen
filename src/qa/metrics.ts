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

/** Region types for the stamp density review (replaces V6). */
export const REGIONS = ['mountain', 'plateau', 'foothill', 'valley', 'plain', 'coast'] as const;
export type Region = (typeof REGIONS)[number];

/**
 * Region of every land cell, from data only: coast = within 2 cells of sea; valley = within 1 cell
 * of a river carrying ≥ 3× the threshold where the ground is at least rolling; plateau = high and
 * nearly flat; mountain = at or above mountainLevel; foothill = rolling ground within 6 cells of
 * mountain ground; plain = everything else (low land and open rolling country away from ranges).
 * Sea and lake cells get -1. Precedence follows that order.
 */
export function regionMap(world: WorldData): Int8Array {
  const { hydro, config: cfg } = world;
  const w = cfg.size, n = w * w, H = hydro.height;
  const out = new Int8Array(n).fill(-1);
  const near = (c: number, r: number, f: (b: number) => boolean) => {
    const x = c % w, y = (c - x) / w;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < w && f(yy * w + xx)) return true;
    }
    return false;
  };
  const bigRiver = (b: number) => hydro.river[b] === 1 && hydro.acc[b] >= 3 * hydro.riverThreshold;
  // Chebyshev distance to mountain ground (capped), by BFS.
  const toMtn = new Uint8Array(n).fill(255);
  const q: number[] = [];
  for (let c = 0; c < n; c++) if (!hydro.sea[c] && H[c] >= cfg.mountainLevel) { toMtn[c] = 0; q.push(c); }
  for (let head = 0; head < q.length; head++) {
    const c = q[head], x = c % w, y = (c - x) / w;
    if (toMtn[c] >= 8) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= w) continue;
      const b = yy * w + xx;
      if (toMtn[b] > toMtn[c] + 1) { toMtn[b] = toMtn[c] + 1; q.push(b); }
    }
  }
  for (let c = 0; c < n; c++) {
    if (hydro.sea[c] || hydro.lakeId[c]) continue;
    const x = c % w, y = (c - x) / w;
    const gx = (H[y * w + Math.min(w - 1, x + 1)] - H[y * w + Math.max(0, x - 1)]) / 2;
    const gy = (H[Math.min(w - 1, y + 1) * w + x] - H[Math.max(0, y - 1) * w + x]) / 2;
    const slope = Math.sqrt(gx * gx + gy * gy) * w; // height units per map width
    const rolling = cfg.hillLevel - 0.14;
    let r: Region;
    if (near(c, 2, (b) => hydro.sea[b] === 1)) r = 'coast';
    else if (H[c] >= rolling && near(c, 1, bigRiver)) r = 'valley';
    else if (H[c] >= cfg.mountainLevel - 0.04 && slope < 1.2) r = 'plateau';
    else if (H[c] >= cfg.mountainLevel) r = 'mountain';
    else if (H[c] >= rolling && toMtn[c] <= 6) r = 'foothill';
    else r = 'plain';
    out[c] = REGIONS.indexOf(r);
  }
  return out;
}

export interface RegionDensity {
  cells: Record<Region, number>;
  /** Share of the region's cells covered by at least one stamp's visual bounds. */
  coverage: Record<Region, number>;
  /** Stamp count by composer role. */
  roles: Record<string, number>;
}

export function regionDensity(world: WorldData, manifest: Manifest): RegionDensity {
  const w = world.config.size;
  const reg = regionMap(world);
  const covered = new Uint8Array(w * w);
  const roles: Record<string, number> = {};
  for (const s of world.composition.stamps) {
    roles[s.role] = (roles[s.role] ?? 0) + 1;
    const r = visualRect(s, manifest);
    for (let cy = Math.max(0, Math.floor(r.y0)); cy <= Math.min(w - 1, Math.floor(r.y1)); cy++) {
      for (let cx = Math.max(0, Math.floor(r.x0)); cx <= Math.min(w - 1, Math.floor(r.x1)); cx++) covered[cy * w + cx] = 1;
    }
  }
  const cells = Object.fromEntries(REGIONS.map((k) => [k, 0])) as Record<Region, number>;
  const cov = Object.fromEntries(REGIONS.map((k) => [k, 0])) as Record<Region, number>;
  for (let c = 0; c < w * w; c++) {
    if (reg[c] < 0) continue;
    const k = REGIONS[reg[c]];
    cells[k]++;
    if (covered[c]) cov[k]++;
  }
  const coverage = Object.fromEntries(REGIONS.map((k) => [k, cells[k] ? cov[k] / cells[k] : 0])) as Record<Region, number>;
  return { cells, coverage, roles };
}

// ---------- Lake shape (Phase 2, B2: L2, L3, L6, L7) ----------

type Pt = [number, number];

function hullArea(pts: Pt[]): number {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return 0;
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [], upper: Pt[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  const h = lower.slice(0, -1).concat(upper.slice(0, -1));
  let a = 0;
  for (let i = 0; i < h.length; i++) { const j = (i + 1) % h.length; a += h[i][0] * h[j][1] - h[j][0] * h[i][1]; }
  return Math.abs(a) / 2;
}

/** Shape of a set of unit cells: area, 4-edge perimeter, compactness, PCA elongation, solidity, axis angle. */
export function cellShape(cells: Pt[]) {
  const A = cells.length;
  const set = new Set(cells.map(([x, y]) => x * 4096 + y));
  let P = 0;
  for (const [x, y] of cells) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!set.has((x + dx) * 4096 + (y + dy))) P++;
  let mx = 0, my = 0;
  for (const [x, y] of cells) { mx += x; my += y; }
  mx /= A; my /= A;
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of cells) { sxx += (x - mx) * (x - mx); syy += (y - my) * (y - my); sxy += (x - mx) * (y - my); }
  sxx = sxx / A + 1 / 12; syy = syy / A + 1 / 12; sxy /= A;
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const l1 = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det)), l2 = tr / 2 - Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const corners: Pt[] = [];
  for (const [x, y] of cells) corners.push([x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]);
  const hull = hullArea(corners);
  return {
    area: A, perimeter: P, compactness: (4 * Math.PI * A) / (P * P), elongation: Math.sqrt(l1 / Math.max(1e-9, l2)),
    solidity: A / Math.max(1, hull), angle: (Math.atan2(2 * sxy, sxx - syy) / 2) * 180 / Math.PI, cx: mx + 0.5, cy: my + 0.5,
    lengthAxis: 4 * Math.sqrt(l1), widthAxis: 4 * Math.sqrt(Math.max(0, l2)),
  };
}

export interface LakeShape {
  id: number;
  kind: number;
  area: number;
  elongation: number;
  solidity: number;
  catchment: number;
  /** Lake cells with at most one 4-neighbour in the same lake (one-cell arms). */
  armCells: number;
}

export function lakeShapes(world: WorldData): LakeShape[] {
  const { hydro } = world;
  const n = world.config.size;
  const cells: Pt[][] = hydro.lakes.map(() => []);
  for (let c = 0; c < n * n; c++) if (hydro.lakeId[c]) cells[hydro.lakeId[c] - 1].push([c % n, (c - (c % n)) / n]);
  return hydro.lakes.map((L, i) => {
    const sh = cellShape(cells[i]);
    let armCells = 0;
    for (const [x, y] of cells[i]) {
      let k = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < n && yy < n && hydro.lakeId[yy * n + xx] === L.id) k++;
      }
      if (k <= 1) armCells++;
    }
    return { id: L.id, kind: L.kind, area: sh.area, elongation: sh.elongation, solidity: sh.solidity, catchment: L.catchment, armCells };
  });
}
