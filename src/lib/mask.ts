import type { HyperCube } from '../types';
import { isValid } from './cube';

export interface RegionStats {
  /** Pixels in the region. */
  count: number;
  mean: Float64Array;
  /** Sample standard deviation (n - 1); NaN below two valid pixels. */
  std: Float64Array;
  /** Valid pixels per band. */
  n: Uint32Array;
}

/** Per-band statistics of each region. Bad bands and no-data are left out, so those means are NaN. */
export function regionStats(cube: HyperCube, labels: Uint16Array, ids: number[]): Map<number, RegionStats> {
  const { bands, data, badBands, noDataValue } = cube;
  const pixels = cube.width * cube.height;
  const members = new Map<number, number[]>(ids.map((id) => [id, []]));
  for (let p = 0; p < pixels; p++) if (labels[p]) members.get(labels[p])?.push(p);

  const out = new Map<number, RegionStats>();
  for (const [id, list] of members) {
    const mean = new Float64Array(bands);
    const std = new Float64Array(bands);
    const n = new Uint32Array(bands);
    // The cube is stored band by band, so walking one band at a time stays in cache.
    for (let b = 0; b < bands; b++) {
      if (badBands?.[b]) {
        mean[b] = std[b] = NaN;
        continue;
      }
      const base = b * pixels;
      let count = 0;
      let m = 0;
      let s2 = 0;
      for (const p of list) {
        const v = data[base + p];
        if (!isValid(v, noDataValue)) continue;
        count++;
        const d = v - m;
        m += d / count;
        s2 += d * (v - m);
      }
      n[b] = count;
      mean[b] = count ? m : NaN;
      std[b] = count > 1 ? Math.sqrt(s2 / (count - 1)) : NaN;
    }
    out.set(id, { count: list.length, mean, std, n });
  }
  return out;
}

export function countLabel(labels: Uint16Array, id: number): number {
  let n = 0;
  for (let i = 0; i < labels.length; i++) if (labels[i] === id) n++;
  return n;
}

/** Where a region is. `x1` and `y1` are exclusive; null if it has no pixels. */
export function labelBounds(labels: Uint16Array, id: number, width: number) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  let count = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== id) continue;
    const x = i % width;
    const y = (i - x) / width;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    y1 = y;
    count++;
    sx += x;
    sy += y;
  }
  return count ? { x0, y0, x1: x1 + 1, y1: y1 + 1, count, cx: sx / count, cy: sy / count } : null;
}

export function clearLabel(labels: Uint16Array, id: number): void {
  for (let i = 0; i < labels.length; i++) if (labels[i] === id) labels[i] = 0;
}

/**
 * Replace region `id` with a binary mask (nonzero = inside).
 * Never overwrites a different region's pixels.
 */
export function applyBinaryMask(labels: Uint16Array, id: number, mask: ArrayLike<number>): number {
  let count = 0;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] === id) labels[i] = 0;
    if (mask[i] && labels[i] === 0) {
      labels[i] = id;
      count++;
    }
  }
  return count;
}

/**
 * The candidate to use from SAM's three (C-order, last two dims are H×W), resized to the image if needed.
 *
 * Normally the top predicted IoU: rendering the candidates showed that is the clean object, while the others
 * are often huge near-zero-IoU masks, so area must never be favoured. Among candidates rated at least half as
 * well, one that actually obeys the clicks wins, so a refining click is never ignored.
 */
export function pickBestMask(
  data: ArrayLike<number | boolean>,
  dims: number[],
  scores: ArrayLike<number>,
  width: number,
  height: number,
  points: { x: number; y: number; label: 0 | 1 }[] = [],
): Uint8Array {
  const srcH = dims[dims.length - 2] ?? height;
  const srcW = dims[dims.length - 1] ?? width;
  const srcPlane = srcW * srcH;
  const nMasks = Math.max(1, Math.floor(data.length / srcPlane));
  const score = (m: number) => Number(scores[m] ?? -1);
  const obeys = (m: number) =>
    points.every((p) => {
      const sy = Math.min(srcH - 1, Math.floor((p.y * srcH) / height));
      const sx = Math.min(srcW - 1, Math.floor((p.x * srcW) / width));
      return Boolean(data[m * srcPlane + sy * srcW + sx]) === (p.label === 1);
    });
  let top = 0;
  for (let m = 1; m < nMasks; m++) if (score(m) > score(top)) top = m;
  let best = top;
  if (points.length && !obeys(top)) {
    let found = -1;
    for (let m = 0; m < nMasks; m++) if (score(m) >= score(top) / 2 && obeys(m) && (found < 0 || score(m) > score(found))) found = m;
    if (found >= 0) best = found;
  }
  const off = best * srcPlane;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const sy = srcH === height ? y : Math.min(srcH - 1, Math.round((y * srcH) / height));
    for (let x = 0; x < width; x++) {
      const sx = srcW === width ? x : Math.min(srcW - 1, Math.round((x * srcW) / width));
      out[y * width + x] = data[off + sy * srcW + sx] ? 1 : 0;
    }
  }
  return out;
}

/** The largest 8-connected blob of a binary mask (0/1). */
function largestBlob(mask: Uint8Array, width: number, height: number): Uint8Array {
  const seen = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  let best: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    const blob: number[] = [];
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top) {
      const i = stack[--top];
      blob.push(i);
      const x = i % width;
      const y = (i - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const n = ny * width + nx;
          if (mask[n] && !seen[n]) {
            seen[n] = 1;
            stack[top++] = n;
          }
        }
      }
    }
    if (blob.length > best.length) best = blob;
  }
  const out = new Uint8Array(mask.length);
  for (const i of best) out[i] = 1;
  return out;
}

/** Fill every background area that can't reach the image border. */
function fillHoles(mask: Uint8Array, width: number, height: number): void {
  const outside = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  let top = 0;
  const push = (i: number) => {
    if (!mask[i] && !outside[i]) {
      outside[i] = 1;
      stack[top++] = i;
    }
  };
  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (top) {
    const i = stack[--top];
    const x = i % width;
    if (x > 0) push(i - 1);
    if (x < width - 1) push(i + 1);
    if (i >= width) push(i - width);
    if (i + width < mask.length) push(i + width);
  }
  for (let i = 0; i < mask.length; i++) if (!outside[i]) mask[i] = 1;
}

/** Offsets of OpenCV's 5×5 elliptical structuring element. */
const ELLIPSE_5: [number, number][] = [];
for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (Math.abs(dy) < 2 || dx === 0) ELLIPSE_5.push([dx, dy]);

/** Morphological closing: pixels past the image edge never add (dilate) and never remove (erode), as in OpenCV. */
function closeMask(mask: Uint8Array, width: number, height: number): Uint8Array {
  const dilated = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      for (const [dx, dy] of ELLIPSE_5) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height) dilated[ny * width + nx] = 1;
      }
    }
  }
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!dilated[y * width + x]) continue;
      let keep = 1;
      for (const [dx, dy] of ELLIPSE_5) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height && !dilated[ny * width + nx]) {
          keep = 0;
          break;
        }
      }
      out[y * width + x] = keep;
    }
  }
  return out;
}

/** Same clean-up as the Segmentation app's `clean_mask`: keep the largest blob, fill its holes, close small gaps. */
export function cleanMask(mask: Uint8Array, width: number, height: number): Uint8Array {
  const blob = largestBlob(mask, width, height);
  fillHoles(blob, width, height);
  return closeMask(blob, width, height);
}

/**
 * Shave one pixel off a region's edge: a pixel stays only if its four neighbours are in the region
 * (the Segmentation app's radius-1 disk; past the image edge counts as outside).
 */
export function erodeLabel(labels: Uint16Array, id: number, width: number, height: number): number {
  const remove: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (labels[i] !== id) continue;
      const inner = x > 0 && y > 0 && x < width - 1 && y < height - 1 && labels[i - 1] === id && labels[i + 1] === id && labels[i - width] === id && labels[i + width] === id;
      if (!inner) remove.push(i);
    }
  }
  for (const i of remove) labels[i] = 0;
  return remove.length;
}

export type BrushMode = 'add' | 'erase';

/** Brush size slider value → radius in image pixels. */
export function brushRadius(diameterPx: number): number {
  return Math.max(0.5, diameterPx * 0.5);
}

/** Stamp a hard disk. Adding never overwrites another region. */
export function stampCircle(
  labels: Uint16Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  diameterPx: number,
  id: number,
  mode: BrushMode,
): boolean {
  const radius = brushRadius(diameterPx);
  const rEff = Math.max(0.25, radius - 0.5);
  const r2 = rEff * rEff;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(height - 1, Math.ceil(cy + radius));
  let changed = false;
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy;
    const dy2 = dy * dy;
    if (dy2 > r2) continue;
    const row = y * width;
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      if (dx * dx + dy2 > r2) continue;
      const i = row + x;
      if (mode === 'erase') {
        if (labels[i] === id) {
          labels[i] = 0;
          changed = true;
        }
      } else if (labels[i] === 0) {
        labels[i] = id;
        changed = true;
      }
    }
  }
  return changed;
}

export function stampLine(
  labels: Uint16Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  diameterPx: number,
  id: number,
  mode: BrushMode,
): boolean {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const step = Math.max(0.35, brushRadius(diameterPx) * 0.2);
  const n = Math.max(1, Math.ceil(dist / step));
  let changed = false;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (stampCircle(labels, width, height, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, diameterPx, id, mode)) changed = true;
  }
  return changed;
}

/** Run-length encode labels as [value, count, …]. */
export function encodeRle(labels: Uint16Array): number[] {
  if (!labels.length) return [];
  const out: number[] = [];
  let prev = labels[0];
  let n = 1;
  for (let i = 1; i < labels.length; i++) {
    if (labels[i] === prev) n++;
    else {
      out.push(prev, n);
      prev = labels[i];
      n = 1;
    }
  }
  out.push(prev, n);
  return out;
}

export function decodeRle(rle: number[], length: number): Uint16Array {
  const out = new Uint16Array(length);
  let i = 0;
  for (let k = 0; k + 1 < rle.length; k += 2) {
    const value = rle[k] | 0;
    const n = rle[k + 1] | 0;
    if (n < 0 || i + n > length) throw new Error('rle length mismatch');
    out.fill(value, i, i + n);
    i += n;
  }
  if (i !== length) throw new Error('rle length mismatch');
  return out;
}
