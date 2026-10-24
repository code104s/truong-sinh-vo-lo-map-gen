// Mountain Composition: turns the ridge graph into placed stamp instances.
//
// Determinism: candidates are generated in any order, then sorted into a canonical order before
// acceptance and variant assignment. Variants come from a stateless position hash plus an
// anti-repetition pass over that canonical order, so the result never depends on candidate
// order, chunk load order or iteration order of hash maps.
import { hash01, hash32, seedToU32 } from '../core/rng';
import type { Family, ManifestLogic } from '../assets/manifestTypes';
import type { WorldConfig } from './config';
import type { HydrologyResult } from './hydrology';
import type { RidgeResult } from './ridges';

export type StampRole = 'main' | 'shoulder' | 'guest' | 'ridge' | 'spur' | 'summit' | 'hill';

const ROLE_RANK: Record<StampRole, number> = { main: 0, shoulder: 1, guest: 2, ridge: 3, spur: 4, summit: 5, hill: 6 };

export interface StampInstance {
  id: number;
  key: string;
  role: StampRole;
  clusterId: number;
  /** Ground contact point in world units (cells). */
  x: number;
  y: number;
  variant: number;
  /** Family the terrain role asked for; the variant's own family may be a fallback (FAMILY_FALLBACK). */
  family: Family;
  flip: boolean;
  scale: number;
  squash: number;
  /** -1 lighter, 0, +1 darker ink. */
  tone: number;
  /** Ridge path index and position along it, -1 when not placed on a ridge path. */
  path: number;
  pathPos: number;
}

export interface Candidate {
  key: string;
  role: StampRole;
  family: Family;
  clusterId: number;
  x: number;
  y: number;
  baseScale: number;
  path: number;
  pathPos: number;
  /** Acceptance priority inside a role, higher first (minor summits: their height). */
  rank?: number;
}

export interface SceneComposition {
  stamps: StampInstance[];
}

/**
 * Family order tried when no variant of the wanted family is free (anti-repetition) or the key
 * has none: the wanted family first, then the closest silhouettes.
 */
export const FAMILY_FALLBACK: Record<Family, readonly Family[]> = {
  range: ['range', 'flat', 'cliff', 'pinnacle', 'hill'],
  pinnacle: ['pinnacle', 'cliff', 'range', 'flat', 'hill'],
  cliff: ['cliff', 'pinnacle', 'range', 'flat', 'hill'],
  flat: ['flat', 'range', 'cliff', 'pinnacle', 'hill'],
  hill: ['hill', 'range', 'flat', 'cliff', 'pinnacle'],
};

/** Height a minor summit must stand above everything within 2 cells. */
const MINOR_RELIEF = 0.02;
/** Cells within 0.03 of a summit's height that make it a flat top (đỉnh bằng). */
const FLAT_TOP_CELLS = 6;
/** East/west slope ratio that makes a summit or ridge a cliff (vách). */
const CLIFF_RATIO = 2;

/** East and west drop from a cell over 3 cells; the larger over the smaller (min 0.005). */
export function slopeRatio(H: Float32Array, w: number, x: number, y: number): number {
  const c = H[y * w + x];
  const dw = c - H[y * w + Math.max(0, x - 3)], de = c - H[y * w + Math.min(w - 1, x + 3)];
  const a = Math.max(0.005, dw), b = Math.max(0.005, de);
  return a > b ? a / b : b / a;
}

/**
 * Silhouette of a summit from the ground around it: flat when at least FLAT_TOP_CELLS cells
 * (4-connected to it, within 4 cells) lie within 0.03 of its height; cliff when one flank drops
 * CLIFF_RATIO times faster than the other; else pinnacle.
 */
export function summitFamily(H: Float32Array, sea: Uint8Array, w: number, x: number, y: number): Family {
  const top = H[y * w + x];
  const seen = new Set<number>([y * w + x]);
  const queue = [y * w + x];
  for (let head = 0; head < queue.length && queue.length < FLAT_TOP_CELLS; head++) {
    const c = queue[head], cx = c % w, cy = (c - cx) / w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= w || Math.abs(nx - x) > 4 || Math.abs(ny - y) > 4) continue;
      const nb = ny * w + nx;
      if (seen.has(nb) || sea[nb] || Math.abs(H[nb] - top) > 0.03) continue;
      seen.add(nb);
      queue.push(nb);
    }
  }
  if (queue.length >= FLAT_TOP_CELLS) return 'flat';
  return slopeRatio(H, w, x, y) >= CLIFF_RATIO ? 'cliff' : 'pinnacle';
}

const KEY_SALT: Record<string, number> = { 'mountain.main': 11, 'mountain.tall': 23, 'mountain.low': 37, hill: 41 };

/** Estimated image extent per unit of footprint width, horizontally and vertically. */
const EXTENT_X = 1.12;
const EXTENT_Y = 1.15;
/** Image centre height above the ground point, as a fraction of the image height. */
const CENTRE_UP = 0.44;

/** Final stamp scale: the candidate's base scale with a ±12% jitter from a position hash. */
export function stampScale(s32: number, key: string, x: number, y: number, baseScale: number): number {
  return Math.fround(baseScale * (0.88 + 0.24 * hash01(s32, Math.round(x * 16), Math.round(y * 16), (KEY_SALT[key] ?? 97) + 2)));
}

export function generateCandidates(
  hydro: HydrologyResult,
  ridges: RidgeResult,
  logic: ManifestLogic,
  cfg: WorldConfig,
  seed: string,
): Candidate[] {
  const w = cfg.size;
  const H = hydro.height;
  const s32 = seedToU32(seed);
  const out: Candidate[] = [];
  const cxOf = (c: number) => (c % w) + 0.5;
  const cyOf = (c: number) => Math.floor(c / w) + 0.5;

  const clusterOfPath = new Int32Array(ridges.paths.length).fill(-1);
  for (const cl of ridges.clusters) for (const p of cl.paths) clusterOfPath[p] = cl.id;

  for (const cl of ridges.clusters) {
    if (cl.peaks.length === 0) continue;
    // Main peak = highest peak whose main stamp fits on dry land inside the map.
    let mainIdx = -1, mx = 0, my = 0;
    for (const pi of cl.peaks) {
      const c = ridges.peaks[pi].cell;
      for (const dy of [1.2, 2, 0.6]) {
        if (footprintFits(hydro, logic['mountain.main'].footprint, 1, cxOf(c), cyOf(c) + dy, w)) {
          mainIdx = pi; mx = cxOf(c); my = cyOf(c) + dy;
          break;
        }
      }
      if (mainIdx >= 0) break;
    }
    const main = ridges.peaks[mainIdx >= 0 ? mainIdx : cl.peaks[0]];
    if (mainIdx >= 0) {
      const mc = ridges.peaks[mainIdx].cell;
      const family = summitFamily(H, hydro.sea, w, mc % w, Math.floor(mc / w));
      out.push({ key: 'mountain.main', role: 'main', family, clusterId: cl.id, x: mx, y: my, baseScale: 1, path: -1, pathPos: 0 });
      // Shoulders flank the main peak, slightly in front, so it reads as one massif; they share
      // its silhouette family.
      const fw = logic['mountain.main'].footprint[0];
      out.push({ key: 'mountain.tall', role: 'shoulder', family, clusterId: cl.id, x: mx - fw * 0.42, y: my + 0.7, baseScale: 0.82, path: -1, pathPos: 0 });
      out.push({ key: 'mountain.tall', role: 'shoulder', family, clusterId: cl.id, x: mx + fw * 0.4, y: my + 0.9, baseScale: 0.76, path: -1, pathPos: 0 });
    }
    let guests = 0;
    for (const pi of cl.peaks) {
      if (pi === mainIdx || guests >= 4) continue;
      const p = ridges.peaks[pi];
      const rel = (p.height - cfg.hillLevel) / Math.max(1e-6, main.height - cfg.hillLevel);
      out.push({
        key: 'mountain.tall', role: 'guest', family: summitFamily(H, hydro.sea, w, p.cell % w, Math.floor(p.cell / w)), clusterId: cl.id,
        x: cxOf(p.cell), y: cyOf(p.cell) + 0.8, baseScale: Math.min(0.9, 0.62 + 0.26 * rel), path: -1, pathPos: 0,
      });
      guests++;
    }
  }

  // Ridge sampling: walk each path from its far end towards the summit. A path that ends at a
  // summit (its last cell is a root of the inverted flow) is a main ridge (sống chính); one that
  // joins another path is a spur (nhánh).
  //  - Main ridge, crest running east-west: a range (dãy), mountain.main on high ground,
  //    mountain.low lower down. Running north-south: stacked peaks, mountain.tall pinnacle or
  //    cliff (ridgeFamily).
  //  - Spur: mountain.low, cliff where one flank is much steeper, else range; scale tapers
  //    towards the spur's end.
  //  - Below mountainLevel both become hills.
  ridges.paths.forEach((cells, pi) => {
    const spur = ridges.invReceiver[cells[cells.length - 1]] >= 0;
    // Chain placement: each next stamp sits where its overlap with the previous one along the
    // chain equals cfg.ridgeOverlap (V4). Image extents are estimated from the footprint width
    // (EXTENT_X/EXTENT_Y), since worldgen must not read visual data; the final scale jitter is
    // included because it is a pure function of position.
    let pos = 0;
    // Ground point (x, y) of the last stamp and its estimated image size (ex, ey).
    let last: { x: number; y: number; ex: number; ey: number } | null = null;
    const overlapAt = (a: { x: number; y: number; ex: number; ey: number }, bx: number, by: number, ex: number, ey: number) => {
      // Image centres sit CENTRE_UP of the image height above the ground point.
      const ax = a.x, ay = a.y - CENTRE_UP * a.ey, cx = bx, cy = by - CENTRE_UP * ey;
      const d = Math.sqrt((cx - ax) * (cx - ax) + (cy - ay) * (cy - ay));
      if (d === 0) return 1;
      const ux = Math.abs(cx - ax) / d, uy = Math.abs(cy - ay) / d;
      const ea = ux * a.ex + uy * a.ey, eb = ux * ex + uy * ey;
      return ((ea + eb) / 2 - d) / Math.min(ea, eb);
    };
    for (let k = 0; k < cells.length; k++) {
      const b = cells[k];
      const bx = cxOf(b), by = cyOf(b) + 0.6;
      const hb = H[b];
      const lift = Math.min(1, Math.max(0, (hb - cfg.mountainLevel - 0.1) / 0.25));
      let key: string, family: Family, baseScale: number;
      if (hb < cfg.mountainLevel) {
        key = 'hill'; family = 'hill'; baseScale = 0.9;
      } else if (spur) {
        key = 'mountain.low';
        family = slopeRatio(H, w, b % w, Math.floor(b / w)) >= CLIFF_RATIO ? 'cliff' : 'range';
        baseScale = 0.9 * (0.65 + 0.35 * k / Math.max(1, cells.length - 1));
      } else {
        family = ridgeFamily(H, w, cells, k);
        if (family === 'range') {
          key = hb >= cfg.mountainLevel + 0.1 ? 'mountain.main' : 'mountain.low';
          baseScale = key === 'mountain.main' ? 0.5 + 0.3 * lift : 0.9;
        } else {
          key = 'mountain.tall';
          baseScale = 0.6 + 0.5 * Math.min(1, (hb - cfg.mountainLevel) / 0.35);
        }
      }
      const role: StampRole = spur ? 'spur' : 'ridge';
      const fw0 = logic[key].footprint[0];
      const size = (x: number, y: number) => fw0 * stampScale(s32, key, x, y, baseScale);
      if (!last) {
        const fw = size(bx, by);
        last = { x: bx, y: by, ex: fw * EXTENT_X, ey: fw * EXTENT_Y };
        out.push({ key, role, family, clusterId: clusterOfPath[pi], x: bx, y: by, baseScale, path: pi, pathPos: pos++ });
        continue;
      }
      // Not yet far enough: the stamp would overlap more than the target even at b.
      const fwB = size(bx, by);
      if (overlapAt(last, bx, by, fwB * EXTENT_X, fwB * EXTENT_Y) > cfg.ridgeOverlap) continue;
      // Bisect along the segment last → b for the point where the overlap meets the target.
      let lo = 0, hi = 1;
      for (let it = 0; it < 24; it++) {
        const t = (lo + hi) / 2;
        const x = last.x + (bx - last.x) * t, y = last.y + (by - last.y) * t;
        const fw = size(x, y);
        if (overlapAt(last, x, y, fw * EXTENT_X, fw * EXTENT_Y) > cfg.ridgeOverlap) lo = t; else hi = t;
      }
      const px: number = last.x + (bx - last.x) * hi, py: number = last.y + (by - last.y) * hi;
      const fw = size(px, py);
      last = { x: px, y: py, ex: fw * EXTENT_X, ey: fw * EXTENT_Y };
      out.push({ key, role, family, clusterId: clusterOfPath[pi], x: px, y: py, baseScale, path: pi, pathPos: pos++ });
      k--; // the same cell may host another stamp further along
    }
  });

  // Minor summits (đỉnh phụ) on high ground off the ridge lines: local maxima within 2 cells
  // standing at least MINOR_RELIEF above their surroundings. Positions come from the terrain, not
  // from a lattice; they are accepted highest first (rank), and the composer's overlap limits keep
  // them apart and off ground already covered by the structure above.
  for (let c = 0; c < w * w; c++) {
    if (hydro.sea[c] || hydro.lakeId[c] || hydro.river[c] || H[c] < cfg.mountainLevel - 0.02) continue;
    const x = c % w, y = (c - x) / w;
    let isMax = true, low = H[c];
    for (let dy = -2; dy <= 2 && isMax; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx, ny = y + dy;
        if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= w || ny >= w) continue;
        const nb = ny * w + nx;
        if (H[nb] > H[c] || (H[nb] === H[c] && nb < c)) { isMax = false; break; }
        if (H[nb] < low) low = H[nb];
      }
    }
    if (!isMax || H[c] - low < MINOR_RELIEF) continue;
    const key = H[c] >= cfg.mountainLevel + 0.1 ? 'mountain.tall' : 'mountain.low';
    out.push({
      key, role: 'summit', family: summitFamily(H, hydro.sea, w, x, y), clusterId: nearestCluster(ridges, x, y, w),
      x: x + 0.5, y: y + 1.1, rank: H[c],
      baseScale: key === 'mountain.tall' ? 0.6 + 0.45 * Math.min(1, (H[c] - cfg.mountainLevel - 0.1) / 0.25) : 0.8,
      path: -1, pathPos: 0,
    });
  }

  // Foothills on a jittered 4-cell lattice, sparse enough to leave empty paper (lưu bạch).
  const near = ridgeDistance(ridges.ridge, w);
  for (let gy = 0; gy < w; gy += 4) {
    for (let gx = 0; gx < w; gx += 4) {
      const jx = gx + Math.floor(hash01(s32, gx, gy, 7) * 4);
      const jy = gy + Math.floor(hash01(s32, gx, gy, 8) * 4);
      if (jx >= w || jy >= w) continue;
      const c = jy * w + jx;
      if (hydro.sea[c] || hydro.lakeId[c] || hydro.river[c]) continue;
      // Rolling ground starts a little below hillLevel; low knolls (gò) thin out towards the plains.
      const floor = cfg.hillLevel - 0.14;
      if (H[c] < floor || H[c] >= cfg.mountainLevel || near[c] < 3) continue;
      const chance = (H[c] - floor) / (cfg.mountainLevel - floor);
      if (hash01(s32, jx, jy, 9) > (0.26 + 0.55 * chance) * (0.3 + 1.4 * clumpDensity(s32, jx + 7, jy + 7, 18))) continue;
      out.push({ key: 'hill', role: 'hill', family: 'hill', clusterId: -1, x: jx + 0.5, y: jy + 0.5, baseScale: 0.65 + 0.45 * chance, path: -1, pathPos: 0 });
    }
  }
  return out;
}

/**
 * Silhouette along a ridge path at cells[k]: a crest running east-west reads as a range (dãy); one
 * running north-south, seen from above with upright mountains, as stacked peaks: cliff when one
 * flank is much steeper, else pinnacle. Direction from the cells two steps either side.
 */
export function ridgeFamily(H: Float32Array, w: number, cells: readonly number[], k: number): Family {
  const a = cells[Math.max(0, k - 2)], b = cells[Math.min(cells.length - 1, k + 2)];
  const dx = Math.abs((b % w) - (a % w)), dy = Math.abs(Math.floor(b / w) - Math.floor(a / w));
  if (dx >= dy) return 'range';
  const c = cells[k];
  return slopeRatio(H, w, c % w, Math.floor(c / w)) >= CLIFF_RATIO ? 'cliff' : 'pinnacle';
}

export interface FootBox { x0: number; y0: number; x1: number; y1: number }

/** Ground footprint box: the foot point sits 3/4 of the way down the footprint depth. */
export function footBox(footprint: readonly [number, number], scale: number, x: number, y: number): FootBox {
  const [fw, fh] = footprint;
  return { x0: x - (fw * scale) / 2, x1: x + (fw * scale) / 2, y0: y - fh * scale * 0.75, y1: y + fh * scale * 0.25 };
}

/** True if the footprint lies inside the map and covers no sea, lake or river cell centre. */
export function footprintFits(hydro: HydrologyResult, footprint: readonly [number, number], scale: number, x: number, y: number, w: number): boolean {
  const b = footBox(footprint, scale, x, y);
  if (b.x0 < 0 || b.x1 > w || b.y0 < 0 || b.y1 > w) return false;
  for (let cy = Math.floor(b.y0); cy <= Math.min(w - 1, Math.floor(b.y1)); cy++) {
    for (let cx = Math.floor(b.x0); cx <= Math.min(w - 1, Math.floor(b.x1)); cx++) {
      const ccx = cx + 0.5, ccy = cy + 0.5;
      if (ccx < b.x0 || ccx > b.x1 || ccy < b.y0 || ccy > b.y1) continue;
      const c = cy * w + cx;
      if (hydro.sea[c] || hydro.lakeId[c] || hydro.river[c]) return false;
    }
  }
  return true;
}

/** Smooth value noise in [0,1] on a `cell`-sized lattice, from stateless hashes (no trig). */
export function clumpDensity(s32: number, x: number, y: number, cell: number): number {
  const fx = x / cell, fy = y / cell;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  const tx = fx - ix, ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const v = (a: number, b: number) => hash01(s32, a, b, 61);
  const top = v(ix, iy) + (v(ix + 1, iy) - v(ix, iy)) * sx;
  const bot = v(ix, iy + 1) + (v(ix + 1, iy + 1) - v(ix, iy + 1)) * sx;
  return top + (bot - top) * sy;
}

/** Cluster of the nearest peak within 12 cells, or -1. Ties break by cluster id. */
function nearestCluster(ridges: RidgeResult, x: number, y: number, w: number): number {
  let best = -1, bestD = 145;
  for (const cl of ridges.clusters) {
    for (const pi of cl.peaks) {
      const c = ridges.peaks[pi].cell;
      const dx = (c % w) - x, dy = Math.floor(c / w) - y;
      const d = dx * dx + dy * dy;
      if (d < bestD || (d === bestD && cl.id < best)) { bestD = d; best = cl.id; }
    }
  }
  return best;
}

/** Chebyshev distance to the nearest ridge cell, capped at 255. */
function ridgeDistance(ridge: Uint8Array, w: number): Uint8Array {
  const n = w * w;
  const d = new Uint8Array(n).fill(255);
  const q: number[] = [];
  for (let i = 0; i < n; i++) if (ridge[i]) { d[i] = 0; q.push(i); }
  for (let head = 0; head < q.length; head++) {
    const c = q[head];
    const cx = c % w, cy = (c - cx) / w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= w) continue;
        const nb = ny * w + nx;
        if (d[nb] > d[c] + 1) { d[nb] = d[c] + 1; q.push(nb); }
      }
    }
  }
  return d;
}

export function canonicalCompare(a: Candidate, b: Candidate): number {
  return ROLE_RANK[a.role] - ROLE_RANK[b.role] || (b.rank ?? 0) - (a.rank ?? 0) || a.y - b.y || a.x - b.x || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
    || a.path - b.path || a.pathPos - b.pathPos;
}

/** Accepts candidates and assigns variants. Input order does not matter. */
export function composeStamps(
  candidates: readonly Candidate[],
  hydro: HydrologyResult,
  logic: ManifestLogic,
  cfg: WorldConfig,
  seed: string,
): SceneComposition {
  const w = cfg.size;
  const s32 = seedToU32(seed);
  const sorted = [...candidates].sort(canonicalCompare);

  interface Box extends FootBox { cluster: number }
  const boxes: Box[] = [];
  const accepted: Candidate[] = [];

  const finalScale = (c: Candidate) => stampScale(s32, c.key, c.x, c.y, c.baseScale);
  for (const cand of sorted) {
    const fp = logic[cand.key].footprint;
    // Test the scale the stamp will actually have, so the jitter cannot push it onto water.
    const scale = finalScale(cand);
    if (!footprintFits(hydro, fp, scale, cand.x, cand.y, w)) continue;
    const box: Box = { ...footBox(fp, scale, cand.x, cand.y), cluster: cand.clusterId };
    // Limit ground overlap: same-cluster neighbours may overlap more than strangers.
    let clash = false;
    for (const b of boxes) {
      const ix = Math.min(b.x1, box.x1) - Math.max(b.x0, box.x0);
      const iy = Math.min(b.y1, box.y1) - Math.max(b.y0, box.y0);
      if (ix <= 0 || iy <= 0) continue;
      const inter = ix * iy;
      const minArea = Math.min((b.x1 - b.x0) * (b.y1 - b.y0), (box.x1 - box.x0) * (box.y1 - box.y0));
      const limit = cand.role === 'main' || cand.role === 'shoulder' ? 0.9 : b.cluster === box.cluster && box.cluster >= 0 ? 0.5 : 0.2;
      if (inter / minArea > limit) { clash = true; break; }
    }
    if (clash) continue;
    boxes.push(box);
    accepted.push(cand);
  }

  // Every range of 3+ mountains needs one recognisable main peak (V2). When the main stamp did not
  // fit (coast, river, map edge), the largest accepted mountain of that range takes the role.
  const mountainsOf = new Map<number, Candidate[]>();
  for (const c of accepted) {
    if (c.clusterId < 0 || c.key === 'hill') continue;
    const list = mountainsOf.get(c.clusterId) ?? [];
    list.push(c);
    mountainsOf.set(c.clusterId, list);
  }
  for (const list of mountainsOf.values()) {
    if (list.length < 3 || list.some((c) => c.role === 'main')) continue;
    let best = list[0];
    for (const c of list) {
      const size = logic[c.key].footprint[0] * finalScale(c), bestSize = logic[best.key].footprint[0] * finalScale(best);
      if (size > bestSize || (size === bestSize && canonicalCompare(c, best) < 0)) best = c;
    }
    const i = accepted.indexOf(best);
    accepted[i] = { ...best, role: 'main' };
  }

  // Variant assignment over the canonical order. The terrain role fixes the family; inside it a
  // position hash picks the variant, with anti-repetition: no neighbour with the same variant and
  // flip, and no variant above 25% of its (cluster, key) group once the group has 8+. When the
  // family has no variant that passes, the next family of FAMILY_FALLBACK is tried; the strict
  // pass (both rules) runs over the whole fallback chain before the relaxed pass (neighbour rule).
  const stamps: StampInstance[] = [];
  const H = hydro.height;
  const groupKey = (c: { clusterId: number; key: string }) => `${c.clusterId}|${c.key}`;
  const groupSize = new Map<string, number>();
  for (const c of accepted) if (c.clusterId >= 0) groupSize.set(groupKey(c), (groupSize.get(groupKey(c)) ?? 0) + 1);
  const used = new Map<string, number[]>();
  for (const cand of accepted) {
    const lg = logic[cand.key];
    const qx = Math.round(cand.x * 16), qy = Math.round(cand.y * 16);
    const salt = KEY_SALT[cand.key] ?? 97;
    const h = hash32(s32, qx, qy, salt);
    // Flip from the local east-west slope so lit and shaded faces agree with the terrain.
    const cx = Math.min(w - 2, Math.max(1, Math.floor(cand.x)));
    const cy = Math.min(w - 1, Math.max(0, Math.floor(cand.y - 1)));
    const dx = H[cy * w + cx + 1] - H[cy * w + cx - 1];
    const flip = dx === 0 ? (hash32(s32, qx, qy, salt + 1) & 1) === 1 : dx > 0;
    const radius = Math.max(3, 1.6 * lg.footprint[0]);
    const gk = groupKey(cand);
    const size = cand.clusterId >= 0 ? groupSize.get(gk)! : 0;
    const cap = size >= 8 ? Math.floor(size * 0.25) : Infinity;
    const counts = used.get(gk) ?? new Array<number>(lg.variants).fill(0);
    used.set(gk, counts);
    const near = (v: number) => stamps.some((o) => o.key === cand.key && o.variant === v && o.flip === flip
      && (o.x - cand.x) * (o.x - cand.x) + (o.y - cand.y) * (o.y - cand.y) < radius * radius);
    const members = (f: Family) => {
      const list: number[] = [];
      for (let v = 0; v < lg.variants; v++) if (lg.variantFamilies[v] === f) list.push(v);
      return list;
    };
    let chosen = -1;
    for (let pass = 0; pass < 2 && chosen < 0; pass++) {
      for (const f of FAMILY_FALLBACK[cand.family]) {
        const list = members(f);
        for (let tries = 0; tries < list.length && chosen < 0; tries++) {
          const v = list[(h + tries) % list.length];
          if (pass === 0 && counts[v] >= cap) continue;
          if (!near(v)) chosen = v;
        }
        if (chosen >= 0) break;
      }
    }
    if (chosen < 0) {
      // Every variant has a twin within the radius: take the one whose nearest twin is farthest
      // (fallback order, then hash order, breaks ties).
      let best = -1;
      for (const f of FAMILY_FALLBACK[cand.family]) {
        const list = members(f);
        for (let tries = 0; tries < list.length; tries++) {
          const v = list[(h + tries) % list.length];
          let d = Infinity;
          for (const o of stamps) {
            if (o.key !== cand.key || o.variant !== v || o.flip !== flip) continue;
            d = Math.min(d, (o.x - cand.x) * (o.x - cand.x) + (o.y - cand.y) * (o.y - cand.y));
          }
          if (d > best) { best = d; chosen = v; }
        }
      }
    }
    const variant = chosen;
    counts[variant]++;
    const r2 = hash01(s32, qx, qy, salt + 3), r3 = hash01(s32, qx, qy, salt + 4);
    stamps.push({
      id: 0,
      key: cand.key, role: cand.role, clusterId: cand.clusterId, x: cand.x, y: cand.y,
      variant, family: cand.family, flip,
      scale: finalScale(cand),
      squash: Math.fround(0.93 + 0.14 * r2),
      tone: r3 < 0.25 ? -1 : r3 > 0.8 ? 1 : 0,
      path: cand.path, pathPos: cand.pathPos,
    });
  }

  // Draw order: north to south, ties by x then key; ids follow draw order.
  stamps.sort((a, b) => a.y - b.y || a.x - b.x || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  stamps.forEach((s, i) => (s.id = i));
  return { stamps };
}

/** Stamps whose ground point falls inside a chunk. Pure filter: query order cannot change results. */
export function stampsInChunk(comp: SceneComposition, chunkSize: number, cx: number, cy: number): StampInstance[] {
  return comp.stamps.filter((s) => Math.floor(s.x / chunkSize) === cx && Math.floor(s.y / chunkSize) === cy);
}
