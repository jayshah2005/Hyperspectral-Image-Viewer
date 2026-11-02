import type { HyperCube } from '../types';
import { covers, getBand, nearestBand, nmToCubeUnits } from './cube';
import { renderRGB, type Channel } from './render';
import { sortedSample, stretchRange } from './stretch';

/**
 * Bands for the RGB view: the file's default bands if it names them, natural colour
 * (640/550/470 nm) when the wavelengths cover the visible range, else bands spread across the cube.
 */
export function rgbBands(cube: HyperCube): [number, number, number] {
  if (cube.defaultBands?.every((b) => b >= 0 && b < cube.bands)) return cube.defaultBands;
  if (covers(cube, 460, 640)) {
    return [640, 550, 470].map((nm) => nearestBand(cube, nmToCubeUnits(cube, nm))) as [number, number, number];
  }
  const B = cube.bands - 1;
  return [Math.round(B * 0.75), Math.round(B * 0.5), Math.round(B * 0.25)];
}

const rendered = new WeakMap<HyperCube, HTMLCanvasElement>();

/**
 * The RGB composite (2–98% percentile stretch per channel) as a native-resolution canvas.
 * Kept per cube: the main view and the editor share one picture.
 */
export function renderRgbImage(cube: HyperCube): HTMLCanvasElement {
  const existing = rendered.get(cube);
  if (existing) return existing;
  const { width, height } = cube;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(width, height);

  const channels = rgbBands(cube).map((b): Channel => {
    const values = getBand(cube, b);
    const [lo, hi] = stretchRange(sortedSample(values, cube.noDataValue), 2, 98);
    return { values, lo, hi };
  }) as unknown as [Channel, Channel, Channel];
  renderRGB(channels, width * height, cube.noDataValue, img.data);

  ctx.putImageData(img, 0, 0);
  rendered.set(cube, canvas);
  return canvas;
}

/**
 * RGBA pixels of a part of the image, stretched to that part's own brightness range. A single bright object such as
 * a white reference sets the exposure of the whole picture, which leaves the leaves too dark to edit. All three
 * channels share one range, so colours stay true. This only affects what is displayed.
 */
export function renderCropPicture(cube: HyperCube, rect: { x0: number; y0: number; w: number; h: number }): Uint8ClampedArray {
  const { x0, y0, w, h } = rect;
  const pixels = w * h;
  // One channel after another, so that sampling the list sees all three evenly.
  const values = new Float64Array(pixels * 3);
  rgbBands(cube).forEach((band, c) => {
    const source = getBand(cube, band);
    for (let y = 0, o = c * pixels; y < h; y++) {
      const row = (y0 + y) * cube.width + x0;
      for (let x = 0; x < w; x++) values[o++] = source[row + x];
    }
  });
  const [lo, hi] = stretchRange(sortedSample(values, cube.noDataValue), 0.5, 99.8);
  const channel = (c: number): Channel => ({ values: values.subarray(c * pixels, (c + 1) * pixels), lo, hi });
  const out = new Uint8ClampedArray(pixels * 4);
  renderRGB([channel(0), channel(1), channel(2)], pixels, cube.noDataValue, out);
  return out;
}
