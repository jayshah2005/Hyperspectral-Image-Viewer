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
  applyTrim,
  pickBestMask,
  regionStats,
  squareCrop,
  stampCircle,
  stampLine,
  trimField,
} from './mask';
import { samThreads } from './samModels';

function cube(data: number[], width: number, height: number, bands: number, extra: Partial<HyperCube> = {}): HyperCube {
  return { name: 't', width, height, bands, data: Float32Array.from(data), ...extra };
}

describe('thin brushes', () => {
  it('always paints the pixel under the pointer, wherever in that pixel it is', () => {
    for (const size of [1, 2]) {
      for (const fx of [0, 0.1, 0.25, 0.5, 0.75, 0.9]) {
        const labels = new Uint16Array(40 * 40);
        stampLine(labels, 40, 40, 10 + fx, 5, 10 + fx, 25, size, 1, 'add');
        for (let y = 5; y < 25; y++) expect(labels[y * 40 + 10]).toBe(1);
      }
    }
  });

  it('stays inside the crop', () => {
    const labels = new Uint16Array(20 * 20);
    expect(stampCircle(labels, 20, 20, 3.1, 3.1, 1, 1, 'add', { x0: 8, y0: 8, x1: 14, y1: 14 })).toBe(false);
  });
});

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

describe('trimming an edge', () => {
  it('removes the edge, including pixels on the image border, and leaves other regions', () => {
    const w = 5;
    const labels = new Uint16Array(w * w).fill(1);
    labels[0] = 2;
    applyTrim(labels, 1, w, trimField(labels, 1, w)!, 1);
    expect(countLabel(labels, 1)).toBe(9);
    expect(labels[0]).toBe(2);
  });

  it('matches the disk rule exactly, at every radius, on an irregular shape', () => {
    const w = 40;
    const h = 30;
    const shape = new Uint16Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const inBlob = (x - 18) ** 2 / 300 + (y - 14) ** 2 / 120 < 1 && !((x - 22) ** 2 + (y - 12) ** 2 < 9) && (x + 2 * y) % 17 !== 0;
        if (inBlob) shape[y * w + x] = 1;
      }
    }
    const field = trimField(shape, 1, w)!;
    for (let r = 0; r <= field.maxTrim; r++) {
      const trimmed = shape.slice();
      applyTrim(trimmed, 1, w, field, r);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let keep = shape[y * w + x] === 1;
          for (let dy = -r; keep && dy <= r; dy++) {
            for (let dx = -r; keep && dx <= r; dx++) {
              if (dx * dx + dy * dy > r * r) continue;
              const [a, b] = [x + dx, y + dy];
              if (a < 0 || b < 0 || a >= w || b >= h || shape[b * w + a] !== 1) keep = false;
            }
          }
          expect(trimmed[y * w + x], `r=${r} at ${x},${y}`).toBe(keep ? 1 : 0);
        }
      }
    }
  });

  it('knows how far it can go before the region is gone', () => {
    const w = 9;
    const labels = new Uint16Array(w * w);
    labels[4 * w + 4] = 1;
    expect(trimField(labels, 1, w)!.maxTrim).toBe(0);
    labels.fill(1);
    const field = trimField(labels, 1, w)!;
    expect(field.maxTrim).toBe(4);
    applyTrim(labels, 1, w, field, 4);
    expect(countLabel(labels, 1)).toBe(1);
  });
});

describe('the square crop around a region', () => {
  it('is square, centred, and holds the whole region with room to spare', () => {
    const c = squareCrop({ x0: 100, y0: 200, x1: 180, y1: 240 }, 512, 512);
    expect(c.w).toBe(c.h);
    expect(c.w).toBe(120);
    expect(c.x0 + c.w / 2).toBe(140);
    expect(c.y0 + c.h / 2).toBe(220);
  });

  it('moves to stay inside the image', () => {
    const c = squareCrop({ x0: 0, y0: 490, x1: 20, y1: 512 }, 512, 512);
    expect(c.x0).toBe(0);
    expect(c.y0 + c.h).toBe(512);
    expect(c.w).toBe(c.h);
  });

  it('gives way only when the image is smaller than the square', () => {
    const b = { x0: 10, y0: 40, x1: 150, y1: 110 };
    const c = squareCrop(b, 157, 151);
    expect(c.w).toBe(157);
    expect(c.h).toBe(151);
    const narrow = squareCrop({ x0: 5, y0: 5, x1: 25, y1: 15 }, 30, 300);
    expect(narrow).toMatchObject({ x0: 0, w: 30 });
    expect(narrow.h).toBe(52);
  });

  it('keeps a very small region from filling the view', () => {
    expect(squareCrop({ x0: 50, y0: 50, x1: 51, y1: 51 }, 512, 512).w).toBe(33);
  });
});

describe('brush clipping', () => {
  it('leaves everything outside the clip alone', () => {
    const w = 20;
    const labels = new Uint16Array(w * w);
    stampCircle(labels, w, w, 10, 10, 12, 1, 'add', { x0: 8, y0: 8, x1: 14, y1: 14 });
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) if (labels[y * w + x]) {
      expect(x >= 8 && x < 14 && y >= 8 && y < 14).toBe(true);
    }
    expect(countLabel(labels, 1)).toBeGreaterThan(0);
  });
});

describe('samThreads', () => {
  it('leaves two cores free, with limits at both ends', () => {
    expect(samThreads(1)).toBe(1);
    expect(samThreads(2)).toBe(1);
    expect(samThreads(4)).toBe(2);
    expect(samThreads(14)).toBe(12);
    expect(samThreads(64)).toBe(12);
  });
});

describe('regionStats reuse', () => {
  it('reuses a region whose pixels are unchanged and recalculates one that changed', () => {
    const c = cube([1, 2, 3, 4, 5, 6, 7, 8], 4, 2, 1);
    const labels = Uint16Array.from([1, 1, 2, 2, 0, 0, 0, 0]);
    const first = regionStats(c, labels, [1, 2]);
    labels[4] = 2; // pixel value 5 joins region 2
    const second = regionStats(c, labels, [1, 2], first);
    expect(second.get(1)).toBe(first.get(1));
    expect(second.get(2)).not.toBe(first.get(2));
    expect(second.get(2)!.mean[0]).toBeCloseTo((3 + 4 + 5) / 3);
  });

  it('notices a change that keeps the pixel count the same', () => {
    const c = cube([1, 2, 3, 4], 4, 1, 1);
    const labels = Uint16Array.from([1, 0, 0, 0]);
    const first = regionStats(c, labels, [1]);
    labels.set([0, 0, 0, 1]);
    expect(regionStats(c, labels, [1], first).get(1)!.mean[0]).toBe(4);
  });
});
