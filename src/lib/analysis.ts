import type { HyperCube } from '../types';
import { getBand, isValid } from './cube';

export interface Rect {
  x0: number;
  y0: number;
  x1: number; // exclusive
  y1: number; // exclusive
}

export interface RoiStats {
  mean: Float64Array;
  std: Float64Array;
  count: number;
}

/** Per-band mean and standard deviation over a rectangle, skipping no-data and NaN values. */
export function roiStats(cube: HyperCube, r: Rect): RoiStats {
  const { width, height, bands, data, badBands, noDataValue } = cube;
  const pixels = width * height;
  const mean = new Float64Array(bands);
  const std = new Float64Array(bands);
  let count = 0;
  for (let b = 0; b < bands; b++) {
    let n = 0;
    let s = 0;
    let ss = 0;
    if (!badBands?.[b]) {
      const off = b * pixels;
      for (let y = r.y0; y < r.y1; y++) {
        for (let x = r.x0; x < r.x1; x++) {
          const v = data[off + y * width + x];
          if (!isValid(v, noDataValue)) continue;
          n++;
          s += v;
          ss += v * v;
        }
      }
    }
    mean[b] = n ? s / n : NaN;
    std[b] = n ? Math.sqrt(Math.max(0, ss / n - (s / n) ** 2)) : NaN;
    count = Math.max(count, n);
  }
  return { mean, std, count };
}

/**
 * Spectral Angle Mapper: angle (radians) between every pixel spectrum and `ref`.
 * Bands that are bad or NaN in the reference are ignored. Invalid pixels are NaN.
 */
export function spectralAngleMap(cube: HyperCube, ref: ArrayLike<number>): Float32Array {
  const { width, height, bands, data, badBands, noDataValue } = cube;
  const pixels = width * height;
  const dot = new Float64Array(pixels);
  const nn = new Float64Array(pixels);
  const invalid = new Uint8Array(pixels);
  let rr = 0;
  for (let b = 0; b < bands; b++) {
    const rv = ref[b];
    if (badBands?.[b] || !Number.isFinite(rv)) continue;
    rr += rv * rv;
    const off = b * pixels;
    for (let p = 0; p < pixels; p++) {
      const v = data[off + p];
      if (!isValid(v, noDataValue)) {
        invalid[p] = 1;
        continue;
      }
      dot[p] += v * rv;
      nn[p] += v * v;
    }
  }
  const out = new Float32Array(pixels);
  const rNorm = Math.sqrt(rr);
  for (let p = 0; p < pixels; p++) {
    const denom = Math.sqrt(nn[p]) * rNorm;
    out[p] = invalid[p] || denom === 0 ? NaN : Math.acos(Math.min(1, Math.max(-1, dot[p] / denom)));
  }
  return out;
}

/** (A − B) / (A + B) per pixel, e.g. NDVI with A = NIR and B = red. */
export function normalizedDifference(cube: HyperCube, bandA: number, bandB: number): Float32Array {
  const a = getBand(cube, bandA);
  const b = getBand(cube, bandB);
  const out = new Float32Array(a.length);
  for (let p = 0; p < a.length; p++) {
    const va = a[p];
    const vb = b[p];
    const s = va + vb;
    out[p] = !isValid(va, cube.noDataValue) || !isValid(vb, cube.noDataValue) || s === 0 ? NaN : (va - vb) / s;
  }
  return out;
}

export interface CsvSeries {
  label: string;
  values: ArrayLike<number>;
  std?: ArrayLike<number>;
}

export function spectraToCsv(axis: { values: number[]; label: string }, series: CsvSeries[]): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const header = [esc(axis.label), ...series.flatMap((s) => (s.std ? [esc(s.label), esc(`${s.label} std`)] : [esc(s.label)]))];
  const rows = axis.values.map((x, i) =>
    [x, ...series.flatMap((s) => (s.std ? [s.values[i], s.std[i]] : [s.values[i]]))]
      .map((v) => (Number.isFinite(v) ? String(v) : ''))
      .join(','),
  );
  return [header.join(','), ...rows].join('\n');
}
