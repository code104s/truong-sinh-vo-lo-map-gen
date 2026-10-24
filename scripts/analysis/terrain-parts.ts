// Analysis only: re-runs generateTerrain step by step and keeps the intermediate fields so a
// feature (lake, flat, range) can be traced back to the noise term that made it. Must stay in
// sync with src/worldgen/terrain.ts; checkSame() asserts that the recombined height is identical.
import { createSimplex2D, fbm, ridged, smoothstep } from '../../src/core/noise';
import { rngFor } from '../../src/core/rng';
import type { WorldConfig } from '../../src/worldgen/config';

export interface TerrainParts {
  base: Float32Array;      // 0.2 * base fBm term
  tilt: Float32Array;      // tilt towards the sea
  mountains: Float32Array; // 0.62 * mountain term
  zone: Float32Array;      // low-frequency mountain mask (0..1)
  ridgedR: Float32Array;   // raw ridged noise r
  land: Float32Array;      // coast mask
  height: Float32Array;    // normalised, as generateTerrain
}

export function terrainParts(seed: string, cfg: WorldConfig): TerrainParts {
  const rng = rngFor(seed, 'terrain');
  const nWarpX = createSimplex2D(rng);
  const nWarpY = createSimplex2D(rng);
  const nBase = createSimplex2D(rng);
  const nMask = createSimplex2D(rng);
  const nRidge = createSimplex2D(rng);
  const nCoast = createSimplex2D(rng);
  const seaSide = rng.int(4);
  const ox = rng.range(0, 100), oy = rng.range(0, 100);
  const n = cfg.size;
  const mk = () => new Float32Array(n * n);
  const P = { base: mk(), tilt: mk(), mountains: mk(), zone: mk(), ridgedR: mk(), land: mk(), height: mk() };
  const raw = new Float64Array(n * n);
  let lo = Infinity, hi = -Infinity;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = x / n, v = y / n;
    const wx = u + 0.11 * fbm(nWarpX, ox + u * 2.3, oy + v * 2.3, 3);
    const wy = v + 0.11 * fbm(nWarpY, ox + u * 2.3 + 17, oy + v * 2.3 + 31, 3);
    const base = 0.5 + 0.5 * fbm(nBase, ox + wx * 2.4, oy + wy * 2.4, 5, 2, 0.45);
    const zone = smoothstep(0.38, 0.72, 0.5 + 0.5 * fbm(nMask, ox + wx * 1.3, oy + wy * 1.3, 3));
    const r = ridged(nRidge, ox + wx * 2.6, oy + wy * 2.6, 5);
    const edge = smoothstep(0, 0.14, Math.min(u, v, 1 - u, 1 - v));
    const mountains = zone * edge * (0.12 + 0.88 * r * r * (0.5 + 0.5 * r));
    const d = seaSide === 0 ? v : seaSide === 1 ? 1 - u : seaSide === 2 ? 1 - v : u;
    const coast = d + 0.16 * fbm(nCoast, ox + u * 2.7, oy + v * 2.7, 4);
    const land = smoothstep(0.12, 0.38, coast);
    const tilt = 0.22 * smoothstep(0.1, 0.9, coast);
    const h = (0.12 + 0.2 * base + tilt + 0.62 * mountains) * (0.2 + 0.8 * land);
    const i = y * n + x;
    P.base[i] = 0.2 * base; P.tilt[i] = tilt; P.mountains[i] = 0.62 * mountains; P.zone[i] = zone * edge;
    P.ridgedR[i] = r; P.land[i] = land;
    raw[i] = h;
    if (h < lo) lo = h;
    if (h > hi) hi = h;
  }
  const span = hi - lo || 1;
  for (let i = 0; i < raw.length; i++) P.height[i] = (raw[i] - lo) / span;
  return P;
}
