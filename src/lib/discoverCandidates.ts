// Deterministic discovery candidates: visit every registered kind before capping.
// Reuse the chart builders and their support checks; no random global state.
import { CHART_KIND_OPTIONS, type ChartRecommendation } from "./recs/types";
import {
  CATEGORY_X_KINDS,
  CATEGORY_Y_KINDS,
  IDENTITY_X_KINDS,
  ORDERED_X_KINDS,
  PART_TO_WHOLE_KINDS,
  createChartRec,
  fitEncodingToKind,
} from "./recs/createChartRec";
import {
  inferType,
  measureColumns,
  nominalQualityBoost,
  defaultLineAreaAggregate,
} from "./recs/columns";
import { chartKindDataSupport, TOP_N_RANDOM_KINDS } from "./recs/random";
import { expandRecommendationsWithExtras } from "./recs/expand";
import { isGeoMapKind } from "./geoMapsRec";
import { isLatField, isLonField, isGeoRegionField } from "./geoFields";
import { pickDataCubeEncoding } from "./dataCubeSchema";
import { discoverRecipeKey } from "./discoverChartCatalog";
import type { ColumnInfo, QueryResult } from "./queryTypes";
import { addDiscoverMarkerVariants } from "./discoverMarkers";
import { SOURCE_BY_KIND, type SourceKind } from "./sourceRegistry";
import { isAdditiveDiscoverMeasure } from "./discoverChartQuality";
import { wordCloudCompareColumn } from "./oddChartsRec";

export function enumerateDiscoverCharts(
  columns: ColumnInfo[],
  curated: ChartRecommendation[],
  source: string,
  sample?: QueryResult | null,
): ChartRecommendation[] {
  const type = (c: ColumnInfo) =>
    inferType(c.data_type, c.name, c.min_value, c.max_value);
  const measures = measureColumns(columns).filter(
    (c) => !isLatField(c.name) && !isLonField(c.name),
  );
  // Keep the source author's preferred measures at the front, then cover other axes.
  const preferred = curated.flatMap((c) => [c.yField, c.sizeField, c.xField]);
  measures.sort((a, b) => {
    const position = (name: string) => {
      const i = preferred.indexOf(name);
      return i < 0 ? 10_000 : i;
    };
    return position(a.name) - position(b.name) || a.name.localeCompare(b.name);
  });
  const categories = columns
    .filter(
      (c) =>
        type(c) === "nominal" &&
        c.distinct_count >= 2 &&
        !/(^|_)(id|url|link|uuid|key)($|_)/i.test(c.name),
    )
    .sort(
      (a, b) =>
        nominalQualityBoost(b.name) - nominalQualityBoost(a.name) ||
        a.distinct_count - b.distinct_count ||
        a.name.localeCompare(b.name),
    );
  const time = columns.find(
    (c) => type(c) === "temporal" && c.distinct_count >= 2,
  );
  const lon = columns.find((c) => isLonField(c.name));
  const lat = columns.find((c) => isLatField(c.name));
  // Trails connect one entity's rows through time — only an identity-like column
  // (callsign, vehicle id, …) with several rows each; coarse groups (airline,
  // region) would join unrelated points into invented journeys.
  // Without a sample, the most distinct column is a floor on the row count.
  const totalRows = sample?.rows.length ?? Math.max(0, ...columns.map((c) => c.distinct_count + c.null_count));
  const trailCandidates = time && totalRows
    ? columns
        .filter((c) => {
          if (type(c) !== "nominal" || c.distinct_count < 2) return false;
          if (totalRows / c.distinct_count < 3) return false;
          // Only names that denote one tracked thing; cardinality alone admits
          // groupings like a quake's seismic network or an inspection's violation.
          return /(^|_)(id|icao|icao24|callsign|vehicle|flight|tail|mmsi|imo|craft|ship|train|bus|device|satellite|norad|object|name|label|state|state_abbr|country|iso|iso3|symbol|ticker|quote|pair|station|site|route|team|player|city)($|\d)/i.test(c.name);
        })
        .sort((a, b) => b.distinct_count - a.distinct_count || a.name.localeCompare(b.name))
    : [];
  // Metric trails (a state's income × poverty over years) accept any identity;
  // map paths need a thing that physically moves — not a city or a station.
  const trailEntity = trailCandidates[0];
  const movingEntity = trailCandidates.find((c) =>
    /(^|_)(id|icao|icao24|callsign|vehicle|flight|tail|mmsi|imo|craft|ship|train|bus|device|satellite|norad|object)($|\d)/i.test(c.name),
  );
  const calendarDays = (() => {
    if (!time || !sample) return time ? Number.POSITIVE_INFINITY : 0;
    const ti = sample.columns.indexOf(time.name);
    const days = new Set<number>();
    for (const r of sample.rows) {
      const v: unknown = r[ti];
      const t = v instanceof Date ? v.getTime() : typeof v === "string" ? Date.parse(v) : typeof v === "number" && v > 1e9 ? (v < 1e11 ? v * 1000 : v) : NaN;
      if (Number.isFinite(t)) days.add(Math.floor(t / 86_400_000));
    }
    return days.size;
  })();
  const seeds = [...curated];
  const smallCategories = categories.filter((c) => c.distinct_count <= 20);
  const units = SOURCE_BY_KIND[source as SourceKind]?.units;
  for (const { value: kind } of CHART_KIND_OPTIONS) {
    if (!chartKindDataSupport(columns, kind).ok) continue;
    // Every measure gets a turn, without a Cartesian product of all settings.
    for (
      let turn = 0;
      turn < Math.max(3, measures.length, smallCategories.length);
      turn++
    ) {
      const m = measures[turn % Math.max(1, measures.length)];
      const n = measures.find((c) => c !== m);
      const cat =
        smallCategories[turn % Math.max(1, smallCategories.length)] ??
        categories[0];
      let x: string | undefined = m?.name ?? time?.name ?? cat?.name;
      let y: string | null = n?.name ?? null;
      let color =
        categories.find((c) => c.distinct_count <= 10 && c !== cat)?.name ??
        null;
      let size: string | null = null;
      let z: string | null = null;
      if (
        CATEGORY_X_KINDS.has(kind) ||
        IDENTITY_X_KINDS.has(kind) ||
        kind === "loomWeave"
      ) {
        x = cat?.name;
        y = m?.name ?? null;
        if (["pyramid", "slope", "dumbbell"].includes(kind))
          size =
            measures.find(
              (c) =>
                c !== m &&
                units?.[c.name] &&
                units[c.name] === units?.[m?.name ?? ""],
            )?.name ??
            n?.name ??
            null;
      } else if (CATEGORY_Y_KINDS.has(kind)) {
        y = cat?.name ?? null;
        color = null;
      } else if (ORDERED_X_KINDS.has(kind)) {
        x = time?.name;
        y = m?.name ?? null;
        color = categories.find((c) => c.distinct_count <= 10)?.name ?? null;
      } else if (isGeoMapKind(kind)) {
        x = lon?.name;
        y = lat?.name ?? null;
        // The ISS feed is one craft with no id column; its rows already form a path.
        if ((kind === "globeTrail" || kind === "arcMap") && !movingEntity && source !== "iss") continue;
        size = ["geoBubbles", "globe"].includes(kind)
          ? (m?.name ?? null)
          : null;
        color = categories.find((c) => c.distinct_count <= 10)?.name ?? null;
      } else if (kind === "choropleth") {
        x = columns.find((c) => isGeoRegionField(c.name))?.name;
        y = m?.name ?? null;
        color = null;
      } else if (kind === "histogram") {
        y = null;
        color = null;
      } else if (
        kind === "heatmap" &&
        categories.filter((c) => c.distinct_count <= 20).length >= 2
      ) {
        x = cat?.name;
        y =
          categories.find((c) => c !== cat && c.distinct_count <= 20)?.name ??
          null;
        color = null;
      } else if (kind === "bubble") {
        size = measures.find((c) => c !== m && c !== n)?.name ?? null;
      } else if (kind === "firefly") {
        // Flat field: a third measure drives glow (Size); Z would be ignored.
        size = measures.find((c) => c !== m && c !== n)?.name ?? null;
      } else if (kind === "trailRibbon") {
        if (!trailEntity) continue;
        // Map paths when coordinates exist (moving things only); otherwise two
        // measures traced through time.
        if (lon && lat && movingEntity) {
          x = lon.name;
          y = lat.name;
        } else if (!m || !n) continue;
        size = measures.find((c) => c.name !== x && c.name !== y)?.name ?? null;
      } else if (
        ["scatter3d", "quakeTerrain"].includes(kind)
      ) {
        z = measures.find((c) => c !== m && c !== n)?.name ?? null;
      }
      if (PART_TO_WHOLE_KINDS.has(kind))
        y =
          measures.find((c) => isAdditiveDiscoverMeasure(source, c.name))
            ?.name ?? null;
      let aggregate = y
        ? defaultLineAreaAggregate(y, columns)
        : ("count" as const);
      if (PART_TO_WHOLE_KINDS.has(kind) && y) aggregate = "sum";
      // Per-period views average a level (temperature, population) unless the measure adds up.
      // Population, players, stations are stocks: summing a day's readings double-counts them.
      if (
        (kind === "stripes" || kind === "sparkGrid" || kind === "calendar") && y &&
        (!isAdditiveDiscoverMeasure(source, y) || /population|players|owners|stations|capacity/i.test(y) || /^(people|players|owners|stations)$/.test(units?.[y] ?? ""))
      ) aggregate = "mean";
      if (kind === "wordCloud") aggregate = y ? "sum" : "count";
      if (kind === "dataCube") {
        const cube = pickDataCubeEncoding(columns);
        if (!cube) continue;
        x = cube.xField;
        y = cube.yField;
        z = cube.zField;
        size = cube.valueField;
        aggregate = cube.aggregate;
        color = null;
      }
      // Gallery kinds: give each the encoding its renderer reads, nothing it ignores.
      if (kind === "ecdf" || kind === "density") {
        x = m?.name;
        y = null;
        color = categories.find((c) => c.distinct_count <= 6)?.name ?? null;
      } else if (kind === "qq") {
        x = m?.name;
        y = null;
        color = null;
      } else if (kind === "connectedScatter") {
        if (!time || !m || !n) continue;
        x = m.name;
        y = n.name;
        size = time.name;
        color = null;
      } else if (kind === "calendar" || kind === "stripes") {
        // A calendar of a few hours is one lonely square — need a week of days.
        if (kind === "calendar" && calendarDays < 7) continue;
        x = time?.name;
        color = null;
      } else if (kind === "errorBars") {
        color = null;
      } else if (kind === "wordCloud") {
        // Words need variety: a label column with many values, sized by rows or an additive total.
        const words = categories
          .filter((c) => c.distinct_count >= 8 && c.distinct_count <= 400)
          .sort((a, b) => b.distinct_count - a.distinct_count)[turn % 2] ??
          categories.find((c) => c.distinct_count >= 8 && c.distinct_count <= 400);
        if (!words) continue;
        x = words.name;
        y = measures.find((c) => isAdditiveDiscoverMeasure(source, c.name))?.name ?? null;
        color = null;
      }
      if (!x) continue;
      const enc = fitEncodingToKind(kind, columns, {
        xField: x,
        yField: y,
        colorField: color,
      });
      const rec = createChartRec(
        kind,
        columns,
        enc.xField,
        enc.yField,
        enc.colorField,
        source,
        {
          sizeField: size,
          zField: z,
          timeField: time?.name,
          trailId:
            kind === "globeTrail" || kind === "arcMap" || (kind === "trailRibbon" && lon && lat && movingEntity)
              ? movingEntity?.name
              : kind === "trailRibbon"
                ? trailEntity?.name
                : undefined,
          yAggregate: aggregate,
          topN: TOP_N_RANDOM_KINDS.has(kind) ? 15 : null,
        },
      );
      if (rec)
        seeds.push({
          ...rec,
          score: 72,
          id: `${source}-discover-${kind}-${turn}`,
        });
      if (rec && kind === "wordCloud" && turn === 0) {
        const group = wordCloudCompareColumn(columns, enc.xField);
        if (group) {
          const cmp = createChartRec(kind, columns, enc.xField, enc.yField, group.name, source, {
            yAggregate: aggregate,
            topN: 15,
            wordCloudMode: group.mode,
          });
          if (cmp)
            seeds.push({
              ...cmp,
              score: 74,
              id: `${source}-discover-wordCloud-${group.mode}`,
            });
        }
      }
    }
    if (
      [
        "scatter",
        "bubble",
        "hexbin",
        "contour",
        "voronoi",
        "isoScatter",
      ].includes(kind)
    ) {
      for (let a = 0; a < measures.length; a++)
        for (let b = a + 1; b < measures.length; b++) {
          const x = measures[a]!.name,
            y = measures[b]!.name;
          const rec = createChartRec(kind, columns, x, y, null, source, {
            sizeField:
              kind === "bubble"
                ? measures.find((c) => c.name !== x && c.name !== y)?.name
                : null,
          });
          if (rec)
            seeds.push({
              ...rec,
              score: 72,
              id: `${source}-discover-${kind}-pair-${a}-${b}`,
            });
        }
    }
  }
  const seen = new Set<string>();
  const expanded = expandRecommendationsWithExtras(seeds, columns, {
    exhaustive: true,
  });
  const fits = galleryKindFit(columns, sample, source);
  return addDiscoverMarkerVariants(expanded, columns, source, sample).filter(
    (chart) => {
      if (!fits(chart)) return false;
      const key = discoverRecipeKey(chart);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    },
  );
}

const TIMEISH_FIELD = /^(year|yr|month|day|week|hour|minute|doy|dow)$/i;

/**
 * Shape checks for the gallery kinds, on the real sample: each must have
 * something to show, not just columns of the right type.
 */
export function galleryKindFit(
  columns: ColumnInfo[],
  sample?: QueryResult | null,
  source = "",
): (chart: ChartRecommendation) => boolean {
  const distinct = (f: string | null | undefined) => columns.find((c) => c.name === f)?.distinct_count ?? 0;
  const rows = sample?.rows ?? [];
  const n = rows.length || Math.max(0, ...columns.map((c) => c.distinct_count + c.null_count));
  const avgLabelLen = (f: string) => {
    const i = sample?.columns.indexOf(f) ?? -1;
    if (i < 0 || !rows.length) return 0;
    const seen = new Set<string>();
    for (const r of rows) {
      seen.add(String(r[i] ?? ""));
      if (seen.size >= 200) break;
    }
    return [...seen].reduce((a, s) => a + s.length, 0) / Math.max(1, seen.size);
  };
  // Days with data and how densely they fill their span (monthly data makes an empty calendar).
  const dayCover = (f: string) => {
    const i = sample?.columns.indexOf(f) ?? -1;
    if (i < 0 || !rows.length) return { days: Number.POSITIVE_INFINITY, fill: 1 };
    const days = new Set<number>();
    for (const r of rows) {
      const v: unknown = r[i];
      const t = v instanceof Date ? v.getTime() : typeof v === "string" ? Date.parse(v) : NaN;
      if (Number.isFinite(t)) days.add(Math.floor(t / 86_400_000));
    }
    if (!days.size) return { days: 0, fill: 0 };
    const span = Math.max(...days) - Math.min(...days) + 1;
    return { days: days.size, fill: days.size / span };
  };
  // Labels that are mostly bare numbers (app ids, codes) aren't words.
  const numericLabels = (f: string) => {
    const i = sample?.columns.indexOf(f) ?? -1;
    if (i < 0 || !rows.length) return false;
    const vals = rows.slice(0, 200).map((r) => String(r[i] ?? "").trim()).filter(Boolean);
    return vals.length > 0 && vals.filter((v) => /^-?[\d.,]+$/.test(v)).length / vals.length > 0.5;
  };
  // Row counts per category that barely differ (one reading per city per hour) make flat petals / equal words.
  const countsVary = (f: string) => {
    const i = sample?.columns.indexOf(f) ?? -1;
    if (i < 0 || !rows.length) return true;
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(String(r[i] ?? ""), (counts.get(String(r[i] ?? "")) ?? 0) + 1);
    const vals = [...counts.values()];
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
    return mean > 0 && sd / mean >= 0.15;
  };
  return (chart) => {
    switch (chart.kind) {
      case "wordCloud": {
        const d = distinct(chart.xField);
        // Words, not headlines: many short labels.
        if (/(^|_)(fips|code|id|zip|iso\d?|uuid)($|_)|id$/i.test(chart.xField) || numericLabels(chart.xField)) return false;
        // Sizes add up words' totals, so the measure must be additive.
        if (chart.yField && !isAdditiveDiscoverMeasure(source, chart.yField)) return false;
        return d >= 8 && d <= 400 && avgLabelLen(chart.xField) <= 24 && (chart.yField != null || countsVary(chart.xField));
      }
      case "errorBars": {
        const d = distinct(chart.xField);
        // An interval needs several rows per group.
        return d >= 2 && d <= 40 && n / Math.max(1, d) >= 3 && avgLabelLen(chart.xField) <= 32;
      }
      case "rose": {
        const d = distinct(chart.xField);
        // Counting one row per petal draws identical wedges.
        return d >= 3 && d <= 24 && (chart.yField != null || (n / Math.max(1, d) >= 2 && countsVary(chart.xField)));
      }
      case "calendar": {
        const c = dayCover(chart.xField);
        return c.days >= 14 && c.fill >= 0.2;
      }
      case "sparkGrid": {
        const d = distinct(chart.colorField);
        return d >= 3 && d <= 24 && !/(^|_)(year|yr|fy_\w*|month)$/i.test(chart.yField ?? "");
      }
      case "connectedScatter":
        return !!chart.sizeField && !TIMEISH_FIELD.test(chart.xField) && !TIMEISH_FIELD.test(chart.yField ?? "");
      default:
        return true;
    }
  };
}
