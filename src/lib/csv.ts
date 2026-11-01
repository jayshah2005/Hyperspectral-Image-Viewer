import type { HyperCube } from '../types';
import { getSpectrum } from './cube';
import type { RegionStats } from './mask';

/** RFC-style CSV field: quote when needed. */
export function csvField(v: string | number): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Empty for NaN / missing, so Excel shows a blank and pandas reads NaN. */
function num(v: number, digits: number): string {
  return Number.isFinite(v) ? String(Number(v.toPrecision(digits))) : '';
}

/** Significant digits worth writing: a float32 holds about seven, and more only prints its rounding noise. */
const digitsFor = (cube: Pick<HyperCube, 'data'>) => (cube.data instanceof Float32Array ? 7 : 15);

/** Column name for the spectral axis, or null if the file has no wavelengths. */
export function wavelengthColumn(cube: Pick<HyperCube, 'wavelengths' | 'wavelengthUnits'>): string | null {
  const wl = cube.wavelengths;
  if (!wl?.length) return null;
  const u = (cube.wavelengthUnits ?? '').toLowerCase();
  if (/micro|µm|\bum\b/.test(u)) return 'wavelength_um';
  if (/nano|\bnm\b/.test(u) || Math.max(...wl) > 100) return 'wavelength_nm';
  return 'wavelength';
}

function bandRows(cube: Pick<HyperCube, 'bands' | 'wavelengths' | 'wavelengthUnits'>, header: string[], cells: (b: number) => string[]): string {
  const wlCol = wavelengthColumn(cube);
  const lines = [['band', ...(wlCol ? [wlCol] : []), ...header].map(csvField).join(',')];
  for (let b = 0; b < cube.bands; b++) {
    lines.push([String(b + 1), ...(wlCol ? [String(cube.wavelengths![b])] : []), ...cells(b)].join(','));
  }
  return lines.join('\n') + '\n';
}

/** Names as given, made unique: repeated names would collapse columns when read back. */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return n === 1 ? name : `${name}_${n}`;
  });
}

/** One row per band; mean, std and n columns per region. The header is on line 1, so `read_csv` just works. */
export function meansCsv(cube: Pick<HyperCube, 'bands' | 'wavelengths' | 'wavelengthUnits' | 'data'>, regions: { name: string; stats: RegionStats }[]): string {
  const names = uniqueNames(regions.map((r) => r.name));
  const digits = digitsFor(cube);
  return bandRows(cube, names.flatMap((n) => [`${n}_mean`, `${n}_std`, `${n}_n`]), (b) =>
    regions.flatMap(({ stats }) => [num(stats.mean[b], digits), num(stats.std[b], digits), String(stats.n[b])]),
  );
}

/** The spectrum of one pixel. */
export function pixelCsv(cube: Pick<HyperCube, 'bands' | 'wavelengths' | 'wavelengthUnits' | 'data'>, values: ArrayLike<number>): string {
  const digits = digitsFor(cube);
  return bandRows(cube, ['value'], (b) => [num(values[b], digits)]);
}

/** Estimated size of an all-pixels export, in bytes. */
export const pixelsCsvBytes = (pixelCount: number, bands: number) => pixelCount * bands * 9;

/**
 * One row per pixel: region, x, y, then a column per band. Returned as chunks so a large region
 * becomes a Blob rather than one giant string.
 */
export function pixelsCsvParts(cube: HyperCube, labels: Uint16Array, regions: { id: number; name: string }[], rowsPerChunk = 2000): string[] {
  const names = new Map(uniqueNames(regions.map((r) => r.name)).map((n, i) => [regions[i].id, csvField(n)]));
  const axis = cube.wavelengths?.length === cube.bands ? cube.wavelengths : Array.from({ length: cube.bands }, (_, i) => `band_${i + 1}`);
  const parts = [`region,x,y,${axis.join(',')}\n`];
  const digits = digitsFor(cube);
  let rows: string[] = [];
  for (let y = 0; y < cube.height; y++) {
    for (let x = 0; x < cube.width; x++) {
      const name = names.get(labels[y * cube.width + x]);
      if (name === undefined) continue;
      const cells = Array.from(getSpectrum(cube, x, y), (v) => num(v, digits));
      rows.push(`${name},${x},${y},${cells.join(',')}`);
      if (rows.length >= rowsPerChunk) {
        parts.push(rows.join('\n') + '\n');
        rows = [];
      }
    }
  }
  if (rows.length) parts.push(rows.join('\n') + '\n');
  return parts;
}

export function safeFilename(name: string, fallback = 'spectrum'): string {
  const s = name.replace(/[^\w.\-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return s || fallback;
}
