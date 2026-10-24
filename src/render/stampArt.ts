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

interface Profile {
  xs: number[];
  ys: number[];
  /** Peak positions (x, top y) along the profile, highest first. */
  tops: { x: number; y: number; w: number }[];
}

/** Silhouette family of a variant (manifest visual.source.params.families, one per variant). */
export type Family = 'range' | 'pinnacle' | 'flat' | 'cliff' | 'hill';
export const FAMILIES: readonly Family[] = ['range', 'pinnacle', 'flat', 'cliff', 'hill'];

type Span = [number, number];

/** How one silhouette is built: peaks, their shape (1 - |d|^a)^b, spacing and roughness. */
interface ProfileSpec {
  peaks: number;
  /** Shape exponents: a = 2, b ~ 1 is the rounded shan-shui bell; large a flattens the crown. */
  a: number;
  b: number;
  mainX: Span;
  mainW: Span;
  sideX: Span;
  sideW: Span;
  sideH: Span;
  /** Flank asymmetry: half-width left = w·skew, right = w/skew. */
  skew: Span;
  rough: number;
  x0f: number;
  x1f: number;
  /** Spread all peaks over evenly spaced slots across sideX (main peak in the middle slot). */
  even?: boolean;
  /** Height of a continuous ridge the peaks rise from (saddles never drop to the ground). */
  ridge?: Span;
}

/** Silhouette of 1..k peaks above the ground line `gy`, roughened by rock noise on the upper outline. */
function makeProfile(rng: Rng, noise: Noise2D, W: number, gy: number, maxH: number, sp: ProfileSpec): Profile {
  const x0 = W * sp.x0f, x1 = W * sp.x1f;
  const ps: { x: number; h: number; w: number; skew: number }[] = [];
  const mid = Math.floor(sp.peaks / 2);
  for (let i = 0; i < sp.peaks; i++) {
    const main = i === 0;
    // Even slots: the main peak takes the middle one, side peaks fill the rest in order.
    const slot = main ? mid : i <= mid ? i - 1 : i;
    const step = (sp.sideX[1] - sp.sideX[0]) / Math.max(1, sp.peaks - 1);
    const evenX = sp.sideX[0] + step * slot + rng.range(-0.2, 0.2) * step;
    ps.push({
      x: sp.even && sp.peaks > 1 ? evenX : main ? rng.range(...sp.mainX) : rng.range(...sp.sideX),
      h: main ? 1 : rng.range(...sp.sideH),
      w: main ? rng.range(...sp.mainW) : rng.range(...sp.sideW),
      skew: rng.range(...sp.skew),
    });
  }
  const ridge = sp.ridge ? rng.range(...sp.ridge) : 0;
  const N = 120;
  const xs: number[] = [], ys: number[] = [];
  for (let k = 0; k <= N; k++) {
    const t = k / N;
    const x = x0 + (x1 - x0) * t;
    let h = ridge * (1 - Math.pow(Math.abs(2 * t - 1), 4));
    for (const p of ps) {
      const d = t < p.x ? (t - p.x) / (p.w * p.skew) : (t - p.x) / (p.w / p.skew);
      if (d <= -1 || d >= 1) continue;
      h = Math.max(h, p.h * Math.pow(1 - Math.pow(Math.abs(d), sp.a), sp.b));
    }
    const edgeFade = Math.min(1, Math.min(t, 1 - t) * 10);
    h += (noise(t * 7, 0.3) * 0.05 + noise(t * 23, 4.1) * 0.02) * sp.rough * edgeFade * Math.min(1, h * 3);
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
  far: boolean; hill: boolean; cun: number; W: number; axe?: boolean;
}): void {
  const { far, hill, cun, W } = opts;
  // Axe-cut strokes (phủ phách thuân) on cliffs and mesas: short, steep and broad.
  const axe = opts.axe ?? false;
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
    const len = (hill ? 5 : axe ? 6 + 9 * rng.next() : 8 + 16 * rng.next()) * s * (1 - depth * 0.55);
    const sl = axe ? Math.max(2.2, slope) : slope;
    const vx = dir / Math.sqrt(1 + sl * sl) * 0.6, vy = sl / Math.sqrt(1 + sl * sl);
    const ink = rng.next() < 0.35 ? pal.ink[1] : pal.ink[2];
    ctx.strokeStyle = rgba(ink, (far ? 0.18 : 0.3) * (0.5 + rng.next()) * (1 - depth * 0.75) * (shaded ? 1 : 0.55));
    ctx.lineWidth = (axe ? 1.2 + 1.6 * rng.next() : 0.6 + 1.0 * rng.next()) * s;
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

interface FamilySpec {
  main: ProfileSpec & { peaks: number };
  peaks: Span;
  /** Main silhouette height as a share of the ground line height. */
  height: Span;
  /** Back range (far ink layer) or none. */
  back: null | { spec: Omit<ProfileSpec, 'peaks'>; peaks: Span; height: Span };
  cun: number;
  axe: boolean;
  outline: number;
  /** Share of the height over which the outline dissolves into the foot mist. */
  foot: Span;
  moss: Span;
}

const BELL = { a: 2, b: 1, skew: [0.75, 1.3] as Span, rough: 1 };

function familySpec(f: Family, steep: number): FamilySpec {
  switch (f) {
    case 'range': // long, low, many-peaked ridge (trùng điệp)
      return {
        main: { ...BELL, peaks: 0, b: 0.9 + 0.2 * steep, mainX: [0.35, 0.65], mainW: [0.2, 0.28], sideX: [0.18, 0.82], sideW: [0.14, 0.22], sideH: [0.7, 0.95], x0f: 0.02, x1f: 0.98, even: true, ridge: [0.45, 0.55] },
        peaks: [4, 6], height: [0.36, 0.52],
        back: { spec: { ...BELL, b: 0.9, rough: 0.8, mainX: [0.3, 0.7], mainW: [0.25, 0.4], sideX: [0.1, 0.9], sideW: [0.15, 0.3], sideH: [0.6, 0.9], x0f: 0.01, x1f: 0.99 }, peaks: [2, 4], height: [0.75, 0.95] },
        cun: 0.8, axe: false, outline: 1, foot: [0.25, 0.4], moss: [4, 10],
      };
    case 'pinnacle': // one tall pointed peak, steep sides, small satellites below a third of its height
      return {
        main: { a: 1.7, b: 1.0, skew: [0.85, 1.18], rough: 0.7, peaks: 0, mainX: [0.46, 0.54], mainW: [0.3, 0.38], sideX: [0.25, 0.75], sideW: [0.1, 0.15], sideH: [0.2, 0.32], x0f: 0.1, x1f: 0.9 },
        peaks: [1, 3], height: [0.9, 0.98],
        back: { spec: { a: 1.8, b: 1.0, skew: [0.85, 1.18], rough: 0.6, mainX: [0.35, 0.65], mainW: [0.2, 0.28], sideX: [0.3, 0.7], sideW: [0.12, 0.18], sideH: [0.6, 0.9], x0f: 0.15, x1f: 0.85 }, peaks: [1, 2], height: [0.26, 0.33] },
        cun: 0.9, axe: false, outline: 1.15, foot: [0.3, 0.42], moss: [3, 7],
      };
    case 'flat': // mesa or plateau: broad flat crown, steep walls
      return {
        main: { a: 6, b: 0.45, skew: [0.85, 1.18], rough: 0.3, peaks: 0, mainX: [0.42, 0.58], mainW: [0.36, 0.44], sideX: [0.2, 0.8], sideW: [0.1, 0.16], sideH: [0.45, 0.7], x0f: 0.04, x1f: 0.96 },
        peaks: [1, 2], height: [0.42, 0.62],
        back: { spec: { a: 4, b: 0.6, skew: [0.85, 1.18], rough: 0.4, mainX: [0.3, 0.7], mainW: [0.3, 0.42], sideX: [0.2, 0.8], sideW: [0.1, 0.2], sideH: [0.5, 0.8], x0f: 0.02, x1f: 0.98 }, peaks: [1, 1], height: [0.7, 0.85] },
        cun: 0.7, axe: true, outline: 1.05, foot: [0.22, 0.34], moss: [2, 6],
      };
    case 'cliff': // asymmetric: a sheer face on one side, a long slope on the other
      return {
        main: { a: 2, b: 0.8, skew: [0.3, 0.36], rough: 1.1, peaks: 0, mainX: [0.16, 0.24], mainW: [0.21, 0.24], sideX: [0.45, 0.75], sideW: [0.08, 0.14], sideH: [0.3, 0.5], x0f: 0.04, x1f: 0.96 },
        peaks: [1, 3], height: [0.7, 0.92],
        back: { spec: { ...BELL, b: 0.9, rough: 0.8, mainX: [0.5, 0.7], mainW: [0.2, 0.3], sideX: [0.4, 0.85], sideW: [0.12, 0.2], sideH: [0.5, 0.8], x0f: 0.1, x1f: 0.95 }, peaks: [1, 2], height: [0.38, 0.5] },
        cun: 1, axe: true, outline: 1.1, foot: [0.28, 0.4], moss: [3, 8],
      };
    case 'hill': // low rounded foothill humps
    default:
      return {
        main: { ...BELL, b: 1.2, rough: 0.5, peaks: 0, mainX: [0.38, 0.62], mainW: [0.34, 0.46], sideX: [0.18, 0.82], sideW: [0.2, 0.32], sideH: [0.5, 0.8], x0f: 0.04, x1f: 0.96 },
        peaks: [1, 3], height: [0.32, 0.46],
        back: null,
        cun: 0.35, axe: false, outline: 0.55, foot: [0.4, 0.5], moss: [0, 3],
      };
  }
}

/** Family of a variant: from the manifest list, else by generator (older manifests). */
export function familyOf(entry: AssetEntry, variant: number, generator: string): Family {
  const params = entry.visual.source.type === 'procedural' ? entry.visual.source.params : {};
  const list = params.families;
  if (Array.isArray(list) && list.length > 0) {
    const f = String(list[variant % list.length]) as Family;
    if (FAMILIES.includes(f)) return f;
  }
  return generator === 'hill.v1' ? 'hill' : 'range';
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
  const family = familyOf(entry, variant, generator);
  const hill = family === 'hill';
  const fs = familySpec(family, Number(params.steep ?? 1));
  const cun = Number(params.cun ?? 0.6) * fs.cun;
  const s = ART_PX_PER_CELL / 56;
  const pick = ([lo, hi]: Span) => lo + rng.int(hi - lo + 1);

  const maxH = gy * rng.range(...fs.height);
  const fadeFrom = rng.range(...fs.foot);

  // Back range: a lower, paler massif behind the main one (far ink layer, trùng điệp).
  if (fs.back) {
    const back = makeProfile(rng, noise, W, gy, maxH * rng.range(...fs.back.height), { ...fs.back.spec, peaks: pick(fs.back.peaks) });
    for (let i = 0; i < back.ys.length; i++) back.ys[i] -= maxH * 0.04;
    paintMass(ctx, back, rng, noise, pal, gy, s, { far: true, hill, cun: cun * 0.6, W, axe: fs.axe });
    brushOutline(ctx, back, noise, pal.ink[2], 1.4 * s, 0.6, gy, fadeFrom);
  }

  const pr = makeProfile(rng, noise, W, gy, maxH, { ...fs.main, peaks: pick(fs.peaks) });
  paintMass(ctx, pr, rng, noise, pal, gy, s, { far: false, hill, cun, W, axe: fs.axe });

  // Outline: a soft bleed pass, then the crisp brush line; weight varies by family and variant.
  const ow = fs.outline * rng.range(0.85, 1.15);
  ctx.filter = `blur(${Math.max(1, Math.round(1.8 * s))}px)`;
  brushOutline(ctx, pr, noise, pal.ink[2], (hill ? 2 : 4) * s * ow, hill ? 0.18 : 0.35, gy, fadeFrom);
  ctx.filter = 'none';
  brushOutline(ctx, pr, noise, hill ? pal.ink[2] : pal.ink[0], (hill ? 1.0 : 2) * s * ow, hill ? 0.42 : 0.85, gy, fadeFrom);

  // Moss dots (điểm rêu) along the upper crest.
  const topY = Math.min(...pr.tops.map((p) => p.y));
  const dots = pick(fs.moss);
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
  const mist = ctx.createLinearGradient(0, gy - (gy - topY) * (hill ? 0.55 : fadeFrom + 0.1), 0, gy + 1);
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
