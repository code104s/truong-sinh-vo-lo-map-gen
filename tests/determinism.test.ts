import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, WORLDGEN_VERSION, configKey } from '../src/worldgen/config';
import { generateWorld, hashWorld } from '../src/worldgen/index';
import { terrainClassDifference } from '../src/qa/metrics';
import { GOLDEN_CANDIDATE, GOLDEN_FINAL, GOLDEN_V1_SHA256 } from '../src/qa/golden';
import { QA_SEEDS, logic, world } from './worlds';

describe('determinism contract', () => {
  it('same seed gives the same worldHash over 10 runs', async () => {
    const hashes = new Set<string>();
    for (let i = 0; i < 10; i++) hashes.add((await hashWorld(generateWorld('tsvl-01', logic), logic)).worldHash);
    expect(hashes.size).toBe(1);
  });

  it('keeps golden v1 frozen (traceability of worldgen 1.0.0)', () => {
    const sha = createHash('sha256').update(readFileSync('golden/worldgen-v1.json')).digest('hex');
    expect(sha).toBe(GOLDEN_V1_SHA256);
  });

  it('wave 2 leaves the terrain stage byte-identical to worldgen 1.0.0', async () => {
    const v1 = JSON.parse(readFileSync('golden/worldgen-v1.json', 'utf8'));
    for (const seed of QA_SEEDS) {
      const h = await hashWorld(world(seed), logic);
      expect({ seed, terrain: h.stages.terrain }).toEqual({ seed, terrain: v1.seeds[seed].stages.terrain });
    }
  });

  it('matches the golden hashes for all 20 QA seeds, stage by stage', async () => {
    // Final golden once the version is accepted, the candidate while it is under review.
    const path = existsSync(GOLDEN_FINAL) ? GOLDEN_FINAL : GOLDEN_CANDIDATE;
    expect(existsSync(path), 'run scripts/update-golden.ts').toBe(true);
    const golden = JSON.parse(readFileSync(path, 'utf8'));
    expect(golden.worldgenVersion).toBe(WORLDGEN_VERSION);
    expect(golden.config).toBe(configKey(DEFAULT_CONFIG));
    expect(golden.logic, 'manifest logic changed: bump WORLDGEN_VERSION').toBe(JSON.stringify(logic));
    for (const seed of QA_SEEDS) {
      const h = await hashWorld(world(seed), logic);
      // Stage hashes first, so a failure names the stage that diverged.
      expect({ seed, stages: h.stages }).toEqual({ seed, stages: golden.seeds[seed].stages });
      expect(h.worldHash).toBe(golden.seeds[seed].worldHash);
    }
  });

  it('different seeds differ in at least 30% of terrain classes', () => {
    for (let i = 0; i + 1 < QA_SEEDS.length; i += 2) {
      expect(terrainClassDifference(world(QA_SEEDS[i]), world(QA_SEEDS[i + 1]))).toBeGreaterThanOrEqual(0.3);
    }
  });

  it('every QA seed has at least one mountain range and a river at least 0.2 × map width long', () => {
    for (const seed of QA_SEEDS) {
      const w = world(seed);
      expect(w.ridges.clusters.some((c) => c.peaks.length > 0), seed).toBe(true);
      const longest = Math.max(...w.hydro.rivers.map((r) => r.cells.length));
      expect(longest, seed).toBeGreaterThanOrEqual(0.2 * w.config.size);
    }
  });
});
