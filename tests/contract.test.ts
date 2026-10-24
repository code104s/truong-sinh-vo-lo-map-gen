// Static checks of the determinism contract and the asset manifest.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateManifest } from '../src/assets/validate';
import { manifest } from './worlds';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const BANNED: [RegExp, string][] = [
  [/Math\.(sin|cos|tan|asin|acos|atan|atan2|exp|expm1|log|log1p|log2|log10|pow|hypot|cbrt|sinh|cosh|tanh|random)\s*\(/, 'non-portable Math function'],
  [/\*\*/, 'exponent operator (Math.pow semantics)'],
  [/\bDate\b|performance\.now|crypto\.getRandomValues/, 'clock or entropy source'],
  [/from ['"]pixi\.js['"]|\bdocument\.|\bwindow\./, 'renderer or DOM dependency'],
  [/\bfor\s*\(\s*(const|let|var)\s+\w+\s+in\b/, 'for…in (key order)'],
];

describe('determinism contract (lint)', () => {
  it('the patterns catch what they should', () => {
    const hit = (code: string) => BANNED.some(([re]) => re.test(code));
    expect(['Math.sin(a)', 'Math.random()', 'x ** 2', 'Date.now()', "import { Sprite } from 'pixi.js'", 'for (const k in o)'].every(hit)).toBe(true);
    expect(['Math.sqrt(a)', 'Math.floor(x)', 'Math.imul(a, b)', 'for (const k of o)'].some(hit)).toBe(false);
  });

  const files = [...sources('src/core'), ...sources('src/worldgen')];
  it.each(files)('%s uses no banned API', (file) => {
    const text = readFileSync(file, 'utf8').split('\n')
      .map((l) => l.replace(/\/\/.*$/, ''))
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [re, why] of BANNED) expect(re.test(text), `${file}: ${why}`).toBe(false);
  });
});

describe('asset manifest', () => {
  it('the shipped manifest validates', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('rejects broken entries with readable errors', () => {
    const bad = JSON.parse(JSON.stringify(manifest));
    bad.assets['mountain.tall'].logic.footprint = [1];
    bad.assets['hill'].visual.source = { type: 'image', urls: [] };
    bad.palette.ink = bad.palette.ink.slice(0, 3);
    const errs = validateManifest(bad);
    expect(errs.some((e) => e.includes('mountain.tall') && e.includes('footprint'))).toBe(true);
    expect(errs.some((e) => e.includes('hill') && e.includes('urls'))).toBe(true);
    expect(errs.some((e) => e.includes('5 ink'))).toBe(true);
  });
});
