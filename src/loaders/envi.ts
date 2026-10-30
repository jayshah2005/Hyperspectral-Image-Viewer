import { readTyped } from '../lib/dtypes';
import type { Axes, DType, HyperCube } from '../types';
import { toBSQ } from './arrayToCube';

export interface EnviHeader {
  samples: number;
  lines: number;
  bands: number;
  headerOffset: number;
  dtype: DType;
  interleave: 'bsq' | 'bil' | 'bip';
  littleEndian: boolean;
  wavelengths?: number[];
  wavelengthUnits?: string;
  bandNames?: string[];
  badBands?: boolean[];
  noDataValue?: number;
  defaultBands?: [number, number, number];
  /** ENVI `reflectance scale factor`: stored value / factor = reflectance. */
  reflectanceScale?: number;
}

const ENVI_TYPES: Record<number, DType> = {
  1: 'uint8',
  2: 'int16',
  3: 'int32',
  4: 'float32',
  5: 'float64',
  12: 'uint16',
  13: 'uint32',
  14: 'int64',
  15: 'uint64',
};

/** Parse "key = value" pairs; braced values may span several lines. Keys are lower-cased. */
export function parseHeaderFields(text: string): Map<string, string> {
  const fields = new Map<string, string>();
  const re = /^[ \t]*([^=\n{}]+?)[ \t]*=[ \t]*(\{[\s\S]*?\}|[^\n]*)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) fields.set(m[1].trim().toLowerCase(), m[2].trim());
  return fields;
}

function list(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return value
    .replace(/^\{|\}$/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function numList(value: string | undefined): number[] | undefined {
  const l = list(value)?.map(Number);
  return l && l.every(Number.isFinite) ? l : undefined;
}

export function parseEnviHeader(text: string): EnviHeader {
  if (!/^\s*ENVI/.test(text)) throw new Error('Not an ENVI header (missing "ENVI" on the first line).');
  const f = parseHeaderFields(text);
  const int = (key: string, fallback?: number) => {
    const v = f.get(key);
    if (v === undefined) {
      if (fallback !== undefined) return fallback;
      throw new Error(`ENVI header is missing "${key}".`);
    }
    return parseInt(v, 10);
  };

  const samples = int('samples');
  const lines = int('lines');
  const bands = int('bands');
  const typeCode = int('data type');
  const dtype = ENVI_TYPES[typeCode];
  if (!dtype) throw new Error(`Unsupported ENVI data type ${typeCode} (complex data is not supported).`);
  const interleave = (f.get('interleave') ?? 'bsq').toLowerCase() as EnviHeader['interleave'];
  if (!['bsq', 'bil', 'bip'].includes(interleave)) throw new Error(`Unknown interleave "${interleave}".`);

  const wavelengths = numList(f.get('wavelength'));
  const bbl = numList(f.get('bbl'));
  const defaultBands = numList(f.get('default bands'));
  const ignore = f.get('data ignore value');
  const scale = Number(f.get('reflectance scale factor'));

  return {
    samples,
    lines,
    bands,
    headerOffset: int('header offset', 0),
    dtype,
    interleave,
    littleEndian: int('byte order', 0) === 0,
    wavelengths: wavelengths?.length === bands ? wavelengths : undefined,
    wavelengthUnits: f.get('wavelength units'),
    bandNames: list(f.get('band names'))?.length === bands ? list(f.get('band names')) : undefined,
    badBands: bbl?.length === bands ? bbl.map((v) => v === 0) : undefined,
    noDataValue: ignore !== undefined && Number.isFinite(Number(ignore)) ? Number(ignore) : undefined,
    defaultBands:
      defaultBands?.length === 3 ? (defaultBands.map((b) => b - 1) as [number, number, number]) : undefined,
    reflectanceScale: Number.isFinite(scale) && scale > 0 && scale !== 1 ? scale : undefined,
  };
}

const INTERLEAVE_LAYOUT: Record<EnviHeader['interleave'], (h: EnviHeader) => { shape: number[]; axes: Axes }> = {
  bsq: (h) => ({ shape: [h.bands, h.lines, h.samples], axes: { b: 0, y: 1, x: 2 } }),
  bil: (h) => ({ shape: [h.lines, h.bands, h.samples], axes: { y: 0, b: 1, x: 2 } }),
  bip: (h) => ({ shape: [h.lines, h.samples, h.bands], axes: { y: 0, x: 1, b: 2 } }),
};

export function parseEnvi(headerText: string, data: ArrayBuffer, name: string): HyperCube {
  const h = parseEnviHeader(headerText);
  const count = h.samples * h.lines * h.bands;
  const raw = readTyped(data, h.headerOffset, count, h.dtype, h.littleEndian);
  const { shape, axes } = INTERLEAVE_LAYOUT[h.interleave](h);
  const bsq = toBSQ({ data: raw, shape, order: 'C' }, axes);
  const k = h.reflectanceScale;
  // Scaled integers (e.g. reflectance x 10000) become float reflectance, as the header defines.
  if (k) bsq.data = Float32Array.from(bsq.data, (v) => v / k);
  return {
    name,
    ...bsq,
    wavelengths: h.wavelengths,
    wavelengthUnits: h.wavelengthUnits,
    bandNames: h.bandNames,
    badBands: h.badBands,
    noDataValue: k && h.noDataValue !== undefined ? Math.fround(h.noDataValue / k) : h.noDataValue,
    defaultBands: h.defaultBands,
  };
}
