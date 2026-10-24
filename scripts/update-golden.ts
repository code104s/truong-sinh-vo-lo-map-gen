// Regenerates golden/worldgen-v1.json from Node. Run only when WORLDGEN_VERSION changes on purpose:
//   npx vite-node scripts/update-golden.ts
import { writeFileSync } from 'node:fs';
import manifestJson from '../src/assets/manifest.json';
import { logicOf, type Manifest } from '../src/assets/manifestTypes';
import { DEFAULT_CONFIG, WORLDGEN_VERSION, configKey } from '../src/worldgen/config';
import { generateWorld, hashWorld } from '../src/worldgen/index';
import { QA_SEEDS } from '../src/qa/metrics';

const logic = logicOf(manifestJson as unknown as Manifest);
const seeds: Record<string, { worldHash: string; stages: Record<string, string> }> = {};
for (const seed of QA_SEEDS) seeds[seed] = await hashWorld(generateWorld(seed, logic), logic);
const out = { worldgenVersion: WORLDGEN_VERSION, config: configKey(DEFAULT_CONFIG), logic: JSON.stringify(logic), seeds };
writeFileSync('golden/worldgen-v1.json', JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${QA_SEEDS.length} seeds for worldgen ${WORLDGEN_VERSION}`);
