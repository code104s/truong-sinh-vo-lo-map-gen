// Layer 1: paper, land wash, water and coastline, drawn by one shader over a world-sized quad.
import { Geometry, Mesh, Shader, Texture } from 'pixi.js';
import type { Manifest } from '../assets/manifestTypes';
import { CELL_PX, hexToRgb01 } from './constants';
import { SDF_RANGE, type FieldImage } from './fields';

const vertex = /* glsl */ `
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}
`;

const fragment = /* glsl */ `
precision highp float;
in vec2 vUV;
out vec4 finalColor;
uniform sampler2D uData;
uniform sampler2D uSdf;
uniform float uSize;
uniform float uSdfRange;
uniform float uSdfSize;
uniform float uPxPerCell;
uniform vec3 uPaper;
uniform vec3 uInk0;
uniform vec3 uInk2;
uniform vec3 uInk3;
uniform vec3 uIndigo;
uniform vec3 uGreen;
uniform vec3 uOchre;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 1.7; a *= 0.5; }
  return s;
}

// 16-bit distance stored as two bytes (nearest-sampled): decode the four nearest texels first,
// then interpolate, because interpolating the low byte across a carry would produce garbage.
float decode16(vec2 texel) {
  vec2 v = texture(uSdf, (clamp(texel, vec2(0.0), vec2(uSdfSize - 1.0)) + 0.5) / uSdfSize).rg;
  return (v.r * 255.0 * 256.0 + v.g * 255.0) / 65535.0;
}
float sdf16(vec2 uv) {
  vec2 t = uv * uSdfSize - 0.5;
  vec2 i = floor(t);
  vec2 f = t - i;
  float a = decode16(i), b = decode16(i + vec2(1.0, 0.0));
  float c = decode16(i + vec2(0.0, 1.0)), d = decode16(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  vec2 cell = vUV * uSize;
  float px = 1.0 / max(uPxPerCell, 0.001);

  // Organic coastline: sample the distance field through a small domain warp.
  vec2 warp = (vec2(fbm(cell * 0.45), fbm(cell * 0.45 + 17.3)) - 0.5) * 0.7;
  vec4 d = texture(uData, (cell + warp) / uSize);
  float sdf = (sdf16((cell + warp) / uSize) - 0.5) * uSdfRange;
  float hgt = d.g;
  float shade = d.b;

  // Paper: long fibres plus fine grain, and a large-scale mottling for uneven wash.
  float fibre = fbm(cell * vec2(2.2, 7.5)) * 0.55 + fbm(cell * 5.3) * 0.45;
  float mott = fbm(cell * 0.06 + 3.7);
  vec3 paper = uPaper * (0.955 + 0.07 * fibre);

  float land = smoothstep(-px, px, sdf);

  // Land: pale washes only (thủy mặc ngũ sắc, màu nhạt).
  vec3 lc = paper;
  float lowland = 1.0 - smoothstep(0.3, 0.52, hgt);
  lc = mix(lc, uGreen, lowland * 0.09 * (0.5 + 1.0 * mott));
  lc = mix(lc, uOchre, smoothstep(0.36, 0.66, hgt) * 0.12 * (0.6 + 0.8 * mott));
  float shadow = clamp((0.5 - shade) * 2.4, 0.0, 1.0);
  lc = mix(lc, mix(uOchre, uInk3, 0.5), shadow * 0.16 * smoothstep(0.32, 0.55, hgt));
  float lit = clamp((shade - 0.55) * 2.0, 0.0, 1.0);
  lc = mix(lc, paper * 1.02, lit * 0.2);
  // A darker damp band just inland of the coast, as if the wash pooled at the edge.
  lc = mix(lc, uOchre, (1.0 - smoothstep(0.0, 0.6, sdf)) * 0.12);

  // Water: indigo wash strongest near the shore, fading to bare paper offshore.
  float off = clamp(-sdf / 5.0, 0.0, 1.0);
  vec3 wc = mix(paper, uIndigo, (0.42 - 0.3 * off) * (0.7 + 0.6 * mott));
  // Ripple lines parallel to the coast, broken by a dry-brush mask.
  float rip = 0.0;
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float r0 = 0.5 + fk * 0.8 + (fbm(cell * 0.4 + fk * 7.0) - 0.5) * 0.5;
    float wv = abs(-sdf - r0);
    float brk = smoothstep(0.35, 0.6, fbm(cell * 0.9 + fk * 3.1));
    rip += (1.0 - smoothstep(0.02, 0.02 + 1.2 * px, wv)) * (0.55 - fk * 0.15) * brk;
  }
  wc = mix(wc, uInk2, rip * step(sdf, 0.0) * 0.55);

  vec3 col = mix(wc, lc, land);

  // Coastline in ink: varying width, with dry-brush gaps.
  float lw = 0.025 + 0.045 * fbm(cell * 0.8);
  float coast = 1.0 - smoothstep(lw, lw + 1.2 * px, abs(sdf + 0.02));
  float dry = smoothstep(0.2, 0.7, fbm(cell * 1.7 + 9.0));
  col = mix(col, uInk0, coast * (0.3 + 0.35 * dry));
  // Soft halo of diluted ink around the line (ink bleed).
  col = mix(col, uInk3, (1.0 - smoothstep(0.0, 0.3, abs(sdf))) * 0.12);

  // Vignette: paper darkens slightly towards the edges of the map.
  vec2 q = vUV - 0.5;
  col *= 1.0 - dot(q, q) * 0.28;
  finalColor = vec4(col, 1.0);
}
`;

export interface TerrainLayer {
  mesh: Mesh<Geometry, Shader>;
  setPxPerCell(v: number): void;
}

export function createTerrainLayer(field: FieldImage, size: number, manifest: Manifest): TerrainLayer {
  const toTexture = (pixels: Uint8ClampedArray<ArrayBuffer>, scaleMode: 'linear' | 'nearest') => {
    const canvas = document.createElement('canvas');
    canvas.width = field.width;
    canvas.height = field.height;
    canvas.getContext('2d')!.putImageData(new ImageData(pixels, field.width, field.height), 0, 0);
    const t = Texture.from(canvas);
    t.source.scaleMode = scaleMode;
    t.source.addressMode = 'clamp-to-edge';
    return t;
  };
  const texture = toTexture(field.rgba, 'linear');
  const sdfTexture = toTexture(field.sdf, 'nearest');

  const W = size * CELL_PX;
  const geometry = new Geometry({
    attributes: {
      aPosition: [0, 0, W, 0, W, W, 0, W],
      aUV: [0, 0, 1, 0, 1, 1, 0, 1],
    },
    indexBuffer: [0, 1, 2, 0, 2, 3],
  });

  const pal = manifest.palette;
  const uniforms = {
    uSize: { value: size, type: 'f32' },
    uSdfRange: { value: SDF_RANGE, type: 'f32' },
    uSdfSize: { value: field.width, type: 'f32' },
    uPxPerCell: { value: CELL_PX, type: 'f32' },
    uPaper: { value: hexToRgb01(pal.paper), type: 'vec3<f32>' },
    uInk0: { value: hexToRgb01(pal.ink[0]), type: 'vec3<f32>' },
    uInk2: { value: hexToRgb01(pal.ink[2]), type: 'vec3<f32>' },
    uInk3: { value: hexToRgb01(pal.ink[3]), type: 'vec3<f32>' },
    uIndigo: { value: hexToRgb01(pal.indigo), type: 'vec3<f32>' },
    uGreen: { value: hexToRgb01(pal.green), type: 'vec3<f32>' },
    uOchre: { value: hexToRgb01(pal.ochre), type: 'vec3<f32>' },
  };
  const shader = Shader.from({
    gl: { vertex, fragment },
    resources: { uData: texture.source, uSdf: sdfTexture.source, terrainUniforms: uniforms },
  });
  const mesh = new Mesh({ geometry, shader });

  return {
    mesh,
    setPxPerCell(v: number) {
      shader.resources.terrainUniforms.uniforms.uPxPerCell = v;
    },
  };
}
