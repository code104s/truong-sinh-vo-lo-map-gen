// Analysis only: counterfactual terrains to test which term causes a symptom. Each variant
// recombines the terrain terms differently and re-runs the unchanged hydrology on it.
//   npx vite-node scripts/analysis/whatif.ts
import { DEFAULT_CONFIG } from '../../src/worldgen/config';
import { generateHydrology } from '../../src/worldgen/hydrology';
import { terrainParts } from './terrain-parts';

const cfg = DEFAULT_CONFIG, n = cfg.size, N = n * n;
const blur = (a: Float32Array, r: number) => {
  let src = a;
  for (let pass = 0; pass < 2; pass++) {
    const out = new Float32Array(N);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      let s = 0, k = 0;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const xx = Math.min(n - 1, Math.max(0, x + dx)), yy = Math.min(n - 1, Math.max(0, y + dy));
        s += src[yy * n + xx]; k++;
      }
      out[y * n + x] = s / k;
    }
    src = out;
  }
  return src;
};
function shapeOdd(cells: number[]): boolean {
  const A = cells.length;
  let mx = 0, my = 0;
  for (const c of cells) { mx += c % n; my += Math.floor(c / n); }
  mx /= A; my /= A;
  let sxx = 1 / 12, syy = 1 / 12, sxy = 0;
  for (const c of cells) { const x = c % n - mx, y = Math.floor(c / n) - my; sxx += x * x / A; syy += y * y / A; sxy += x * y / A; }
  const tr = sxx + syy, det = sxx * syy - sxy * sxy, d = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  return Math.sqrt((tr / 2 + d) / (tr / 2 - d)) >= 2.2;
}
type Variant = (p: ReturnType<typeof terrainParts>) => Float32Array;
const recombine = (p: ReturnType<typeof terrainParts>, base: Float32Array, tilt: Float32Array, mtn: Float32Array) => {
  const raw = new Float32Array(N);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < N; i++) { raw[i] = (0.12 + base[i] + tilt[i] + mtn[i]) * (0.2 + 0.8 * p.land[i]); lo = Math.min(lo, raw[i]); hi = Math.max(hi, raw[i]); }
  for (let i = 0; i < N; i++) raw[i] = (raw[i] - lo) / (hi - lo);
  return raw;
};
const variants: Record<string, Variant> = {
  baseline: (p) => recombine(p, p.base, p.tilt, p.mountains),
  // Crest network of the ridged term softened: tests whether lakes are basins between crests.
  softCrests: (p) => recombine(p, p.base, p.tilt, blur(p.mountains, 2)),
  // Mountains only (no fBm detail on the plains): tests whether plain lakes come from base fBm.
  smoothBase: (p) => recombine(p, blur(p.base, 3), p.tilt, p.mountains),
  bothSmooth: (p) => recombine(p, blur(p.base, 3), p.tilt, blur(p.mountains, 2)),
  // Twice the seaward tilt: tests whether a stronger regional slope sends rivers to the sea.
  strongTilt: (p) => { const t = new Float32Array(N); for (let i = 0; i < N; i++) t[i] = p.tilt[i] * 2; return recombine(p, p.base, t, p.mountains); },
  // Tilt keeps rising inland instead of flattening at coast > 0.9: tests drainage off the inland border.
  linearTilt: (p) => {
    const t = new Float32Array(N);
    for (let i = 0; i < N; i++) t[i] = p.tilt[i] + 0.12 * Math.max(0, p.tilt[i] / 0.22 - 0.5);
    return recombine(p, p.base, t, p.mountains);
  },
};
const rows: Record<string, { lakes: number; odd: number; lakeCells: number; toSea: number }> = {};
for (const name of Object.keys(variants)) rows[name] = { lakes: 0, odd: 0, lakeCells: 0, toSea: 0 };
for (let k = 1; k <= 20; k++) {
  const seed = `tsvl-${String(k).padStart(2, '0')}`;
  const p = terrainParts(seed, cfg);
  for (const [name, fn] of Object.entries(variants)) {
    const hy = generateHydrology(seed, fn(p), cfg);
    const cells = new Map<number, number[]>();
    for (let i = 0; i < N; i++) if (hy.lakeId[i]) { const l = cells.get(hy.lakeId[i]) ?? []; l.push(i); cells.set(hy.lakeId[i], l); }
    let land = 0, sea = 0;
    for (let i = 0; i < N; i++) if (!hy.sea[i]) { land++; if (hy.sea[hy.basinId[i]]) sea++; }
    const r = rows[name];
    r.lakes += hy.lakes.length; r.lakeCells += [...cells.values()].reduce((s, c) => s + c.length, 0);
    r.odd += [...cells.values()].filter(shapeOdd).length; r.toSea += sea / land / 20;
  }
}
for (const [name, r] of Object.entries(rows)) console.log(name.padEnd(11), `lakes ${r.lakes}`, `elongated(>=2.2) ${r.odd}`, `lakeCells ${r.lakeCells}`, `drainageToSea ${r.toSea.toFixed(3)}`);
