// Asset Manifest types. `logic` is part of world generation (changing it requires a
// WORLDGEN_VERSION bump); `visual` belongs to the art and can be swapped freely.

/** Silhouette family of a mountain variant: dãy, chóp, đỉnh bằng, vách, đồi. */
export type Family = 'range' | 'pinnacle' | 'flat' | 'cliff' | 'hill';
export const FAMILIES: readonly Family[] = ['range', 'pinnacle', 'flat', 'cliff', 'hill'];

export interface AssetLogic {
  /** Ground footprint in cells: [width, depth]. */
  footprint: [number, number];
  /** Number of logical variants the composer chooses from. Images map variant % images.length. */
  variants: number;
  /**
   * Family of each variant (length = variants). Worldgen picks the family from the terrain role
   * and then a variant inside it; the art draws the same family. Part of logic since 2.0.0.
   */
  variantFamilies: Family[];
}

export type AssetSource =
  | { type: 'procedural'; generator: string; params: Record<string, unknown> }
  | { type: 'image'; urls: string[] };

export interface AssetVisual {
  layer: number;
  anchor: [number, number];
  visualSize: [number, number];
  lod: { minZoom: number };
  source: AssetSource;
}

export interface AssetEntry {
  logic: AssetLogic;
  visual: AssetVisual;
}

export interface Manifest {
  version: number;
  palette: {
    paper: string;
    ink: string[];
    indigo: string;
    green: string;
    ochre: string;
    vermilion: string;
  };
  assets: Record<string, AssetEntry>;
}

export type ManifestLogic = Record<string, AssetLogic>;

export function logicOf(m: Manifest): ManifestLogic {
  const out: ManifestLogic = {};
  for (const key of Object.keys(m.assets).sort()) out[key] = m.assets[key].logic;
  return out;
}
