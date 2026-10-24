// Wave 1 helper: Node timing of the render-side derivations (hydro view, field image, river geometry).
//   npx vite-node scripts/qa/render-prof.ts
import manifest from '../../src/assets/manifest.json';
import { logicOf, type Manifest } from '../../src/assets/manifestTypes';
import { generateWorld } from '../../src/worldgen/index';
import { buildHydroView } from '../../src/render/hydroView';
import { buildFieldImage, sampleSdf } from '../../src/render/fields';
import { riverGeometry } from '../../src/render/riverGeometry';

const logic = logicOf(manifest as unknown as Manifest);
const t: Record<string, number[]> = { view: [], field: [], rivers: [] };
for (let k = 1; k <= 20; k++) {
  const w = generateWorld(`tsvl-${String(k).padStart(2, '0')}`, logic);
  let t0 = performance.now();
  const v = buildHydroView(w);
  t.view.push(performance.now() - t0); t0 = performance.now();
  const f = buildFieldImage(w, v);
  t.field.push(performance.now() - t0); t0 = performance.now();
  const sd = (x: number, y: number) => sampleSdf(f, x, y);
  riverGeometry(w, v, sd, 1); riverGeometry(w, v, sd, 2.4);
  t.rivers.push(performance.now() - t0);
}
for (const [k, a] of Object.entries(t)) { a.sort((x, y) => x - y); console.log(k, 'p50', a[10].toFixed(1), 'max', a[19].toFixed(1)); }
