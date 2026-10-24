// Renderer-side fields derived from WorldData: an upsampled signed distance to water, smoothed
// height and hillshade, packed into one RGB texture for the terrain shader. Not part of the
// determinism contract (visual only), so trig and pow are allowed here.
import type { WorldData } from '../worldgen/index';

export const FIELD_UPSAMPLE = 4;
/** Cells represented by the full range of the SDF channel: d = (r - 0.5) * SDF_RANGE. */
export const SDF_RANGE = 16;

export interface FieldImage {
  width: number;
  height: number;
  /** R: coarse signed distance, G: height, B: hillshade. */
  rgba: Uint8ClampedArray<ArrayBuffer>;
  /** Signed distance as 16 bits (R high byte, G low byte): 8 bits alone band the coast at Z3. */
  sdf: Uint8ClampedArray<ArrayBuffer>;
}

function cubic(p0: number, p1: number, p2: number, p3: number, t: number): number {
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
}

function sampleBicubic(src: Float32Array, n: number, x: number, y: number): number {
  const x1 = Math.floor(x), y1 = Math.floor(y);
  const tx = x - x1, ty = y - y1;
  const at = (xx: number, yy: number) => src[Math.min(n - 1, Math.max(0, yy)) * n + Math.min(n - 1, Math.max(0, xx))];
  const rows: number[] = [];
  for (let j = -1; j <= 2; j++) {
    rows.push(cubic(at(x1 - 1, y1 + j), at(x1, y1 + j), at(x1 + 1, y1 + j), at(x1 + 2, y1 + j), tx));
  }
  return cubic(rows[0], rows[1], rows[2], rows[3], ty);
}

function blur3(src: Float32Array, n: number): Float32Array {
  const out = new Float32Array(n * n);
  const k = [1, 2, 1];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let sum = 0, wsum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(n - 1, Math.max(0, x + dx)), yy = Math.min(n - 1, Math.max(0, y + dy));
          const wgt = k[dx + 1] * k[dy + 1];
          sum += src[yy * n + xx] * wgt;
          wsum += wgt;
        }
      }
      out[y * n + x] = sum / wsum;
    }
  }
  return out;
}

/** 1D squared distance transform (Felzenszwalb & Huttenlocher) of f into d. */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Exact Euclidean distance (in pixels) to the nearest `true` pixel. */
function edt(mask: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e20;
  const grid = new Float64Array(w * h);
  for (let i = 0; i < grid.length; i++) grid[i] = mask[i] ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), z = new Float64Array(n + 1);
  const v = new Int32Array(n);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) grid[y * w + x] = d[x];
  }
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = Math.sqrt(grid[i]);
  return out;
}

export function buildFieldImage(world: WorldData): FieldImage {
  const n = world.config.size;
  const U = FIELD_UPSAMPLE, N = n * U;
  const { hydro } = world;

  const water = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) water[i] = hydro.sea[i] || hydro.lakeId[i] ? 1 : 0;
  // Two light blur passes round off cell-scale stair steps before the coast is thresholded.
  const smoothWater = blur3(blur3(water, n), n);

  const wUp = new Float32Array(N * N);
  const wMask = new Uint8Array(N * N);
  const lMask = new Uint8Array(N * N);
  const hUp = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      // Sample at the centre of the fine pixel, in cell coordinates relative to cell centres.
      const cx = (x + 0.5) / U - 0.5, cy = (y + 0.5) / U - 0.5;
      const wv = sampleBicubic(smoothWater, n, cx, cy);
      const i = y * N + x;
      wUp[i] = wv;
      if (wv >= 0.5) wMask[i] = 1;
      else lMask[i] = 1;
      hUp[i] = sampleBicubic(hydro.height, n, cx, cy);
    }
  }
  const toWater = edt(wMask, N, N);
  const toLand = edt(lMask, N, N);

  const rgba = new Uint8ClampedArray(N * N * 4);
  const sdf = new Uint8ClampedArray(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      // Signed distance in cells: positive on land. The transform of a binary mask snaps the
      // zero line to pixel edges (a saw-tooth coast at Z3), so near the shore the distance comes
      // from the continuous water field instead: d ≈ (0.5 - w) / |∇w|.
      let sdPx = wMask[i] ? -(toLand[i] - 0.5) : toWater[i] - 0.5;
      if (Math.abs(sdPx) < 3) {
        const gx = (wUp[y * N + Math.min(N - 1, x + 1)] - wUp[y * N + Math.max(0, x - 1)]) / 2;
        const gy = (wUp[Math.min(N - 1, y + 1) * N + x] - wUp[Math.max(0, y - 1) * N + x]) / 2;
        const g = Math.sqrt(gx * gx + gy * gy);
        if (g > 1e-4) {
          const est = (0.5 - wUp[i]) / g;
          const t = Math.max(0, Math.min(1, (Math.abs(sdPx) - 1.5) / 1.5));
          sdPx = est * (1 - t) + sdPx * t;
        }
      }
      const sd = sdPx / U;
      const r = 0.5 + sd / SDF_RANGE;
      // Hillshade, light from the north-west.
      const xl = Math.max(0, x - 1), xr = Math.min(N - 1, x + 1);
      const yu = Math.max(0, y - 1), yd = Math.min(N - 1, y + 1);
      const dzdx = (hUp[y * N + xr] - hUp[y * N + xl]) * n * 2.2;
      const dzdy = (hUp[yd * N + x] - hUp[yu * N + x]) * n * 2.2;
      const len = Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
      const shade = (-dzdx * -0.62 + -dzdy * -0.62 + 0.48) / len;
      rgba[i * 4] = Math.round(Math.min(1, Math.max(0, r)) * 255);
      const q = Math.round(Math.min(1, Math.max(0, r)) * 65535);
      sdf[i * 4] = q >> 8;
      sdf[i * 4 + 1] = q & 255;
      sdf[i * 4 + 3] = 255;
      rgba[i * 4 + 1] = Math.round(Math.min(1, Math.max(0, hUp[i])) * 255);
      rgba[i * 4 + 2] = Math.round(Math.min(1, Math.max(0, 0.5 + 0.5 * shade)) * 255);
      rgba[i * 4 + 3] = 255;
    }
  }
  return { width: N, height: N, rgba, sdf };
}
