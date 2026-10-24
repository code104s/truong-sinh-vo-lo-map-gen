// Frame-rate sweep in headless Chromium: node scripts/bench-fps.mjs [seed]
// Headless here means SwiftShader (CPU rendering), so the numbers are a floor, not the desktop
// figure. On a real machine open the dev server with ?bench=1 and read the HUD.
import { chromium, LAUNCH_ARGS } from './pw.mjs';
import { startServer } from './serve.mjs';
const seed = process.argv[2] ?? 'tsvl-01';
const srv = await startServer();
const browser = await chromium.launch({ args: LAUNCH_ARGS });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto(`${srv.url}?seed=${seed}&bench=1`);
await page.waitForFunction(() => window.__tsvl?.benchResult, null, { timeout: 900000 });
console.log(JSON.stringify({ seed, renderer: 'SwiftShader (software)', ...(await page.evaluate(() => window.__tsvl.benchResult)) }));
await browser.close();
srv.close();
