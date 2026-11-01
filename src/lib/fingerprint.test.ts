import { describe, expect, it } from 'vitest';
import { cubeFingerprint } from './fingerprint';

function cube(fill: (i: number) => number, width = 8, height = 8, bands = 9) {
  return { width, height, bands, data: Float32Array.from({ length: width * height * bands }, (_, i) => fill(i)) };
}

describe('cubeFingerprint', () => {
  it('ignores the file name: same contents, same fingerprint', () => {
    const a = cube((i) => i);
    expect(cubeFingerprint({ ...a, data: a.data.slice() })).toBe(cubeFingerprint(a));
  });

  it('tells apart leaf cut-outs that differ in only one pixel of a zero background', () => {
    const a = cube(() => 0);
    const b = cube(() => 0);
    b.data[8 * 8 * 4 + 37] = 0.25; // one pixel in the middle band
    expect(cubeFingerprint(a)).not.toBe(cubeFingerprint(b));
  });

  it('tells apart equal data of different shapes and types', () => {
    const a = cube(() => 1, 4, 16);
    const b = cube(() => 1, 16, 4);
    expect(cubeFingerprint(a)).not.toBe(cubeFingerprint(b));
    const ints = { ...a, data: Int32Array.from(a.data) };
    expect(cubeFingerprint(a)).not.toBe(cubeFingerprint(ints));
  });

  it('works on a view into a larger buffer', () => {
    const a = cube((i) => i);
    const big = new Float32Array(a.data.length + 10);
    big.set(a.data, 5);
    expect(cubeFingerprint({ ...a, data: big.subarray(5, 5 + a.data.length) })).toBe(cubeFingerprint(a));
  });
});
