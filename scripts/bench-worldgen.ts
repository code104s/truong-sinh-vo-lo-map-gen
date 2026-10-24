// Worldgen benchmark per stage, in Node. Usage: npx vite-node scripts/bench-worldgen.ts [runs]
// Reports the median over `runs` runs (after 2 warm-up runs) for each of the 20 QA seeds.
import manifestJson from '../src/assets/manifest.json';
import { logicOf, type Manifest } from '../src/assets/manifestTypes';
import { DEFAULT_CONFIG } from '../src/worldgen/config';
import { composeStamps, generateCandidates } from '../src/worldgen/composition';
import { generateHydrology } from '../src/worldgen/hydrology';
import { hashWorld, type WorldData } from '../src/worldgen/index';
import { generateRidges } from '../src/worldgen/ridges';
import { generateTerrain } from '../src/worldgen/terrain';
import { WORLDGEN_VERSION } from '../src/worldgen/config';
import { QA_SEEDS } from '../src/qa/metrics';

const runs = Number(process.argv[2] ?? 7);
const logic = logicOf(manifestJson as unknown as Manifest);
const cfg = DEFAULT_CONFIG;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

type Stage = 'terrain' | 'hydrology' | 'ridges' | 'composition' | 'total' | 'hash';
const rows: Record<string, Record<Stage, number>> = {};
for (const seed of QA_SEEDS) {
  const t: Record<Stage, number[]> = { terrain: [], hydrology: [], ridges: [], composition: [], total: [], hash: [] };
  for (let r = 0; r < runs + 2; r++) {
    const a = performance.now();
    const terrain = generateTerrain(seed, cfg);
    const b = performance.now();
    const hydro = generateHydrology(seed, terrain.height, cfg);
    const c = performance.now();
    const ridges = generateRidges(hydro.height, hydro.sea, cfg);
    const d = performance.now();
    const composition = composeStamps(generateCandidates(hydro, ridges, logic, cfg, seed), hydro, logic, cfg, seed);
    const e = performance.now();
    const world: WorldData = { seed, worldgenVersion: WORLDGEN_VERSION, config: cfg, seaSide: terrain.seaSide, hydro, ridges, composition };
    await hashWorld(world, logic);
    const f = performance.now();
    if (r < 2) continue;
    t.terrain.push(b - a); t.hydrology.push(c - b); t.ridges.push(d - c); t.composition.push(e - d); t.total.push(e - a); t.hash.push(f - e);
  }
  rows[seed] = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, +median(v).toFixed(1)])) as Record<Stage, number>;
}
console.log(`node ${process.version}, ${runs} runs per seed (median), size ${cfg.size}`);
console.log('seed      terrain  hydro  ridges  compose  | total  (+hash)');
for (const [seed, r] of Object.entries(rows)) {
  console.log(`${seed}  ${String(r.terrain).padStart(7)} ${String(r.hydrology).padStart(6)} ${String(r.ridges).padStart(7)} ${String(r.composition).padStart(8)}  | ${String(r.total).padStart(5)}  (+${r.hash})`);
}
const totals = Object.values(rows).map((r) => r.total);
console.log(`total: median ${median(totals)} ms, max ${Math.max(...totals)} ms (budget 300 ms)`);
if (process.argv.includes('--json')) console.log(JSON.stringify(rows));
