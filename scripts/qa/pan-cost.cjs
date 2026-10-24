const { chromium } = require('playwright');
const port = process.argv[2];
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await p.goto(`http://localhost:${port}/index.html?shot=1&seed=tsvl-07`);
  await p.waitForFunction(() => window.__tsvl && window.__tsvl.ready, null, { timeout: 120000 });
  for (const v of ['Z1', 'Z2', 'Z3']) {
    const r = await p.evaluate((v) => {
      const api = window.__tsvl; api.setView(v); api.renderNow();
      const gl = document.querySelector('canvas').getContext('webgl2'); const px = new Uint8Array(4);
      gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);
      const st = { ...api.stats }; const ts = [];
      // 40 pan steps of 24 css px to the right and down, as a drag would do.
      const z = st.zoom;
      for (let i = 0; i < 40; i++) {
        const t = performance.now();
        const W = 128 * 32; const cx = W / 2 + (i - 20) * 24 / z, cy = W / 2 + (i - 20) * 12 / z;
        api.setCamera({ zoom: z, cx, cy }); api.renderNow(); gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);
        ts.push(performance.now() - t);
      }
      const s = [...ts].sort((a, b) => a - b);
      return `median ${s[20].toFixed(0)} ms, p90 ${s[36].toFixed(0)} ms, max ${s[39].toFixed(0)} ms, slow(>2x median) ${ts.filter(x => x > 2 * s[20]).length}/40`;
    }, v);
    console.log(port, v, r);
  }
  await b.close();
})();
