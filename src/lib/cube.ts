import type { CubeArray, HyperCube } from '../types';
import { dtypeOf } from './dtypes';

export function isValid(v: number, noData: number | undefined): boolean {
  return Number.isFinite(v) && v !== noData;
}

/** Spectrum at a pixel; no-data values and bad bands become NaN. */
export function getSpectrum(cube: HyperCube, x: number, y: number): Float64Array {
  const { width, height, bands, data, badBands, noDataValue } = cube;
  const out = new Float64Array(bands);
  const pixels = width * height;
  let i = y * width + x;
  for (let b = 0; b < bands; b++, i += pixels) {
    const v = data[i];
    out[b] = badBands?.[b] || !isValid(v, noDataValue) ? NaN : v;
  }
  return out;
}

export function getBand(cube: HyperCube, b: number): CubeArray {
  const pixels = cube.width * cube.height;
  return cube.data.subarray(b * pixels, (b + 1) * pixels) as CubeArray;
}

export function nearestBand(cube: HyperCube, wavelength: number): number {
  const wl = cube.wavelengths;
  if (!wl) return 0;
  let best = 0;
  for (let i = 1; i < wl.length; i++) if (Math.abs(wl[i] - wavelength) < Math.abs(wl[best] - wavelength)) best = i;
  return best;
}

/** Convert a value in nm to the cube's wavelength units. */
export function nmToCubeUnits(cube: HyperCube, nm: number): number {
  const u = (cube.wavelengthUnits ?? '').toLowerCase();
  if (/micro|µm|um/.test(u)) return nm / 1000;
  return nm;
}

/** Whether the wavelength list covers a given range (in nm). */
export function covers(cube: HyperCube, fromNm: number, toNm: number): boolean {
  const wl = cube.wavelengths;
  if (!wl?.length) return false;
  const lo = Math.min(...wl);
  const hi = Math.max(...wl);
  return lo <= nmToCubeUnits(cube, fromNm) && hi >= nmToCubeUnits(cube, toNm);
}

/** X values for plots: wavelengths when they are usable (strictly increasing), else 1-based band numbers. */
export function spectralAxis(cube: HyperCube): { values: number[]; label: string; isWavelength: boolean } {
  const wl = cube.wavelengths;
  if (wl && wl.every((v, i) => i === 0 || v > wl[i - 1])) {
    return { values: wl, label: `Wavelength${cube.wavelengthUnits ? ` (${cube.wavelengthUnits})` : ''}`, isWavelength: true };
  }
  return { values: Array.from({ length: cube.bands }, (_, i) => i + 1), label: 'Band', isWavelength: false };
}

export function bandLabel(cube: HyperCube, b: number): string {
  const wl = cube.wavelengths?.[b];
  const name = cube.bandNames?.[b];
  const parts = [`Band ${b + 1}`];
  if (wl !== undefined) parts.push(`${+wl.toFixed(2)} ${cube.wavelengthUnits ?? ''}`.trim());
  else if (name) parts.push(name);
  return parts.join(' · ');
}

export function describeCube(cube: HyperCube): string {
  return `${cube.width} × ${cube.height} px · ${cube.bands} bands · ${dtypeOf(cube.data)}`;
}
