// Layer 2: mountain and hill stamps. Sprites are created from SceneComposition in draw order
// (north to south), so southern mountains overlap northern ones.
import { Assets, Container, Sprite, Texture } from 'pixi.js';
import type { Manifest } from '../assets/manifestTypes';
import type { StampInstance } from '../worldgen/composition';
import { CELL_PX } from './constants';
import { paintMountain, paintProceduralArt } from './stampArt';

export type ArtTextures = Map<string, Texture[]>;

/** Loads image sources and paints procedural ones. Failed images fall back to procedural art. */
export async function loadArt(manifest: Manifest): Promise<{ textures: ArtTextures; warnings: string[] }> {
  const textures: ArtTextures = new Map();
  const warnings: string[] = [];
  for (const [key, canvases] of paintProceduralArt(manifest)) {
    textures.set(key, canvases.map((c) => Texture.from(c)));
  }
  for (const key of Object.keys(manifest.assets).sort()) {
    const entry = manifest.assets[key];
    if (entry.visual.source.type !== 'image') continue;
    try {
      const loaded: Texture[] = [];
      for (const url of entry.visual.source.urls) loaded.push(await Assets.load<Texture>(url));
      textures.set(key, loaded);
    } catch (err) {
      warnings.push(`${key}: image failed to load (${String(err)}), using procedural placeholder`);
      const list: Texture[] = [];
      for (let v = 0; v < entry.logic.variants; v++) {
        list.push(Texture.from(paintMountain(entry, v, key, manifest.palette, key === 'hill' ? 'hill.v1' : 'mountain.v1')));
      }
      textures.set(key, list);
    }
  }
  for (const list of textures.values()) for (const t of list) t.source.scaleMode = 'linear';
  return { textures, warnings };
}

/** Sprite treatment of the three ink layers (near / mid / far) chosen by StampInstance.tone. */
export const INK_LAYER = {
  far: { alpha: 0.82, tint: 0xe8ecec },
  mid: { alpha: 0.95, tint: 0xffffff },
  near: { alpha: 1, tint: 0xddd6cb },
} as const;

export interface StampSprite {
  sprite: Sprite;
  stamp: StampInstance;
}

export function createStampLayer(stamps: StampInstance[], manifest: Manifest, art: ArtTextures): { layer: Container; sprites: StampSprite[] } {
  const layer = new Container();
  layer.label = 'layer2-scenery';
  const sprites: StampSprite[] = [];
  for (const s of stamps) {
    const entry = manifest.assets[s.key];
    const list = art.get(s.key);
    if (!entry || !list || list.length === 0) continue;
    const tex = list[s.variant % list.length];
    const sp = new Sprite(tex);
    sp.anchor.set(entry.visual.anchor[0], entry.visual.anchor[1]);
    const w = entry.visual.visualSize[0] * CELL_PX * s.scale;
    const h = entry.visual.visualSize[1] * CELL_PX * s.scale * s.squash;
    sp.width = w;
    sp.height = h;
    if (s.flip) sp.scale.x = -Math.abs(sp.scale.x);
    sp.position.set(s.x * CELL_PX, s.y * CELL_PX);
    // Ink layers from the composer's tone: far masses paler and cooler, near ones darker and warmer.
    sp.alpha = s.tone < 0 ? INK_LAYER.far.alpha : s.tone > 0 ? INK_LAYER.near.alpha : INK_LAYER.mid.alpha;
    sp.tint = s.tone < 0 ? INK_LAYER.far.tint : s.tone > 0 ? INK_LAYER.near.tint : INK_LAYER.mid.tint;
    sp.cullable = true;
    layer.addChild(sp);
    sprites.push({ sprite: sp, stamp: s });
  }
  return { layer, sprites };
}
