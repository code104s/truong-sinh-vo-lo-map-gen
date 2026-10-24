// Deterministic review camera positions, derived from WorldData only.
import type { WorldData } from '../worldgen/index';
import type { CameraState } from '../render/camera';
import { CELL_PX } from '../render/constants';

export type ViewName = 'Z1' | 'Z2' | 'Z3';

/** Main peak of the range with the most peaks (ties: lower cluster id). */
export function mainRangeFocus(world: WorldData): [number, number] {
  const main = world.composition.stamps.filter((s) => s.role === 'main');
  if (main.length === 0) return [world.config.size / 2, world.config.size / 2];
  const peaksIn = (id: number) => world.ridges.clusters[id]?.peaks.length ?? 0;
  main.sort((a, b) => peaksIn(b.clusterId) - peaksIn(a.clusterId) || a.clusterId - b.clusterId);
  return [main[0].x, main[0].y - 3];
}

/** Largest river confluence: river cell with two or more river donors and the highest flow. */
export function confluenceFocus(world: WorldData): [number, number] {
  const { hydro } = world;
  const n = world.config.size;
  const riverDonors = new Uint8Array(n * n);
  for (let c = 0; c < n * n; c++) {
    const r = hydro.receiver[c];
    if (r >= 0 && hydro.river[c] && hydro.river[r]) riverDonors[r]++;
  }
  let best = -1;
  for (let c = 0; c < n * n; c++) {
    if (riverDonors[c] >= 2 && (best < 0 || hydro.acc[c] > hydro.acc[best])) best = c;
  }
  if (best < 0) {
    for (let c = 0; c < n * n; c++) if (hydro.river[c] && (best < 0 || hydro.acc[c] > hydro.acc[best])) best = c;
  }
  if (best < 0) return mainRangeFocus(world);
  return [(best % n) + 0.5, Math.floor(best / n) + 0.5];
}

export function reviewView(world: WorldData, name: ViewName, fitZoom: number): CameraState {
  const size = world.config.size * CELL_PX;
  if (name === 'Z1') return { zoom: fitZoom, cx: size / 2, cy: size / 2 };
  const [x, y] = name === 'Z2' ? mainRangeFocus(world) : confluenceFocus(world);
  return { zoom: name === 'Z2' ? 1 : 2, cx: x * CELL_PX, cy: y * CELL_PX };
}
