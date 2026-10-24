// Render-space constants. World units are cells; render units are pixels at zoom 1.

/** Pixels per cell at zoom 1. The only place world units are multiplied into pixels. */
export const CELL_PX = 32;

export function worldToRender(v: number): number {
  return v * CELL_PX;
}

export function hexToRgb01(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

export function hexToNumber(hex: string): number {
  return parseInt(hex.slice(1), 16);
}
