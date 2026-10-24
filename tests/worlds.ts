// Shared, lazily generated worlds for the test files (each file runs in its own worker).
import manifestJson from '../src/assets/manifest.json';
import { logicOf, type Manifest } from '../src/assets/manifestTypes';
import { generateWorld, type WorldData } from '../src/worldgen/index';
export { QA_SEEDS } from '../src/qa/metrics';

export const manifest = manifestJson as unknown as Manifest;
export const logic = logicOf(manifest);

const cache = new Map<string, WorldData>();
export function world(seed: string): WorldData {
  let w = cache.get(seed);
  if (!w) {
    w = generateWorld(seed, logic);
    cache.set(seed, w);
  }
  return w;
}
