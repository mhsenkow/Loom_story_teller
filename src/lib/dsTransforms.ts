// =================================================================
// Loom — Data-science chart transforms (roll, rebase, residual, corr…)
// =================================================================
// Pure helpers used by ChartView / ChartCard and recommendation expand.
// Keep transforms deterministic and side-effect free.
// =================================================================

export type YScaleKind = "linear" | "log" | "symlog";
export type SeriesNormalize = "index100" | "zscore";

/** Rolling mean over the last `window` points (inclusive). */
export function rollingMean(values: number[], window: number): number[] {
  const w = Math.max(1, Math.floor(window));
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= w) sum -= values[i - w]!;
    const n = Math.min(i + 1, w);
    out.push(sum / n);
  }
  return out;
}

/** Rebase a series to index=100 at first finite point, or to z-scores. */
export function normalizeSeriesValues(values: number[], mode: SeriesNormalize): number[] {
  if (mode === "index100") {
    const base = values.find((v) => Number.isFinite(v) && v !== 0) ?? values.find((v) => Number.isFinite(v));
    if (base == null || base === 0) return values.map(() => 100);
    return values.map((v) => (Number.isFinite(v) ? (v / base) * 100 : NaN));
  }
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length < 2) return values.map(() => 0);
  const mean = finite.reduce((a, b) => a + b, 0) / finite.length;
  const variance = finite.reduce((a, b) => a + (b - mean) ** 2, 0) / finite.length;
  const sd = Math.sqrt(variance) || 1;
  return values.map((v) => (Number.isFinite(v) ? (v - mean) / sd : NaN));
}

/** Pearson r for two equal-length numeric arrays (pairwise complete). */
export function pearsonR(xs: number[], ys: number[]): number {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  const len = Math.min(xs.length, ys.length);
  for (let i = 0; i < len; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    n += 1;
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  if (n < 3) return 0;
  const num = n * sxy - sx * sy;
  const den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  if (!(den > 0)) return 0;
  const r = num / den;
  return Number.isFinite(r) ? Math.max(-1, Math.min(1, r)) : 0;
}

export interface CorrMatrix {
  labels: string[];
  /** matrix[row][col] = r(labels[row], labels[col]) */
  matrix: number[][];
}

/** Correlation matrix over column indices into rows. */
export function buildCorrMatrix(
  rows: unknown[][],
  colIndices: number[],
  labels: string[],
): CorrMatrix | null {
  if (colIndices.length < 2 || labels.length !== colIndices.length) return null;
  const series = colIndices.map((ci) =>
    rows.map((r) => {
      const v = Number(r[ci]);
      return Number.isFinite(v) ? v : NaN;
    }),
  );
  const matrix = series.map((a, i) =>
    series.map((b, j) => (i === j ? 1 : pearsonR(a, b))),
  );
  return { labels: [...labels], matrix };
}

export interface ParetoBin {
  label: string;
  value: number;
  cumulativePct: number;
}

/** Sort descending and attach cumulative percent of total. */
export function buildPareto(entries: { label: string; value: number }[]): ParetoBin[] {
  const sorted = [...entries].filter((e) => e.value > 0).sort((a, b) => b.value - a.value);
  const total = sorted.reduce((s, e) => s + e.value, 0) || 1;
  let acc = 0;
  return sorted.map((e) => {
    acc += e.value;
    return { label: e.label, value: e.value, cumulativePct: (acc / total) * 100 };
  });
}

/** Linear regression residuals: y - (slope*x + intercept). */
export function residualYs(xs: number[], ys: number[]): { residuals: number[]; slope: number; intercept: number } {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
  }
  if (pts.length < 2) return { residuals: ys.map(() => NaN), slope: 0, intercept: 0 };
  const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  let num = 0;
  let den = 0;
  for (const p of pts) {
    num += (p.x - mx) * (p.y - my);
    den += (p.x - mx) ** 2;
  }
  const slope = den ? num / den : 0;
  const intercept = my - slope * mx;
  const residuals = xs.map((x, i) => {
    const y = ys[i]!;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return NaN;
    return y - (slope * x + intercept);
  });
  return { residuals, slope, intercept };
}

/** Map data value → [0,1] for log / symlog (positive domain for log). */
export function scaleY(v: number, min: number, max: number, kind: YScaleKind): number {
  if (kind === "linear" || !Number.isFinite(v)) {
    if (!(max > min)) return 0.5;
    return (v - min) / (max - min);
  }
  if (kind === "log") {
    const lo = Math.max(1e-12, min);
    const hi = Math.max(lo * 1.0001, max);
    const lv = Math.log(Math.max(1e-12, v));
    const a = Math.log(lo);
    const b = Math.log(hi);
    return (lv - a) / (b - a || 1);
  }
  // symlog — asinh-style soft log around 0
  const c = 1;
  const t = (x: number) => Math.asinh(x / c);
  const a = t(min);
  const b = t(max);
  return (t(v) - a) / (b - a || 1);
}

/** Domain for log scales: force positive for log; keep signed for symlog. */
export function scaleDomain(min: number, max: number, kind: YScaleKind): { min: number; max: number } {
  if (kind === "log") {
    const hi = Math.max(Math.abs(max), Math.abs(min), 1e-6);
    const lo = Math.min(Math.abs(min), Math.abs(max));
    const positiveMin = min > 0 ? min : lo > 0 ? lo : hi / 1000;
    return { min: Math.max(1e-12, positiveMin), max: Math.max(positiveMin * 1.01, hi) };
  }
  if (min === max) {
    const d = Math.abs(min) || 1;
    return { min: min - d, max: max + d };
  }
  return { min, max };
}

/** Z-score anomaly row indices (|z| > threshold). */
export function anomalyRowIndices(rows: unknown[][], colIdx: number, threshold = 2.5): number[] {
  const vals: { i: number; v: number }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const v = Number(rows[i]![colIdx]);
    if (Number.isFinite(v)) vals.push({ i, v });
  }
  if (vals.length < 5) return [];
  const mean = vals.reduce((s, p) => s + p.v, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((s, p) => s + (p.v - mean) ** 2, 0) / vals.length) || 1;
  return vals.filter((p) => Math.abs((p.v - mean) / sd) > threshold).map((p) => p.i);
}
