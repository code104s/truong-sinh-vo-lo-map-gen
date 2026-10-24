// Runs world generation off the main thread. Timing is measured here, in the host, never
// inside worldgen code (which must not read clocks).
import manifest from '../assets/manifest.json';
import { logicOf, type Manifest } from '../assets/manifestTypes';
import { generateWorld, hashWorld } from '../worldgen/index';

self.onmessage = async (e: MessageEvent<{ seed: string }>) => {
  const logic = logicOf(manifest as unknown as Manifest);
  const t0 = performance.now();
  const world = generateWorld(e.data.seed, logic);
  const t1 = performance.now();
  const hashes = await hashWorld(world, logic);
  (self as unknown as Worker).postMessage({ world, hashes, genMs: t1 - t0 });
};
