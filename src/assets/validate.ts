// Minimal structural validation for the Asset Manifest. Returns a list of problems; an empty
// list means the manifest is usable. Invalid entries fall back to procedural placeholders.
import { FAMILIES, type Manifest } from './manifestTypes';

const isPair = (v: unknown): v is [number, number] =>
  Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && Number.isFinite(x));

export function validateManifest(m: unknown): string[] {
  const errs: string[] = [];
  if (!m || typeof m !== 'object') return ['manifest is not an object'];
  const mm = m as Partial<Manifest>;
  if (typeof mm.version !== 'number') errs.push('version must be a number');
  if (!mm.palette || typeof mm.palette.paper !== 'string' || !Array.isArray(mm.palette.ink) || mm.palette.ink.length !== 5) {
    errs.push('palette needs paper and exactly 5 ink tones');
  }
  if (!mm.assets || typeof mm.assets !== 'object') return [...errs, 'assets missing'];
  for (const [key, e] of Object.entries(mm.assets)) {
    if (!e || typeof e !== 'object') { errs.push(`${key}: entry is not an object`); continue; }
    if (!e.logic || !isPair(e.logic.footprint)) errs.push(`${key}: logic.footprint must be [w, d]`);
    if (!e.logic || !Number.isInteger(e.logic.variants) || e.logic.variants < 1) errs.push(`${key}: logic.variants must be a positive integer`);
    else if (!Array.isArray(e.logic.variantFamilies) || e.logic.variantFamilies.length !== e.logic.variants
      || !e.logic.variantFamilies.every((f) => FAMILIES.includes(f))) {
      errs.push(`${key}: logic.variantFamilies must list one of ${FAMILIES.join('/')} per variant`);
    }
    const v = e.visual;
    if (!v) { errs.push(`${key}: visual missing`); continue; }
    if (!isPair(v.anchor)) errs.push(`${key}: visual.anchor must be [x, y]`);
    if (!isPair(v.visualSize)) errs.push(`${key}: visual.visualSize must be [w, h]`);
    if (!v.source || (v.source.type !== 'procedural' && v.source.type !== 'image')) errs.push(`${key}: visual.source.type must be procedural or image`);
    else if (v.source.type === 'image' && (!Array.isArray(v.source.urls) || v.source.urls.length === 0)) errs.push(`${key}: image source needs urls`);
  }
  return errs;
}
