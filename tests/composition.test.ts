import { describe, expect, it } from 'vitest';
import { composeStamps, generateCandidates, stampsInChunk, type StampInstance } from '../src/worldgen/composition';
import { sfc32 } from '../src/core/rng';
import { compositionMetrics, regionDensity, REGIONS, structureMetrics, type Region } from '../src/qa/metrics';
import { QA_SEEDS, logic, manifest, world } from './worlds';

const key = (s: StampInstance) => JSON.stringify(s);

function shuffled<T>(list: readonly T[], seed: number): T[] {
  const rng = sfc32(seed, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35);
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe('composition is independent of candidate and chunk order', () => {
  it.each(QA_SEEDS.slice(0, 6))('%s: shuffled and reversed candidates give identical stamps', (seed) => {
    const w = world(seed);
    const cands = generateCandidates(w.hydro, w.ridges, logic, w.config, seed);
    const ref = composeStamps(cands, w.hydro, logic, w.config, seed).stamps.map(key);
    expect(ref).toEqual(w.composition.stamps.map(key));
    for (const order of [shuffled(cands, 1), shuffled(cands, 2), [...cands].reverse()]) {
      expect(composeStamps(order, w.hydro, logic, w.config, seed).stamps.map(key)).toEqual(ref);
    }
  });

  it.each(QA_SEEDS.slice(0, 6))('%s: loading chunks in any order yields the same stamps, each exactly once', (seed) => {
    const w = world(seed);
    const CH = 32, k = w.config.size / CH;
    const coords: [number, number][] = [];
    for (let y = 0; y < k; y++) for (let x = 0; x < k; x++) coords.push([x, y]);
    const collect = (order: [number, number][]) => {
      const byChunk = new Map<string, string[]>();
      for (const [x, y] of order) byChunk.set(`${x},${y}`, stampsInChunk(w.composition, CH, x, y).map(key));
      return [...byChunk.entries()].sort().flatMap(([, v]) => v);
    };
    const a = collect(coords), b = collect(shuffled(coords, 7)), c = collect([...coords].reverse());
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(new Set(a).size).toBe(w.composition.stamps.length);
  });
});

describe('composition quality metrics (V2–V4) on 20 QA seeds', () => {
  const all = QA_SEEDS.map((s) => ({ seed: s, m: compositionMetrics(world(s), manifest) }));

  it.each(all)('$seed: V2 one main peak per range, no footprint on water', ({ m }) => {
    expect(m.rangesWithOneMain).toBe(m.rangesWith3);
    expect(m.footprintsOnWater).toBe(0);
  });

  it.each(all)('$seed: V3 no repeated neighbours, no variant above 25% of a range', ({ m }) => {
    expect(m.repeatedNeighbours).toBe(0);
    expect(m.maxVariantShare).toBeLessThanOrEqual(0.25);
  });

  it('V4 at least 90% of neighbouring ridge stamps overlap 20–45% along the chain', () => {
    const pairs = all.reduce((s, r) => s + r.m.adjacentPairs, 0);
    const ok = all.reduce((s, r) => s + r.m.overlapInBand, 0);
    expect(ok / pairs).toBeGreaterThanOrEqual(0.9);
  });

  // V6 (25–60% of land left bare) was retired by the owner in the Phase 2 brief in favour of a
  // per-region density review: M7/M8 below.
});

// Phase 2 wave 2, B4 (worldgen 2.0.0): massif structure. Criteria M4–M9 in
// docs/worldgen/phase2/02-worldgen-v2.md; M1–M3 are V2–V4 above.
describe('mountain structure (M4–M9) on 20 QA seeds', () => {
  const all = QA_SEEDS.map((s) => ({ seed: s, m: structureMetrics(world(s), manifest), d: regionDensity(world(s), manifest) }));
  const sum = (f: (r: (typeof all)[number]) => number) => all.reduce((a, r) => a + f(r), 0);

  it('M4: at most 30% of stamps come from a regular lattice (every stamp sits on a terrain feature)', () => {
    expect(sum((r) => r.m.notFromTerrain) / sum((r) => r.m.stamps)).toBeLessThanOrEqual(0.3);
    expect(sum((r) => r.m.notFromTerrain)).toBe(0);
  });

  it('M5: summit families match the terrain classifier; variants come from the asked family', () => {
    expect(sum((r) => r.m.classifierMismatch)).toBe(0);
    expect(sum((r) => r.m.familyMatch) / sum((r) => r.m.stamps)).toBeGreaterThanOrEqual(0.9);
  });

  it.each(all)('$seed: M6 no footprint in a valley corridor', ({ m }) => {
    expect(m.footprintsInCorridor).toBe(0);
  });

  it('M7: mean coverage per region within the agreed bands', () => {
    const mean = (k: Region) => all.reduce((a, r) => a + r.d.coverage[k], 0) / all.length;
    const bands: Record<Region, [number, number]> = {
      mountain: [0.7, 0.95], plateau: [0.4, 0.85], foothill: [0.25, 0.6], valley: [0, 0.12], plain: [0, 0.15], coast: [0, 0.12],
    };
    const bad = REGIONS.filter((k) => mean(k) < bands[k][0] || mean(k) > bands[k][1]).map((k) => `${k} ${mean(k).toFixed(3)}`);
    expect(bad).toEqual([]);
  });

  it.each(all)('$seed: M8 plain coverage at most 25%', ({ d }) => {
    expect(d.coverage.plain).toBeLessThanOrEqual(0.25);
  });

  it('M9: far ink layer lies north of the near layer in at least 90% of layered massifs', () => {
    expect(sum((r) => r.m.farNorthOfNear) / sum((r) => r.m.layeredMassifs)).toBeGreaterThanOrEqual(0.9);
  });
});
