// Procedural ink-wash placeholders, painted with Canvas2D and uploaded as textures.
// Each (key, variant) is painted once from its own seeded stream, so the same variant always
// looks the same. Real PNG/WebP art replaces these through the manifest without code changes.
import { createSimplex2D, type Noise2D } from '../core/noise';
import { rngFor, type Rng } from '../core/rng';
import type { AssetEntry, Manifest } from '../assets/manifestTypes';

/** Texture pixels per cell. Z3 renders at 64 px per cell; brush texture survives the upscale, and painting stays fast. */
export const ART_PX_PER_CELL = 44;

interface Ink {
  ink: string[];
  paper: string;
  indigo: string;
  green: string;
  ochre: string;
}

function rgba(hex: string, a: number): string {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

function range(params: Record<string, unknown>, key: string, fallback: [number, number]): [number, number] {
  const v = params[key];
  return Array.isArray(v) && v.length === 2 ? [Number(v[0]), Number(v[1])] : fallback;
}

interface Profile {
  xs: number[];
  ys: number[];
  /** Peak positions (x, top y) along the profile, highest first. */
  tops: { x: number; y: number; w: number }[];
}

/**
 * Silhouette of 1..k peaks above the ground line `gy`. Each peak is a bell (1 - d²)^steep: rounded
 * crown, flaring foot, the classic shan-shui massif. Rock noise roughens the upper outline.
 */
function makeProfile(rng: Rng, noise: Noise2D, W: number, gy: number, maxH: number, peaks: number, steep: number, rough: number, x0f = 0.03, x1f = 0.97): Profile {
  const x0 = W * x0f, x1 = W * x1f;
  const ps: { x: number; h: number; w: number; skew: number }[] = [];
  for (let i = 0; i < peaks; i++) {
    const main = i === 0;
    ps.push({
      x: main ? rng.range(0.38, 0.62) : rng.range(0.16, 0.84),
      h: main ? 1 : rng.range(0.45, 0.8),
      w: main ? rng.range(0.42, 0.55) : rng.range(0.22, 0.38),
      // Asymmetric flanks: one side steep cliff, the other a long slope.
      skew: rng.range(0.7, 1.35),
    });
  }
  const N = 120;
  const xs: number[] = [], ys: number[] = [];
  for (let k = 0; k <= N; k++) {
    const t = k / N;
    const x = x0 + (x1 - x0) * t;
    let h = 0;
    for (const p of ps) {
      const d = t < p.x ? (t - p.x) / (p.w * p.skew) : (t - p.x) / (p.w / p.skew);
      if (d <= -1 || d >= 1) continue;
      h = Math.max(h, p.h * Math.pow(1 - d * d, steep));
    }
    const edgeFade = Math.min(1, Math.min(t, 1 - t) * 10);
    h += (noise(t * 7, 0.3) * 0.05 + noise(t * 23, 4.1) * 0.02) * rough * edgeFade * Math.min(1, h * 3);
    h = Math.max(0, h) * edgeFade;
    xs.push(x);
    ys.push(gy - h * maxH);
  }
  const tops = ps
    .map((p) => {
      const k = Math.round(p.x * N);
      return { x: xs[k], y: ys[k], w: p.w * (x1 - x0) };
    })
    .sort((a, b) => a.y - b.y);
  return { xs, ys, tops };
}

function silhouette(ctx: CanvasRenderingContext2D, pr: Profile, gy: number): void {
  ctx.beginPath();
  ctx.moveTo(pr.xs[0], gy);
  for (let i = 0; i < pr.xs.length; i++) ctx.lineTo(pr.xs[i], pr.ys[i]);
  ctx.lineTo(pr.xs[pr.xs.length - 1], gy);
  ctx.closePath();
}

/** Profile top y at x, by linear interpolation. */
function topAt(pr: Profile, x: number): number {
  const { xs, ys } = pr;
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) {
      const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
      return ys[i - 1] + (ys[i] - ys[i - 1]) * t;
    }
  }
  return ys[ys.length - 1];
}

/** Outline in short segments of varying width and opacity: a brush that loads and runs dry. */
function brushOutline(ctx: CanvasRenderingContext2D, pr: Profile, noise: Noise2D, ink: string, baseW: number, alpha: number, gy: number, fadeFrom: number): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const n = pr.xs.length;
  const topY = Math.min(...pr.tops.map((p) => p.y));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const hRatio = (gy - pr.ys[i]) / Math.max(1, gy - topY);
    if (hRatio < fadeFrom * 0.5) continue; // the outline dissolves into mist near the ground
    const pressure = 0.5 + 0.5 * noise(t * 8, 1.7);
    if (noise(t * 13, 8.2) < -0.6) continue; // dry-brush gap
    ctx.strokeStyle = rgba(ink, alpha * (0.55 + 0.45 * pressure) * Math.min(1, (hRatio - fadeFrom * 0.5) / Math.max(0.01, fadeFrom)));
    ctx.lineWidth = baseW * (0.45 + pressure) * (0.7 + 0.5 * hRatio);
    ctx.beginPath();
    ctx.moveTo(pr.xs[i - 1], pr.ys[i - 1]);
    ctx.lineTo(pr.xs[i], pr.ys[i]);
    ctx.stroke();
  }
}

/** Paints one massif (body, washes, texture strokes) clipped to its silhouette. */
function paintMass(ctx: CanvasRenderingContext2D, pr: Profile, rng: Rng, noise: Noise2D, pal: Ink, gy: number, s: number, opts: {
  far: boolean; hill: boolean; cun: number; W: number;
}): void {
  const { far, hill, cun, W } = opts;
  const topY = Math.min(...pr.tops.map((p) => p.y));
  const massH = Math.max(1, gy - topY);
  ctx.save();
  silhouette(ctx, pr, gy);
  ctx.clip();

  // Paper body so nearer masses hide farther ones; knolls stay half transparent so they read as
  // a light mark on the ground, not as solid domes.
  ctx.fillStyle = rgba(pal.paper, hill ? 0.45 : 1);
  ctx.fillRect(0, topY - 4, W, massH + 8);

  // Pale colour wash (thiển giáng): blue-green crowns, ochre flanks, bare paper at the foot.
  const g = ctx.createLinearGradient(0, topY, 0, gy);
  if (hill) {
    g.addColorStop(0, rgba(pal.green, 0.3));
    g.addColorStop(0.6, rgba(pal.green, 0.06));
    g.addColorStop(1, rgba(pal.green, 0));
  } else {
    g.addColorStop(0, rgba(pal.indigo, far ? 0.5 : 0.42));
    g.addColorStop(0.3, rgba(pal.green, far ? 0.18 : 0.22));
    g.addColorStop(0.55, rgba(pal.ochre, 0.26));
    g.addColorStop(1, rgba(pal.ochre, 0));
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, topY - 4, W, massH + 8);

  // Shading hugging the outline on the shaded (right) flank of each peak.
  ctx.filter = `blur(${Math.max(3, Math.round(9 * s))}px)`;
  for (const top of pr.tops) {
    ctx.beginPath();
    const xa = top.x, xb = Math.min(pr.xs[pr.xs.length - 1], top.x + top.w * 0.55);
    const steps = 24;
    for (let k = 0; k <= steps; k++) {
      const x = xa + (xb - xa) * (k / steps);
      const y = topAt(pr, x);
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    for (let k = steps; k >= 0; k--) {
      const x = xa + (xb - xa) * (k / steps);
      const y = topAt(pr, x);
      // Thin at the summit, widening down the flank, so the wash has no straight inner edge.
      const t = k / steps;
      const depth = (gy - y) * (0.08 + 0.5 * Math.sqrt(t)) * (1 - 0.35 * t);
      ctx.lineTo(x - top.w * 0.04 * t, y + depth);
    }
    ctx.closePath();
    ctx.fillStyle = rgba(pal.ink[3], hill ? 0.2 : far ? 0.26 : 0.38);
    ctx.fill();
  }
  ctx.filter = 'none';

  // Texture strokes (cun): hemp-fibre strokes descending from the crest along the slope.
  const area = (pr.xs[pr.xs.length - 1] - pr.xs[0]) * massH;
  const count = Math.round((hill ? 0.0012 : 0.0042) * cun * area / (s * s));
  for (let i = 0; i < count; i++) {
    const x = rng.range(pr.xs[2], pr.xs[pr.xs.length - 3]);
    const crest = topAt(pr, x);
    const depth = Math.pow(rng.next(), 1.6);
    const y = crest + (gy - crest) * depth * 0.8 + 1.5 * s;
    const top = pr.tops.reduce((a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a));
    const shaded = x > top.x;
    if (!shaded && rng.next() < 0.6) continue;
    const dir = shaded ? 1 : -1;
    // Slope direction from the local profile gradient.
    const dy = topAt(pr, x + 2 * dir) - crest;
    const slope = Math.min(2.5, Math.max(0.25, Math.abs(dy) / 2));
    const len = (hill ? 5 : 8 + 16 * rng.next()) * s * (1 - depth * 0.55);
    const vx = dir / Math.sqrt(1 + slope * slope) * 0.6, vy = slope / Math.sqrt(1 + slope * slope);
    const ink = rng.next() < 0.35 ? pal.ink[1] : pal.ink[2];
    ctx.strokeStyle = rgba(ink, (far ? 0.18 : 0.3) * (0.5 + rng.next()) * (1 - depth * 0.75) * (shaded ? 1 : 0.55));
    ctx.lineWidth = (0.6 + 1.0 * rng.next()) * s;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const bend = noise(x * 0.04, y * 0.04) * 3 * s;
    ctx.quadraticCurveTo(x + vx * len * 0.5 + bend, y + vy * len * 0.5, x + vx * len, y + vy * len);
    ctx.stroke();
  }

  // Inner spur lines from the peaks.
  if (!hill) {
    for (const top of pr.tops) {
      const spurs = far ? 1 : 1 + rng.int(2);
      for (let k = 0; k < spurs; k++) {
        const dir = rng.next() < 0.65 ? 1 : -1;
        let x = top.x + dir * top.w * 0.05, y = top.y + 5 * s;
        ctx.strokeStyle = rgba(far ? pal.ink[2] : pal.ink[1], far ? 0.3 : 0.45);
        ctx.lineWidth = (far ? 0.9 : 1.3) * s;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let j = 0; j < 7; j++) {
          x += dir * top.w * (0.03 + rng.next() * 0.03);
          y += massH * 0.08 * (0.6 + rng.next() * 0.6);
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

export function paintMountain(entry: AssetEntry, variant: number, key: string, pal: Ink, generator: string): HTMLCanvasElement {
  const [vw, vh] = entry.visual.visualSize;
  const W = Math.round(vw * ART_PX_PER_CELL), H = Math.round(vh * ART_PX_PER_CELL);
  const gy = H * entry.visual.anchor[1];
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const rng = rngFor('art', `${key}#${variant}`);
  const noise = createSimplex2D(rng);
  const params = entry.visual.source.type === 'procedural' ? entry.visual.source.params : {};
  const hill = generator === 'hill.v1';
  const [pLo, pHi] = range(params, hill ? 'humps' : 'peaks', [1, 3]);
  const peaks = pLo + rng.int(pHi - pLo + 1);
  const steep = Number(params.steep ?? 1);
  const cun = Number(params.cun ?? 0.6);
  const s = ART_PX_PER_CELL / 56;

  const maxH = gy * (hill ? rng.range(0.4, 0.6) : rng.range(0.84, 0.96));
  const fadeFrom = hill ? 0.45 : 0.3;

  // Back range: a lower, paler massif behind the main one (layered depth, trùng điệp).
  if (!hill) {
    const back = makeProfile(rng, noise, W, gy, maxH * rng.range(0.62, 0.8), 1 + rng.int(2), (0.5 + 0.6 * steep) * rng.range(0.9, 1.3), 0.8, 0.01, 0.99);
    for (let i = 0; i < back.ys.length; i++) back.ys[i] -= maxH * 0.04;
    paintMass(ctx, back, rng, noise, pal, gy, s, { far: true, hill, cun: cun * 0.6, W });
    brushOutline(ctx, back, noise, pal.ink[2], 1.4 * s, 0.6, gy, fadeFrom);
  }

  const pr = makeProfile(rng, noise, W, gy, maxH, peaks, hill ? 1.2 : (0.6 + 0.6 * steep) * rng.range(0.85, 1.2), hill ? 0.5 : 1, hill ? 0.04 : 0.08, hill ? 0.96 : 0.92);
  paintMass(ctx, pr, rng, noise, pal, gy, s, { far: false, hill, cun, W });

  // Outline: a soft bleed pass, then the crisp brush line.
  ctx.filter = `blur(${Math.max(1, Math.round(1.8 * s))}px)`;
  brushOutline(ctx, pr, noise, pal.ink[2], (hill ? 2 : 4) * s, hill ? 0.18 : 0.35, gy, fadeFrom);
  ctx.filter = 'none';
  brushOutline(ctx, pr, noise, hill ? pal.ink[2] : pal.ink[0], (hill ? 1.0 : 2) * s, hill ? 0.42 : 0.85, gy, fadeFrom);

  // Moss dots (điểm rêu) along the upper crest.
  const topY = Math.min(...pr.tops.map((p) => p.y));
  const dots = hill ? rng.int(3) : 5 + rng.int(9);
  for (let i = 0; i < dots; i++) {
    const x = rng.range(pr.xs[6], pr.xs[pr.xs.length - 7]);
    const crest = topAt(pr, x);
    if ((gy - crest) < (gy - topY) * 0.35) continue;
    const cluster = 1 + rng.int(3);
    for (let j = 0; j < cluster; j++) {
      const r = (1.1 + rng.next() * 1.5) * s;
      ctx.fillStyle = rgba(pal.ink[0], 0.5 + 0.35 * rng.next());
      ctx.beginPath();
      ctx.ellipse(x + (j - 1) * 3.5 * s, crest + rng.range(-0.5, 2.5) * s, r * 1.35, r, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Mist at the foot: erase the base so the stamp melts into the terrain wash.
  ctx.globalCompositeOperation = 'destination-out';
  const mist = ctx.createLinearGradient(0, gy - (gy - topY) * (hill ? 0.55 : 0.4), 0, gy + 1);
  mist.addColorStop(0, 'rgba(0,0,0,0)');
  mist.addColorStop(0.6, 'rgba(0,0,0,0.5)');
  mist.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = mist;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

/** Paints every procedural variant listed in the manifest. Image sources are loaded elsewhere. */
export function paintProceduralArt(manifest: Manifest): Map<string, HTMLCanvasElement[]> {
  const out = new Map<string, HTMLCanvasElement[]>();
  const pal: Ink = manifest.palette;
  for (const key of Object.keys(manifest.assets).sort()) {
    const entry = manifest.assets[key];
    if (entry.visual.source.type !== 'procedural') continue;
    const gen = entry.visual.source.generator;
    const list: HTMLCanvasElement[] = [];
    for (let v = 0; v < entry.logic.variants; v++) list.push(paintMountain(entry, v, key, pal, gen));
    out.set(key, list);
  }
  return out;
}
