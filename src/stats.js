// Small numeric helpers (pure).
/** Quantile with linear interpolation between order statistics (R type 7, numpy default). */
export function quantile(sorted, p) {
  if (!sorted.length) return null;
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h), hi = Math.ceil(h);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}
export const median = (xs) => quantile([...xs].sort((a, b) => a - b), 0.5);
export const round = (x, d = 0) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
export const DAY = 86400e3;
export const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
export const t = (s) => Date.parse(s);
