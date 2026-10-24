// Every parameter that affects output bytes lives here. Changing any default = MAJOR bump of WORLDGEN_VERSION.

/** Semver. MAJOR changes whenever the same seed produces different bytes. */
export const WORLDGEN_VERSION = '1.0.0';

export interface WorldConfig {
  size: number;
  seaLevel: number;
  hillLevel: number;
  mountainLevel: number;
  /** Hydrology */
  jitter: number;
  minLakeDepth: number;
  minLakeArea: number;
  /** Largest open-water area of one depression, as a fraction of the map. */
  maxLakeArea: number;
  /** River threshold as a fraction of land cells draining through a cell. */
  riverFraction: number;
  /** Ridges */
  ridgeFraction: number;
  peakRadius: number;
  minPeakRelief: number;
  passLevel: number;
  /** Composition */
  /** Overlap of neighbouring ridge stamps along the chain, as a fraction of the smaller image. */
  ridgeOverlap: number;
}

export const DEFAULT_CONFIG: WorldConfig = {
  size: 128,
  seaLevel: 0.25,
  hillLevel: 0.44,
  mountainLevel: 0.56,
  jitter: 1e-4,
  minLakeDepth: 0.01,
  minLakeArea: 12,
  maxLakeArea: 0.012,
  riverFraction: 0.008,
  ridgeFraction: 0.006,
  peakRadius: 4,
  minPeakRelief: 0.06,
  passLevel: 0.52,
  ridgeOverlap: 0.32,
};

/** Stable string form of a config, hashed into the world header. */
export function configKey(c: WorldConfig): string {
  return (Object.keys(c) as (keyof WorldConfig)[])
    .sort()
    .map((k) => `${k}=${c[k]}`)
    .join(';');
}
