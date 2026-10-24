// Silhouette diversity of the stamp art: per-variant descriptors and pairwise mask IoU.
//   node scripts/art-metrics.mjs [out.json]   (needs `vite build` first)
import { writeFileSync } from 'node:fs';
import { chromium, LAUNCH_ARGS } from './pw.mjs';
import { startServer } from './serve.mjs';
const [out = 'art-metrics.json'] = process.argv.slice(2);
const srv = await startServer(4176);
const browser = await chromium.launch({ args: LAUNCH_ARGS });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(`${srv.url}art.html?scale=0.25`, { waitUntil: 'commit' });
await page.waitForSelector('body[data-ready="1"]', { timeout: 600000 });
const art = await page.evaluate(() => window.__art);
await browser.close(); srv.close();
const all = [];
for (const [key, list] of Object.entries(art)) list.forEach((v, i) => all.push({ key, variant: i, ...v }));
const iou = (a, b) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { if (a[k] || b[k]) u++; if (a[k] && b[k]) i++; } return u ? i / u : 1; };
const pairs = [];
for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (all[i].key !== 'hill' && all[j].key !== 'hill') pairs.push(iou(all[i].mask, all[j].mask));
pairs.sort((a, b) => a - b);
const q = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
// A10 rules, fixed in docs/worldgen/phase2/00-baseline.md before the art was changed. "Low" for a
// hill = silhouette at most half the height of its art frame.
const RULES = {
  range: (r) => r.aspect >= 1.8 && r.peaks >= 3,
  pinnacle: (r) => r.aspect <= 0.85 && r.peaks === 1,
  flat: (r) => r.topFlat >= 0.35,
  cliff: (r) => r.symmetry <= 0.6,
  hill: (r) => r.aspect >= 2.2 && r.height <= 0.5,
};
const rows = all.map(({ mask, ...r }) => ({ ...r, aspect: +r.aspect.toFixed(2), topFlat: +r.topFlat.toFixed(3), symmetry: +r.symmetry.toFixed(3), height: +(r.height ?? 0).toFixed(3), ok: r.family ? RULES[r.family](r) : null }));
const fam = {};
for (const r of rows) if (r.family) { fam[r.family] ??= { n: 0, ok: 0 }; fam[r.family].n++; if (r.ok) fam[r.family].ok++; }
const okShare = rows.filter((r) => r.ok).length / rows.length;
const summary = { mountainPairIoU: { p10: +q(pairs, 0.1).toFixed(3), p50: +q(pairs, 0.5).toFixed(3), p90: +q(pairs, 0.9).toFixed(3) }, familyMatch: { share: +okShare.toFixed(3), byFamily: fam }, rows };
writeFileSync(out, JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary.mountainPairIoU), JSON.stringify(summary.familyMatch));
for (const r of rows) console.log(r.key.padEnd(14), String(r.variant).padStart(2), (r.family ?? '').padEnd(9), r.ok ? 'ok ' : 'NO ', 'aspect', r.aspect, 'flat', r.topFlat, 'peaks', r.peaks, 'sym', r.symmetry, 'h', r.height);
