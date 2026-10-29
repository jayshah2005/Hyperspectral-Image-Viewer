import { describe, expect, it } from 'vitest';
import { squeeze, toBSQ } from './arrayToCube';

describe('toBSQ', () => {
  const H = 2, W = 3, B = 4;
  const v = (y: number, x: number, b: number) => y * 100 + x * 10 + b;

  it('returns BSQ input untouched', () => {
    const data = new Float32Array(B * H * W);
    expect(toBSQ({ data, shape: [B, H, W], order: 'C' }, { b: 0, y: 1, x: 2 }).data).toBe(data);
  });

  it('MATLAB v7.3: HDF5 [B,W,H] C-order equals [H,W,B] F-order', () => {
    const vals: number[] = [];
    for (let b = 0; b < B; b++) for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) vals.push(v(y, x, b));
    const shape = [B, W, H].reverse();
    const cube = toBSQ({ data: Float64Array.from(vals), shape, order: 'F' }, { y: 0, x: 1, b: 2 });
    expect([cube.width, cube.height, cube.bands]).toEqual([W, H, B]);
    expect(cube.data[2 * H * W + 1 * W + 2]).toBe(v(1, 2, 2));
  });

  it('squeezes singleton dimensions', () => {
    expect(squeeze({ data: new Uint8Array(24), shape: [1, 2, 3, 1, 4], order: 'C' }).shape).toEqual([2, 3, 4]);
  });
});
