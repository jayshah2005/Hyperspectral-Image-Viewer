import { describe, expect, it } from 'vitest';
import type { HyperCube } from '../types';
import { csvField, meansCsv, pixelCsv, pixelsCsvBytes, pixelsCsvParts, safeFilename, uniqueNames, wavelengthColumn } from './csv';
import { regionStats } from './mask';

const cube: HyperCube = {
  name: 'c',
  width: 2,
  height: 2,
  bands: 2,
  // band 0, then band 1
  data: Float32Array.from([0.1, 0.2, 0.3, 0.4, 1, 2, 3, 4]),
  wavelengths: [400.5, 500.5],
  badBands: [false, false],
};

describe('csv', () => {
  it('quotes fields that need it', () => {
    expect(csvField('ok')).toBe('ok');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
  });

  it('writes means with the header on line 1 and no comment lines', () => {
    const labels = Uint16Array.from([1, 1, 2, 0]);
    const stats = regionStats(cube, labels, [1, 2]);
    const text = meansCsv(cube, [
      { name: 'Leaf, A', stats: stats.get(1)! },
      { name: 'B', stats: stats.get(2)! },
    ]);
    const lines = text.trim().split('\n');
    expect(lines[0]).toBe('band,wavelength_nm,"Leaf, A_mean","Leaf, A_std","Leaf, A_n",B_mean,B_std,B_n');
    expect(lines[1]).toBe('1,400.5,0.15,0.07071068,2,0.3,,1');
    expect(lines[2].split(',').slice(0, 3)).toEqual(['2', '500.5', '1.5']);
    expect(lines).toHaveLength(3);
  });

  it('leaves bad bands empty so they read back as missing', () => {
    const c = { ...cube, badBands: [true, false] };
    const stats = regionStats(c, Uint16Array.from([1, 0, 0, 0]), [1]);
    expect(meansCsv(c, [{ name: 'A', stats: stats.get(1)! }]).split('\n')[1]).toBe('1,400.5,,,0');
    expect(pixelCsv(c, [Number.NaN, 2]).split('\n').slice(0, 3)).toEqual(['band,wavelength_nm,value', '1,400.5,', '2,500.5,2']);
  });

  it('writes one row per pixel, joining to a single table across chunks', () => {
    const labels = Uint16Array.from([1, 2, 0, 1]);
    const parts = pixelsCsvParts(cube, labels, [{ id: 1, name: 'A' }, { id: 2, name: 'B' }], 2);
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.join('').trim().split('\n')).toEqual(['region,x,y,400.5,500.5', 'A,0,0,0.1,1', 'B,1,0,0.2,2', 'A,1,1,0.4,4']);
    expect(pixelsCsvBytes(10, 200)).toBe(18000);
  });

  it('keeps full precision for double-precision data', () => {
    const c = { ...cube, data: Float64Array.from([0.123456789012, 0, 0, 0, 1, 0, 0, 0]) };
    expect(pixelCsv(c, [0.123456789012, 1]).split('\n')[1]).toBe('1,400.5,0.123456789012');
  });

  it('keeps repeated names apart', () => {
    expect(uniqueNames(['a', 'b', 'a'])).toEqual(['a', 'b', 'a_2']);
  });

  it('names the wavelength column by its unit', () => {
    expect(wavelengthColumn({ wavelengths: [400, 500] })).toBe('wavelength_nm');
    expect(wavelengthColumn({ wavelengths: [0.4, 0.5], wavelengthUnits: 'Micrometers' })).toBe('wavelength_um');
    expect(wavelengthColumn({ wavelengths: [1, 2] })).toBe('wavelength');
    expect(wavelengthColumn({})).toBeNull();
  });

  it('uses band numbers when the file has no wavelengths', () => {
    const c = { ...cube, wavelengths: undefined };
    expect(pixelCsv(c, [1, 2]).split('\n')[0]).toBe('band,value');
    expect(pixelsCsvParts(c, Uint16Array.from([1, 0, 0, 0]), [{ id: 1, name: 'A' }])[0]).toBe('region,x,y,band_1,band_2\n');
  });

  it('sanitizes download names', () => {
    expect(safeFilename('Demo: vine row')).toBe('Demo-vine-row');
    expect(safeFilename('***')).toBe('spectrum');
  });
});
