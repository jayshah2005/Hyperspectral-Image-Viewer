import type { HyperCube } from '../types';
import type { Derived, DisplayMode } from '../store';
import { colormapLUT, type ColormapName } from './colormaps';
import { getBand } from './cube';
import { renderMapped, renderRGB, type Channel } from './render';
import { sortedSample, stretchRange } from './stretch';

const bandSamples = new WeakMap<HyperCube, Map<number, Float64Array>>();
const derivedSamples = new WeakMap<Float32Array, Float64Array>();

function bandSample(cube: HyperCube, b: number): Float64Array {
  let m = bandSamples.get(cube);
  if (!m) bandSamples.set(cube, (m = new Map()));
  let s = m.get(b);
  if (!s) m.set(b, (s = sortedSample(getBand(cube, b), cube.noDataValue)));
  return s;
}

export interface DisplayParams {
  mode: DisplayMode;
  band: number;
  rgb: [number, number, number];
  colormap: ColormapName;
  lowPct: number;
  highPct: number;
  gamma: number;
  derived: Derived | null;
  showDerived: boolean;
}

export interface DisplayImage {
  canvas: HTMLCanvasElement;
  /** Value range mapped to the colour scale (single-band and derived views). */
  range: [number, number] | null;
  colormap: ColormapName | null;
}

/** Render the current view of the cube into an offscreen canvas at native resolution. */
export function renderDisplay(cube: HyperCube, p: DisplayParams): DisplayImage {
  const { width, height } = cube;
  const pixels = width * height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(width, height);

  let range: [number, number] | null = null;
  let colormap: ColormapName | null = null;

  if (p.showDerived && p.derived) {
    let s = derivedSamples.get(p.derived.data);
    if (!s) derivedSamples.set(p.derived.data, (s = sortedSample(p.derived.data)));
    range = stretchRange(s, p.lowPct, p.highPct);
    colormap = p.derived.colormap;
    renderMapped({ values: p.derived.data, lo: range[0], hi: range[1] }, pixels, colormapLUT(colormap), p.gamma, undefined, img.data);
  } else if (p.mode === 'single') {
    range = stretchRange(bandSample(cube, p.band), p.lowPct, p.highPct);
    colormap = p.colormap;
    renderMapped({ values: getBand(cube, p.band), lo: range[0], hi: range[1] }, pixels, colormapLUT(p.colormap), p.gamma, cube.noDataValue, img.data);
  } else {
    const channels = p.rgb.map((b): Channel => {
      const [lo, hi] = stretchRange(bandSample(cube, b), p.lowPct, p.highPct);
      return { values: getBand(cube, b), lo, hi };
    }) as unknown as [Channel, Channel, Channel];
    renderRGB(channels, pixels, p.gamma, cube.noDataValue, img.data);
  }

  ctx.putImageData(img, 0, 0);
  return { canvas, range, colormap };
}
