// Stamp density per region type (replaces V6, owner decision 3): share of each region's land
// covered by stamp visual bounds, plus where stamps come from (structure vs lattice).
//   npx vite-node scripts/qa/region-density.ts [-- out.json]
import { writeFileSync } from 'node:fs';
import manifestJson from '../../src/assets/manifest.json';
import { logicOf, type Manifest } from '../../src/assets/manifestTypes';
import { generateWorld } from '../../src/worldgen/index';
import { QA_SEEDS, regionDensity, REGIONS } from '../../src/qa/metrics';

const manifest = manifestJson as unknown as Manifest;
const logic = logicOf(manifest);
const out = process.argv.slice(2).filter((a) => a !== '--')[0];
const rows = QA_SEEDS.map((seed) => ({ seed, ...regionDensity(generateWorld(seed, logic), manifest) }));
const mean = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0) / rows.length;
for (const r of rows) console.log(r.seed, REGIONS.map((k) => `${k} ${(r.coverage[k] * 100).toFixed(0)}%/${r.cells[k]}`).join('  '), 'roles', JSON.stringify(r.roles));
console.log('mean', REGIONS.map((k) => `${k} ${(mean((r) => r.coverage[k]) * 100).toFixed(1)}%`).join('  '));
if (out) writeFileSync(out, JSON.stringify(rows, null, 1));
