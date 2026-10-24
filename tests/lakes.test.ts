// Phase 2 wave 2 (worldgen 2.0.0, B2): lakes chosen by water balance and sub-basin, with a clean
// shore. Criteria L2–L7 in docs/worldgen/phase2/02-worldgen-v2.md (L1 is tests/hydrology.test.ts).
import { describe, expect, it } from 'vitest';
import { DX8, DY8 } from '../src/core/grid';
import { buildFieldImage, FIELD_UPSAMPLE } from '../src/render/fields';
import { lakeShapes } from '../src/qa/metrics';
import { LAKE_KIND, OUTLET_TYPE } from '../src/worldgen/hydrology';
import type { WorldData } from '../src/worldgen/index';
import { QA_SEEDS, world } from './worlds';

const shapes = QA_SEEDS.map((seed) => ({ seed, lakes: lakeShapes(world(seed)) }));
const all = shapes.flatMap((s) => s.lakes.map((L) => ({ seed: s.seed, ...L })));

/** First lake (other than `id`) reached by following receivers from the lake's outlet, else 0. */
function downstreamLake(w: WorldData, id: number): number {
  const { hydro } = w;
  let c = hydro.lakes[id - 1].outlet;
  for (let steps = 0; c >= 0 && steps < hydro.receiver.length; steps++) {
    if (hydro.sea[c]) return 0;
    if (hydro.lakeId[c] && hydro.lakeId[c] !== id) return hydro.lakeId[c];
    c = hydro.receiver[c];
  }
  return 0;
}

describe('lake shape and water balance (B2) on 20 QA seeds', () => {
  it('L2: at most 10% of lakes are hooks (cell solidity < 0.7)', () => {
    const hooks = all.filter((L) => L.solidity < 0.7);
    expect(hooks.length / all.length, hooks.map((L) => `${L.seed}#${L.id}`).join(' ')).toBeLessThanOrEqual(0.1);
  });

  it('L3: at least 14 long natural lakes (elongation ≥ 2.2, solidity ≥ 0.75)', () => {
    expect(all.filter((L) => L.elongation >= 2.2 && L.solidity >= 0.75).length).toBeGreaterThanOrEqual(14);
  });

  it('L4: every lake has a catchment of at least 4 × its area', () => {
    const bad = all.filter((L) => L.catchment < 4 * L.area).map((L) => `${L.seed}#${L.id} ${L.catchment}/${L.area}`);
    expect(bad).toEqual([]);
  });

  it('L6: at least 24 long valley lakes (elongation ≥ 1.8)', () => {
    expect(all.filter((L) => L.kind === LAKE_KIND.valley && L.elongation >= 1.8).length).toBeGreaterThanOrEqual(24);
  });

  it('L7: no lake cell with at most one lake neighbour', () => {
    const bad = all.filter((L) => L.armCells > 0).map((L) => `${L.seed}#${L.id}: ${L.armCells}`);
    expect(bad).toEqual([]);
  });

  it('lake attributes agree with the cells and the flow graph', () => {
    const bad: string[] = [];
    for (const seed of QA_SEEDS) {
      const w = world(seed), { hydro } = w, n = w.config.size;
      const surface = hydro.lakes.map(() => -Infinity), low = hydro.lakes.map(() => Infinity);
      for (let c = 0; c < n * n; c++) {
        const id = hydro.lakeId[c];
        if (!id) continue;
        surface[id - 1] = Math.max(surface[id - 1], hydro.height[c]);
        low[id - 1] = Math.min(low[id - 1], hydro.height[c]);
      }
      for (const L of hydro.lakes) {
        const tag = `${seed}#${L.id}`;
        if (L.surface !== surface[L.id - 1]) bad.push(`${tag} surface`);
        if (Math.abs(L.maxDepth - (surface[L.id - 1] - low[L.id - 1])) > 1e-6) bad.push(`${tag} maxDepth`);
        if (L.surface > L.level) bad.push(`${tag} surface above the spill level`);
        if (!(Object.values(LAKE_KIND) as number[]).includes(L.kind)) bad.push(`${tag} kind ${L.kind}`);
        const down = downstreamLake(w, L.id);
        const want = L.outlet < 0 ? OUTLET_TYPE.none : down ? OUTLET_TYPE.lake : (() => {
          let c = L.outlet;
          while (!hydro.sea[c] && hydro.receiver[c] >= 0) c = hydro.receiver[c];
          return hydro.sea[c] ? OUTLET_TYPE.ocean : OUTLET_TYPE.regionBoundary;
        })();
        if (L.outletType !== want) bad.push(`${tag} outletType ${L.outletType}, want ${want}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('close lakes on screen (A4 regression, tsvl-18)', () => {
  // v1 (worldgen 1.0.0) facts for tsvl-18: lake 2 (21 cells) spilled through one river cell into
  // lake 3 (18 cells), one cell away; the lake blur joined them on screen and analyze.ts counted
  // the pixels between them for both lakes (rendered area ratio 1.427 for lake 3). The link was
  // real, but lake 3 drained only 44 cells: under the B2 water balance (catchment ≥ 4 × area) it
  // is no longer open water, and lake 2's sub-basin is the only lake left there.
  it('tsvl-18: the small lake with a 44-cell catchment is gone; what remains passes water balance', () => {
    const w = world('tsvl-18'), { hydro } = w, n = w.config.size;
    const v1Lake3Centre = 80 * n + 55;
    expect(hydro.lakeId[v1Lake3Centre]).toBe(0);
    for (const L of hydro.lakes) expect(L.catchment).toBeGreaterThanOrEqual(4 * L.cells);
  });

  it('two lakes share one patch of rendered water only when one drains into the other', () => {
    const U = FIELD_UPSAMPLE;
    const bad: string[] = [];
    for (const seed of QA_SEEDS) {
      const w = world(seed), { hydro } = w, n = w.config.size, FN = n * U;
      const field = buildFieldImage(w);
      const water = new Uint8Array(FN * FN);
      for (let i = 0; i < FN * FN; i++) {
        const c = Math.floor(Math.floor(i / FN) / U) * n + Math.floor((i % FN) / U);
        if (!hydro.sea[c] && (field.sdf[i * 4] * 256 + field.sdf[i * 4 + 1]) / 65535 < 0.5) water[i] = 1;
      }
      const seen = new Uint8Array(FN * FN);
      for (let s = 0; s < FN * FN; s++) {
        if (!water[s] || seen[s]) continue;
        const ids = new Set<number>();
        const stack = [s];
        seen[s] = 1;
        while (stack.length) {
          const p = stack.pop()!;
          const px = p % FN, py = (p - px) / FN;
          const id = hydro.lakeId[Math.floor(py / U) * n + Math.floor(px / U)];
          if (id) ids.add(id);
          for (let d = 0; d < 8; d += 2) {
            const x = px + DX8[d], y = py + DY8[d];
            if (x < 0 || y < 0 || x >= FN || y >= FN) continue;
            const q = y * FN + x;
            if (water[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
          }
        }
        const list = [...ids].sort((a, b) => a - b);
        for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j];
          if (downstreamLake(w, a) !== b && downstreamLake(w, b) !== a) bad.push(`${seed}: lakes ${a} and ${b} merge on screen but are not linked`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
