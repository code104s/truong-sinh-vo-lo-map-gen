// Writes the golden hashes of the current WORLDGEN_VERSION from Node. By default it writes the
// candidate file; pass --final only once the owner has accepted the new version:
//   npx vite-node scripts/update-golden.ts [-- --final]
import { writeFileSync } from 'node:fs';
import manifestJson from '../src/assets/manifest.json';
import { logicOf, type Manifest } from '../src/assets/manifestTypes';
import { DEFAULT_CONFIG, WORLDGEN_VERSION, configKey } from '../src/worldgen/config';
import { generateWorld, hashWorld } from '../src/worldgen/index';
import { QA_SEEDS } from '../src/qa/metrics';
import { GOLDEN_CANDIDATE, GOLDEN_FINAL } from '../src/qa/golden';

const logic = logicOf(manifestJson as unknown as Manifest);
const seeds: Record<string, { worldHash: string; stages: Record<string, string> }> = {};
for (const seed of QA_SEEDS) seeds[seed] = await hashWorld(generateWorld(seed, logic), logic);
const out = { worldgenVersion: WORLDGEN_VERSION, config: configKey(DEFAULT_CONFIG), logic: JSON.stringify(logic), seeds };
const path = process.argv.includes('--final') ? GOLDEN_FINAL : GOLDEN_CANDIDATE;
if (path.endsWith('worldgen-v1.json')) throw new Error('golden v1 is frozen');
writeFileSync(path, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${QA_SEEDS.length} seeds for worldgen ${WORLDGEN_VERSION} to ${path}`);
