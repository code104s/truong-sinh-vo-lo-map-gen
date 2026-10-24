// Camera: pans and zooms the world container. Zoom is screen pixels per render pixel
// (1.0 = CELL_PX screen pixels per cell). Wheel zooms around the cursor; drag pans.
import type { Container } from 'pixi.js';

export interface CameraState {
  zoom: number;
  /** World point (render px) at the screen centre. */
  cx: number;
  cy: number;
}

export class Camera {
  zoom = 1;
  cx = 0;
  cy = 0;
  minZoom = 0.1;
  maxZoom = 4;
  /** Called after every camera change (the app renders on demand). */
  onChange: () => void = () => {};
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  constructor(private world: Container, private view: { width: number; height: number }, private worldSize: number) {}

  apply(): void {
    this.world.scale.set(this.zoom);
    this.world.position.set(this.view.width / 2 - this.cx * this.zoom, this.view.height / 2 - this.cy * this.zoom);
    this.onChange();
  }

  set(state: CameraState): void {
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, state.zoom));
    this.cx = state.cx;
    this.cy = state.cy;
    this.clampCenter();
    this.apply();
  }

  fitZoom(margin = 0.96): number {
    return Math.min(this.view.width, this.view.height) / this.worldSize * margin;
  }

  fit(): void {
    this.set({ zoom: this.fitZoom(), cx: this.worldSize / 2, cy: this.worldSize / 2 });
  }

  screenToWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.world.position.x) / this.zoom, (sy - this.world.position.y) / this.zoom];
  }

  worldToScreen(wx: number, wy: number): [number, number] {
    return [wx * this.zoom + this.world.position.x, wy * this.zoom + this.world.position.y];
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const [wx, wy] = this.screenToWorld(sx, sy);
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
    // Keep the world point under the cursor fixed.
    this.cx = wx - (sx - this.view.width / 2) / this.zoom;
    this.cy = wy - (sy - this.view.height / 2) / this.zoom;
    this.clampCenter();
    this.apply();
  }

  private clampCenter(): void {
    const halfW = this.view.width / 2 / this.zoom, halfH = this.view.height / 2 / this.zoom;
    const S = this.worldSize;
    this.cx = halfW * 2 >= S ? S / 2 : Math.min(S - halfW, Math.max(halfW, this.cx));
    this.cy = halfH * 2 >= S ? S / 2 : Math.min(S - halfH, Math.max(halfH, this.cy));
  }

  attach(el: HTMLElement): void {
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    el.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.cx -= (e.clientX - this.lastX) / this.zoom;
      this.cy -= (e.clientY - this.lastY) / this.zoom;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.clampCenter();
      this.apply();
    });
    const end = () => { this.dragging = false; };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
}
