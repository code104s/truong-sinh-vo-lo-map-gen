// Phase 2 wave 1 (render only): river ends meet the water, lake outflows leave the lake at full
// width, rivers that leave the region reach the map edge, and the overview LOD has no brush gaps.
// Criteria A6–A9 in docs/worldgen/phase2/00-baseline.md.
import { describe, expect, it } from 'vitest';
import { CELL_PX } from '../src/render/constants';
import { buildFieldImage, sampleSdf } from '../src/render/fields';
import { buildHydroView } from '../src/render/hydroView';
import { brushRuns, gapThreshold, riverGeometry, riverNoise, type RiverGeom } from '../src/render/riverGeometry';
import { QA_SEEDS, world } from './worlds';

/** The terrain shader warps the shore by up to 0.35 cells, so "inside rendered water" needs margin. */
const WARP = 0.35;

const cases = QA_SEEDS.map((seed) => {
  const w = world(seed);
  const view = buildHydroView(w);
  const field = buildFieldImage(w, view);
  const sdAt = (x: number, y: number) => sampleSdf(field, x, y);
  return { seed, w, near: riverGeometry(w, view, sdAt, 1), far: riverGeometry(w, view, sdAt, 2.4) };
});

function each(fn: (g: RiverGeom, seed: string, n: number) => string | null): string[] {
  const bad: string[] = [];
  for (const c of cases) for (const set of [c.near, c.far]) for (const g of set) {
    const m = fn(g, c.seed, c.w.config.size);
    if (m) bad.push(`${c.seed} path ${g.index}: ${m}`);
  }
  return bad;
}

describe('river geometry meets the water and the map edge', () => {
  it('A6: every river into a lake or the sea ends inside rendered water', () => {
    const bad = each((g) => {
      if (g.end !== 'ocean' && g.end !== 'lake') return null;
      const sd = g.sd[g.sd.length - 1];
      return sd < -WARP ? null : `${g.end} end at sd ${sd.toFixed(3)}`;
    });
    expect(bad).toEqual([]);
  });

  it('A7: lake outflows start inside the lake at full width', () => {
    let count = 0;
    const bad = each((g) => {
      if (g.start !== 'lakeOutflow') return null;
      count++;
      if (g.sd[0] >= -WARP) return `start at sd ${g.sd[0].toFixed(3)}`;
      return g.pts[0].w >= 0.8 * g.fullStartW ? null : `start width ${(g.pts[0].w / g.fullStartW).toFixed(2)} of full`;
    });
    expect(bad).toEqual([]);
    expect(count).toBe(130 * 2);
  });

  it('A8: rivers leaving the region run to the map edge without narrowing', () => {
    let count = 0;
    const bad = each((g, _s, n) => {
      if (g.end !== 'regionBoundary') return null;
      count++;
      const e = g.pts[g.pts.length - 1], W = n * CELL_PX;
      const onEdge = Math.min(e.x, e.y, W - e.x, W - e.y) <= 1e-6;
      if (!onEdge) return `ends ${Math.min(e.x, e.y, W - e.x, W - e.y).toFixed(2)} px from the edge`;
      const tail = g.pts.slice(-8);
      return e.w >= 0.999 * Math.max(...tail.map((p) => p.w)) ? null : 'narrows at the edge';
    });
    expect(bad).toEqual([]);
    expect(count).toBe(210 * 2);
  });

  it('A9: the overview LOD draws every brush run', () => {
    expect(gapThreshold(2.4, 0.45)).toBe(-Infinity);
    for (const c of cases) {
      const noise = riverNoise(c.w);
      for (const g of c.far) {
        const xy = g.pts.flatMap((p) => [p.x, p.y]);
        const runs = brushRuns(xy, g.pts.map(() => 1), noise, 1, 1, gapThreshold(2.4, 0.45));
        expect(runs.length).toBe(Math.ceil((g.pts.length - 1) / 4));
      }
    }
  });
});
