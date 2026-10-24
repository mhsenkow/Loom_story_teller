// Snapshot evidence and fitness, memoized per window/encoding during one scan.
// Scores describe chart usefulness, never statistical significance or causality.
import type { ColumnInfo, QueryResult } from "./queryTypes";
import type { ChartRecommendation } from "./recs/types";
import {
  NUMERIC_XY_KINDS,
  CATEGORY_Y_KINDS,
  NUMERIC_X_KINDS,
  PART_TO_WHOLE_KINDS,
} from "./recs/createChartRec";
import { inferType, isRateLikeField } from "./recs/columns";
import { applyChartTimeWindow, parseChartTime } from "./chartTime";
import { discoverFamily } from "./discoverChartCatalog";
import { discoverFieldLabel } from "./discoverEditorial";
import { formatChartNumber } from "./formatChartNumber";
import { chartEmoji, isEmojiGlyph } from "./chartEmoji";

export interface DiscoverInsight {
  label: string;
  detail: string;
  /** Strength for editorial ranking, not a probability. */
  strength: number;
}
export interface DiscoverAssessment {
  quality: number;
  insight: DiscoverInsight;
}

const numeric = (v: unknown): number | null => {
  if (v == null || v === "" || typeof v === "boolean") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const numFormat = (n: number) => formatChartNumber(n);

export function createDiscoverAssessor(
  stats: ColumnInfo[],
  sample: QueryResult,
  source?: string,
) {
  const indices = new Map(sample.columns.map((name, i) => [name, i]));
  const windows = new Map<string, QueryResult["rows"]>();
  const profiles = new Map<
    string,
    {
      values: number[];
      distinct: number;
      min: number;
      max: number;
      mean: number;
      sd: number;
      outliers: number;
    }
  >();
  const results = new Map<string, DiscoverAssessment | null>();
  const rowsFor = (chart: ChartRecommendation) => {
    const key = `${chart.timeWindowField ?? ""}|${chart.timeWindow ?? "all"}`;
    if (!windows.has(key))
      windows.set(
        key,
        applyChartTimeWindow(sample.rows, sample.columns, chart).rows,
      );
    return { key, rows: windows.get(key)! };
  };
  const profile = (field: string, key: string, rows: QueryResult["rows"]) => {
    const id = `${key}|${field}`;
    let p = profiles.get(id);
    if (!p) {
      const i = indices.get(field) ?? -1;
      const values: number[] = [];
      let sum = 0,
        min = Infinity,
        max = -Infinity;
      for (const row of rows) {
        const n = numeric(row[i]);
        if (n != null) {
          values.push(n);
          sum += n;
          min = Math.min(min, n);
          max = Math.max(max, n);
        }
      }
      const mean = values.length ? sum / values.length : 0;
      const sd = Math.sqrt(
        values.reduce((s, n) => s + (n - mean) ** 2, 0) /
          Math.max(1, values.length),
      );
      p = {
        values,
        distinct: new Set(values).size,
        min,
        max,
        mean,
        sd,
        outliers: sd
          ? values.filter((n) => Math.abs(n - mean) / sd > 2.5).length
          : 0,
      };
      profiles.set(id, p);
    }
    return p;
  };
  return (chart: ChartRecommendation): DiscoverAssessment | null => {
    // Visual-only alternatives reuse the same evidence computation.
    const resultKey = JSON.stringify([
      chart.kind,
      chart.xField,
      chart.yField,
      chart.sizeField,
      chart.y2Field,
      chart.colorField,
      chart.rowField,
      chart.zField,
      chart.yAggregate,
      chart.timeWindowField,
      chart.timeWindow,
      chart.rollingWindow,
      chart.comparePrevious,
      chart.seriesNormalize,
      chart.residualOverlay,
      chart.anomalyHighlight,
      chart.yScale,
      chart.emojiField,
      chart.emojiMap,
      chart.shapeField,
    ]);
    if (results.has(resultKey)) return results.get(resultKey)!;
    const assess = (): DiscoverAssessment | null => {
      const { key, rows } = rowsFor(chart);
      if (!rows.length) return null;
      const family = discoverFamily(chart.kind);
      const xi = indices.get(chart.xField) ?? -1;
      const yi = indices.get(chart.yField ?? "") ?? -1;
      if (xi < 0) return null;
      if (
        chart.yField &&
        chart.yAggregate === "sum" &&
        isRateLikeField(chart.yField)
      )
        return null;
      const distinct = (field: string) =>
        new Set(
          rows
            .map((row) => row[indices.get(field) ?? -1])
            .filter((v) => v != null && v !== ""),
        ).size;
      const isNum = (field: string) => {
        const c = stats.find((s) => s.name === field);
        const type =
          c?.data_type ?? sample.types[indices.get(field) ?? -1] ?? "";
        return (
          inferType(type, field, c?.min_value, c?.max_value) === "quantitative"
        );
      };
      const numericFields = new Set<string>();
      if (
        NUMERIC_XY_KINDS.has(chart.kind) ||
        NUMERIC_X_KINDS.has(chart.kind) ||
        CATEGORY_Y_KINDS.has(chart.kind)
      )
        numericFields.add(chart.xField);
      if (
        chart.yField &&
        (NUMERIC_XY_KINDS.has(chart.kind) ||
          (isNum(chart.yField) && chart.kind !== "dataCube"))
      )
        numericFields.add(chart.yField);
      // Connected scatter's Size slot is its Order — a date is the usual pick.
      for (const f of [chart.kind === "connectedScatter" ? null : chart.sizeField, chart.y2Field])
        if (f) numericFields.add(f);
      let quality = 70;
      if (chart.emojiField) {
        if (rows.length > 1200 && !chart.rowField) return null;
        if (chart.rowField) {
          const sizes = new Map<unknown, number>();
          for (const row of rows) {
            const group = row[indices.get(chart.rowField) ?? -1];
            sizes.set(group, (sizes.get(group) ?? 0) + 1);
          }
          if (Math.max(0, ...sizes.values()) > 1200) return null;
        }
        const ei = indices.get(chart.emojiField) ?? -1;
        const useful = rows.filter((row) =>
          isEmojiGlyph(chartEmoji(row[ei], chart.emojiField, chart.emojiMap)),
        ).length;
        if (useful / rows.length < 0.75) return null;
        quality += 2;
      }
      let locations = rows.length;
      let mappedObservations = rows.length;
      if (family === "geography" && chart.kind !== "choropleth") {
        const valid = rows.filter((row) => {
          const lon = numeric(row[xi]),
            lat = numeric(row[yi]);
          return (
            lon != null &&
            lat != null &&
            Math.abs(lon) <= 180 &&
            Math.abs(lat) <= 90
          );
        });
        mappedObservations = valid.length;
        locations = new Set(
          valid.map((row) => `${Number(row[xi])},${Number(row[yi])}`),
        ).size;
        if (!mappedObservations) return null;
        quality -= Math.round(20 * (1 - mappedObservations / rows.length));
      }
      for (const field of numericFields) {
        const p = profile(field, key, rows);
        if (!p.values.length || (p.distinct < 2 && family !== "geography"))
          return null;
        quality -= Math.round(20 * (1 - p.values.length / rows.length));
      }
      // A few extreme values (one coin's market cap) squash every other mark into
      // one edge of a linear axis — the plot shows a wall, not a distribution.
      const squashed = (field: string | null | undefined) => {
        if (!field || !isNum(field)) return false;
        const p = profile(field, key, rows);
        if (p.values.length < 8 || p.max <= p.min) return false;
        const span = p.max - p.min;
        let low = 0,
          high = 0;
        for (const v of p.values) {
          if ((v - p.min) / span < 0.05) low++;
          else if ((p.max - v) / span < 0.05) high++;
        }
        return Math.max(low, high) / p.values.length >= 0.85;
      };
      const logY = chart.yScale === "log" || chart.yScale === "symlog";
      const numericPlane =
        yi >= 0 &&
        (NUMERIC_XY_KINDS.has(chart.kind) ||
          ((family === "relationship" || family === "dimensional") &&
            isNum(chart.xField) &&
            isNum(chart.yField!)));
      // Share of points crammed into one corner cell of a 20 × 20 grid.
      const cornered = () => {
        const px = profile(chart.xField, key, rows);
        const py = profile(chart.yField!, key, rows);
        if (px.max <= px.min || py.max <= py.min) return 0;
        let n = 0,
          hit = 0;
        for (const row of rows) {
          const x = numeric(row[xi]),
            y = numeric(row[yi]);
          if (x == null || y == null) continue;
          n++;
          const fx = (x - px.min) / (px.max - px.min);
          const fy = (y - py.min) / (py.max - py.min);
          if ((fx < 0.05 || fx > 0.95) && (fy < 0.05 || fy > 0.95)) hit++;
        }
        return n >= 8 ? hit / n : 0;
      };
      if (numericPlane) {
        if (squashed(chart.xField) || (!logY && squashed(chart.yField))) return null;
        if (!logY && cornered() >= 0.7) return null;
      } else if (family === "distribution") {
        // Whichever axis carries the values (strip / box put categories on either side).
        const valueField = isNum(chart.xField) ? chart.xField : chart.yField;
        const valueOnY = valueField === chart.yField;
        if (!(valueOnY && logY) && squashed(valueField)) return null;
      } else if (["dumbbell", "slope"].includes(chart.kind)) {
        if (!logY && (squashed(chart.yField) || squashed(chart.sizeField))) return null;
      }
      if (chart.yField && chart.yScale === "log") {
        const p = profile(chart.yField, key, rows);
        if (p.min <= 0 || p.max / p.min < 10) return null;
      }
      if (family === "trend") {
        const positions = distinct(chart.xField);
        if (positions < 3) return null;
        const ci = indices.get(chart.colorField ?? chart.rowField ?? "") ?? -1;
        const perSeries = new Map<unknown, Set<unknown>>();
        for (const row of rows) {
          const group = ci < 0 ? "all" : row[ci];
          if (row[xi] == null || (yi >= 0 && numeric(row[yi]) == null))
            continue;
          const xs = perSeries.get(group) ?? new Set();
          xs.add(row[xi]);
          perSeries.set(group, xs);
        }
        const longest = Math.max(
          0,
          ...[...perSeries.values()].map((xs) => xs.size),
        );
        if (
          longest < 3 ||
          (chart.rollingWindow && longest < chart.rollingWindow) ||
          (chart.comparePrevious && longest < 6)
        )
          return null;
        if (chart.kind === "bump" && (!chart.colorField || perSeries.size < 2))
          return null;
      }
      if (family === "distribution") {
        if (rows.length < 8) return null;
        if (["box", "violin", "ridgeline"].includes(chart.kind)) {
          const field = CATEGORY_Y_KINDS.has(chart.kind)
            ? chart.yField
            : chart.xField;
          if (!field || rows.length / Math.max(1, distinct(field)) < 4)
            return null;
        }
      }
      if (
        PART_TO_WHOLE_KINDS.has(chart.kind) &&
        chart.yField &&
        chart.yAggregate !== "count"
      ) {
        const p = profile(chart.yField, key, rows);
        if (p.min < 0 || p.max <= 0) return null;
      }
      if (
        chart.seriesNormalize === "index100" &&
        chart.yField &&
        profile(chart.yField, key, rows).min <= 0
      )
        return null;
      if (["globeTrail", "arcMap", "trailRibbon"].includes(chart.kind)) {
        // Connecting unrelated snapshot locations invents journeys.
        if (
          !chart.timeField ||
          (!chart.trailId && source !== "iss") ||
          distinct(chart.timeField) < 3 ||
          rows.length /
            Math.max(1, chart.trailId ? distinct(chart.trailId) : 1) <
            3
        )
          return null;
        // A trail of a fixed station is a dot: most entities must actually move.
        const ti = chart.trailId ? (indices.get(chart.trailId) ?? -1) : -1;
        if (ti >= 0 && yi >= 0) {
          const spots = new Map<string, Set<string>>();
          for (const row of rows) {
            const id = String(row[ti] ?? "");
            const at = `${row[xi]}|${row[yi]}`;
            const set = spots.get(id) ?? new Set<string>();
            set.add(at);
            spots.set(id, set);
          }
          let moving = 0;
          for (const set of spots.values()) if (set.size >= 3) moving++;
          if (moving < Math.max(1, spots.size * 0.5)) return null;
        }
      }
      if (
        chart.kind === "scatter3d" &&
        (!chart.zField || distinct(chart.zField) < 2)
      )
        return null;
      const measure = chart.yField ? profile(chart.yField, key, rows) : null;
      if (
        chart.anomalyHighlight &&
        (!measure || measure.values.length < 8 || !measure.outliers)
      )
        return null;
      if (chart.residualOverlay && rows.length < 8) return null;
      quality += Math.min(12, Math.log2(rows.length + 1) * 2);
      let insight: DiscoverInsight = {
        label:
          family === "geography"
            ? "Geographic perspective"
            : "Another perspective",
        detail:
          family === "geography"
            ? chart.kind === "choropleth"
              ? `${rows.length.toLocaleString()} geographic records in this snapshot.`
              : `${mappedObservations.toLocaleString()} mapped observations across ${locations.toLocaleString()} distinct ${locations === 1 ? "location" : "locations"}.`
            : `${rows.length.toLocaleString()} observed rows support this view.`,
        strength: 0.2,
      };
      if (
        NUMERIC_XY_KINDS.has(chart.kind) &&
        yi >= 0 &&
        chart.xField !== chart.yField
      ) {
        let n = 0,
          mx = 0,
          my = 0,
          xx = 0,
          yy = 0,
          xy = 0;
        for (const row of rows) {
          const x = numeric(row[xi]),
            y = numeric(row[yi]);
          if (x == null || y == null) continue;
          n++;
          const dx = x - mx,
            dy = y - my;
          mx += dx / n;
          my += dy / n;
          xx += dx * (x - mx);
          yy += dy * (y - my);
          xy += dx * (y - my);
        }
        if (n < 3 || !xx || !yy) return null;
        const r = Math.max(-1, Math.min(1, xy / Math.sqrt(xx * yy)));
        const pairs: [number, number][] = [];
        for (const row of rows) {
          const x = numeric(row[xi]),
            y = numeric(row[yi]);
          if (x != null && y != null) pairs.push([x, y]);
        }
        // Rank correlation is robust to that outlier; trust the weaker of the two.
        // Ties share their average rank so discrete / zero-heavy measures aren't scrambled by row order.
        const ranks = (vals: number[]) => {
          const order = vals.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
          const out = new Array<number>(vals.length);
          let i = 0;
          while (i < order.length) {
            let j = i;
            while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
            const avg = (i + j) / 2;
            for (let q = i; q <= j; q++) out[order[q]![1]] = avg;
            i = j + 1;
          }
          return out;
        };
        const rx = ranks(pairs.map((p) => p[0]));
        const ry = ranks(pairs.map((p) => p[1]));
        const avgOf = (v: number[]) => v.reduce((a, b) => a + b, 0) / (v.length || 1);
        const rmx = avgOf(rx);
        const rmy = avgOf(ry);
        let sxy = 0,
          sxx = 0,
          syy = 0;
        for (let i = 0; i < pairs.length; i++) {
          sxy += (rx[i]! - rmx) * (ry[i]! - rmy);
          sxx += (rx[i]! - rmx) ** 2;
          syy += (ry[i]! - rmy) ** 2;
        }
        const rho = sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
        const outlierDriven = Math.abs(r) - Math.abs(rho) > 0.3;
        const shown = outlierDriven ? rho : r;
        if (n >= 8)
          insight = {
            label:
              Math.min(Math.abs(r), Math.abs(rho)) >= 0.65
                ? "Clear relationship"
                : "Explore the relationship",
            detail: outlierDriven
              ? `${discoverFieldLabel(chart.xField)} × ${discoverFieldLabel(chart.yField!)}: rank correlation ${shown.toFixed(2)} across ${n.toLocaleString()} pairs (r = ${r.toFixed(2)} is driven by a few extreme values).`
              : `${discoverFieldLabel(chart.xField)} × ${discoverFieldLabel(chart.yField!)}: r = ${r.toFixed(2)} across ${n.toLocaleString()} paired observations.`,
            strength: Math.min(Math.abs(r), Math.abs(rho)) * Math.min(1, n / 30),
          };
      } else if (chart.anomalyHighlight && measure) {
        insight = {
          label: "Outliers worth a look",
          detail: `${measure.outliers} of ${measure.values.length.toLocaleString()} readings sit more than 2.5 standard deviations from the mean.`,
          strength: 0.8,
        };
      } else if (family === "trend" && chart.yField) {
        const ci = indices.get(chart.colorField ?? chart.rowField ?? "") ?? -1;
        const series = new Map<string, Map<number, number[]>>();
        for (const row of rows) {
          const t = parseChartTime(row[xi]),
            value = numeric(row[yi]);
          if (t == null || value == null) continue;
          const label = ci < 0 ? "" : String(row[ci] ?? "");
          const points = series.get(label) ?? new Map<number, number[]>();
          const values = points.get(t) ?? [];
          values.push(value);
          points.set(t, values);
          series.set(label, points);
        }
        let strongest = -1;
        for (const [label, points] of series) {
          if (points.size < 3) continue;
          const ordered = [...points]
            .sort(([a], [b]) => a - b)
            .map(([, v]) =>
              chart.yAggregate === "max"
                ? Math.max(...v)
                : chart.yAggregate === "min"
                  ? Math.min(...v)
                  : chart.yAggregate === "count"
                    ? v.length
                    : chart.yAggregate === "sum"
                      ? v.reduce((a, b) => a + b, 0)
                      : v.reduce((a, b) => a + b, 0) / v.length,
            );
          const first = ordered[0]!,
            last = ordered[ordered.length - 1]!;
          const strength = Math.min(
            0.95,
            Math.abs(last - first) /
              Math.max(measure?.sd ?? 0, Math.abs(first) * 0.1, 1e-9) /
              4,
          );
          if (strength <= strongest) continue;
          strongest = strength;
          insight = {
            label:
              Math.abs(last - first) > 1e-9
                ? "Change over the observed period"
                : "A steady series",
            detail: `${label ? `${label.slice(0, 60)}: ` : ""}${discoverFieldLabel(chart.yField)} goes from ${numFormat(first)} to ${numFormat(last)} across ${ordered.length.toLocaleString()} observed time points.`,
            strength,
          };
        }
      } else if (family === "distribution") {
        const field =
          NUMERIC_X_KINDS.has(chart.kind) || CATEGORY_Y_KINDS.has(chart.kind)
            ? chart.xField
            : chart.yField;
        if (field) {
          const p = profile(field, key, rows);
          if (p.values.length)
            insight = {
              label: "See the spread",
              detail: `${discoverFieldLabel(field)} ranges from ${numFormat(p.min)} to ${numFormat(p.max)} across ${p.values.length.toLocaleString()} readings.`,
              strength: p.outliers ? 0.75 : 0.45,
            };
        }
      } else if (
        ["comparison", "composition"].includes(family) &&
        !["pyramid", "slope", "dumbbell"].includes(chart.kind)
      ) {
        const groups = new Map<string, number[]>();
        for (const row of rows) {
          if (row[xi] == null || row[xi] === "") continue;
          const value =
            !chart.yField || chart.yAggregate === "count"
              ? 1
              : numeric(row[yi]);
          if (value == null) continue;
          const label = String(row[xi]);
          const group = groups.get(label) ?? [];
          group.push(value);
          groups.set(label, group);
        }
        const agg = (values: number[]) =>
          chart.yAggregate === "mean"
            ? values.reduce((a, b) => a + b, 0) / values.length
            : chart.yAggregate === "min"
              ? Math.min(...values)
              : chart.yAggregate === "max"
                ? Math.max(...values)
                : values.reduce((a, b) => a + b, 0);
        const ordered = [...groups]
          .map(([label, values]) => ({ label, value: agg(values) }))
          .sort((a, b) => b.value - a.value);
        if (ordered.length < 2) return null;
        const first = ordered[0]!;
        const total = ordered.reduce((s, g) => s + g.value, 0);
        const share =
          total > 0 && ordered.every((g) => g.value >= 0)
            ? first.value / total
            : 0;
        // Shares only make sense for additive quantities or counts, never means/rates.
        const additive =
          !chart.yField ||
          chart.yAggregate === "sum" ||
          chart.yAggregate === "count";
        // Judge the leader against an even split: with 2 groups, 50% is the floor, not a finding.
        const k = ordered.length;
        const excess = k > 1 ? (share - 1 / k) / (1 - 1 / k) : 0;
        const concentrated = additive && k >= 3 && excess >= 0.35;
        insight = {
          label: concentrated ? "Concentrated at the top" : "See who leads",
          detail: concentrated
            ? `${first.label.slice(0, 80)} accounts for ${(share * 100).toFixed(1)}% of the observed total across ${k} groups.`
            : `${first.label.slice(0, 80)} leads ${k} groups at ${numFormat(first.value)}${chart.yField ? ` (${discoverFieldLabel(chart.yField)})` : " rows"}.`,
          strength: additive ? (concentrated ? Math.min(0.9, 0.4 + excess * 0.5) : 0.3) : 0.4,
        };
      }
      return { quality: Math.min(100, Math.max(0, quality)), insight };
    };
    const result = assess();
    results.set(resultKey, result);
    return result;
  };
}
