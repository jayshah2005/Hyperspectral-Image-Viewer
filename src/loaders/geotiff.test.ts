import { describe, expect, it } from 'vitest';
import { writeArrayBuffer } from 'geotiff';
import { parseGeoTiff } from './geotiff';
import { getSpectrum } from '../lib/cube';
import { H, W, B } from '../test/fixtures';

describe('GeoTIFF', () => {
  it('reads a multi-sample image as BSQ', async () => {
    const val = (y: number, x: number, b: number) => (y * 50 + x * 10 + b) % 256;
    const data = Array.from({ length: B }, (_, b) => Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => val(y, x, b))));
    const buf = writeArrayBuffer(data, { height: H, width: W }) as ArrayBuffer;
    const cube = await parseGeoTiff(buf, 't.tif');
    expect([cube.width, cube.height, cube.bands]).toEqual([W, H, B]);
    expect(Array.from(getSpectrum(cube, 2, 1))).toEqual([0, 1, 2, 3, 4].map((b) => val(1, 2, b)));
  });
});
