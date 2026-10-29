import { isValid } from './cube';

export interface Channel {
  values: ArrayLike<number>;
  lo: number;
  hi: number;
}

function toByte(v: number, lo: number, scale: number): number {
  const t = (v - lo) * scale;
  return ((t < 0 ? 0 : t > 1 ? 1 : t) * 255 + 0.5) | 0;
}

/** Three channels as an RGB composite. A pixel is transparent if any channel is invalid. */
export function renderRGB(
  [r, g, b]: [Channel, Channel, Channel],
  pixels: number,
  noData: number | undefined,
  out: Uint8ClampedArray,
): void {
  const sr = 1 / (r.hi - r.lo || 1);
  const sg = 1 / (g.hi - g.lo || 1);
  const sb = 1 / (b.hi - b.lo || 1);
  for (let p = 0, o = 0; p < pixels; p++, o += 4) {
    const vr = r.values[p];
    const vg = g.values[p];
    const vb = b.values[p];
    if (!isValid(vr, noData) || !isValid(vg, noData) || !isValid(vb, noData)) {
      out[o + 3] = 0;
      continue;
    }
    out[o] = toByte(vr, r.lo, sr);
    out[o + 1] = toByte(vg, g.lo, sg);
    out[o + 2] = toByte(vb, b.lo, sb);
    out[o + 3] = 255;
  }
}
