// Wave 2 summary metrics over the 20 QA seeds: V2–V4 (M1–M3), M4–M9, region coverage, stamp counts.
//   npx vite-node scripts/qa/wave2-metrics.ts -- <out.json>
import { writeFileSync } from 'node:fs';
import manifestJson from '../../src/assets/manifest.json';
import { logicOf, type Manifest } from '../../src/assets/manifestTypes';
import { compositionMetrics, QA_SEEDS, regionDensity, REGIONS, structureMetrics } from '../../src/qa/metrics';
import { generateWorld } from '../../src/worldgen/index';

const manifest = manifestJson as unknown as Manifest;
const logic = logicOf(manifest);
const out = process.argv.slice(2).filter((a) => a !== '--')[0] ?? 'qa-out/wave2-metrics.json';
const rows = QA_SEEDS.map((seed) => {
  const w = generateWorld(seed, logic);
  return { seed, v: compositionMetrics(w, manifest), m: structureMetrics(w, manifest), d: regionDensity(w, manifest) };
});
const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0);
const summary = {
  stamps: sum((r) => r.m.stamps),
  M1_rangesWithOneMain: `${sum((r) => r.v.rangesWithOneMain)}/${sum((r) => r.v.rangesWith3)}`,
  M1_footprintsOnWater: sum((r) => r.v.footprintsOnWater),
  M2_repeatedNeighbours: sum((r) => r.v.repeatedNeighbours),
  M2_maxVariantShare: Math.max(...rows.map((r) => r.v.maxVariantShare)),
  M3_overlapInBand: sum((r) => r.v.overlapInBand) / sum((r) => r.v.adjacentPairs),
  M4_notFromTerrain: sum((r) => r.m.notFromTerrain) / sum((r) => r.m.stamps),
  M5_familyMatch: sum((r) => r.m.familyMatch) / sum((r) => r.m.stamps),
  M5_classifierMismatch: sum((r) => r.m.classifierMismatch),
  M6_footprintsInCorridor: sum((r) => r.m.footprintsInCorridor),
  M7_meanCoverage: Object.fromEntries(REGIONS.map((k) => [k, sum((r) => r.d.coverage[k]) / rows.length])),
  M8_maxPlain: Math.max(...rows.map((r) => r.d.coverage.plain)),
  M9: `${sum((r) => r.m.farNorthOfNear)}/${sum((r) => r.m.layeredMassifs)}`,
  roles: rows.reduce((a, r) => { for (const [k, v] of Object.entries(r.d.roles)) a[k] = (a[k] ?? 0) + v; return a; }, {} as Record<string, number>),
};
writeFileSync(out, JSON.stringify({ summary, rows }, null, 1));
console.log(JSON.stringify(summary, null, 1));
