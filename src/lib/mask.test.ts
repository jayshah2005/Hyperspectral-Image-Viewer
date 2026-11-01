import { describe, expect, it } from 'vitest';
import type { HyperCube } from '../types';
import {
  applyBinaryMask,
  brushRadius,
  cleanMask,
  clearLabel,
  countLabel,
  decodeRle,
  encodeRle,
  erodeLabel,
  pickBestMask,
  regionStats,
  stampCircle,
  stampLine,
} from './mask';

function cube(data: number[], width: number, height: number, bands: number, extra: Partial<HyperCube> = {}): HyperCube {
  return { name: 't', width, height, bands, data: Float32Array.from(data), ...extra };
}

describe('mask labels', () => {
  it('stamps a disk without overwriting another region', () => {
    const labels = new Uint16Array(5 * 5);
    labels[2 * 5 + 2] = 1;
    expect(stampCircle(labels, 5, 5, 2.5, 2.5, 3, 2, 'add')).toBe(true);
    expect(labels[2 * 5 + 2]).toBe(1);
    expect(countLabel(labels, 2)).toBeGreaterThan(0);
    expect(stampLine(labels, 5, 5, 2.5, 2.5, 2.5, 2.5, 3, 2, 'erase')).toBe(true);
    expect(labels[2 * 5 + 2]).toBe(1);
    expect(countLabel(labels, 2)).toBe(0);
  });

  it('applies a SAM mask and picks the highest-scoring candidate', () => {
    const labels = new Uint16Array(4);
    labels[0] = 1;
    const mask = Uint8Array.from([0, 1, 1, 0]);
    expect(applyBinaryMask(labels, 1, mask)).toBe(2);
    expect(Array.from(labels)).toEqual([0, 1, 1, 0]);

    const data = Uint8Array.from([1, 0, 0, 0, 0, 1, 1, 0]);
    const picked = pickBestMask(data, [2, 2, 2], [0.1, 0.9], 2, 2);
    expect(Array.from(picked)).toEqual([0, 1, 1, 0]);
  });

  it('never favours a huge low-confidence candidate over the top-rated one', () => {
    // Candidate 0 covers everything at IoU 0.01 (what SAM really returns); candidate 1 is the object.
    const data = Uint8Array.from([1, 1, 1, 1, 0, 1, 0, 0]);
    expect(Array.from(pickBestMask(data, [1, 2, 2, 2], [0.01, 0.93], 2, 2))).toEqual([0, 1, 0, 0]);
  });

  it('cleans a mask: largest blob only, holes filled', () => {
    const w = 12;
    const h = 12;
    const mask = new Uint8Array(w * h);
    for (let y = 2; y < 9; y++) for (let x = 2; x < 9; x++) mask[y * w + x] = 1; // 7×7 square
    mask[5 * w + 5] = 0; // hole
    mask[11 * w + 11] = 1; // speck
    const out = cleanMask(mask, w, h);
    expect(out[5 * w + 5]).toBe(1);
    expect(out[11 * w + 11]).toBe(0);
    expect(out[2 * w + 2]).toBe(1);
    expect(out[0]).toBe(0);
  });

  it('round-trips RLE, including a fill of zeros', () => {
    const labels = Uint16Array.from([0, 0, 1, 1, 1, 2, 0]);
    expect(decodeRle(encodeRle(labels), labels.length)).toEqual(labels);
    expect(encodeRle(new Uint16Array(4))).toEqual([0, 4]);
    expect(brushRadius(12)).toBe(6);
  });

  it('rejects an RLE whose counts do not match the image', () => {
    expect(() => decodeRle([1, 2], 3)).toThrow(/length mismatch/);
  });
});

describe('regionStats', () => {
  it('computes mean, sample std and n, skipping no-data and bad bands', () => {
    const data = [
      1, 3, 10, 20, // band 0: pixel 1 is no-data
      2, 4, 10, 20, // band 1
      8, 8, 10, 20, // band 2 (bad)
    ];
    const c = cube(data, 2, 2, 3, { badBands: [false, false, true], noDataValue: 3 });
    const labels = Uint16Array.from([1, 1, 2, 0]);
    const stats = regionStats(c, labels, [1, 2]);
    const a = stats.get(1)!;
    expect(a.count).toBe(2);
    expect(a.mean[0]).toBe(1);
    expect(a.n[0]).toBe(1);
    expect(a.std[0]).toBeNaN();
    expect(a.mean[1]).toBe(3);
    expect(a.std[1]).toBeCloseTo(Math.SQRT2);
    expect(a.mean[2]).toBeNaN();
    expect(stats.get(2)!.mean[1]).toBe(10);
    clearLabel(labels, 1);
    expect(countLabel(labels, 1)).toBe(0);
  });
});

describe('pickBestMask with clicks', () => {
  // Three 2×2 candidates. 0 is huge with IoU 0.02; 1 is rated top but misses the second click; 2 has both.
  const data = Uint8Array.from([1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 0, 0]);
  const scores = [0.02, 0.9, 0.7];
  const dims = [1, 3, 2, 2];

  it('prefers a well-rated candidate that obeys the clicks', () => {
    const points = [{ x: 0, y: 0, label: 1 as const }, { x: 1, y: 0, label: 1 as const }];
    expect(Array.from(pickBestMask(data, dims, scores, 2, 2, points))).toEqual([1, 1, 0, 0]);
  });

  it('never falls back to a near-zero-rated candidate just because it obeys', () => {
    const points = [{ x: 0, y: 1, label: 1 as const }];
    expect(Array.from(pickBestMask(data, dims, scores, 2, 2, points))).toEqual([1, 0, 0, 0]);
  });

  it('honours a leave-out click', () => {
    const points = [{ x: 0, y: 0, label: 1 as const }, { x: 1, y: 0, label: 0 as const }];
    expect(Array.from(pickBestMask(data, dims, scores, 2, 2, points))).toEqual([1, 0, 0, 0]);
  });
});

describe('erodeLabel', () => {
  it('removes the edge, including pixels on the image border, and leaves other regions', () => {
    const w = 5;
    const labels = new Uint16Array(w * w).fill(1);
    labels[0] = 2;
    expect(erodeLabel(labels, 1, w, w)).toBe(15);
    expect(countLabel(labels, 1)).toBe(9);
    expect(labels[0]).toBe(2);
  });
});
