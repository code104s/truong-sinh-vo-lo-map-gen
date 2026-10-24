// Grid helpers. Cell index = y * width + x; 8-neighbourhood in a fixed order.

export const DX8 = [1, 1, 0, -1, -1, -1, 0, 1] as const;
export const DY8 = [0, 1, 1, 1, 0, -1, -1, -1] as const;
export const DIST8 = [1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2] as const;

export function inBounds(w: number, h: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < w && y < h;
}

export function isEdge(w: number, h: number, x: number, y: number): boolean {
  return x === 0 || y === 0 || x === w - 1 || y === h - 1;
}
