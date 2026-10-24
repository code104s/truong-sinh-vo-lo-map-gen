// Phase 1 diagnostics (analysis only, no pipeline change): measures lakes, rivers, mountain
// composition and terrain regions for each seed, and writes debug overlays.
//   npx vite-node scripts/analysis/analyze.ts -- <outDir> [seed...]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import manifest from '../../src/assets/manifest.json';
import { logicOf, type Manifest } from '../../src/assets/manifestTypes';
import { generateWorld, type WorldData } from '../../src/worldgen/index';
import { buildFieldImage, FIELD_UPSAMPLE, SDF_RANGE } from '../../src/render/fields';
import { DX8, DY8 } from '../../src/core/grid';
import { encodePng } from '../png';
import { terrainParts, type TerrainParts } from './terrain-parts';

const man = manifest as unknown as Manifest;
const logic = logicOf(man);
const args = process.argv.slice(2).filter((a) => a !== '--');
const outDir = args[0] ?? 'qa-out/analysis';
const seeds = args.length > 1 ? args.slice(1) : Array.from({ length: 20 }, (_, i) => `tsvl-${String(i + 1).padStart(2, '0')}`);
mkdirSync(outDir, { recursive: true });

// Z1 camera in the QA shots: viewport 1600×1000, fit margin 0.96 → 960 px map at (320, 20).
const Z1_PX_PER_CELL = 7.5;
const RIVER_FAR_SCALE = 2.4;

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
function shape(cells: Pt[]) {
  const A = cells.length;
  const set = new Set(cells.map(([x, y]) => x * 4096 + y));
  let P = 0;
  for (const [x, y] of cells) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!set.has((x + dx) * 4096 + (y + dy))) P++;
  let mx = 0, my = 0;
  for (const [x, y] of cells) { mx += x; my += y; }
  mx /= A; my /= A;
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of cells) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
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

function components(mask: Uint8Array, w: number, conn8 = false): number[][] {
  const seen = new Uint8Array(mask.length);
  const out: number[][] = [];
  const step = conn8 ? 1 : 2;
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    const comp = [s]; seen[s] = 1;
    for (let h = 0; h < comp.length; h++) {
      const c = comp[h], cx = c % w, cy = (c - cx) / w;
      for (let d = 0; d < 8; d += step) {
        const nx = cx + DX8[d], ny = cy + DY8[d];
        if (nx < 0 || ny < 0 || nx >= w || ny >= w) continue;
        const nb = ny * w + nx;
        if (mask[nb] && !seen[nb]) { seen[nb] = 1; comp.push(nb); }
      }
    }
    out.push(comp);
  }
  return out;
}

const pts = (cells: number[], w: number): Pt[] => cells.map((c) => [c % w, Math.floor(c / w)]);
const median = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Approximate opaque silhouette of a stamp image (bell over the ground point, foot erased by mist). */
function stampCovers(s: WorldData['composition']['stamps'][number], px: number, py: number): boolean {
  const v = man.assets[s.key].visual;
  const w = v.visualSize[0] * s.scale, h = v.visualSize[1] * s.scale * s.squash;
  const groundY = s.y + h * (1 - v.anchor[1]);
  const up = groundY - py; // height above the image bottom
  const hh = h * v.anchor[1];
  if (up < hh * 0.3 || up > hh * 0.95) return false; // foot is erased to mist; tip is thin
  const half = 0.45 * w * Math.sqrt(Math.max(0, 1 - up / hh));
  return Math.abs(px - s.x) < half;
}

function mistCovers(world: WorldData, px: number, py: number): boolean {
  for (const s of world.composition.stamps) {
    if (s.role !== 'main' && s.role !== 'guest') continue;
    const v = man.assets[s.key].visual;
    const w = v.visualSize[0] * s.scale * (s.role === 'main' ? 1.9 : 1.3);
    const cy = s.y - v.visualSize[1] * s.scale * 0.12;
    // Core of the mist band (alpha ≳ 0.35): inner 60% of the blob ellipses.
    const dx = (px - s.x) / (w * 0.3), dy = (py - cy) / (w * 0.3 * 0.3 * 0.6);
    if (dx * dx + dy * dy < 1) return true;
  }
  return false;
}

interface Img { w: number; h: number; d: Uint8Array }
const img = (w: number, h: number): Img => ({ w, h, d: new Uint8Array(w * h * 4).fill(255) });
function put(im: Img, x: number, y: number, c: number[], a = 1) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= im.w || y >= im.h) return;
  const o = (y * im.w + x) * 4;
  for (let k = 0; k < 3; k++) im.d[o + k] = im.d[o + k] * (1 - a) + c[k] * a;
  im.d[o + 3] = 255;
}
function line(im: Img, x0: number, y0: number, x1: number, y1: number, c: number[], wpx = 1, a = 1) {
  const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) + 1;
  const r = Math.max(0, Math.floor((wpx - 1) / 2));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) put(im, x + dx, y + dy, c, a);
  }
}
function disc(im: Img, x: number, y: number, rad: number, c: number[], a = 1) {
  for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) if (dx * dx + dy * dy <= rad * rad) put(im, x + dx, y + dy, c, a);
}
function ring(im: Img, x: number, y: number, rad: number, c: number[]) {
  for (let k = 0; k < 64; k++) { const t = (k / 64) * Math.PI * 2; put(im, x + rad * Math.cos(t), y + rad * Math.sin(t), c); }
}

/** Shaded relief base shared by overlays. */
function reliefBase(world: WorldData, S: number, im: Img, ox: number, tint: (c: number) => number[] | null = () => null) {
  const n = world.config.size, H = world.hydro.height;
  for (let y = 0; y < n * S; y++) for (let x = 0; x < n * S; x++) {
    const cx = Math.floor(x / S), cy = Math.floor(y / S), c = cy * n + cx;
    const ex = H[cy * n + Math.min(n - 1, cx + 1)] - H[cy * n + Math.max(0, cx - 1)];
    const ey = H[Math.min(n - 1, cy + 1) * n + cx] - H[Math.max(0, cy - 1) * n + cx];
    const shade = Math.max(0, Math.min(1, 0.62 - (ex + ey) * 4));
    let col: number[];
    if (world.hydro.sea[c]) col = [168, 188, 205];
    else {
      const t = (H[c] - world.config.seaLevel) / (1 - world.config.seaLevel);
      const g = 120 + 120 * t;
      col = [g * (0.6 + 0.55 * shade), g * (0.6 + 0.55 * shade), g * (0.6 + 0.55 * shade)];
      const tc = tint(c);
      if (tc) col = col.map((v, k) => v * 0.55 + tc[k] * 0.45);
    }
    put(im, ox + x, y, col.map((v) => Math.min(255, v)));
  }
}

const report: Record<string, unknown>[] = [];

for (const seed of seeds) {
  const world = generateWorld(seed, logic);
  const parts: TerrainParts = terrainParts(seed, world.config);
  const { hydro, ridges, composition, config: cfg } = world;
  const n = cfg.size, N = n * n, H = hydro.height;
  for (let i = 0; i < N; i++) if (Math.abs(parts.height[i] - (H[i] - 0)) > 2e-4) throw new Error(`terrain-parts out of sync at ${seed}`);

  // Rendered water mask (the shader's coast zero line, without its ±0.35-cell domain warp).
  const field = buildFieldImage(world);
  const FN = field.width, U = FIELD_UPSAMPLE;
  const sdAt = (fx: number, fy: number) => {
    const xi = Math.min(FN - 1, Math.max(0, Math.round(fx * U - 0.5))), yi = Math.min(FN - 1, Math.max(0, Math.round(fy * U - 0.5)));
    const o = (yi * FN + xi) * 4;
    return (((field.sdf[o] * 256 + field.sdf[o + 1]) / 65535) - 0.5) * SDF_RANGE;
  };
  const rWater = new Uint8Array(FN * FN);
  for (let i = 0; i < FN * FN; i++) rWater[i] = ((field.sdf[i * 4] * 256 + field.sdf[i * 4 + 1]) / 65535) < 0.5 ? 1 : 0;

  // ---------- Terrain regions ----------
  let land = 0;
  const cls = { lowland: 0, rolling: 0, hill: 0, mountain: 0 };
  const isMtn = new Uint8Array(N);
  let flatHigh = 0;
  for (let i = 0; i < N; i++) {
    if (hydro.sea[i]) continue;
    land++;
    const h = H[i];
    if (h < cfg.hillLevel - 0.14) cls.lowland++; else if (h < cfg.hillLevel) cls.rolling++; else if (h < cfg.mountainLevel) cls.hill++; else { cls.mountain++; isMtn[i] = 1; }
    const x = i % n, y = (i - x) / n;
    if (x > 0 && y > 0 && x < n - 1 && y < n - 1 && h >= cfg.hillLevel) {
      const gx = (H[i + 1] - H[i - 1]) / 2, gy = (H[i + n] - H[i - n]) / 2;
      if (Math.hypot(gx, gy) < 0.006) flatHigh++;
    }
  }
  const mtnComps = components(isMtn, n, true).filter((c) => c.length >= 10).sort((a, b) => b.length - a.length);
  const mtnShapes = mtnComps.map((c) => shape(pts(c, n)));
  // Lowland slope: how flat the plains are (map-wide gradient of the tilt dominates).
  const terrain = {
    land, classes: Object.fromEntries(Object.entries(cls).map(([k, v]) => [k, r3(v / land)])),
    mountainMasses: mtnComps.length, largestMassShare: r3((mtnComps[0]?.length ?? 0) / Math.max(1, cls.mountain)),
    massElongation: mtnShapes.slice(0, 4).map((s) => r3(s.elongation)), flatHighShare: r3(flatHigh / land),
    // Share of land height variance explained by each term (variance of the term over land / variance of H).
    termStd: (() => {
      const vals = { base: [] as number[], tilt: [] as number[], mountains: [] as number[] };
      for (let i = 0; i < N; i++) if (!hydro.sea[i]) { vals.base.push(parts.base[i]); vals.tilt.push(parts.tilt[i]); vals.mountains.push(parts.mountains[i]); }
      const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };
      return { base: r3(sd(vals.base)), tilt: r3(sd(vals.tilt)), mountains: r3(sd(vals.mountains)) };
    })(),
  };

  // ---------- Lakes ----------
  const deepAll = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (!hydro.sea[i] && hydro.filled[i] - H[i] > cfg.minLakeDepth) deepAll[i] = 1;
  const depComp = new Int32Array(N).fill(-1);
  const deps = components(deepAll, n);
  deps.forEach((c, k) => { for (const i of c) depComp[i] = k; });
  const lakeCells = new Map<number, number[]>();
  for (let i = 0; i < N; i++) if (hydro.lakeId[i]) { const l = lakeCells.get(hydro.lakeId[i]) ?? []; l.push(i); lakeCells.set(hydro.lakeId[i], l); }
  // Shallow flats: filled above terrain but not open water (marsh, cut rims, small pits).
  let flats = 0;
  for (let i = 0; i < N; i++) if (!hydro.sea[i] && !hydro.lakeId[i] && hydro.filled[i] - H[i] > 0.002) flats++;

  const pathEnds = hydro.rivers.map((r) => r.cells[r.cells.length - 1]);
  const lakes = hydro.lakes.map((L) => {
    const cells = lakeCells.get(L.id) ?? [];
    const sh = shape(pts(cells, n));
    const depths = cells.map((c) => L.level - H[c]);
    const inLake = new Set(cells);
    // Rim: land cells within 6 cells of the lake (Chebyshev).
    let rimMax = -1, rimSteep = 0, rimN = 0;
    const rimSeen = new Set<number>();
    for (const c of cells) {
      const cx = c % n, cy = (c - cx) / n;
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const b = y * n + x;
        if (inLake.has(b) || rimSeen.has(b) || hydro.sea[b]) continue;
        rimSeen.add(b);
        rimMax = Math.max(rimMax, H[b]);
      }
      for (let d = 0; d < 8; d += 2) {
        const x = cx + DX8[d], y = cy + DY8[d];
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const b = y * n + x;
        if (inLake.has(b)) continue;
        rimN++;
        if (H[b] - L.level > 0.02) rimSteep++;
      }
    }
    const relief = rimMax - L.level;
    const kind = L.level >= cfg.hillLevel ? 'mountain' : relief >= 0.12 ? 'valley' : 'plain';
    const zoneMean = mean(cells.map((c) => parts.zone[c]));
    const mtnTerm = mean(cells.map((c) => parts.mountains[c]));
    const dep = depComp[cells[0]];
    const depSize = dep >= 0 ? deps[dep].length : cells.length;
    // Rendered lake: field pixels inside this lake's dilated bbox that are water and not sea-connected.
    let rArea = 0;
    const rPts: Pt[] = [];
    const x0 = Math.max(0, Math.floor((sh.cx - sh.lengthAxis - 3) * U)), x1 = Math.min(FN - 1, Math.ceil((sh.cx + sh.lengthAxis + 3) * U));
    const y0 = Math.max(0, Math.floor((sh.cy - sh.lengthAxis - 3) * U)), y1 = Math.min(FN - 1, Math.ceil((sh.cy + sh.lengthAxis + 3) * U));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!rWater[y * FN + x]) continue;
      const c = Math.floor(y / U) * n + Math.floor(x / U);
      if (hydro.sea[c]) continue;
      // Attribute to this lake when the nearest lake cell within 2 cells is ours.
      const cx = Math.floor(x / U), cy = Math.floor(y / U);
      let ours = false;
      for (let dy = -2; dy <= 2 && !ours; dy++) for (let dx = -2; dx <= 2 && !ours; dx++) {
        const xx = cx + dx, yy = cy + dy;
        if (xx >= 0 && yy >= 0 && xx < n && yy < n && hydro.lakeId[yy * n + xx] === L.id) ours = true;
      }
      if (!ours) continue;
      rArea++;
      rPts.push([x, y]);
    }
    const rSh = rPts.length > 2 ? shape(rPts) : null;
    const inflows = pathEnds.filter((e) => hydro.lakeId[e] === L.id).length;
    return {
      id: L.id, kind, area: sh.area, elongation: r3(sh.elongation), solidity: r3(sh.solidity), compactness: r3(sh.compactness),
      length: r3(sh.lengthAxis), width: r3(sh.widthAxis), angle: Math.round(sh.angle),
      level: r3(L.level), maxDepth: r3(Math.max(...depths)), meanDepth: r3(mean(depths)), rimRelief: r3(relief), rimSteepShare: r3(rimSteep / Math.max(1, rimN)),
      zone: r3(zoneMean), mountainTerm: r3(mtnTerm), depressionCells: depSize, truncated: depSize > cells.length,
      inflowRivers: inflows, outlet: L.outlet, outletIsRiver: L.outlet >= 0 ? hydro.river[L.outlet] === 1 : false,
      outletAcc: L.outlet >= 0 ? Math.round(hydro.acc[L.outlet]) : 0,
      renderedAreaRatio: r3(rArea / (U * U) / sh.area), renderedSolidity: rSh ? r3(rSh.solidity) : null, renderedElongation: rSh ? r3(rSh.elongation) : null,
      cx: r3(sh.cx), cy: r3(sh.cy),
    };
  });

  // ---------- Rivers ----------
  const thr = hydro.riverThreshold;
  const donorsOf: number[][] = Array.from({ length: N }, () => []);
  for (let c = 0; c < N; c++) { const r = hydro.receiver[c]; if (r >= 0) donorsOf[r].push(c); }
  // Strahler order on the river network.
  const order = new Uint8Array(N);
  for (let k = hydro.order.length - 1; k >= 0; k--) {
    const c = hydro.order[k];
    if (!hydro.river[c]) continue;
    let mx = 0, cnt = 0;
    for (const d of donorsOf[c]) if (hydro.river[d]) { if (order[d] > mx) { mx = order[d]; cnt = 1; } else if (order[d] === mx) cnt++; }
    order[c] = mx === 0 ? 1 : cnt >= 2 ? mx + 1 : mx;
  }
  const z1Width = (acc: number) => Z1_PX_PER_CELL * RIVER_FAR_SCALE * Math.min(0.34, 0.035 + 0.032 * Math.sqrt(acc / thr));
  let occStamp = 0, occMist = 0, rcells = 0, occStampW = 0, occMistW = 0, totW = 0;
  const riverCellInfo: { x: number; y: number; ratio: number; order: number; occluded: boolean }[] = [];
  for (let c = 0; c < N; c++) {
    if (!hydro.river[c]) continue;
    rcells++;
    const px = (c % n) + 0.5, py = Math.floor(c / n) + 0.5;
    const ws = Math.sqrt(hydro.acc[c] / thr);
    totW += ws;
    const st = composition.stamps.some((s) => stampCovers(s, px, py));
    const mi = !st && mistCovers(world, px, py);
    if (st) { occStamp++; occStampW += ws; }
    if (mi) { occMist++; occMistW += ws; }
    riverCellInfo.push({ x: px, y: py, ratio: hydro.acc[c] / thr, order: order[c], occluded: st || mi });
  }
  const paths = hydro.rivers.map((r) => {
    const s = r.cells[0], e = r.cells[r.cells.length - 1];
    const fromLake = donorsOf[s].some((d) => hydro.lakeId[d] > 0);
    const end = hydro.sea[e] ? 'sea' : hydro.lakeId[e] ? 'lake' : hydro.river[e] && r.cells.length > 1 && hydro.receiver[r.cells[r.cells.length - 2]] === e && !(hydro.receiver[e] < 0) ? 'junction' : hydro.receiver[e] < 0 ? 'mapEdge' : 'other';
    const last = r.cells.filter((c) => hydro.river[c]);
    const maxAcc = Math.max(...last.map((c) => hydro.acc[c]));
    const ratio = maxAcc / thr;
    const ex = (e % n) + 0.5, ey = Math.floor(e / n) + 0.5;
    const endInRenderedWater = end === 'sea' || end === 'lake' ? sdAt(ex, ey) < 0 : null;
    // Distance from the end point back along the path to rendered water (gap length in cells).
    let gap = 0;
    if (end === 'lake' || end === 'sea') {
      for (let k = r.cells.length - 1; k >= 0; k--) {
        const c = r.cells[k];
        if (sdAt((c % n) + 0.5, Math.floor(c / n) + 0.5) >= 0) break;
        gap--; // negative: path runs into water already
      }
      const sdEnd = sdAt(ex, ey);
      gap = sdEnd > 0 ? sdEnd : 0;
    }
    return {
      len: r.cells.length, start: fromLake ? 'lakeOutflow' : 'source', end, ratio: r3(ratio),
      order: Math.max(...last.map((c) => order[c])), stream: ratio < 2.95, z1MaxWidthPx: r3(z1Width(maxAcc)),
      endInRenderedWater, gapToWaterCells: r3(gap),
      startAccRatio: r3(hydro.acc[s] / thr),
    };
  });
  const byEnd: Record<string, number> = {}, byStart: Record<string, number> = {}, byOrder: Record<string, number> = {};
  for (const p of paths) { byEnd[p.end] = (byEnd[p.end] ?? 0) + 1; byStart[p.start] = (byStart[p.start] ?? 0) + 1; byOrder[p.order] = (byOrder[p.order] ?? 0) + 1; }
  // Where the land drains: share of land cells whose basin root is the sea vs a land cell on the map border.
  let toSea = 0, toEdge = 0;
  for (let c = 0; c < N; c++) { if (hydro.sea[c]) continue; const b = hydro.basinId[c]; if (b >= 0 && hydro.sea[b]) toSea++; else toEdge++; }
  let bigRoot = -1, bigAcc = 0;
  for (let c = 0; c < N; c++) if (!hydro.sea[c] && hydro.receiver[c] >= 0 && hydro.sea[hydro.receiver[c]] && hydro.acc[c] > bigAcc) { bigAcc = hydro.acc[c]; bigRoot = c; }
  let bigEdge = 0;
  for (let c = 0; c < N; c++) if (!hydro.sea[c] && hydro.receiver[c] < 0 && hydro.acc[c] > bigEdge) bigEdge = hydro.acc[c];
  const rivers = {
    drainageToSea: r3(toSea / land), drainageOffMapEdge: r3(toEdge / land), largestSeaMouthAcc: Math.round(bigAcc), largestEdgeExitAcc: Math.round(bigEdge),
    threshold: thr, paths: paths.length, riverCells: rcells, byStart, byEnd, byOrder,
    maxOrder: Math.max(0, ...paths.map((p) => p.order)),
    streams: paths.filter((p) => p.stream).length,
    widthPxZ1: { p50: r3(median(paths.map((p) => p.z1MaxWidthPx))), max: r3(Math.max(...paths.map((p) => p.z1MaxWidthPx))), capped: paths.filter((p) => p.ratio >= 95).length },
    lakeOutflowStartsTapered: paths.filter((p) => p.start === 'lakeOutflow').length,
    mouthGaps: paths.filter((p) => (p.end === 'lake' || p.end === 'sea') && p.gapToWaterCells > 0.3).length,
    mouthGapMax: r3(Math.max(0, ...paths.map((p) => p.gapToWaterCells))),
    occludedByStampShare: r3(occStamp / Math.max(1, rcells)), occludedByMistShare: r3(occMist / Math.max(1, rcells)),
    occludedFlowWeighted: r3((occStampW + occMistW) / Math.max(1e-9, totW)),
  };

  // ---------- Mountains ----------
  const st = composition.stamps;
  const roles: Record<string, number> = {};
  for (const s of st) roles[s.role] = (roles[s.role] ?? 0) + 1;
  const sizeOf = (s: typeof st[number]) => logic[s.key].footprint[0] * s.scale;
  const clusterStats = ridges.clusters.map((cl) => {
    const ss = st.filter((s) => s.clusterId === cl.id && s.key !== 'hill');
    const ridgeCells: number[] = [];
    for (const p of cl.paths) for (const c of ridges.paths[p]) ridgeCells.push(c);
    if (ss.length < 5 || ridgeCells.length < 5) return null;
    const rs = shape(pts([...new Set(ridgeCells)], n));
    const sp = shape(ss.map((s) => [Math.floor(s.x), Math.floor(s.y)] as Pt));
    const main = ss.find((s) => s.role === 'main');
    const others = ss.filter((s) => s !== main);
    // Hierarchy: does size fall off with distance from the main peak? Spearman rank correlation.
    let rho = NaN;
    if (main && others.length >= 4) {
      const d = others.map((s) => Math.hypot(s.x - main.x, s.y - main.y)), z = others.map(sizeOf);
      const rank = (a: number[]) => { const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = new Array(a.length); idx.forEach(([, i], k) => (r[i] = k)); return r; };
      const rd = rank(d), rz = rank(z);
      const m = (others.length - 1) / 2;
      let num = 0, da = 0, db = 0;
      for (let i = 0; i < others.length; i++) { num += (rd[i] - m) * (rz[i] - m); da += (rd[i] - m) ** 2; db += (rz[i] - m) ** 2; }
      rho = num / Math.sqrt(da * db);
    }
    let dAng = Math.abs(rs.angle - sp.angle) % 180; if (dAng > 90) dAng = 180 - dAng;
    const sizes = ss.map(sizeOf).sort((a, b) => b - a);
    return {
      id: cl.id, stamps: ss.length, peaks: cl.peaks.length,
      ridgeElongation: r3(rs.elongation), stampElongation: r3(sp.elongation), axisDiffDeg: Math.round(dAng),
      mainToMedianSize: main ? r3(sizeOf(main) / median(others.map(sizeOf))) : null,
      top2Ratio: sizes.length > 1 ? r3(sizes[0] / sizes[1]) : null,
      sizeVsDistanceRho: Number.isNaN(rho) ? null : r3(rho),
    };
  }).filter((x) => x !== null);
  const nnCv = (role: string) => {
    const ss = st.filter((s) => s.role === role);
    if (ss.length < 6) return null;
    const d = ss.map((a) => Math.min(...ss.filter((b) => b !== a).map((b) => Math.hypot(a.x - b.x, a.y - b.y))));
    const m = mean(d);
    return { n: ss.length, meanNN: r3(m), cv: r3(Math.sqrt(mean(d.map((v) => (v - m) ** 2))) / m) };
  };
  // Mountain-level land under a stamp footprint, and stamps on low ground.
  const under = new Uint8Array(N);
  for (const s of st) {
    const fp = logic[s.key].footprint;
    const x0 = Math.floor(s.x - fp[0] * s.scale / 2), x1 = Math.ceil(s.x + fp[0] * s.scale / 2);
    const y0 = Math.floor(s.y - fp[1] * s.scale * 0.75), y1 = Math.ceil(s.y + fp[1] * s.scale * 0.25);
    for (let y = Math.max(0, y0); y < Math.min(n, y1); y++) for (let x = Math.max(0, x0); x < Math.min(n, x1); x++) under[y * n + x] = 1;
  }
  let mtnUnder = 0;
  for (let i = 0; i < N; i++) if (isMtn[i] && under[i]) mtnUnder++;
  let lakeOcc = 0, lakeTot = 0;
  for (let c = 0; c < N; c++) {
    if (!hydro.lakeId[c]) continue;
    lakeTot++;
    const px = (c % n) + 0.5, py = Math.floor(c / n) + 0.5;
    if (st.some((s) => stampCovers(s, px, py))) lakeOcc++;
  }
  const keysUsed = new Set(st.map((s) => `${s.key}#${s.variant}`)).size;
  const mountains = {
    stamps: st.length, roles,
    shareFromRidgeGraph: r3(((roles.main ?? 0) + (roles.shoulder ?? 0) + (roles.guest ?? 0) + (roles.ridge ?? 0)) / st.length),
    shareLatticeFill: r3(((roles.massif ?? 0) + (roles.hill ?? 0)) / st.length),
    distinctArt: keysUsed,
    clusters: clusterStats,
    rangesWithClearMain: clusterStats.filter((c) => (c.top2Ratio ?? 0) >= 1.25).length,
    massifNN: nnCv('massif'), hillNN: nnCv('hill'), ridgeNN: nnCv('ridge'),
    mountainLandUnderStamp: r3(mtnUnder / Math.max(1, cls.mountain)),
    stampsOnLowland: st.filter((s) => H[Math.min(n - 1, Math.floor(s.y)) * n + Math.min(n - 1, Math.floor(s.x))] < cfg.hillLevel - 0.06).length,
    lakeCellsCoveredByStampArt: r3(lakeOcc / Math.max(1, lakeTot)),
  };

  report.push({ seed, seaSide: world.seaSide, terrain, lakes, rivers, riverPaths: paths, mountains });

  // ---------- Overlays ----------
  const S = 6, PW = n * S;
  // (1) Hydrology: Strahler-coloured rivers, sources, mouths, lake kinds and outlets, flats, rendered lake edge.
  {
    const im = img(PW, PW);
    const lakeCol: Record<string, number[]> = { mountain: [150, 90, 200], valley: [60, 140, 220], plain: [60, 190, 170] };
    const kindOf = new Map(lakes.map((l) => [l.id, l.kind]));
    reliefBase(world, S, im, 0, (c) => (hydro.lakeId[c] ? lakeCol[kindOf.get(hydro.lakeId[c])!] : null));
    // Flats (filled but not open water): marsh rims, cut depressions.
    for (let c = 0; c < N; c++) {
      if (hydro.sea[c] || hydro.lakeId[c] || hydro.filled[c] - H[c] <= 0.002) continue;
      const x = (c % n) * S, y = Math.floor(c / n) * S;
      for (let k = 0; k < S; k += 2) put(im, x + k, y + k, [230, 150, 40]);
    }
    // Rendered water edge (where the shader draws the lake shore) in black.
    for (let y = 1; y < PW - 1; y++) for (let x = 1; x < PW - 1; x++) {
      const fx = (x + 0.5) / S, fy = (y + 0.5) / S;
      const a = sdAt(fx, fy) < 0, b = sdAt(fx + 1 / S, fy) < 0, d = sdAt(fx, fy + 1 / S) < 0;
      if (a !== b || a !== d) put(im, x, y, [20, 20, 20], 0.8);
    }
    const ordCol = [[0, 0, 0], [120, 170, 255], [40, 110, 240], [10, 50, 200], [120, 0, 160], [200, 0, 80], [200, 0, 0]];
    for (const r of hydro.rivers) for (let k = 1; k < r.cells.length; k++) {
      const a = r.cells[k - 1], b = r.cells[k];
      const o = Math.min(6, order[a] || 1);
      line(im, ((a % n) + 0.5) * S, (Math.floor(a / n) + 0.5) * S, ((b % n) + 0.5) * S, (Math.floor(b / n) + 0.5) * S, ordCol[o], o >= 3 ? 3 : o === 2 ? 2 : 1);
    }
    paths.forEach((p, i) => {
      const r = hydro.rivers[i];
      const s = r.cells[0], e = r.cells[r.cells.length - 1];
      const sx = ((s % n) + 0.5) * S, sy = (Math.floor(s / n) + 0.5) * S, ex = ((e % n) + 0.5) * S, ey = (Math.floor(e / n) + 0.5) * S;
      if (p.start === 'source') disc(im, sx, sy, 2, [0, 160, 0]); else disc(im, sx, sy, 3, [240, 120, 0]);
      if (p.end === 'mapEdge') disc(im, ex, ey, 3, [230, 0, 0]);
      if ((p.end === 'lake' || p.end === 'sea') && p.gapToWaterCells > 0.3) ring(im, ex, ey, 6, [230, 0, 0]);
    });
    for (const L of hydro.lakes) if (L.outlet >= 0) { const o = L.outlet; ring(im, ((o % n) + 0.5) * S, (Math.floor(o / n) + 0.5) * S, 4, [255, 255, 0]); }
    writeFileSync(join(outDir, `${seed}_hydro.png`), encodePng(im.d, im.w, im.h));
  }
  // (2) Composition: stamps by role over relief, ridge paths, mountain masses with principal axis.
  {
    const im = img(PW, PW);
    reliefBase(world, S, im, 0, (c) => (hydro.lakeId[c] ? [80, 140, 210] : null));
    for (const p of ridges.paths) for (let k = 1; k < p.length; k++) {
      const a = p[k - 1], b = p[k];
      line(im, ((a % n) + 0.5) * S, (Math.floor(a / n) + 0.5) * S, ((b % n) + 0.5) * S, (Math.floor(b / n) + 0.5) * S, [180, 30, 30], 2, 0.7);
    }
    for (const r of hydro.rivers) for (let k = 1; k < r.cells.length; k++) {
      const a = r.cells[k - 1], b = r.cells[k];
      line(im, ((a % n) + 0.5) * S, (Math.floor(a / n) + 0.5) * S, ((b % n) + 0.5) * S, (Math.floor(b / n) + 0.5) * S, [30, 90, 220], 1, 0.8);
    }
    const roleCol: Record<string, number[]> = { main: [220, 0, 0], shoulder: [240, 120, 0], guest: [240, 200, 0], ridge: [130, 40, 160], massif: [20, 130, 60], hill: [120, 120, 120] };
    for (const s of st) {
      const c = roleCol[s.role];
      const rad = Math.max(2, Math.round(sizeOf(s) * S * 0.18));
      if (s.role === 'hill') disc(im, s.x * S, s.y * S, 2, c, 0.8); else { disc(im, s.x * S, s.y * S, rad, c, 0.35); ring(im, s.x * S, s.y * S, rad, c); }
    }
    for (let k = 0; k < Math.min(4, mtnComps.length); k++) {
      const sh = mtnShapes[k];
      const a = sh.angle * Math.PI / 180, L = sh.lengthAxis / 2 * S;
      line(im, sh.cx * S - Math.cos(a) * L, sh.cy * S - Math.sin(a) * L, sh.cx * S + Math.cos(a) * L, sh.cy * S + Math.sin(a) * L, [0, 0, 0], 3, 0.6);
    }
    writeFileSync(join(outDir, `${seed}_mountains.png`), encodePng(im.d, im.w, im.h));
  }
  // (3) Lake origin: which terrain term carved the depression (zone mask and ridged term).
  {
    const im = img(PW * 2 + 8, PW);
    for (let panel = 0; panel < 2; panel++) {
      const ox = panel * (PW + 8);
      for (let y = 0; y < PW; y++) for (let x = 0; x < PW; x++) {
        const c = Math.floor(y / S) * n + Math.floor(x / S);
        let col: number[];
        if (hydro.sea[c]) col = [200, 210, 220];
        else if (panel === 0) { const z = parts.zone[c]; col = [255 - 150 * z, 255 - 90 * z, 255 - 150 * z]; }
        else { const v = parts.mountains[c] / 0.62; col = [255 - 200 * v, 255 - 170 * v, 255 - 120 * v]; }
        put(im, ox + x, y, col);
      }
      for (let y = 1; y < PW - 1; y++) for (let x = 1; x < PW - 1; x++) {
        const c = Math.floor(y / S) * n + Math.floor(x / S), c2 = Math.floor(y / S) * n + Math.floor((x + 1) / S), c3 = Math.floor((y + 1) / S) * n + Math.floor(x / S);
        if ((hydro.lakeId[c] > 0) !== (hydro.lakeId[c2] > 0) || (hydro.lakeId[c] > 0) !== (hydro.lakeId[c3] > 0)) put(im, ox + x, y, [0, 60, 200]);
        if ((deepAll[c] > 0) !== (deepAll[c2] > 0) || (deepAll[c] > 0) !== (deepAll[c3] > 0)) put(im, ox + x, y, [230, 120, 0], 0.7);
      }
    }
    writeFileSync(join(outDir, `${seed}_lakeorigin.png`), encodePng(im.d, im.w, im.h));
  }
  // River cell samples for the screenshot contrast measurement (scripts/analysis/measure_shots.py).
  writeFileSync(join(outDir, `${seed}_samples.json`), JSON.stringify({
    rivers: riverCellInfo,
    landClass: Array.from({ length: N }, (_, i) => (hydro.sea[i] ? -1 : hydro.lakeId[i] ? -2 : H[i] < cfg.hillLevel - 0.14 ? 0 : H[i] < cfg.hillLevel ? 1 : H[i] < cfg.mountainLevel ? 2 : 3)),
    covered: Array.from({ length: N }, (_, i) => { const px = (i % n) + 0.5, py = Math.floor(i / n) + 0.5; return st.some((s) => stampCovers(s, px, py)) || mistCovers(world, px, py) ? 1 : 0; }),
    lakeId: Array.from(hydro.lakeId),
  }));
  console.log(seed, JSON.stringify({ lakes: lakes.length, rivers: rivers.byEnd, stamps: st.length }));
}
writeFileSync(join(outDir, 'analysis.json'), JSON.stringify(report, null, 1));
