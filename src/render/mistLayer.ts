// Layer 3: mist bands cutting across the feet of main peaks (mây cắt chân núi). Static in PoC 0.
import { Container, Sprite, Texture } from 'pixi.js';
import type { Manifest } from '../assets/manifestTypes';
import type { StampInstance } from '../worldgen/composition';
import { CELL_PX } from './constants';

function mistTexture(paper: string): Texture {
  const W = 512, H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const v = parseInt(paper.slice(1), 16);
  const rgb = `${(v >> 16) & 255},${(v >> 8) & 255},${v & 255}`;
  // Several overlapping soft ellipses make an uneven band; each fades to nothing at its rim.
  const blobs = [[0.32, 0.52, 0.28], [0.55, 0.48, 0.3], [0.74, 0.56, 0.2], [0.18, 0.58, 0.15]];
  for (const [x, y, r] of blobs) {
    ctx.save();
    ctx.translate(x * W, y * H);
    ctx.scale(1, 0.3);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * W);
    g.addColorStop(0, `rgba(${rgb},0.75)`);
    g.addColorStop(0.6, `rgba(${rgb},0.35)`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r * W, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  return Texture.from(c);
}

export function createMistLayer(stamps: StampInstance[], manifest: Manifest): Container {
  const layer = new Container();
  layer.label = 'layer3-atmosphere';
  const tex = mistTexture(manifest.palette.paper);
  for (const s of stamps) {
    if (s.role !== 'main' && s.role !== 'guest') continue;
    const e = manifest.assets[s.key];
    const sp = new Sprite(tex);
    sp.anchor.set(0.5, 0.5);
    const w = e.visual.visualSize[0] * CELL_PX * s.scale * (s.role === 'main' ? 1.9 : 1.3);
    sp.width = w;
    sp.height = w * 0.3;
    sp.position.set(s.x * CELL_PX, (s.y - e.visual.visualSize[1] * s.scale * 0.12) * CELL_PX);
    sp.alpha = s.role === 'main' ? 0.85 : 0.6;
    sp.cullable = true;
    layer.addChild(sp);
  }
  return layer;
}
