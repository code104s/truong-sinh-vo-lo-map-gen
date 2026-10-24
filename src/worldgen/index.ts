// generateWorld(seed, config, manifestLogic) -> WorldData. Pure: no DOM, no PixiJS, no clocks.
import { sha256Hex } from '../core/sha256';
import type { ManifestLogic } from '../assets/manifestTypes';
import { DEFAULT_CONFIG, WORLDGEN_VERSION, configKey, type WorldConfig } from './config';
import { composeStamps, generateCandidates, type SceneComposition } from './composition';
import { generateHydrology, type HydrologyResult } from './hydrology';
import { generateRidges, type RidgeResult } from './ridges';
import { ByteWriter } from './serialize';
import { generateTerrain } from './terrain';

export interface WorldData {
  seed: string;
  worldgenVersion: string;
  config: WorldConfig;
  seaSide: number;
  hydro: HydrologyResult;
  ridges: RidgeResult;
  composition: SceneComposition;
}

export function generateWorld(seed: string, logic: ManifestLogic, config: WorldConfig = DEFAULT_CONFIG): WorldData {
  const terrain = generateTerrain(seed, config);
  const hydro = generateHydrology(seed, terrain.height, config);
  const ridges = generateRidges(hydro.height, hydro.sea, config);
  const candidates = generateCandidates(hydro, ridges, logic, config, seed);
  const composition = composeStamps(candidates, hydro, logic, config, seed);
  return { seed, worldgenVersion: WORLDGEN_VERSION, config, seaSide: terrain.seaSide, hydro, ridges, composition };
}

/** Stage-by-stage byte streams. Each is hashed separately so a divergence can be located. */
export function serializeStages(world: WorldData, logic: ManifestLogic): Record<string, Uint8Array> {
  const { hydro, ridges, composition } = world;

  const header = new ByteWriter();
  header.ascii('TSVL');
  header.u16(1); // formatVersion
  header.str(world.worldgenVersion);
  header.str(world.seed);
  header.u32(world.config.size);
  header.u32(world.config.size);
  header.str(configKey(world.config));
  header.str(JSON.stringify(logic));
  header.u8(world.seaSide);

  const terrain = new ByteWriter();
  terrain.f32array(hydro.height);

  const hydrology = new ByteWriter();
  hydrology.f32array(hydro.filled);
  hydrology.u8array(hydro.sea);
  hydrology.u16array(hydro.lakeId);
  hydrology.i32array(hydro.receiver);
  hydrology.f32array(hydro.acc);
  hydrology.u8array(hydro.river);
  hydrology.i32array(hydro.basinId);
  hydrology.u32(hydro.lakes.length);
  for (const l of hydro.lakes) {
    hydrology.u32(l.id);
    hydrology.f64(l.level);
    hydrology.u32(l.cells);
    hydrology.i32(l.outlet);
    hydrology.f64(l.surface);
    hydrology.f64(l.maxDepth);
    hydrology.f64(l.catchment);
    hydrology.u8(l.kind);
    hydrology.u8(l.outletType);
  }
  hydrology.u32(hydro.rivers.length);
  for (const r of hydro.rivers) hydrology.i32array(Int32Array.from(r.cells));

  const ridge = new ByteWriter();
  ridge.u8array(ridges.ridge);
  ridge.f32array(ridges.invAcc);
  ridge.u32(ridges.peaks.length);
  for (const p of ridges.peaks) {
    ridge.i32(p.cell);
    ridge.f64(p.height);
    ridge.f64(p.relief);
  }
  ridge.u32(ridges.paths.length);
  for (const p of ridges.paths) ridge.i32array(Int32Array.from(p));
  ridge.u32(ridges.clusters.length);
  for (const c of ridges.clusters) {
    ridge.i32array(Int32Array.from(c.peaks));
    ridge.i32array(Int32Array.from(c.paths));
    ridge.u32(c.passes.length);
    for (const s of c.passes) {
      ridge.i32(s.a);
      ridge.i32(s.b);
      ridge.f64(s.height);
    }
  }

  const comp = new ByteWriter();
  comp.u32(composition.stamps.length);
  for (const s of composition.stamps) {
    comp.u32(s.id);
    comp.str(s.key);
    comp.str(s.role);
    comp.i32(s.clusterId);
    comp.f64(s.x);
    comp.f64(s.y);
    comp.u32(s.variant);
    comp.u8(s.flip ? 1 : 0);
    comp.f64(s.scale);
    comp.f64(s.squash);
    comp.i32(s.tone);
    comp.i32(s.path);
    comp.i32(s.pathPos);
  }

  return {
    header: header.bytes(),
    terrain: terrain.bytes(),
    hydrology: hydrology.bytes(),
    ridges: ridge.bytes(),
    composition: comp.bytes(),
  };
}

export interface WorldHashes {
  worldHash: string;
  stages: Record<string, string>;
}

export async function hashWorld(world: WorldData, logic: ManifestLogic): Promise<WorldHashes> {
  const parts = serializeStages(world, logic);
  const names = Object.keys(parts);
  const stages: Record<string, string> = {};
  let total = 0;
  for (const k of names) {
    stages[k] = await sha256Hex(parts[k]);
    total += parts[k].length;
  }
  const all = new Uint8Array(total);
  let o = 0;
  for (const k of names) {
    all.set(parts[k], o);
    o += parts[k].length;
  }
  return { worldHash: await sha256Hex(all), stages };
}
