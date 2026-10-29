import { describe, expect, it } from 'vitest';
import { normalizedDifference, roiStats, spectralAngleMap, spectraToCsv } from './analysis';
import type { HyperCube } from '../types';

// 2×1 image, 3 bands. Pixel 0 = [1,2,3]; pixel 1 = [2,4,6] (same direction, twice as bright).
const cube: HyperCube = { name: 't', width: 2, height: 1, bands: 3, data: Float32Array.from([1, 2, 2, 4, 3, 6]) };

describe('analysis', () => {
  it('SAM is zero for spectra that differ only in brightness', () => {
    const sam = spectralAngleMap(cube, [1, 2, 3]);
    expect(sam[0]).toBeCloseTo(0, 3);
    expect(sam[1]).toBeCloseTo(0, 3);
    const orth = spectralAngleMap(cube, [3, 0, -1]);
    expect(orth[0]).toBeCloseTo(Math.PI / 2, 5);
  });

  it('ROI mean and std', () => {
    const s = roiStats(cube, { x0: 0, y0: 0, x1: 2, y1: 1 });
    expect(Array.from(s.mean)).toEqual([1.5, 3, 4.5]);
    expect(Array.from(s.std)).toEqual([0.5, 1, 1.5]);
    expect(s.count).toBe(2);
  });

  it('normalized difference', () => {
    const nd = normalizedDifference(cube, 2, 0);
    expect(nd[0]).toBeCloseTo(0.5);
  });

  it('csv export', () => {
    const csv = spectraToCsv({ values: [400, 500], label: 'Wavelength (nm)' }, [
      { label: 'A, pin', values: [1, NaN] },
      { label: 'ROI', values: [2, 3], std: [0.1, 0.2] },
    ]);
    expect(csv).toBe('Wavelength (nm),"A, pin",ROI,ROI std\n400,1,2,0.1\n500,,3,0.2');
  });
});
