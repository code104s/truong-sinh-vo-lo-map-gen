// Deterministic randomness. Integer-only math so every JS engine produces identical sequences.

/** cyrb128: hashes a string into four 32-bit words (seed material for sfc32). */
export function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  /** Uniform float in [a, b). */
  range(a: number, b: number): number;
}

/** sfc32 PRNG (128-bit state). */
export function sfc32(a: number, b: number, c: number, d: number): Rng {
  const nextU32 = (): number => {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };
  // Warm up so similar seeds diverge.
  for (let i = 0; i < 12; i++) nextU32();
  return {
    next: () => nextU32() / 4294967296,
    int: (n: number) => Math.floor((nextU32() / 4294967296) * n),
    range: (lo: number, hi: number) => lo + (nextU32() / 4294967296) * (hi - lo),
  };
}

/** Independent stream per pipeline stage: adding draws in one stage never shifts another. */
export function rngFor(seed: string, label: string): Rng {
  const [a, b, c, d] = cyrb128(seed + ':' + label);
  return sfc32(a, b, c, d);
}

/** Numeric seed for stateless hashing, derived once per world. */
export function seedToU32(seed: string): number {
  return cyrb128(seed)[0];
}

/**
 * Stateless position hash (order-independent): same inputs give the same 32-bit
 * result no matter when or in which order it is called.
 */
export function hash32(seed: number, x: number, y: number, salt: number): number {
  let h = (seed ^ Math.imul(x | 0, 0x27d4eb2d)) | 0;
  h = (h ^ Math.imul(y | 0, 0x165667b1)) | 0;
  h = (h ^ Math.imul(salt | 0, 0x9e3779b1)) | 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca77);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae3d);
  h ^= h >>> 16;
  return h >>> 0;
}

/** hash32 mapped to [0, 1). */
export function hash01(seed: number, x: number, y: number, salt: number): number {
  return hash32(seed, x, y, salt) / 4294967296;
}
