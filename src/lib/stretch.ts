import { isValid } from './cube';

const MAX_SAMPLES = 200_000;

/** Sorted sample of finite, non-no-data values; percentiles are looked up from it. */
export function sortedSample(values: ArrayLike<number>, noData?: number): Float64Array {
  const n = values.length;
  const step = Math.max(1, Math.floor(n / MAX_SAMPLES));
  const out = new Float64Array(Math.ceil(n / step));
  let k = 0;
  for (let i = 0; i < n; i += step) {
    const v = values[i];
    if (isValid(v, noData)) out[k++] = v;
  }
  return out.subarray(0, k).sort();
}

export function percentile(sorted: Float64Array, p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i];
}

export function stretchRange(sorted: Float64Array, lowPct: number, highPct: number): [number, number] {
  let lo = percentile(sorted, lowPct);
  let hi = percentile(sorted, highPct);
  if (hi <= lo) {
    lo = sorted[0] ?? 0;
    hi = sorted[sorted.length - 1] ?? 1;
    if (hi <= lo) hi = lo + 1;
  }
  return [lo, hi];
}
