// Rivers as variable-width ink ribbons: a pale indigo wash between two thin bank lines that
// widen downstream (width ~ sqrt(flow)), darker for larger rivers. Geometry (riverGeometry.ts) is
// pure and tested in Node; this file only draws it.
import { Graphics } from 'pixi.js';
import type { Manifest } from '../assets/manifestTypes';
import type { WorldData } from '../worldgen/index';
import { CELL_PX, hexToNumber } from './constants';
import type { HydroView } from './hydroView';
import { brushRuns, gapThreshold, riverGeometry, riverNoise, type BrushRun, type RiverGeom } from './riverGeometry';

/** Points this far inside water (cells) get a faint wash and no banks, so the river fades into the lake or sea. */
const WATER_SD = -0.1;

/** Index ranges [from, to] of consecutive points where keep(i) holds, sharing an end point. */
function runsWhere(n: number, keep: (i: number) => boolean): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let s = -1;
  for (let i = 0; i < n; i++) {
    if (keep(i)) { if (s < 0) s = i > 0 ? i - 1 : i; }
    else if (s >= 0) { out.push([s, i]); s = -1; }
  }
  if (s >= 0) out.push([s, n - 1]);
  return out.filter(([a, b]) => b > a);
}

function ribbonPoly(r: RiverGeom, from: number, to: number): number[] {
  const left: number[] = [], right: number[] = [];
  const p = r.pts;
  for (let i = from; i <= to; i++) {
    const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)];
    let nx = -(b.y - a.y), ny = b.x - a.x;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len; ny /= len;
    const hw = p[i].w / 2;
    left.push(p[i].x + nx * hw, p[i].y + ny * hw);
    right.push(p[i].x - nx * hw, p[i].y - ny * hw);
  }
  const poly = [...left];
  for (let i = right.length - 2; i >= 0; i -= 2) poly.push(right[i], right[i + 1]);
  return poly;
}

function bankLine(r: RiverGeom, side: 1 | -1): number[] {
  const p = r.pts, xy: number[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)];
    let nx = -(b.y - a.y), ny = b.x - a.x;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len; ny /= len;
    xy.push(p[i].x + side * nx * p[i].w / 2, p[i].y + side * ny * p[i].w / 2);
  }
  return xy;
}

/** Butt caps: round caps of neighbouring runs overlap and leave dark dots along the line. */
function stroke(g: Graphics, run: BrushRun, color: number): void {
  g.poly(run.xy, false).stroke({ width: run.width, color, alpha: run.alpha, cap: 'butt', join: 'round' });
}

/**
 * @param widthScale widens ribbons and lines for the overview LOD, where true-scale rivers would
 *                   be thinner than a pixel and the river network would vanish from the map frame.
 */
export function createRiverLayer(world: WorldData, manifest: Manifest, view: HydroView, sdAt: (x: number, y: number) => number, widthScale = 1): Graphics {
  const g = new Graphics();
  g.label = 'rivers';
  const wash = hexToNumber(manifest.palette.indigo);
  const ink = hexToNumber(manifest.palette.ink[2]);
  const inkDark = hexToNumber(manifest.palette.ink[1]);
  const noise = riverNoise(world);
  // The overview LOD draws unbroken lines: dry-brush gaps at that scale read as broken rivers.
  const gap = (bias: number) => gapThreshold(widthScale, bias);

  const geoms = riverGeometry(world, view, sdAt, widthScale).sort((a, b) => b.rank - a.rank);
  for (const r of geoms) {
    const n = r.pts.length;
    const fade = r.pts.map((p) => p.a);
    const xy: number[] = [];
    for (const p of r.pts) xy.push(p.x, p.y);
    if (r.kind === 'stream') {
      // Stream: one unbroken brush line that swells and thins, faint at its headwater.
      const maxW = Math.max(...r.pts.map((p) => p.w));
      const tone = r.pts.map((p) => p.a * (0.2 + 0.3 * p.t));
      for (const run of brushRuns(xy, tone, noise, Math.max(0.8, maxW * 0.85), 1, -Infinity)) stroke(g, run, ink);
      continue;
    }
    // Headwater: a fading centre line until the ribbon reaches full strength.
    for (const [a, b] of runsWhere(n, (i) => r.pts[i].a < 0.999)) {
      for (const run of brushRuns(xy.slice(a * 2, b * 2 + 2), fade.slice(a, b + 1), noise, r.pts[b].w * 0.45, 0.3, -Infinity)) stroke(g, run, ink);
    }
    // Wash: darker where the flow is larger (four tone bands along the river); full strength over
    // land and just past the shore, faint further into lake or sea.
    const band = r.pts.map((p) => Math.round(p.t * 4) / 4);
    const full = (i: number) => r.pts[i].a >= 0.999;
    for (let a = 0; a < n - 1;) {
      let b = a + 1;
      const inWater = r.sd[a] <= WATER_SD;
      while (b < n - 1 && band[b] === band[a] && (r.sd[b] <= WATER_SD) === inWater && full(b) === full(a)) b++;
      if (full(a)) {
        const washA = (0.34 + 0.42 * band[a]) * (inWater ? 0.35 : 1);
        g.poly(ribbonPoly(r, a, b)).fill({ color: wash, alpha: washA });
      }
      a = b;
    }
    // Banks with a loaded-then-dry brush, only on land; the shaded (south/east) bank stays firmer.
    const bankW = Math.max(0.8, CELL_PX * 0.026 * widthScale) * (0.8 + 0.6 * r.rank);
    const bankInk = r.rank > 0.6 ? inkDark : ink;
    for (const [side, w, a0, a1, bias] of [[1, 1, 0.3, 0.42, 0.1], [-1, 0.8, 0.2, 0.36, 0.45]] as const) {
      const bank = bankLine(r, side);
      const tone = r.pts.map((p) => p.a * (a0 + a1 * p.t));
      for (const [a, b] of runsWhere(n, (i) => full(i) && r.sd[i] > -0.1)) {
        for (const run of brushRuns(bank.slice(a * 2, b * 2 + 2), tone.slice(a, b + 1), noise, bankW * w, 1, gap(bias))) stroke(g, run, bankInk);
      }
    }
  }
  return g;
}
