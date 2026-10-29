export type ColormapName = 'gray' | 'viridis' | 'inferno' | 'jet' | 'rdylgn';

export const COLORMAPS: ColormapName[] = ['gray', 'viridis', 'inferno', 'jet', 'rdylgn'];

type RGB = [number, number, number];

// 6th-order polynomial fits of matplotlib's viridis and inferno.
const POLY: Record<'viridis' | 'inferno', RGB[]> = {
  viridis: [
    [0.2777273272234177, 0.005407344544966578, 0.3340998053353061],
    [0.1050930431085774, 1.404613529898575, 1.384590162594685],
    [-0.3308618287255563, 0.214847559468213, 0.09509516302823659],
    [-4.634230498983486, -5.799100973351585, -19.33244095627987],
    [6.228269936347081, 14.17993336680509, 56.69055260068105],
    [4.776384997670288, -13.74514537774601, -65.35303263337234],
    [-5.435455855934631, 4.645852612178535, 26.3124352495832],
  ],
  inferno: [
    [0.0002189403691192265, 0.001651004631001012, -0.01948089843709184],
    [0.1065134194856116, 0.5639564367884091, 3.932712388889277],
    [11.60249308247187, -3.972853965665698, -15.9423941062914],
    [-41.70399613139459, 17.43639888205313, 44.35414519872813],
    [77.162935699427, -33.40235894210092, -81.80730925738993],
    [-71.31942824499214, 32.62606426397723, 73.20951985803202],
    [25.13112622477341, -12.24266895238567, -23.07032500287172],
  ],
};

const STOPS: Record<'jet' | 'rdylgn', RGB[]> = {
  jet: [
    [0, 0, 0.5],
    [0, 0, 1],
    [0, 1, 1],
    [1, 1, 0],
    [1, 0, 0],
    [0.5, 0, 0],
  ],
  rdylgn: [
    [0.647, 0, 0.149],
    [0.957, 0.427, 0.263],
    [0.996, 0.878, 0.545],
    [0.851, 0.937, 0.545],
    [0.4, 0.741, 0.388],
    [0, 0.408, 0.216],
  ],
};

function evaluate(name: ColormapName, t: number): RGB {
  if (name === 'gray') return [t, t, t];
  if (name === 'viridis' || name === 'inferno') {
    const c = POLY[name];
    return [0, 1, 2].map((k) => c.reduceRight((acc, coef) => acc * t + coef[k], 0)) as RGB;
  }
  const stops = STOPS[name];
  const f = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(f));
  const u = f - i;
  return [0, 1, 2].map((k) => stops[i][k] * (1 - u) + stops[i + 1][k] * u) as RGB;
}

const cache = new Map<ColormapName, Uint8Array>();

/** 256-entry RGB lookup table, packed [r0,g0,b0,r1,...]. */
export function colormapLUT(name: ColormapName): Uint8Array {
  let lut = cache.get(name);
  if (!lut) {
    lut = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      const rgb = evaluate(name, i / 255);
      for (let k = 0; k < 3; k++) lut[i * 3 + k] = Math.round(Math.min(1, Math.max(0, rgb[k])) * 255);
    }
    cache.set(name, lut);
  }
  return lut;
}

export function colormapGradient(name: ColormapName): string {
  const lut = colormapLUT(name);
  const stops = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const i = Math.round(t * 255) * 3;
    return `rgb(${lut[i]},${lut[i + 1]},${lut[i + 2]}) ${t * 100}%`;
  });
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}
