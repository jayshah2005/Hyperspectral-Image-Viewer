import { isValid } from './cube';

export interface Channel {
  values: ArrayLike<number>;
  lo: number;
  hi: number;
}

function toByte(v: number, lo: number, scale: number, gamma: number): number {
  let t = (v - lo) * scale;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  if (gamma !== 1) t = Math.pow(t, 1 / gamma);
  return (t * 255 + 0.5) | 0;
}

/** Single channel through a colormap LUT. Invalid pixels are transparent. */
export function renderMapped(
  ch: Channel,
  pixels: number,
  lut: Uint8Array,
  gamma: number,
  noData: number | undefined,
  out: Uint8ClampedArray,
): void {
  const scale = 1 / (ch.hi - ch.lo || 1);
  for (let p = 0, o = 0; p < pixels; p++, o += 4) {
    const v = ch.values[p];
    if (!isValid(v, noData)) {
      out[o + 3] = 0;
      continue;
    }
    const i = toByte(v, ch.lo, scale, gamma) * 3;
    out[o] = lut[i];
    out[o + 1] = lut[i + 1];
    out[o + 2] = lut[i + 2];
    out[o + 3] = 255;
  }
}

/** Three channels as an RGB composite. A pixel is transparent if any channel is invalid. */
export function renderRGB(
  [r, g, b]: [Channel, Channel, Channel],
  pixels: number,
  gamma: number,
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
    out[o] = toByte(vr, r.lo, sr, gamma);
    out[o + 1] = toByte(vg, g.lo, sg, gamma);
    out[o + 2] = toByte(vb, b.lo, sb, gamma);
    out[o + 3] = 255;
  }
}
