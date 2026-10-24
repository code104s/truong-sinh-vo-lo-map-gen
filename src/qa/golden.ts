// Where the golden hashes of the current WORLDGEN_VERSION live. A new major version is first
// written as a candidate (golden/worldgen-vN.candidate.json) and becomes golden/worldgen-vN.json
// only after the owner accepts it; earlier majors stay untouched for traceability.
import { WORLDGEN_VERSION } from '../worldgen/config';

export const GOLDEN_MAJOR = Number(WORLDGEN_VERSION.split('.')[0]);
export const GOLDEN_FINAL = `golden/worldgen-v${GOLDEN_MAJOR}.json`;
export const GOLDEN_CANDIDATE = `golden/worldgen-v${GOLDEN_MAJOR}.candidate.json`;
/** SHA-256 of golden/worldgen-v1.json as accepted for PoC 0 (worldgen 1.0.0). */
export const GOLDEN_V1_SHA256 = '035ba6857841849dd2f96029ae61e03d5c4c83c1c3b97966f47e28bd670da47a';
