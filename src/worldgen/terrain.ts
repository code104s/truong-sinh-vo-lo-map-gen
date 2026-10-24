// Heightmap: fBm base + ridged ranges inside a low-frequency mountain mask, domain warped,
// with one map side forced to sea. Output is normalised to [0, 1] and stored as float32.
import { createSimplex2D, fbm, ridged, smoothstep } from '../core/noise';
import { rngFor } from '../core/rng';
import type { WorldConfig } from './config';

export interface TerrainResult {
  height: Float32Array;
  /** 0 = north, 1 = east, 2 = south, 3 = west: the side the sea comes from. */
  seaSide: number;
}

export function generateTerrain(seed: string, cfg: WorldConfig): TerrainResult {
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
  const raw = new Float64Array(n * n);
  let lo = Infinity, hi = -Infinity;

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = x / n, v = y / n;
      const wx = u + 0.11 * fbm(nWarpX, ox + u * 2.3, oy + v * 2.3, 3);
      const wy = v + 0.11 * fbm(nWarpY, ox + u * 2.3 + 17, oy + v * 2.3 + 31, 3);

      const base = 0.5 + 0.5 * fbm(nBase, ox + wx * 2.4, oy + wy * 2.4, 5, 2, 0.45);
      const zone = smoothstep(0.38, 0.72, 0.5 + 0.5 * fbm(nMask, ox + wx * 1.3, oy + wy * 1.3, 3));
      const r = ridged(nRidge, ox + wx * 2.6, oy + wy * 2.6, 5);
      // Massif = broad uplift inside the zone, crests sharpened by the ridged term.
      // Keep ranges off the map border so the map frame never slices a massif.
      const edge = smoothstep(0, 0.14, Math.min(u, v, 1 - u, 1 - v));
      const mountains = zone * edge * (0.12 + 0.88 * r * r * (0.5 + 0.5 * r));

      // Distance from the sea side, 0 at that edge and 1 at the opposite edge.
      const d = seaSide === 0 ? v : seaSide === 1 ? 1 - u : seaSide === 2 ? 1 - v : u;
      const coast = d + 0.16 * fbm(nCoast, ox + u * 2.7, oy + v * 2.7, 4);
      const land = smoothstep(0.12, 0.38, coast);
      // Gentle tilt towards the sea keeps inland basins (and lakes) rare.
      const tilt = 0.22 * smoothstep(0.1, 0.9, coast);

      const h = (0.12 + 0.2 * base + tilt + 0.62 * mountains) * (0.2 + 0.8 * land);
      raw[y * n + x] = h;
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
  }

  const height = new Float32Array(n * n);
  const span = hi - lo || 1;
  for (let i = 0; i < raw.length; i++) height[i] = (raw[i] - lo) / span;
  return { height, seaSide };
}
