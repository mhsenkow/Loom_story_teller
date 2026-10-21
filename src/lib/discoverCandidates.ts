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
      } else if (
        ["scatter3d", "quakeTerrain", "trailRibbon"].includes(kind)
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
          trailId: kind === "trailRibbon" ? cat?.name : undefined,
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
  return addDiscoverMarkerVariants(expanded, columns, source, sample).filter(
    (chart) => {
      const key = discoverRecipeKey(chart);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    },
  );
}
