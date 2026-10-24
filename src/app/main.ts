// PoC 0 bootstrap: generate the world in a worker, build the five layers, wire the camera.
import { Application, Container } from 'pixi.js';
import manifestJson from '../assets/manifest.json';
import { logicOf, type Manifest } from '../assets/manifestTypes';
import { validateManifest } from '../assets/validate';
import { Camera, type CameraState } from '../render/camera';
import { CELL_PX, hexToNumber } from '../render/constants';
import { buildFieldImage, sampleSdf } from '../render/fields';
import { buildHydroView } from '../render/hydroView';
import { createMistLayer } from '../render/mistLayer';
import { createOverlay } from '../render/overlay';
import { createRiverLayer } from '../render/riverLayer';
import { createStampLayer, loadArt, type StampSprite } from '../render/stampLayer';
import { TerrainCache } from '../render/terrainCache';
import { createTerrainLayer } from '../render/terrainLayer';
import { generateWorld, hashWorld, type WorldData, type WorldHashes } from '../worldgen/index';
import { reviewView, type ViewName } from './views';

const params = new URLSearchParams(location.search);
const seed = params.get('seed') ?? 'tsvl-01';
const shot = params.get('shot') === '1';
if (shot) document.body.classList.add('shot');

interface DebugApi {
  ready: boolean;
  seed: string;
  worldHash?: string;
  stageHashes?: Record<string, string>;
  genMs?: number;
  buildMs?: number;
  artMs?: number;
  warnings: string[];
  setView(name: ViewName): void;
  /** Sets the camera directly (QA before/after shots pin Z2/Z3 to an earlier version's camera). */
  setCamera(state: CameraState): void;
  setOverlay(on: boolean): void;
  /** Replaces the world in place (art is painted once per page). */
  loadSeed(seed: string): Promise<void>;
  /** Generates on the main thread, for the worker-vs-main determinism check. */
  hashOnMain(seed: string): Promise<{ worldHash: string; stages: Record<string, string> }>;
  frameStats(): { fps: number; frames: number[] };
  resetFrames(): void;
  /** Updates culling and renders one frame (shot mode renders only through this). */
  renderNow(): void;
  /** Result of the scripted zoom sweep (?bench=1). */
  benchResult?: { seconds: number; frames: number; avgFps: number; p5Fps: number; minFps: number };
  stats: Record<string, number>;
}
const api: DebugApi = {
  ready: false, seed, warnings: [], stats: {},
  setView: () => {}, setCamera: () => {}, setOverlay: () => {}, loadSeed: async () => {}, hashOnMain: async () => ({ worldHash: '', stages: {} }),
  frameStats: () => ({ fps: 0, frames: [] }), resetFrames: () => {}, renderNow: () => {},
};
(window as unknown as { __tsvl: DebugApi }).__tsvl = api;

function generateInWorker(s: string): Promise<{ world: WorldData; hashes: WorldHashes; genMs: number }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worldgen.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => { resolve(e.data); worker.terminate(); };
    worker.onerror = (e) => reject(e);
    worker.postMessage({ seed: s });
  });
}

interface Built {
  world: WorldData;
  layers: Container[];
  overlay: Container;
  terrain: TerrainCache;
  rivers: Container;
  riversFar: Container;
  sprites: StampSprite[];
  bounds: { x0: number; y0: number; x1: number; y1: number }[];
}

async function main(): Promise<void> {
  const problems = validateManifest(manifestJson);
  if (problems.length) api.warnings.push(...problems.map((p) => `manifest: ${p}`));
  const manifest = manifestJson as unknown as Manifest;

  const app = new Application();
  await app.init({
    resizeTo: window,
    background: hexToNumber(manifest.palette.paper),
    antialias: true,
    preference: 'webgl',
    preserveDrawingBuffer: true,
    autoDensity: true,
    resolution: shot ? 1 : Math.min(2, window.devicePixelRatio || 1),
  });
  document.getElementById('app')!.appendChild(app.canvas);

  // Stamp art does not depend on the seed: paint it once, in parallel with the first world.
  const tArt = performance.now();
  const artPromise = loadArt(manifest).then((a) => { api.artMs = performance.now() - tArt; return a; });

  const worldRoot = new Container();
  worldRoot.label = 'world';
  app.stage.addChild(worldRoot);
  let camera: Camera | null = null;
  let built: Built | null = null;
  let overlayOn = params.get('overlay') === '1';

  // The map is static, so frames are rendered on demand (camera, layer toggles, resize) instead
  // of on every tick. Frame times are kept only for runs of back-to-back frames, as an fps figure
  // while the camera moves. Shot mode renders only through renderNow().
  app.ticker.stop();
  const hud = document.getElementById('hud')!;
  const frames: number[] = [];
  let lastFrame = 0;
  let frameQueued = false;
  function requestRender(): void {
    if (shot || frameQueued) return;
    frameQueued = true;
    requestAnimationFrame((now) => {
      frameQueued = false;
      if (lastFrame && now - lastFrame < 250) {
        frames.push(now - lastFrame);
        if (frames.length > 600) frames.shift();
      }
      lastFrame = now;
      update();
      app.render();
    });
  }

  async function build(s: string): Promise<void> {
    api.ready = false;
    const [{ world, hashes, genMs }, art] = await Promise.all([generateInWorker(s), artPromise]);
    const t0 = performance.now();
    const size = world.config.size;
    if (built) {
      built.terrain.destroy();
      for (const child of worldRoot.removeChildren()) child.destroy({ children: true });
    }

    // Layer 1: paper, terrain, water (+ rivers drawn as vectors on top of the shader).
    const layer1 = new Container();
    layer1.label = 'layer1-ground';
    const hydroView = buildHydroView(world);
    const field = buildFieldImage(world, hydroView);
    const terrain = new TerrainCache(createTerrainLayer(field, size, manifest), app.renderer, size * CELL_PX, requestRender);
    layer1.addChild(terrain.view);
    // Rivers in two LODs: true scale from zoom 0.5 up, widened below so the network still frames Z1.
    const sdAt = (x: number, y: number) => sampleSdf(field, x, y);
    const rivers = createRiverLayer(world, manifest, hydroView, sdAt);
    const riversFar = createRiverLayer(world, manifest, hydroView, sdAt, 2.4);
    layer1.addChild(rivers, riversFar);

    // Layer 2: mountains and hills.
    if (!built) api.warnings.push(...art.warnings);
    const { layer: layer2, sprites } = createStampLayer(world.composition.stamps, manifest, art.textures);

    // Layer 3: mist. Layers 4 and 5 exist but stay empty in PoC 0.
    const layer3 = createMistLayer(world.composition.stamps, manifest);
    const layer4 = new Container();
    layer4.label = 'layer4-structures';
    const layer5 = new Container();
    layer5.label = 'layer5-actors';
    const layers = [layer1, layer2, layer3, layer4, layer5];
    worldRoot.addChild(...layers);

    const overlay = createOverlay(world, manifest);
    overlay.visible = overlayOn;
    worldRoot.addChild(overlay);

    if (!camera) {
      camera = new Camera(worldRoot, app.screen, size * CELL_PX);
      camera.minZoom = Math.min(0.2, camera.fitZoom() * 0.9);
      camera.attach(app.canvas);
      camera.onChange = requestRender;
      camera.fit();
    }

    // Manual culling against world-space bounds of each stamp sprite (render px).
    const bounds = sprites.map(({ sprite }) => {
      const x0 = sprite.x - Math.abs(sprite.width) * sprite.anchor.x, y0 = sprite.y - sprite.height * sprite.anchor.y;
      return { x0, y0, x1: x0 + Math.abs(sprite.width), y1: y0 + sprite.height };
    });
    built = { world, layers, overlay, terrain, rivers, riversFar, sprites, bounds };

    api.seed = s;
    api.worldHash = hashes.worldHash;
    api.stageHashes = hashes.stages;
    api.genMs = genMs;
    api.buildMs = performance.now() - t0;
    api.stats.stamps = sprites.length;
    // Two frames so textures are uploaded before anyone screenshots.
    if (shot) app.render();
    else {
      requestRender();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    api.ready = true;
  }

  const update = () => {
    if (!built || !camera) return;
    const { terrain, sprites, bounds, world } = built;
    terrain.sync(camera, app.screen, app.renderer.resolution, shot);
    built.riversFar.visible = camera.zoom < 0.5;
    built.rivers.visible = !built.riversFar.visible;
    const [vx0, vy0] = camera.screenToWorld(0, 0);
    const [vx1, vy1] = camera.screenToWorld(app.screen.width, app.screen.height);
    let visible = 0;
    for (let i = 0; i < sprites.length; i++) {
      const b = bounds[i];
      const on = b.x1 >= vx0 && b.x0 <= vx1 && b.y1 >= vy0 && b.y0 <= vy1;
      sprites[i].sprite.visible = on;
      if (on) visible++;
    }
    api.stats.visibleStamps = visible;
    api.stats.zoom = camera.zoom;
    if (!shot) {
      const recent = frames.slice(-60);
      const fps = recent.length ? `${(1000 / (recent.reduce((a, b) => a + b, 0) / recent.length)).toFixed(0)} fps` : 'idle';
      hud.textContent = `seed ${api.seed}   worldHash ${(api.worldHash ?? '').slice(0, 12)}   v${world.worldgenVersion}\n`
        + `zoom ${camera.zoom.toFixed(2)}   ${fps}   stamps ${visible}/${sprites.length}\n`
        + `D overlay · 1–5 layers · wheel zoom · drag pan`;
    }
  };

  window.addEventListener('keydown', (e) => {
    if (!built) return;
    if (e.key === 'd' || e.key === 'D') { overlayOn = !overlayOn; built.overlay.visible = overlayOn; }
    const k = Number(e.key);
    if (k >= 1 && k <= 5) built.layers[k - 1].visible = !built.layers[k - 1].visible;
    requestRender();
  });
  window.addEventListener('resize', requestRender);

  api.setView = (name) => { if (built && camera) camera.set(reviewView(built.world, name, camera.fitZoom())); };
  api.setCamera = (state) => { if (camera) camera.set(state); };
  api.setOverlay = (on) => { overlayOn = on; if (built) built.overlay.visible = on; requestRender(); };
  api.loadSeed = (s) => build(s);
  api.hashOnMain = async (s) => {
    const logic = logicOf(manifest);
    return hashWorld(generateWorld(s, logic), logic);
  };
  api.frameStats = () => ({ fps: 1000 / (frames.reduce((a, b) => a + b, 0) / Math.max(1, frames.length)), frames: [...frames] });
  api.resetFrames = () => { frames.length = 0; lastFrame = 0; };
  api.renderNow = () => { update(); app.render(); };

  await build(seed);
  const view = params.get('view') as ViewName | null;
  if (view) api.setView(view);
  if (shot) api.renderNow();
  if (params.get('bench') === '1') await zoomSweep();

  /** Scripted 10 s sweep: fit → zoom 2 over the main range → back, panning across the map. */
  async function zoomSweep(): Promise<void> {
    if (!built || !camera) return;
    const cam = camera;
    const size = built.world.config.size * CELL_PX;
    const fit = cam.fitZoom();
    const seconds = 10;
    const times: number[] = [];
    await new Promise<void>((resolve) => {
      const start = performance.now();
      let prev = start;
      const step = (now: number) => {
        const t = (now - start) / 1000;
        if (t > 0) times.push(now - prev);
        prev = now;
        const u = Math.min(1, t / seconds);
        const z = fit * Math.pow(2 / fit, Math.sin(Math.PI * u));
        cam.set({ zoom: z, cx: size * (0.25 + 0.5 * u), cy: size * (0.5 + 0.2 * Math.sin(2 * Math.PI * u)) });
        if (u < 1) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
    const fps = times.slice(1).map((dt) => 1000 / dt).sort((a, b) => a - b);
    const avg = 1000 / (times.slice(1).reduce((a, b) => a + b, 0) / Math.max(1, fps.length));
    api.benchResult = { seconds, frames: fps.length, avgFps: avg, p5Fps: fps[Math.floor(fps.length * 0.05)] ?? 0, minFps: fps[0] ?? 0 };
    const r = api.benchResult;
    document.getElementById('hud')!.textContent = `bench: ${r.frames} frames, avg ${r.avgFps.toFixed(1)} fps, p5 ${r.p5Fps.toFixed(1)} fps, min ${r.minFps.toFixed(1)} fps`;
  }
}

main().catch((err) => {
  api.warnings.push(String(err));
  console.error(err);
});
