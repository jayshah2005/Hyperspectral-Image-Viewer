import { describe, expect, it } from 'vitest';
import { buildNpy, cubeValue, H, W, B } from '../test/fixtures';
import { parseNpy } from './npy';
import { guessAxes, toBSQ } from './arrayToCube';
import { getSpectrum } from '../lib/cube';

function bytes(values: number[], size: number, write: (dv: DataView, o: number, v: number) => void) {
  const out = new Uint8Array(values.length * size);
  const dv = new DataView(out.buffer);
  values.forEach((v, i) => write(dv, i * size, v));
  return out;
}

const cOrder = () => {
  const v: number[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let b = 0; b < B; b++) v.push(cubeValue(y, x, b));
  return v;
};
const fOrder = () => {
  const v: number[] = [];
  for (let b = 0; b < B; b++) for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) v.push(cubeValue(y, x, b));
  return v;
};

function check(arr: ReturnType<typeof parseNpy>) {
  const axes = guessAxes(arr.shape);
  expect(axes).toEqual({ y: 0, x: 1, b: 2 });
  const cube = { name: 't', ...toBSQ(arr, axes) };
  expect([cube.width, cube.height, cube.bands]).toEqual([W, H, B]);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) expect(Array.from(getSpectrum(cube, x, y))).toEqual([0, 1, 2, 3, 4].map((b) => cubeValue(y, x, b)));
}

describe('npy', () => {
  it('reads C-order little-endian float32', () => {
    const buf = buildNpy('<f4', [H, W, B], false, bytes(cOrder(), 4, (dv, o, v) => dv.setFloat32(o, v, true)));
    const arr = parseNpy(buf);
    expect(arr.data).toBeInstanceOf(Float32Array);
    check(arr);
  });

  it('reads Fortran-order data', () => {
    check(parseNpy(buildNpy('<f8', [H, W, B], true, bytes(fOrder(), 8, (dv, o, v) => dv.setFloat64(o, v, true)))));
  });

  it('byte-swaps big-endian int16', () => {
    check(parseNpy(buildNpy('>i2', [H, W, B], false, bytes(cOrder(), 2, (dv, o, v) => dv.setInt16(o, v, false)))));
  });

  it('copies when the data offset is misaligned', () => {
    // header padded so that data starts at an odd offset
    const buf = buildNpy('<u2', [H, W, B], false, bytes(cOrder(), 2, (dv, o, v) => dv.setUint16(o, v, true)), 3);
    const arr = parseNpy(buf);
    expect(arr.data).toBeInstanceOf(Uint16Array);
    check(arr);
  });

  it('converts int64 to float64', () => {
    const arr = parseNpy(buildNpy('<i8', [H, W, B], false, bytes(cOrder(), 8, (dv, o, v) => dv.setBigInt64(o, BigInt(v), true))));
    expect(arr.data).toBeInstanceOf(Float64Array);
    check(arr);
  });

  it('guesses bands-first layout', () => {
    expect(guessAxes([200, 145, 145])).toEqual({ b: 0, y: 1, x: 2 });
    expect(guessAxes([145, 145, 200])).toEqual({ y: 0, x: 1, b: 2 }); // Indian Pines
    expect(guessAxes([610, 340, 103])).toEqual({ y: 0, x: 1, b: 2 }); // Pavia University
    expect(guessAxes([103, 610, 340])).toEqual({ b: 0, y: 1, x: 2 });
  });
});
