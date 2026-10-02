// =================================================================
// Loom — Shared Cartesian axis math + label layout
// =================================================================
// Every canvas renderer that draws an axis goes through here so ticks
// land on round numbers, gridlines sit on the same values as their
// labels, and category labels pick a legible layout (flat → angled →
// thinned) instead of being chopped to a fixed character count.
// =================================================================

export type NiceScale = {
  /** Domain after rounding outward to whole steps (when `extend`). */
  min: number;
  max: number;
  step: number;
  ticks: number[];
};

/** Round a raw step to 1 / 2 / 2.5 / 5 × 10^k. */
function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const exp = Math.floor(Math.log10(raw));
  const base = Math.pow(10, exp);
  const f = raw / base;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nf * base;
}

/**
 * Round-number ticks for [min, max]. With `extend` (default) the domain
 * grows to the nearest outer ticks so marks never touch the frame edge
 * between labels; without it, ticks are the round values inside the data.
 */
export function niceTicks(min: number, max: number, count = 5, extend = true): NiceScale {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, step: 0.2, ticks: [0, 0.2, 0.4, 0.6, 0.8, 1] };
  if (min > max) [min, max] = [max, min];
  if (min === max) {
    const d = min === 0 ? 1 : Math.abs(min) * 0.1;
    min -= d;
    max += d;
  }
  const step = niceStep((max - min) / Math.max(1, count));
  const lo = extend ? Math.floor(min / step + 1e-9) * step : Math.ceil(min / step - 1e-9) * step;
  const hi = extend ? Math.ceil(max / step - 1e-9) * step : Math.floor(max / step + 1e-9) * step;
  const ticks: number[] = [];
  for (let v = lo, i = 0; v <= hi + step * 1e-6 && i < 200; v += step, i++) {
    // Kill float fuzz (0.30000000000000004) so labels format cleanly
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)));
  }
  // `|| 0` folds -0 so nothing downstream prints "-0"
  return { min: (extend ? lo : min) || 0, max: (extend ? hi : max) || 0, step, ticks };
}

/** Zero-based scale for magnitudes (bars, areas, counts). Handles all-negative data. */
export function niceZeroScale(min: number, max: number, count = 5): NiceScale {
  return niceTicks(Math.min(0, min), Math.max(0, max), count, true);
}

/** Tick label with precision matched to the step (1.5k, 0.25, 12, 3M). */
export function formatAxisValue(v: number, step?: number): string {
  if (!Number.isFinite(v)) return "";
  const abs = Math.abs(v);
  const s = step && step > 0 ? step : abs || 1;
  const fmt = (n: number, unitStep: number, suffix: string) => {
    const decimals = unitStep >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(unitStep) - 1e-9));
    return `${Number(n.toFixed(decimals))}${suffix}`;
  };
  if (abs >= 1e9) return fmt(v / 1e9, s / 1e9, "B");
  if (abs >= 1e6) return fmt(v / 1e6, s / 1e6, "M");
  if (abs >= 1e4 || (abs >= 1e3 && s >= 100)) return fmt(v / 1e3, s / 1e3, "k");
  return fmt(v, s, "").replace(/^-0$/, "0");
}

/** Compact value for data labels / tooltips without a known step (3 significant digits). */
export function formatDataValue(v: number): string {
  if (!Number.isFinite(v)) return "";
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${Number((v / 1e9).toPrecision(3))}B`;
  if (abs >= 1e6) return `${Number((v / 1e6).toPrecision(3))}M`;
  if (abs >= 1e4) return `${Number((v / 1e3).toPrecision(3))}k`;
  if (abs >= 100) return String(Math.round(v));
  if (abs >= 1) return String(Number(v.toFixed(1)));
  if (abs === 0) return "0";
  return String(Number(v.toPrecision(2)));
}

/** Linear map from a domain to a pixel range. */
export function linear(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const span = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

// ---------------------------------------------------------------
// Category (band) label layout
// ---------------------------------------------------------------

export type BandLabelLayout = {
  /** Rotation in radians (0 or negative = rising to the right). */
  angle: number;
  /** Max label width in px before ellipsis. */
  maxWidth: number;
  /** Draw every Nth label (1 = all). */
  every: number;
  fontSize: number;
};

/**
 * Choose how to lay out category labels under a band axis.
 * `room` is the vertical space available below the baseline for labels.
 */
export function layoutBandLabels(
  ctx: CanvasRenderingContext2D,
  labels: string[],
  bandWidth: number,
  room: number,
  fontFamily: string,
  baseFont = 10,
): BandLabelLayout {
  const n = labels.length;
  const fontSize = Math.max(9, Math.min(baseFont, bandWidth * 0.55 + 2));
  ctx.save();
  ctx.font = `${fontSize}px '${fontFamily}', sans-serif`;
  const widths = labels.map((l) => ctx.measureText(l).width);
  ctx.restore();
  const widest = widths.length ? Math.max(...widths) : 0;

  // 1) Flat labels that fit their band
  if (widest <= bandWidth - 6) return { angle: 0, maxWidth: bandWidth - 6, every: 1, fontSize };

  // 2) Flat but allowed to ellipsize when bands are reasonably wide
  if (bandWidth >= 56) return { angle: 0, maxWidth: bandWidth - 8, every: 1, fontSize };

  // 3) Angled at -40°: each label needs ~fontSize*1.5 horizontal spacing
  const angle = (-40 * Math.PI) / 180;
  const sin = Math.abs(Math.sin(angle));
  const maxWidth = Math.max(24, Math.min(widest, (room - fontSize) / sin));
  const minSpacing = fontSize * 1.35;
  const every = Math.max(1, Math.ceil(minSpacing / Math.max(1, bandWidth)));
  return { angle, maxWidth, every: n > 1 ? every : 1, fontSize };
}

// ---------------------------------------------------------------
// Ordered x models (line / area / ordered bars)
// ---------------------------------------------------------------

export type XModelKind = "number" | "time" | "band";

export type XModel = {
  kind: XModelKind;
  /** Keys in drawing order. */
  keys: string[];
  /** 0–1 position per key (same order as `keys`). */
  pos: number[];
  /** Numeric domain for number/time models (ms for time). */
  domain: [number, number] | null;
};

const DATE_LIKE = /^\d{4}-\d{2}(-\d{2})?([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$|^\d{1,2}\/\d{1,2}\/\d{2,4}$/;

function parseTime(s: string): number {
  if (!DATE_LIKE.test(s.trim())) return NaN;
  return Date.parse(s.trim());
}

/** Classify string keys as numbers, dates, or plain categories, and order them. */
export function classifyKeys(keys: string[]): { kind: XModelKind; sorted: string[]; values: number[] } {
  const clean = keys.filter((k) => k !== "null" && k !== "undefined" && k !== "");
  const nums = clean.map((k) => Number(k));
  if (clean.length > 0 && nums.every((n) => Number.isFinite(n))) {
    const order = clean.map((k, i) => [k, nums[i]!] as const).sort((a, b) => a[1] - b[1]);
    return { kind: "number", sorted: order.map((o) => o[0]), values: order.map((o) => o[1]) };
  }
  const times = clean.map(parseTime);
  if (clean.length > 0 && times.every((t) => Number.isFinite(t))) {
    const order = clean.map((k, i) => [k, times[i]!] as const).sort((a, b) => a[1] - b[1]);
    return { kind: "time", sorted: order.map((o) => o[0]), values: order.map((o) => o[1]) };
  }
  const sorted = [...clean].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return { kind: "band", sorted, values: sorted.map((_, i) => i) };
}

export function buildXModel(keys: string[]): XModel {
  const { kind, sorted, values } = classifyKeys(keys);
  if (kind === "band" || sorted.length < 2) {
    const n = Math.max(1, sorted.length);
    return { kind: "band", keys: sorted, pos: sorted.map((_, i) => (i + 0.5) / n), domain: null };
  }
  const min = values[0]!;
  const max = values[values.length - 1]!;
  const span = max - min || 1;
  return { kind, keys: sorted, pos: values.map((v) => (v - min) / span), domain: [min, max] };
}

// ---------------------------------------------------------------
// Time ticks (UTC — date-only strings parse as UTC midnight)
// ---------------------------------------------------------------

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type TimeInterval = { ms: number; unit: "ms" | "month" | "year"; n: number };

const TIME_INTERVALS: TimeInterval[] = [
  { ms: SEC, unit: "ms", n: SEC },
  { ms: 5 * SEC, unit: "ms", n: 5 * SEC },
  { ms: 15 * SEC, unit: "ms", n: 15 * SEC },
  { ms: 30 * SEC, unit: "ms", n: 30 * SEC },
  { ms: MIN, unit: "ms", n: MIN },
  { ms: 5 * MIN, unit: "ms", n: 5 * MIN },
  { ms: 15 * MIN, unit: "ms", n: 15 * MIN },
  { ms: 30 * MIN, unit: "ms", n: 30 * MIN },
  { ms: HOUR, unit: "ms", n: HOUR },
  { ms: 3 * HOUR, unit: "ms", n: 3 * HOUR },
  { ms: 6 * HOUR, unit: "ms", n: 6 * HOUR },
  { ms: 12 * HOUR, unit: "ms", n: 12 * HOUR },
  { ms: DAY, unit: "ms", n: DAY },
  { ms: 2 * DAY, unit: "ms", n: 2 * DAY },
  { ms: 7 * DAY, unit: "ms", n: 7 * DAY },
  { ms: 30 * DAY, unit: "month", n: 1 },
  { ms: 91 * DAY, unit: "month", n: 3 },
  { ms: 182 * DAY, unit: "month", n: 6 },
  { ms: 365 * DAY, unit: "year", n: 1 },
  { ms: 2 * 365 * DAY, unit: "year", n: 2 },
  { ms: 5 * 365 * DAY, unit: "year", n: 5 },
  { ms: 10 * 365 * DAY, unit: "year", n: 10 },
  { ms: 25 * 365 * DAY, unit: "year", n: 25 },
  { ms: 50 * 365 * DAY, unit: "year", n: 50 },
  { ms: 100 * 365 * DAY, unit: "year", n: 100 },
];

/** Calendar-aligned ticks inside [min, max] (ms) with a matching label format. */
export function timeTicks(min: number, max: number, count = 6): { ticks: number[]; format: (t: number) => string } {
  const span = Math.max(1, max - min);
  const target = span / Math.max(1, count);
  const iv = TIME_INTERVALS.find((i) => i.ms >= target) ?? TIME_INTERVALS[TIME_INTERVALS.length - 1]!;
  const ticks: number[] = [];
  if (iv.unit === "ms") {
    // Align to the interval in UTC (weeks start on the first tick's day)
    let t = Math.ceil(min / iv.n) * iv.n;
    for (let i = 0; t <= max && i < 400; t += iv.n, i++) ticks.push(t);
  } else {
    const d = new Date(min);
    let y = d.getUTCFullYear();
    let m = iv.unit === "year" ? 0 : Math.floor(d.getUTCMonth() / iv.n) * iv.n;
    if (iv.unit === "year") y = Math.floor(y / iv.n) * iv.n;
    for (let i = 0; i < 400; i++) {
      const t = Date.UTC(y, m, 1);
      if (t > max) break;
      if (t >= min) ticks.push(t);
      if (iv.unit === "year") y += iv.n;
      else {
        m += iv.n;
        if (m >= 12) {
          y += Math.floor(m / 12);
          m %= 12;
        }
      }
    }
  }
  const sameYear = new Date(min).getUTCFullYear() === new Date(max).getUTCFullYear();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const format = (t: number) => {
    const d = new Date(t);
    if (iv.unit === "year") return String(d.getUTCFullYear());
    if (iv.unit === "month") {
      const mon = MONTHS[d.getUTCMonth()]!;
      return sameYear && d.getUTCMonth() !== 0 ? mon : `${mon} ${d.getUTCFullYear()}`;
    }
    if (iv.ms >= DAY) return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
    if (iv.ms >= MIN) return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
    return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
  };
  return { ticks, format };
}

// ---------------------------------------------------------------
// Histogram bins on round edges
// ---------------------------------------------------------------

export type HistogramBins = { lo: number; hi: number; step: number; counts: number[] };

/** Bin a numeric column on round edges (~sqrt(n) bins, 8–40). */
export function histogramBins(values: number[]): HistogramBins | null {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === Infinity) return null;
  const target = Math.max(8, Math.min(40, Math.round(Math.sqrt(values.length))));
  const s = niceTicks(min, max === min ? min + 1 : max, target, true);
  // The max value sits on the right edge; the clamp below keeps it in the last bin
  const n = Math.max(1, Math.round((s.max - s.min) / s.step));
  const counts = new Array<number>(n).fill(0);
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    const bi = Math.min(n - 1, Math.max(0, Math.floor((v - s.min) / s.step + 1e-9)));
    counts[bi]! += 1;
  }
  return { lo: s.min, hi: s.min + n * s.step, step: s.step, counts };
}

/** Axis title for an aggregated measure ("Count", "Sum of revenue", "Average price"). */
export function aggregateAxisTitle(agg: string | null | undefined, field: string | null | undefined): string {
  if (!field || agg === "count") return "Count";
  switch (agg) {
    case "mean":
      return `Average ${field}`;
    case "min":
      return `Min ${field}`;
    case "max":
      return `Max ${field}`;
    case "sum":
      return `Sum of ${field}`;
    default:
      return field;
  }
}
