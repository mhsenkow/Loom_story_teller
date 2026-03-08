// =================================================================
// Loom — Smart analytics (anomaly, forecast, trend, reference lines)
// =================================================================
// Pure functions: run on sample rows and return indices/points for
// visualization. No AI/vision here; optional vision can be added later.
// =================================================================

export type AnomalyMethod = "z-score" | "iqr" | "mad";

export interface AnomalyResult {
  column: string;
  method: AnomalyMethod;
  threshold: number;
  rowIndices: number[];
}

export interface ForecastResult {
  xField: string;
  yField: string;
  horizon: number;
  points: { x: number; y: number }[];
  method: "linear" | "moving-avg";
}

export interface TrendResult {
  xField: string;
  yField: string;
  slope: number;
  intercept: number;
  points: { x: number; y: number }[]; // line segment in data space
}

export interface ReferenceLine {
  axis: "x" | "y";
  value: number;
  label: string;
  type: "mean" | "median" | "q1" | "q3" | "custom";
}

export interface ReferenceLinesResult {
  column: string;
  axis: "x" | "y";
  lines: ReferenceLine[];
}

export interface ClusterResult {
  rowToCluster: Record<number, number>; // row index -> cluster id 0..k-1
  k: number;
  columnX: string;
  columnY: string;
}

function getNumericValues(rows: unknown[][], colIdx: number): number[] {
  const out: number[] = [];
  for (const r of rows) {
    const v = Number(r[colIdx]);
    if (!isNaN(v)) out.push(v);
  }
  return out;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const sq = arr.reduce((s, v) => s + (v - m) ** 2, 0);
  return Math.sqrt(sq / (arr.length - 1)) || 0;
}

function medianSorted(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n % 2 === 1) return sorted[(n - 1) / 2]!;
  return (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
}

function mad(arr: number[]): number {
  const m = medianSorted([...arr].sort((a, b) => a - b));
  const devs = arr.map(v => Math.abs(v - m));
  return medianSorted(devs.sort((a, b) => a - b)) || 1;
}

/** Z-score anomaly: |z| > threshold. */
export function anomalyZScore(
  rows: unknown[][],
  colIdx: number,
  threshold: number,
): number[] {
  const vals = getNumericValues(rows, colIdx);
  if (vals.length === 0) return [];
  const m = mean(vals);
  const s = std(vals) || 1;
  const indices: number[] = [];
  let idx = 0;
  for (const r of rows) {
    const v = Number(r[colIdx]);
    if (!isNaN(v)) {
      const z = Math.abs((v - m) / s);
      if (z > threshold) indices.push(idx);
      idx++;
    }
  }
  return indices;
}

/** IQR anomaly: below Q1 - 1.5*IQR or above Q3 + 1.5*IQR. */
export function anomalyIQR(
  rows: unknown[][],
  colIdx: number,
  multiplier: number = 1.5,
): number[] {
  const vals = getNumericValues(rows, colIdx);
  if (vals.length < 4) return [];
  const sorted = [...vals].sort((a, b) => a - b);
  const n = sorted.length;
  const q1 = medianSorted(sorted.slice(0, Math.floor(n / 2)));
  const q3 = medianSorted(sorted.slice(Math.ceil(n / 2)));
  const iqr = q3 - q1 || 1;
  const lo = q1 - multiplier * iqr;
  const hi = q3 + multiplier * iqr;
  const indices: number[] = [];
  let idx = 0;
  for (const r of rows) {
    const v = Number(r[colIdx]);
    if (!isNaN(v) && (v < lo || v > hi)) indices.push(idx);
    idx++;
  }
  return indices;
}

/** MAD-based anomaly (median absolute deviation). */
export function anomalyMAD(
  rows: unknown[][],
  colIdx: number,
  threshold: number,
): number[] {
  const vals = getNumericValues(rows, colIdx);
  if (vals.length < 2) return [];
  const med = medianSorted([...vals].sort((a, b) => a - b));
  const m = mad(vals);
  const indices: number[] = [];
  let idx = 0;
  for (const r of rows) {
    const v = Number(r[colIdx]);
    if (!isNaN(v)) {
      const modifiedZ = 0.6745 * Math.abs(v - med) / m;
      if (modifiedZ > threshold) indices.push(idx);
      idx++;
    }
  }
  return indices;
}

export function runAnomaly(
  rows: unknown[][],
  column: string,
  columns: string[],
  method: AnomalyMethod,
  threshold: number,
): AnomalyResult | null {
  const colIdx = columns.indexOf(column);
  if (colIdx === -1) return null;
  let rowIndices: number[];
  if (method === "z-score") rowIndices = anomalyZScore(rows, colIdx, threshold);
  else if (method === "iqr") rowIndices = anomalyIQR(rows, colIdx, threshold);
  else rowIndices = anomalyMAD(rows, colIdx, threshold);
  return { column, method, threshold, rowIndices };
}

/** Simple linear regression. */
function linearRegression(x: number[], y: number[]): { slope: number; intercept: number } {
  const n = x.length;
  if (n < 2) return { slope: 0, intercept: mean(y) };
  const mx = mean(x);
  const my = mean(y);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i]! - mx) * (y[i]! - my);
    den += (x[i]! - mx) ** 2;
  }
  const slope = den ? num / den : 0;
  const intercept = my - slope * mx;
  return { slope, intercept };
}

/** Forecast: extend last N points with linear fit or moving average. */
export function runForecast(
  rows: unknown[][],
  xField: string,
  yField: string,
  columns: string[],
  horizon: number,
  method: "linear" | "moving-avg",
): ForecastResult | null {
  const xi = columns.indexOf(xField);
  const yi = columns.indexOf(yField);
  if (xi === -1 || yi === -1 || horizon < 1) return null;
  const points: { x: number; y: number }[] = [];
  for (const r of rows) {
    const x = Number(r[xi]);
    const y = Number(r[yi]);
    if (!isNaN(x) && !isNaN(y)) points.push({ x, y });
  }
  if (points.length < 2) return null;
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const last = sorted[sorted.length - 1]!;
  const forecast: { x: number; y: number }[] = [];
  if (method === "linear") {
    const { slope, intercept } = linearRegression(
      sorted.map(p => p.x),
      sorted.map(p => p.y),
    );
    const step = sorted.length >= 2
      ? (last.x - sorted[0]!.x) / (sorted.length - 1)
      : 1;
    for (let i = 1; i <= horizon; i++) {
      const x = last.x + i * step;
      forecast.push({ x, y: slope * x + intercept });
    }
  } else {
    const window = Math.min(5, Math.floor(sorted.length / 2));
    const tail = sorted.slice(-window);
    const avgY = mean(tail.map(p => p.y));
    const step = sorted.length >= 2
      ? (last.x - sorted[0]!.x) / (sorted.length - 1)
      : 1;
    for (let i = 1; i <= horizon; i++) {
      forecast.push({ x: last.x + i * step, y: avgY });
    }
  }
  return { xField, yField, horizon, points: forecast, method };
}

/** Trend line: full linear regression over current data. */
export function runTrend(
  rows: unknown[][],
  xField: string,
  yField: string,
  columns: string[],
): TrendResult | null {
  const xi = columns.indexOf(xField);
  const yi = columns.indexOf(yField);
  if (xi === -1 || yi === -1) return null;
  const x: number[] = [];
  const y: number[] = [];
  for (const r of rows) {
    const xv = Number(r[xi]);
    const yv = Number(r[yi]);
    if (!isNaN(xv) && !isNaN(yv)) {
      x.push(xv);
      y.push(yv);
    }
  }
  if (x.length < 2) return null;
  const { slope, intercept } = linearRegression(x, y);
  const xMin = Math.min(...x);
  const xMax = Math.max(...x);
  return {
    xField,
    yField,
    slope,
    intercept,
    points: [
      { x: xMin, y: slope * xMin + intercept },
      { x: xMax, y: slope * xMax + intercept },
    ],
  };
}

export function runReferenceLines(
  rows: unknown[][],
  column: string,
  columns: string[],
  axis: "x" | "y",
  types: ("mean" | "median" | "q1" | "q3")[],
): ReferenceLinesResult | null {
  const colIdx = columns.indexOf(column);
  if (colIdx === -1 || types.length === 0) return null;
  const vals = getNumericValues(rows, colIdx);
  if (vals.length === 0) return null;
  const sorted = [...vals].sort((a, b) => a - b);
  const n = sorted.length;
  const q1 = medianSorted(sorted.slice(0, Math.floor(n / 2)));
  const q3 = medianSorted(sorted.slice(Math.ceil(n / 2)));
  const lines: ReferenceLine[] = [];
  if (types.includes("mean")) lines.push({ axis, value: mean(vals), label: "Mean", type: "mean" });
  if (types.includes("median")) lines.push({ axis, value: medianSorted(sorted), label: "Median", type: "median" });
  if (types.includes("q1")) lines.push({ axis, value: q1, label: "Q1", type: "q1" });
  if (types.includes("q3")) lines.push({ axis, value: q3, label: "Q3", type: "q3" });
  return { column, axis, lines };
}

/** Simple k-means style clustering on two columns (k=2..6). */
export function runClustering(
  rows: unknown[][],
  columnX: string,
  columnY: string,
  columns: string[],
  k: number,
): ClusterResult | null {
  const xi = columns.indexOf(columnX);
  const yi = columns.indexOf(columnY);
  if (xi === -1 || yi === -1 || k < 2 || k > 8) return null;
  const points: { x: number; y: number; rowIdx: number }[] = [];
  rows.forEach((r, i) => {
    const x = Number(r[xi]);
    const y = Number(r[yi]);
    if (!isNaN(x) && !isNaN(y)) points.push({ x, y, rowIdx: i });
  });
  if (points.length < k) return null;
  const xMin = Math.min(...points.map(p => p.x));
  const xMax = Math.max(...points.map(p => p.x));
  const yMin = Math.min(...points.map(p => p.y));
  const yMax = Math.max(...points.map(p => p.y));
  let centroids = Array.from({ length: k }, (_, i) => ({
    x: xMin + (i / (k - 1)) * (xMax - xMin) || xMin,
    y: yMin + (i / (k - 1)) * (yMax - yMin) || yMin,
  }));
  for (let iter = 0; iter < 20; iter++) {
    const assign: number[][] = Array(k).fill(null).map(() => []);
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!;
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = (p.x - centroids[c]!.x) ** 2 + (p.y - centroids[c]!.y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      assign[best]!.push(i);
    }
    centroids = centroids.map((_, c) => {
      const idx = assign[c]!;
      if (idx.length === 0) return centroids[c]!;
      const sx = idx.reduce((s, i) => s + points[i]!.x, 0);
      const sy = idx.reduce((s, i) => s + points[i]!.y, 0);
      return { x: sx / idx.length, y: sy / idx.length };
    });
  }
  const rowToCluster: Record<number, number> = {};
  points.forEach((p, i) => {
    let best = 0;
    let bestD = Infinity;
    for (let c = 0; c < k; c++) {
      const d = (p.x - centroids[c]!.x) ** 2 + (p.y - centroids[c]!.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    rowToCluster[p.rowIdx] = best;
  });
  return { rowToCluster, k, columnX, columnY };
}
