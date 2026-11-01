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
