// Layer 1 cache. The terrain shader is the most expensive draw (several fbm per pixel), but its
// picture depends only on the world and the zoom, so it is rendered into textures and drawn as
// sprites. The view texture is redrawn when the view leaves the cached area or the zoom settles
// at a new value; a whole-map backdrop fills the gaps in between.
import { Container, Matrix, RenderTexture, Sprite, type Renderer } from 'pixi.js';
import type { Camera } from './camera';
import { CELL_PX } from './constants';
import type { TerrainLayer } from './terrainLayer';

/** Texels across the whole-map backdrop. */
const BACKDROP_TEXELS = 2048;
/** Extra area cached around the view on each side, as a share of the view size. */
const MARGIN = 0.3;
/** Largest view texture side; the margin shrinks to stay under it. */
const MAX_TEXELS = 8192;
/** A new zoom is redrawn once the camera has kept it this long (ms)... */
const SETTLE_MS = 160;
/** ...or at once when the cached texture would be stretched beyond this factor. */
const MAX_STRETCH = 1.6;

interface Rect { x0: number; y0: number; x1: number; y1: number }

export class TerrainCache {
  readonly view = new Container();
  /** Number of view texture redraws, for QA. */
  bakes = 0;
  private readonly backdrop: Sprite;
  private readonly sprite = new Sprite();
  private rt: RenderTexture | null = null;
  private rect: Rect = { x0: 0, y0: 0, x1: 0, y1: 0 };
  /** Texels per render px of the view texture. */
  private scale = 0;
  private lastZoom = 0;
  private zoomChangedAt = 0;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private terrain: TerrainLayer, private renderer: Renderer, private worldPx: number, private onSettle: () => void) {
    const s = BACKDROP_TEXELS / worldPx;
    const backdrop = RenderTexture.create({ width: BACKDROP_TEXELS, height: BACKDROP_TEXELS, resolution: 1 });
    terrain.setPxPerCell(CELL_PX * s);
    renderer.render({ container: terrain.mesh, target: backdrop, clear: true, transform: new Matrix().scale(s, s) });
    this.backdrop = new Sprite(backdrop);
    this.backdrop.width = this.backdrop.height = worldPx;
    this.sprite.visible = false;
    this.view.addChild(this.backdrop, this.sprite);
  }

  /** Makes the cache fit the camera, redrawing the view texture if needed. */
  sync(camera: Camera, screen: { width: number; height: number }, resolution: number, immediate: boolean): void {
    const now = performance.now();
    if (camera.zoom !== this.lastZoom) {
      this.lastZoom = camera.zoom;
      this.zoomChangedAt = now;
    }
    const s = camera.zoom * resolution;
    const visible = this.visibleRect(camera, screen);
    const r = this.rect, eps = 1e-6;
    const inside = visible.x0 >= r.x0 - eps && visible.y0 >= r.y0 - eps && visible.x1 <= r.x1 + eps && visible.y1 <= r.y1 + eps;
    // The backdrop is only needed where the view texture does not reach (zooming out).
    this.backdrop.visible = !(this.rt && inside);
    if (this.rt && s === this.scale && inside) return;
    const stretch = s / this.scale;
    if (this.rt && s !== this.scale && !immediate && now - this.zoomChangedAt < SETTLE_MS && stretch < MAX_STRETCH && stretch > 1 / MAX_STRETCH) {
      // Still zooming: show the stretched texture over the backdrop and redraw once it settles.
      if (this.settleTimer) clearTimeout(this.settleTimer);
      this.settleTimer = setTimeout(() => { this.settleTimer = null; this.onSettle(); }, SETTLE_MS);
      return;
    }
    this.bake(camera, screen, resolution, visible);
  }

  destroy(): void {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    const textures = [this.rt, this.backdrop.texture];
    this.view.destroy({ children: true });
    for (const t of textures) t?.destroy(true);
    this.terrain.mesh.destroy();
  }

  /** The part of the map on screen, in render px. */
  private visibleRect(camera: Camera, screen: { width: number; height: number }): Rect {
    const [x0, y0] = camera.screenToWorld(0, 0);
    const [x1, y1] = camera.screenToWorld(screen.width, screen.height);
    const W = this.worldPx;
    return { x0: Math.max(0, x0), y0: Math.max(0, y0), x1: Math.min(W, x1), y1: Math.min(W, y1) };
  }

  private bake(camera: Camera, screen: { width: number; height: number }, resolution: number, visible: Rect): void {
    const s = camera.zoom * resolution;
    const W = this.worldPx;
    const viewW = screen.width / camera.zoom, viewH = screen.height / camera.zoom;
    const fit = (view: number) => Math.max(0, Math.min(MARGIN, (MAX_TEXELS / (view * s) - 1) / 2)) * view;
    const mx = fit(viewW), my = fit(viewH);
    // Device pixel of world x is x * s + ox. Texel edges sit on device pixel edges, so the
    // texture is drawn back one texel per pixel (no resampling) until the camera moves by a
    // fraction of a pixel.
    const [sx, sy] = camera.worldToScreen(0, 0);
    const ox = sx * resolution, oy = sy * resolution;
    const dx0 = Math.floor(Math.max(0, visible.x0 - mx) * s + ox), dx1 = Math.ceil(Math.min(W, visible.x1 + mx) * s + ox);
    const dy0 = Math.floor(Math.max(0, visible.y0 - my) * s + oy), dy1 = Math.ceil(Math.min(W, visible.y1 + my) * s + oy);
    const w = Math.max(1, dx1 - dx0), h = Math.max(1, dy1 - dy0);

    const old = this.rt;
    const rt = RenderTexture.create({ width: w, height: h, resolution: 1 });
    this.terrain.setPxPerCell(CELL_PX * camera.zoom);
    this.renderer.render({
      container: this.terrain.mesh, target: rt, clear: true,
      transform: new Matrix().scale(s, s).translate(ox - dx0, oy - dy0),
    });
    this.rt = rt;
    this.sprite.texture = rt;
    this.sprite.position.set((dx0 - ox) / s, (dy0 - oy) / s);
    this.sprite.scale.set(1 / s);
    this.sprite.visible = true;
    old?.destroy(true);
    this.rect = { x0: (dx0 - ox) / s, y0: (dy0 - oy) / s, x1: (dx0 - ox + w) / s, y1: (dy0 - oy + h) / s };
    this.scale = s;
    this.backdrop.visible = false;
    this.bakes++;
  }
}
