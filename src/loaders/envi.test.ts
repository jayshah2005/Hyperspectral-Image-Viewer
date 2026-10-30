import { describe, expect, it } from 'vitest';
import { cubeValue, H, W, B } from '../test/fixtures';
import { parseEnvi, parseEnviHeader } from './envi';
import { getSpectrum } from '../lib/cube';

function header(extra: string) {
  return `ENVI
description = {test
  cube}
samples = ${W}
lines   = ${H}
bands   = ${B}
data type = 2
file type = ENVI Standard
${extra}
wavelength units = Nanometers
wavelength = {
 400.0, 500.0, 600.0,
 700.0, 800.0}
bbl = {1, 1, 0, 1, 1}
default bands = {3,2,1}
data ignore value = -9999
`;
}

function encode(order: 'bsq' | 'bil' | 'bip', offset: number, littleEndian: boolean) {
  const values: number[] = [];
  if (order === 'bsq') for (let b = 0; b < B; b++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) values.push(cubeValue(y, x, b));
  if (order === 'bil') for (let y = 0; y < H; y++) for (let b = 0; b < B; b++) for (let x = 0; x < W; x++) values.push(cubeValue(y, x, b));
  if (order === 'bip') for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let b = 0; b < B; b++) values.push(cubeValue(y, x, b));
  const buf = new ArrayBuffer(offset + values.length * 2);
  const dv = new DataView(buf);
  values.forEach((v, i) => dv.setInt16(offset + i * 2, v, littleEndian));
  return buf;
}

describe('ENVI', () => {
  it('parses header fields', () => {
    const h = parseEnviHeader(header('interleave = bil\nbyte order = 1\nheader offset = 7'));
    expect(h).toMatchObject({ samples: W, lines: H, bands: B, dtype: 'int16', interleave: 'bil', littleEndian: false, headerOffset: 7, noDataValue: -9999 });
    expect(h.wavelengths).toEqual([400, 500, 600, 700, 800]);
    expect(h.badBands).toEqual([false, false, true, false, false]);
    expect(h.defaultBands).toEqual([2, 1, 0]);
  });

  for (const order of ['bsq', 'bil', 'bip'] as const) {
    for (const [offset, le] of [[0, true], [7, true], [0, false]] as const) {
      it(`decodes ${order} (offset ${offset}, ${le ? 'LE' : 'BE'})`, () => {
        const cube = parseEnvi(header(`interleave = ${order}\nbyte order = ${le ? 0 : 1}\nheader offset = ${offset}`), encode(order, offset, le), 't');
        expect([cube.width, cube.height, cube.bands]).toEqual([W, H, B]);
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W; x++)
            expect(Array.from(getSpectrum(cube, x, y))).toEqual([0, 1, NaN, 3, 4].map((b) => (Number.isNaN(b) ? NaN : cubeValue(y, x, b))));
      });
    }
  }

  it('applies the reflectance scale factor', () => {
    const cube = parseEnvi(header('interleave = bsq\nreflectance scale factor = 1000'), encode('bsq', 0, true), 't');
    expect(cube.data).toBeInstanceOf(Float32Array);
    expect(cube.noDataValue).toBeCloseTo(-9.999);
    expect(getSpectrum(cube, 1, 2)[3]).toBeCloseTo(cubeValue(2, 1, 3) / 1000);
    // The no-data value is scaled too, so masked pixels still drop out of the spectrum.
    cube.data[3 * W * H] = cube.noDataValue!;
    expect(getSpectrum(cube, 0, 0)[3]).toBeNaN();
  });

  it('rejects truncated data', () => {
    expect(() => parseEnvi(header('interleave = bsq'), new ArrayBuffer(10), 't')).toThrow(/too small/);
  });
});
