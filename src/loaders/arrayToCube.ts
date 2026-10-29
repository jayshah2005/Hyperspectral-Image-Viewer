import { allocateLike } from '../lib/dtypes';
import type { Axes, CubeArray, NdArray } from '../types';

/** Drop length-1 dimensions, keeping the memory layout valid. */
export function squeeze(arr: NdArray): NdArray {
  const shape = arr.shape.filter((d) => d !== 1);
  return { ...arr, shape: shape.length ? shape : [1] };
}

export function isCubeShape(shape: number[]): boolean {
  return shape.filter((d) => d !== 1).length === 3;
}

/**
 * Guess the axis mapping. Spectral axes are almost always first or last; if the other two
 * dimensions are equal (a square image, e.g. Indian Pines 145×145×200) that settles it,
 * otherwise the smaller of the outer dimensions is taken as bands. The rest are rows then columns.
 */
export function guessAxes(shape: number[]): Axes {
  if (shape.length !== 3) throw new Error(`Expected a 3-D array, got shape [${shape.join(', ')}].`);
  const [d0, d1, d2] = shape;
  let b: number;
  if (d0 === d1 && d2 !== d0) b = 2;
  else if (d1 === d2 && d0 !== d1) b = 0;
  else b = d0 < d2 ? 0 : 2;
  const [y, x] = [0, 1, 2].filter((i) => i !== b);
  return { y, x, b };
}

function strides(shape: number[], order: 'C' | 'F'): number[] {
  const s = new Array(shape.length).fill(1);
  if (order === 'C') for (let i = shape.length - 2; i >= 0; i--) s[i] = s[i + 1] * shape[i + 1];
  else for (let i = 1; i < shape.length; i++) s[i] = s[i - 1] * shape[i - 1];
  return s;
}

/**
 * Reorder a 3-D array into band-sequential layout (data[b*H*W + y*W + x]).
 * Returns the input storage untouched when it is already BSQ.
 */
export function toBSQ(arr: NdArray, axes: Axes): { data: CubeArray; width: number; height: number; bands: number } {
  const { shape } = arr;
  if (shape.length !== 3) throw new Error(`Expected a 3-D array, got shape [${shape.join(', ')}].`);
  if (new Set([axes.x, axes.y, axes.b]).size !== 3 || [axes.x, axes.y, axes.b].some((a) => a < 0 || a > 2)) {
    throw new Error('Axis mapping must assign rows, columns and bands to three different dimensions.');
  }
  const height = shape[axes.y];
  const width = shape[axes.x];
  const bands = shape[axes.b];
  const st = strides(shape, arr.order);
  const sy = st[axes.y];
  const sx = st[axes.x];
  const sb = st[axes.b];

  if (sx === 1 && sy === width && sb === width * height) {
    return { data: arr.data, width, height, bands };
  }

  const out = allocateLike(arr.data, width * height * bands);
  const src = arr.data;
  let o = 0;
  for (let b = 0; b < bands; b++) {
    const ob = b * sb;
    for (let y = 0; y < height; y++) {
      let i = ob + y * sy;
      for (let x = 0; x < width; x++, i += sx) out[o++] = src[i];
    }
  }
  return { data: out, width, height, bands };
}
