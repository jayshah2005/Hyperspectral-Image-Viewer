import { describe, expect, it } from 'vitest';
import type { HyperCube } from '../types';
import { renderCropPicture } from './display';

const W = 4;
const H = 4;
/** Three bands; the top-left 2×2 is dim and the rest holds a very bright object, like a white reference. */
function cube(extra: Partial<HyperCube> = {}): HyperCube {
  const data = new Float32Array(W * H * 3);
  for (let b = 0; b < 3; b++) {
    for (let p = 0; p < W * H; p++) {
      const dim = p % W < 2 && p < 2 * W;
      data[b * W * H + p] = dim ? 0.05 + 0.01 * p + 0.01 * b : 1;
    }
  }
  return { name: 'c', width: W, height: H, bands: 3, data, defaultBands: [0, 1, 2], ...extra };
}

describe('the picture in the editor', () => {
  const rect = { x0: 0, y0: 0, w: 2, h: 2 };

  it('stretches to the crop, so something dim next to something bright becomes readable', () => {
    const d = renderCropPicture(cube(), rect);
    expect(d).toHaveLength(16);
    expect(Math.max(...d.filter((_, i) => i % 4 !== 3))).toBe(255);
    expect(Math.min(...d.filter((_, i) => i % 4 !== 3))).toBe(0);
  });

  it('keeps colours by stretching all channels together', () => {
    const c = cube();
    const d = renderCropPicture(c, rect);
    // Band 2 is brighter than band 0 at every pixel of this crop, and must stay so.
    for (let o = 0; o < d.length; o += 4) expect(d[o + 2]).toBeGreaterThan(d[o]);
  });

  it('leaves out a pixel with no-data in any channel, instead of showing a false colour', () => {
    // Pixel 0 is 0.05, 0.06, 0.07 in bands 0, 1, 2, so only its first channel is no-data.
    const d = renderCropPicture(cube({ noDataValue: cube().data[0] }), rect);
    expect([...d.subarray(0, 4)]).toEqual([0, 0, 0, 0]);
    expect(d[7]).toBe(255);
  });

  it('measures all three channels, whatever the size of the crop', () => {
    // 480 × 480 is where taking every third of a mixed list of red, green, blue would only ever see red.
    const size = 480;
    const data = new Float32Array(size * size * 3);
    for (let p = 0; p < size * size; p++) {
      const t = p / (size * size);
      data[p] = 0.1 * t;
      data[size * size + p] = t;
      data[2 * size * size + p] = 0.5 * t;
    }
    const big: HyperCube = { name: 'big', width: size, height: size, bands: 3, data, defaultBands: [0, 1, 2] };
    const d = renderCropPicture(big, { x0: 0, y0: 0, w: size, h: size });
    const mid = 4 * (size * Math.floor(size / 2));
    expect(d[mid + 1]).toBeGreaterThan(100); // green, at about half its range
    expect(d[mid + 1]).toBeLessThan(160);
    expect(d[mid]).toBeLessThan(30); // red stays far dimmer than green, as in the data
  });
});
