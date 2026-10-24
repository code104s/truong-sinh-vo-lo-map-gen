// Debug overlay: ridge cells, ridge paths, peaks (main peak larger), passes, river cells,
// stamp ground footprints, visual bounds and anchors. Toggled with D or ?overlay=1.
import { Container, Graphics } from 'pixi.js';
import type { Manifest } from '../assets/manifestTypes';
import { footBox } from '../worldgen/composition';
import type { WorldData } from '../worldgen/index';
import { CELL_PX } from './constants';

export function createOverlay(world: WorldData, manifest: Manifest): Container {
  const n = world.config.size;
  const { ridges, composition, hydro } = world;
  const root = new Container();
  root.label = 'debug-overlay';
  const c = (i: number) => [((i % n) + 0.5) * CELL_PX, (Math.floor(i / n) + 0.5) * CELL_PX] as const;

  const g = new Graphics();
  for (let i = 0; i < n * n; i++) {
    if (hydro.river[i]) {
      const [x, y] = c(i);
      g.rect(x - 3, y - 3, 6, 6).fill({ color: 0x1d4fd0, alpha: 0.45 });
    }
    if (ridges.ridge[i]) {
      const [x, y] = c(i);
      g.rect(x - 5, y - 5, 10, 10).fill({ color: 0xd02020, alpha: 0.28 });
    }
  }
  for (const p of ridges.paths) {
    const pts: number[] = [];
    for (const cell of p) pts.push(...c(cell));
    g.poly(pts, false).stroke({ width: 3, color: 0xa00000, alpha: 0.9 });
  }
  for (const cl of ridges.clusters) {
    cl.peaks.forEach((pi, k) => {
      const [x, y] = c(ridges.peaks[pi].cell);
      g.circle(x, y, k === 0 ? 14 : 8).fill({ color: k === 0 ? 0x000000 : 0x6a006a, alpha: 0.9 });
    });
    for (const s of cl.passes) {
      const [x, y] = c(s.a);
      g.rect(x - 7, y - 7, 14, 14).stroke({ width: 3, color: 0xff8800 });
    }
  }
  for (const s of composition.stamps) {
    const e = manifest.assets[s.key];
    const fb = footBox(e.logic.footprint, s.scale, s.x, s.y);
    g.rect(fb.x0 * CELL_PX, fb.y0 * CELL_PX, (fb.x1 - fb.x0) * CELL_PX, (fb.y1 - fb.y0) * CELL_PX)
      .stroke({ width: 2, color: s.role === 'main' ? 0xff6a00 : 0x2a8a2a, alpha: 0.95 });
    const [vw, vh] = e.visual.visualSize;
    const w = vw * s.scale, h = vh * s.scale * s.squash;
    const [ax, ay] = e.visual.anchor;
    g.rect((s.x - ax * w) * CELL_PX, (s.y - ay * h) * CELL_PX, w * CELL_PX, h * CELL_PX)
      .stroke({ width: 1, color: 0x555555, alpha: 0.6 });
    g.circle(s.x * CELL_PX, s.y * CELL_PX, 4).fill({ color: 0xd00000 });
  }
  root.addChild(g);
  return root;
}
