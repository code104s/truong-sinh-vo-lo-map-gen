// Prints hydrology and V2–V6 metrics for the 20 QA seeds. Usage: npx vite-node scripts/metrics.ts [--json out.json]
import { writeFileSync } from 'node:fs';
import manifestJson from '../src/assets/manifest.json';
import { logicOf, type Manifest } from '../src/assets/manifestTypes';
import { generateWorld, hashWorld } from '../src/worldgen/index';
import { QA_SEEDS, checkHydrology, compositionMetrics } from '../src/qa/metrics';
const manifest = manifestJson as unknown as Manifest;
const logic = logicOf(manifest);
const rows = [];
for (const seed of QA_SEEDS) {
  const t0 = performance.now();
  const world = generateWorld(seed, logic);
  const ms = performance.now() - t0;
  const { worldHash } = await hashWorld(world, logic);
  const h = checkHydrology(world);
  const m = compositionMetrics(world, manifest);
  const longest = Math.max(...world.hydro.rivers.map((r) => r.cells.length));
  const row = { seed, ms: Math.round(ms), worldHash, hydroProblems: h.problems.length, popOrderViolations: h.popOrderViolations, lakes: world.hydro.lakes.length,
    clusters: world.ridges.clusters.filter((c) => c.peaks.length).length, coherence: +world.ridges.coherence.toFixed(3), longestRiver: longest, ...m,
    maxVariantShare: +m.maxVariantShare.toFixed(3), bareLand: +m.bareLand.toFixed(3) };
  rows.push(row);
  console.log(JSON.stringify(row), h.problems.slice(0, 3).join('; '));
}
const i = process.argv.indexOf('--json');
if (i > 0) writeFileSync(process.argv[i + 1], JSON.stringify(rows, null, 2));
