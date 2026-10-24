// Review camera centres (Z2, Z3) of the 20 QA seeds for the worldgen version checked out, so that
// later before/after shots can reuse the same camera when worldgen changes move the focus.
//   npx vite-node scripts/qa/review-cameras.ts -- <out.json>
import { writeFileSync } from 'node:fs';
import manifest from '../../src/assets/manifest.json';
import { logicOf, type Manifest } from '../../src/assets/manifestTypes';
import { QA_SEEDS } from '../../src/qa/metrics';
import { WORLDGEN_VERSION } from '../../src/worldgen/config';
import { generateWorld } from '../../src/worldgen/index';
import { reviewView } from '../../src/app/views';

const out = process.argv.slice(2).filter((a) => a !== '--')[0] ?? 'qa-out/cameras.json';
const logic = logicOf(manifest as unknown as Manifest);
const seeds: Record<string, Record<string, { zoom: number; cx: number; cy: number }>> = {};
for (const seed of QA_SEEDS) {
  const w = generateWorld(seed, logic);
  seeds[seed] = { Z2: reviewView(w, 'Z2', 1), Z3: reviewView(w, 'Z3', 1) };
}
writeFileSync(out, JSON.stringify({ worldgenVersion: WORLDGEN_VERSION, seeds }, null, 1));
console.log(`wrote ${out}`);
