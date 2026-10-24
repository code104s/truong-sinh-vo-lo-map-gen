import { describe, expect, it } from 'vitest';
import { composeStamps, generateCandidates, stampsInChunk, type StampInstance } from '../src/worldgen/composition';
import { sfc32 } from '../src/core/rng';
import { compositionMetrics } from '../src/qa/metrics';
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

describe('composition quality metrics (V2–V6) on 20 QA seeds', () => {
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

  it.each(all)('$seed: V6 25–60% of land is left as bare paper', ({ m }) => {
    expect(m.bareLand).toBeGreaterThanOrEqual(0.25);
    expect(m.bareLand).toBeLessThanOrEqual(0.6);
  });
});
