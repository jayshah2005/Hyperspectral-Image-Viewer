import type { HyperCube } from '../types';

const gauss = (l: number, c: number, w: number) => Math.exp(-0.5 * ((l - c) / w) ** 2);
const sigmoid = (l: number, c: number, w: number) => 1 / (1 + Math.exp(-(l - c) / w));

/** Reflectance spectra (0–1) of a few synthetic materials as functions of wavelength in nm. */
export const MATERIALS = {
  vegetation: (l: number) =>
    0.03 +
    0.07 * gauss(l, 550, 35) -
    0.02 * gauss(l, 670, 20) +
    0.45 * sigmoid(l, 715, 12) * (1 - 0.35 * sigmoid(l, 1300, 60)) -
    0.18 * gauss(l, 1450, 60) -
    0.2 * gauss(l, 1940, 70) -
    0.08 * sigmoid(l, 2100, 80),
  soil: (l: number) => 0.08 + 0.26 * Math.min(1, (l - 400) / 1500) - 0.05 * gauss(l, 1420, 50) - 0.06 * gauss(l, 1920, 60) - 0.05 * gauss(l, 2200, 25),
  water: (l: number) => 0.015 + 0.06 * Math.exp(-(l - 400) / 180),
  concrete: (l: number) => 0.26 + 0.06 * Math.min(1, (l - 400) / 900) - 0.03 * gauss(l, 1450, 70) - 0.04 * gauss(l, 1930, 80),
  redPaint: (l: number) => 0.05 + 0.55 * sigmoid(l, 600, 12) - 0.15 * sigmoid(l, 1400, 200),
  bluePaint: (l: number) => 0.05 + 0.35 * gauss(l, 460, 40) + 0.3 * sigmoid(l, 800, 40),
};

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build a deterministic synthetic scene: fields, a river, a road and painted calibration panels. */
export function makeDemoCube(width = 240, height = 180, bands = 150): HyperCube {
  const wavelengths = Array.from({ length: bands }, (_, i) => +(400 + (i * 2100) / (bands - 1)).toFixed(1));
  const badBands = wavelengths.map((l) => (l > 1340 && l < 1450) || (l > 1790 && l < 1960));
  const spectra = Object.fromEntries(
    Object.entries(MATERIALS).map(([k, f]) => [k, Float32Array.from(wavelengths, f)]),
  ) as Record<keyof typeof MATERIALS, Float32Array>;

  const rand = mulberry32(42);
  const noise = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

  const data = new Float32Array(width * height * bands);
  const pixels = width * height;
  const panels = [
    { x: 40, y: 30, m: 'redPaint' as const },
    { x: 60, y: 30, m: 'bluePaint' as const },
    { x: 190, y: 140, m: 'redPaint' as const },
  ];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Fractional abundances for a linear mixing model.
      const vegField = 0.5 + 0.35 * Math.sin(x / 23) * Math.cos(y / 17) + 0.15 * Math.sin((x + y) / 9);
      let ab: Partial<Record<keyof typeof MATERIALS, number>> = { vegetation: vegField, soil: 1 - vegField };

      const inField = x > 150 && x < 225 && y > 15 && y < 70 && (Math.floor((x - 150) / 25) + Math.floor((y - 15) / 18)) % 2 === 0;
      if (inField) ab = { vegetation: 0.95, soil: 0.05 };

      const riverY = height * 0.62 + 14 * Math.sin(x / 26);
      const dRiver = Math.abs(y - riverY);
      if (dRiver < 9) ab = { water: 1 };
      else if (dRiver < 12) ab = { water: 0.5, soil: 0.3, vegetation: 0.2 };

      const roadX = width * 0.3 + y * 0.25;
      if (Math.abs(x - roadX) < 3 && dRiver >= 9) ab = { concrete: 1 };
      for (const p of panels) if (x >= p.x && x < p.x + 6 && y >= p.y && y < p.y + 6) ab = { [p.m]: 1 };

      const brightness = 0.9 + 0.12 * Math.sin(x / 60 + y / 45);
      const p = y * width + x;
      for (let b = 0; b < bands; b++) {
        let v = 0;
        for (const k in ab) v += ab[k as keyof typeof MATERIALS]! * spectra[k as keyof typeof MATERIALS][b];
        v = v * brightness + 0.004 * noise() + (badBands[b] ? 0.05 * noise() : 0);
        data[b * pixels + p] = v;
      }
    }
  }

  const nearest = (l: number) => wavelengths.reduce((best, w, i) => (Math.abs(w - l) < Math.abs(wavelengths[best] - l) ? i : best), 0);
  return {
    name: 'Demo scene (synthetic)',
    width,
    height,
    bands,
    data,
    wavelengths,
    wavelengthUnits: 'nm',
    badBands,
    defaultBands: [nearest(640), nearest(550), nearest(470)],
  };
}
