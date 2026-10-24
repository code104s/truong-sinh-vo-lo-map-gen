// Wave 1 helper: lake kind and depth distribution over the 20 QA seeds (render-side view only).
//   npx vite-node scripts/qa/lake-stats.ts
import manifest from '../../src/assets/manifest.json';
import { logicOf, type Manifest } from '../../src/assets/manifestTypes';
import { generateWorld } from '../../src/worldgen/index';
import { buildHydroView } from '../../src/render/hydroView';

const logic = logicOf(manifest as unknown as Manifest);
const rows: Record<string, number[]> = { mountain: [], valley: [], plain: [] };
const ends: Record<string, number> = {};
let outflows = 0;
for (let k = 1; k <= 20; k++) {
  const w = generateWorld(`tsvl-${String(k).padStart(2, '0')}`, logic);
  const v = buildHydroView(w);
  for (const L of v.lakes) rows[L.kind].push(L.maxDepth);
  for (const p of v.paths) { ends[p.end] = (ends[p.end] ?? 0) + 1; if (p.start === 'lakeOutflow') outflows++; }
}
const q = (a: number[], t: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(t * (s.length - 1))]?.toFixed(3); };
for (const [k, a] of Object.entries(rows)) console.log(k, a.length, 'maxDepth p10', q(a, 0.1), 'p50', q(a, 0.5), 'p90', q(a, 0.9));
console.log('ends', ends, 'lakeOutflows', outflows);
