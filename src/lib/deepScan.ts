// =================================================================
// Loom — Deep scan: profile dataset + ranked swipe deck
// =================================================================
// Builds a richer DatasetProfile from sample rows, expands/re-scores
// chart candidates, applies viz preference boosts, and returns a
// diversified swipe deck (~12–20 charts).
// =================================================================

import type { ColumnInfo, QueryResult } from "./store";
import {
  recommend,
  recommendStreamStory,
  recommendSourceStory,
  diversifyRecommendations,
  createChartRec,
  type ChartRecommendation,
} from "./recommendations";
import {
  applyPreferenceBoosts,
  type VizPreferenceModel,
} from "./vizPreferences";

export type ProfileColType = "quantitative" | "nominal" | "temporal";

export interface ColumnProfile {
  name: string;
  type: ProfileColType;
  distinctRatio: number;
  nullRatio: number;
  topCategories: { value: string; count: number }[];
  mean?: number;
  std?: number;
  skewProxy?: number;
  variance?: number;
  temporalParseRate?: number;
  entropy?: number;
}

export interface NumericPairCorr {
  a: string;
  b: string;
  absR: number;
}

export interface NominalPairStrength {
  a: string;
  b: string;
  /** Normalized contingency strength in [0, 1]. */
  strength: number;
}

export interface DatasetProfile {
  columns: ColumnProfile[];
  numericCorrelations: NumericPairCorr[];
  nominalPairs: NominalPairStrength[];
  schemaSignature: string;
  rowCount: number;
}

export interface DeepScanResult {
  profile: DatasetProfile;
  deck: ChartRecommendation[];
  scanMs: number;
}

export type DeepScanSource =
  | { kind: "file"; fileName: string }
  | { kind: "stream" }
  | { kind: "source"; sourceKind: string };

function inferType(dt: string, colName?: string): ProfileColType {
  const t = dt.toUpperCase();
  if (["INTEGER", "BIGINT", "FLOAT", "DOUBLE", "DECIMAL", "REAL", "HUGEINT", "TINYINT", "SMALLINT", "UBIGINT", "UINTEGER", "USMALLINT", "UTINYINT"].some((n) => t.includes(n))) {
    return "quantitative";
  }
  if (["DATE", "TIMESTAMP", "TIME", "INTERVAL"].some((n) => t.includes(n))) return "temporal";
  const name = (colName ?? "").toUpperCase();
  if (["DATE", "TIME", "YEAR", "MONTH", "DAY", "INCIDENT_DATE", "CREATED_AT", "UPDATED_AT", "TIMESTAMP", "TS"].some((n) => name.includes(n))) {
    return "temporal";
  }
  return "nominal";
}

function pearsonAbs(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 12) return 0;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  const cov = sxy - (sx * sy) / n;
  const vx = sxx - (sx * sx) / n;
  const vy = syy - (sy * sy) / n;
  if (vx <= 0 || vy <= 0) return 0;
  const r = cov / Math.sqrt(vx * vy);
  return Number.isFinite(r) ? Math.min(1, Math.abs(r)) : 0;
}

function skewProxy(vals: number[], mean: number, std: number): number {
  if (vals.length < 8 || std <= 0) return 0;
  let m3 = 0;
  for (const v of vals) {
    const z = (v - mean) / std;
    m3 += z * z * z;
  }
  return m3 / vals.length;
}

function categoryEntropy(counts: Map<string, number>, total: number): number {
  if (total <= 0 || counts.size === 0) return 0;
  let h = 0;
  for (const c of counts.values()) {
    const p = c / total;
    if (p > 0) h -= p * Math.log2(p);
  }
  const maxH = Math.log2(counts.size);
  return maxH > 0 ? h / maxH : 0;
}

function parseTemporalRate(vals: unknown[]): number {
  if (vals.length === 0) return 0;
  let ok = 0;
  for (const v of vals) {
    if (v == null || v === "") continue;
    if (typeof v === "number" && Number.isFinite(v)) {
      ok += 1;
      continue;
    }
    const s = String(v);
    const t = Date.parse(s);
    if (!Number.isNaN(t)) ok += 1;
  }
  return ok / vals.length;
}

function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Build a richer profile from column stats + sample rows. */
export function buildDatasetProfile(
  columns: ColumnInfo[],
  data: QueryResult | null,
): DatasetProfile {
  const rows = data?.rows ?? [];
  const colNames = data?.columns ?? columns.map((c) => c.name);
  const n = Math.max(rows.length, 1);
  const totalRowsHint = data?.total_rows ?? rows.length;

  const profiles: ColumnProfile[] = columns.map((col) => {
    const idx = colNames.indexOf(col.name);
    const type = inferType(col.data_type, col.name);
    const values: unknown[] = [];
    if (idx >= 0) {
      for (const r of rows) values.push(r[idx]);
    }
    const nonNull = values.filter((v) => v != null && v !== "");
    const nullRatio = values.length > 0 ? 1 - nonNull.length / values.length : col.null_count > 0 ? 0.1 : 0;
    const distinctRatio =
      nonNull.length > 0
        ? Math.min(1, (col.distinct_count || new Set(nonNull.map(String)).size) / nonNull.length)
        : 0;

    const base: ColumnProfile = {
      name: col.name,
      type,
      distinctRatio,
      nullRatio,
      topCategories: [],
    };

    if (type === "quantitative") {
      const nums = nonNull.map(Number).filter((v) => !Number.isNaN(v));
      if (nums.length >= 2) {
        const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
        const variance = nums.reduce((s, v) => s + (v - mean) ** 2, 0) / (nums.length - 1);
        const std = Math.sqrt(variance) || 0;
        base.mean = mean;
        base.std = std;
        base.variance = variance;
        base.skewProxy = skewProxy(nums, mean, std);
      }
    } else if (type === "nominal") {
      const counts = new Map<string, number>();
      for (const v of nonNull) {
        const k = String(v);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      base.topCategories = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([value, count]) => ({ value, count }));
      base.entropy = categoryEntropy(counts, nonNull.length);
    } else if (type === "temporal") {
      base.temporalParseRate = parseTemporalRate(values);
    }

    return base;
  });

  // Numeric correlations: top 12 by variance
  const numProfiles = profiles
    .filter((p) => p.type === "quantitative" && (p.variance ?? 0) > 0)
    .sort((a, b) => (b.variance ?? 0) - (a.variance ?? 0))
    .slice(0, 12);

  const numericCorrelations: NumericPairCorr[] = [];
  for (let i = 0; i < numProfiles.length; i++) {
    for (let j = i + 1; j < numProfiles.length; j++) {
      const a = numProfiles[i]!;
      const b = numProfiles[j]!;
      const ai = colNames.indexOf(a.name);
      const bi = colNames.indexOf(b.name);
      if (ai < 0 || bi < 0) continue;
      const xs: number[] = [];
      const ys: number[] = [];
      for (const r of rows) {
        const x = Number(r[ai]);
        const y = Number(r[bi]);
        if (!Number.isNaN(x) && !Number.isNaN(y)) {
          xs.push(x);
          ys.push(y);
        }
      }
      const absR = pearsonAbs(xs, ys);
      if (absR > 0.05) numericCorrelations.push({ a: a.name, b: b.name, absR });
    }
  }
  numericCorrelations.sort((a, b) => b.absR - a.absR);

  // Nominal pair contingency (top 6 by entropy * distinct)
  const nomProfiles = profiles
    .filter((p) => p.type === "nominal" && p.topCategories.length >= 2 && p.distinctRatio < 0.5)
    .sort((a, b) => (b.entropy ?? 0) - (a.entropy ?? 0))
    .slice(0, 6);

  const nominalPairs: NominalPairStrength[] = [];
  for (let i = 0; i < nomProfiles.length; i++) {
    for (let j = i + 1; j < nomProfiles.length; j++) {
      const a = nomProfiles[i]!;
      const b = nomProfiles[j]!;
      const ai = colNames.indexOf(a.name);
      const bi = colNames.indexOf(b.name);
      if (ai < 0 || bi < 0) continue;
      const joint = new Map<string, number>();
      let total = 0;
      for (const r of rows) {
        const av = r[ai];
        const bv = r[bi];
        if (av == null || bv == null || av === "" || bv === "") continue;
        const key = `${String(av)}\0${String(bv)}`;
        joint.set(key, (joint.get(key) ?? 0) + 1);
        total += 1;
      }
      if (total < 20) continue;
      // Strength: how peaked the joint is vs uniform
      const cells = joint.size;
      const maxCount = Math.max(...joint.values());
      const strength = Math.min(1, (maxCount / total) * Math.log2(1 + cells) / 4);
      if (strength > 0.08) nominalPairs.push({ a: a.name, b: b.name, strength });
    }
  }
  nominalPairs.sort((a, b) => b.strength - a.strength);

  const sigParts = columns
    .map((c) => `${c.name}:${inferType(c.data_type, c.name)}`)
    .sort()
    .join("|");
  const schemaSignature = fnv1a(sigParts);

  return {
    columns: profiles,
    numericCorrelations,
    nominalPairs,
    schemaSignature,
    rowCount: totalRowsHint || n,
  };
}

/** Re-score existing recs using profile signals. */
function applyProfileBoosts(
  recs: ChartRecommendation[],
  profile: DatasetProfile,
): ChartRecommendation[] {
  const corrMap = new Map<string, number>();
  for (const p of profile.numericCorrelations) {
    corrMap.set(`${p.a}|${p.b}`, p.absR);
    corrMap.set(`${p.b}|${p.a}`, p.absR);
  }
  const nomMap = new Map<string, number>();
  for (const p of profile.nominalPairs) {
    nomMap.set(`${p.a}|${p.b}`, p.strength);
    nomMap.set(`${p.b}|${p.a}`, p.strength);
  }
  const byName = new Map(profile.columns.map((c) => [c.name, c]));

  return recs.map((r) => {
    let boost = 0;
    if (r.kind === "scatter" || r.kind === "bubble") {
      if (r.yField) {
        const absR = corrMap.get(`${r.xField}|${r.yField}`) ?? 0;
        if (absR >= 0.7) boost += 14;
        else if (absR >= 0.5) boost += 8;
        else if (absR >= 0.3) boost += 3;
      }
    }
    if (r.kind === "line" || r.kind === "area") {
      const xp = byName.get(r.xField);
      if (xp?.type === "temporal" && (xp.temporalParseRate ?? 1) > 0.6) boost += 10;
    }
    if (r.kind === "heatmap" && r.yField) {
      const s = nomMap.get(`${r.xField}|${r.yField}`) ?? 0;
      if (s > 0.2) boost += 12;
      else if (s > 0.1) boost += 6;
    }
    if (r.kind === "histogram" || r.kind === "violin" || r.kind === "box") {
      const yp = byName.get(r.yField ?? r.xField);
      if (yp && Math.abs(yp.skewProxy ?? 0) > 1.2) boost += 6;
    }
    if (r.kind === "pie" || r.kind === "treemap" || r.kind === "sunburst") {
      const xp = byName.get(r.xField);
      if (xp && (xp.entropy ?? 0) > 0.7 && xp.topCategories.length >= 3 && xp.topCategories.length <= 10) {
        boost += 5;
      }
    }
    if (boost === 0) return r;
    return { ...r, score: r.score + boost };
  });
}

/** Emit a few extra high-signal candidates from the profile. */
function expandFromProfile(
  columns: ColumnInfo[],
  profile: DatasetProfile,
  fileName: string,
  existing: ChartRecommendation[],
): ChartRecommendation[] {
  const ids = new Set(existing.map((r) => r.id));
  const extra: ChartRecommendation[] = [];
  const table = fileName.replace(/\.[^.]+$/, "") || "data";

  for (const pair of profile.numericCorrelations.slice(0, 5)) {
    if (pair.absR < 0.45) continue;
    const rec = createChartRec("scatter", columns, pair.a, pair.b, null, table);
    if (rec && !ids.has(rec.id)) {
      extra.push({
        ...rec,
        score: Math.max(rec.score, 70) + pair.absR * 20,
        subtitle: `deep scan · |r|=${pair.absR.toFixed(2)}`,
      });
      ids.add(rec.id);
    }
  }

  for (const pair of profile.nominalPairs.slice(0, 3)) {
    if (pair.strength < 0.12) continue;
    const rec = createChartRec("heatmap", columns, pair.a, pair.b, null, table);
    if (rec && !ids.has(rec.id)) {
      extra.push({
        ...rec,
        score: Math.max(rec.score, 65) + pair.strength * 25,
        subtitle: "deep scan · category density",
      });
      ids.add(rec.id);
    }
  }

  const temporal = profile.columns.find((c) => c.type === "temporal" && (c.temporalParseRate ?? 1) > 0.5);
  const bestNum = profile.columns
    .filter((c) => c.type === "quantitative")
    .sort((a, b) => (b.variance ?? 0) - (a.variance ?? 0))[0];
  if (temporal && bestNum) {
    const rec = createChartRec("line", columns, temporal.name, bestNum.name, null, table, {
      yAggregate: "mean",
    });
    if (rec && !ids.has(rec.id)) {
      extra.push({
        ...rec,
        score: Math.max(rec.score, 78),
        subtitle: "deep scan · strongest trend",
      });
    }
  }

  return extra;
}

/**
 * Deep scan: profile + recommend + expand + preference re-rank → swipe deck.
 */
export function deepRecommend(
  columns: ColumnInfo[],
  data: QueryResult | null,
  prefs: VizPreferenceModel | null | undefined,
  source: DeepScanSource = { kind: "file", fileName: "data" },
  deckLimit = 16,
): DeepScanResult {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const profile = buildDatasetProfile(columns, data);

  let seed: ChartRecommendation[] = [];
  if (source.kind === "stream") {
    seed = recommendStreamStory(columns, data).charts;
    // Pass null so recommend skips prefs; we boost once after profile scoring
    const generic = recommend(columns, data, "wiki_stream", null);
    seed = [...seed, ...generic];
  } else if (source.kind === "source") {
    seed = recommendSourceStory(source.sourceKind, columns, data).charts;
    const generic = recommend(columns, data, source.sourceKind, null);
    seed = [...seed, ...generic];
  } else {
    seed = recommend(columns, data, source.fileName, null);
  }

  // Prefer raw (pre-diversify) expansion: re-run without prefs for expansion base
  // if seed is thin — recommend already diversified; expand on top.
  const expanded = [
    ...seed,
    ...expandFromProfile(
      columns,
      profile,
      source.kind === "file" ? source.fileName : source.kind === "source" ? source.sourceKind : "wiki_stream",
      seed,
    ),
  ];

  const profiled = applyProfileBoosts(expanded, profile);
  const boosted = applyPreferenceBoosts(
    profiled,
    prefs,
    columns,
    profile.schemaSignature,
  );
  const deck = diversifyRecommendations(boosted, deckLimit);

  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
  return { profile, deck, scanMs: Math.round(t1 - t0) };
}
