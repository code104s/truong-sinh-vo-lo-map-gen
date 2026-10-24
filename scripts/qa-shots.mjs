// QA image set and browser determinism for gate G0.
//   node scripts/qa-shots.mjs [outDir] [--no-shots] [--seeds a,b,c]
// One Chromium page paints the stamp art once, then loads each seed in place and captures Z1, Z2,
// Z3 and a Z1 debug overlay. For every seed it records the worker hash, a main-thread hash, timings
// and colour statistics of the rendered frame (V1). Writes report.json and index.html (contact sheet).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, LAUNCH_ARGS } from './pw.mjs';
import { startServer } from './serve.mjs';

const args = process.argv.slice(2);
const noShots = args.includes('--no-shots');
const si = args.indexOf('--seeds');
const seeds = si >= 0 ? args[si + 1].split(',') : Array.from({ length: 20 }, (_, i) => `tsvl-${String(i + 1).padStart(2, '0')}`);
const outDir = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--seeds') ?? 'qa-out';
mkdirSync(outDir, { recursive: true });

const golden = existsSync('golden/worldgen-v1.json') ? JSON.parse(readFileSync('golden/worldgen-v1.json', 'utf8')) : null;

const srv = await startServer();
const browser = await chromium.launch({ args: LAUNCH_ARGS });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[page]', m.text()); });

const t0 = Date.now();
await page.goto(`${srv.url}?seed=${seeds[0]}&shot=1`);
await page.waitForFunction(() => window.__tsvl?.ready || window.__tsvl?.warnings.length, null, { timeout: 900000 });
const artMs = await page.evaluate(() => window.__tsvl.artMs);
console.log(`page ready in ${((Date.now() - t0) / 1000).toFixed(1)} s (stamp art ${Math.round(artMs)} ms)`);

// Colour statistics of the current frame: HSV and HSL saturation, ignoring the page margin.
const colourStats = () => page.evaluate(() => {
  const src = document.querySelector('#app canvas');
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(src, 0, 0);
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  let n = 0, overHsv = 0, overHsl = 0, maxHsv = 0;
  const hist = new Uint32Array(101);
  for (let i = 0; i < data.length; i += 16) {
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sv = mx === 0 ? 0 : (mx - mn) / mx;
    const l = (mx + mn) / 2;
    const sl = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1));
    n++;
    if (sv > 0.35) overHsv++;
    if (sl > 0.35) overHsl++;
    maxHsv = Math.max(maxHsv, sv);
    hist[Math.round(sv * 100)]++;
  }
  let acc = 0, p99 = 0;
  for (let k = 0; k <= 100; k++) { acc += hist[k]; if (acc >= 0.99 * n) { p99 = k / 100; break; } }
  return { overHsv: overHsv / n, overHsl: overHsl / n, maxHsv, p99Hsv: p99 };
});

const rows = [];
for (const seed of seeds) {
  if (seed !== seeds[0]) await page.evaluate((s) => window.__tsvl.loadSeed(s), seed);
  const info = await page.evaluate(() => ({ h: window.__tsvl.worldHash, stages: window.__tsvl.stageHashes, gen: window.__tsvl.genMs, build: window.__tsvl.buildMs, stamps: window.__tsvl.stats.stamps, warnings: window.__tsvl.warnings }));
  const main = await page.evaluate((s) => window.__tsvl.hashOnMain(s), seed);
  const row = {
    seed, worldHash: info.h, workerEqualsMain: info.h === main.worldHash,
    matchesNodeGolden: golden ? golden.seeds[seed]?.worldHash === info.h : null,
    genMs: Math.round(info.gen), buildMs: Math.round(info.build), stamps: info.stamps, shots: {},
  };
  if (!noShots) {
    for (const view of ['Z1', 'Z2', 'Z3']) {
      await page.evaluate((v) => { window.__tsvl.setOverlay(false); window.__tsvl.setView(v); window.__tsvl.renderNow(); }, view);
      const file = `${seed}_${view}.png`;
      await page.screenshot({ path: join(outDir, file) });
      row.shots[view] = file;
      if (view === 'Z1') row.colour = await colourStats();
    }
    await page.evaluate(() => { window.__tsvl.setOverlay(true); window.__tsvl.setView('Z1'); window.__tsvl.renderNow(); });
    const file = `${seed}_Z1_overlay.png`;
    await page.screenshot({ path: join(outDir, file) });
    row.shots.overlay = file;
  }
  rows.push(row);
  console.log(JSON.stringify({ ...row, shots: undefined }));
}

const report = {
  createdAt: new Date().toISOString(),
  browser: `chromium ${browser.version()} (headless, SwiftShader software GL)`,
  artMs: Math.round(artMs),
  allWorkerEqualsMain: rows.every((r) => r.workerEqualsMain),
  allMatchNodeGolden: golden ? rows.every((r) => r.matchesNodeGolden) : null,
  rows,
};
writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));

if (!noShots) {
  const cells = rows.map((r) => `
  <section>
    <h2>${r.seed} <small>${r.worldHash.slice(0, 12)} · ${r.stamps} stamps</small></h2>
    <div class="row">
      ${['Z1', 'Z2', 'Z3', 'overlay'].map((v) => `<figure><a href="${r.shots[v]}"><img loading="lazy" src="${r.shots[v]}"></a><figcaption>${v === 'overlay' ? 'Z1 + debug overlay' : v}</figcaption></figure>`).join('')}
    </div>
  </section>`).join('');
  writeFileSync(join(outDir, 'index.html'), `<!doctype html><meta charset="utf-8"><title>TSVL PoC 0 review</title>
<style>body{font:14px system-ui;background:#f2ede2;color:#222;margin:16px}section{margin-bottom:28px}h2{font-size:16px;margin:6px 0}
small{color:#777;font-weight:normal}.row{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}figure{margin:0}img{width:100%;border:1px solid #ccc}
figcaption{font-size:12px;color:#555}</style>
<h1>Trường Sinh Vô Lộ · PoC 0 · ${rows.length} seeds × Z1/Z2/Z3</h1>${cells}`);
}
await browser.close();
srv.close();
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
