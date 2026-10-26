// =================================================================
// Facet / Top N / Compare variant expansion and human-readable reasons.
// (split from recommendations.ts — LOOM-195; public API re-exported there)
// =================================================================

import { measureSuggestsGrowDown } from "../chartFieldHeuristics";
import { chartTimeWindowLabel, fieldLooksFutureDated, pickDefaultTimeField, suggestedChartTimeWindows } from "../chartTime";
import { inferType, measureColumns, yFieldSupportsLogScale } from "./columns";
import { geoMapRecommendationReason, isGeoMapKind } from "../geoMapsRec";
import { gpuSceneRecommendationReason, isGpuSceneKind } from "../gpuScenesRec";
import { buildOddChartRec, isOddChartKind, oddChartDataSupport, oddRecommendationReason, wordCloudCompareColumn } from "../oddChartsRec";
import { type ColumnInfo } from "../queryTypes";
import { FACET_RANDOM_KINDS } from "./random";
import { type ChartRecommendation } from "./types";

/**
 * Deterministic Facet / Top N / Compare enrichments for suggestion rails.
 * Returns alternate chart copies (not mutating the originals).
 */
export function expandRecommendationsWithExtras(
  recs: ChartRecommendation[],
  columns: ColumnInfo[],
  options?: { exhaustive?: boolean },
): ChartRecommendation[] {
  const nomCols = columns.filter((c) => inferType(c.data_type, c.name, c.min_value, c.max_value) === "nominal");
  const numCols = measureColumns(columns);
  const facetPool = (rec: ChartRecommendation) =>
    nomCols.filter(
      (c) =>
        c.distinct_count >= 2 &&
        c.distinct_count <= 10 &&
        c.name !== rec.xField &&
        c.name !== rec.yField,
    );
  const out = [...recs];
  const seen = new Set(recs.map((r) => r.id));
  const push = (rec: ChartRecommendation) => {
    if (seen.has(rec.id)) return;
    seen.add(rec.id);
    out.push(rec);
  };

  for (const rec of options?.exhaustive ? recs : recs.slice(0, 40)) {
    // Dual-measure + mirror/slope/dumbbell need room for scale and Δ variants
    // without starving Top N / facet on simpler charts.
    let variantBudget = options?.exhaustive ? Infinity :
      rec.kind === "pyramid" || rec.kind === "slope" || rec.kind === "dumbbell" || numCols.length >= 2
        ? 5
        : 3;
    const spendVariant = () => {
      if (variantBudget <= 0) return false;
      variantBudget -= 1;
      return true;
    };
    const pushVariant = (variant: ChartRecommendation) => {
      if (!spendVariant()) return;
      push(variant);
    };
    // Lower-is-better measures → Direction ↓ (zero at top)
    if (
      (rec.kind === "bar" || rec.kind === "lollipop" || rec.kind === "pareto") &&
      !rec.layoutDirection &&
      measureSuggestsGrowDown(rec.yField)
    ) {
      pushVariant({
        ...rec,
        id: `${rec.id}-dir-down`,
        layoutDirection: "down",
        subtitle: rec.subtitle
          ? `${rec.subtitle} · ↓ zero at top`
          : "↓ zero at top (lower is the story)",
        score: Math.max(46, rec.score - 1),
      });
    }

    // Top N on busy category charts
    if (
      (rec.kind === "bar" ||
        rec.kind === "lollipop" ||
        rec.kind === "treemap" ||
        rec.kind === "sunburst" ||
        rec.kind === "funnel" ||
        rec.kind === "forceBubble" ||
        rec.kind === "waffle" ||
        rec.kind === "isotype" ||
        rec.kind === "radialBar" ||
        rec.kind === "isoBars") &&
      !rec.topN &&
      (columns.find((c) => c.name === rec.xField)?.distinct_count ?? 0) > 12
    ) {
      pushVariant({
        ...rec,
        id: `${rec.id}-top15`,
        topN: 15,
        subtitle: rec.subtitle ? `${rec.subtitle} · top 15` : "top 15 categories",
        score: Math.max(40, rec.score - 3),
      });
      pushVariant({
        ...rec,
        id: `${rec.id}-top30`,
        topN: 30,
        subtitle: rec.subtitle ? `${rec.subtitle} · top 30` : "top 30 categories",
        score: Math.max(38, rec.score - 5),
      });
    }

    // Facet small multiples when a spare low-card category exists
    if (FACET_RANDOM_KINDS.has(rec.kind) && !rec.rowField) {
      const pool = facetPool(rec);
      const facet =
        pool.find((c) => c.name !== rec.colorField) ??
        (rec.colorField && pool.some((c) => c.name === rec.colorField) ? pool.find((c) => c.name === rec.colorField) : null) ??
        pool[0];
      if (facet) {
        const facetOnly = facet.name === rec.colorField;
        pushVariant({
          ...rec,
          id: `${rec.id}-facet-${facet.name}`,
          rowField: facet.name,
          colorField: facetOnly ? null : rec.colorField,
          subtitle: facetOnly
            ? `small multiples by ${facet.name}`
            : rec.colorField
              ? `${rec.subtitle || "split"} · facets by ${facet.name}`
              : `facets by ${facet.name}`,
          score: Math.max(42, rec.score - 4),
        });
      }
    }

    // Stacked / 100% / grouped bar variants when a Color subcategory fits
    if (rec.kind === "bar") {
      const stackColor =
        rec.colorField &&
        rec.colorField !== rec.xField &&
        nomCols.some((c) => c.name === rec.colorField && c.distinct_count >= 2 && c.distinct_count <= 12)
          ? rec.colorField
          : nomCols.find(
              (c) =>
                c.name !== rec.xField &&
                c.name !== rec.yField &&
                c.name !== rec.rowField &&
                c.distinct_count >= 2 &&
                c.distinct_count <= 12,
            )?.name ?? null;
      if (stackColor) {
        const base = { ...rec, colorField: stackColor };
        const alreadyGrouped =
          rec.colorField === stackColor && (!rec.barStackMode || rec.barStackMode === "grouped");
        if (!alreadyGrouped) {
          pushVariant({
            ...base,
            id: `${rec.id}-grouped-${stackColor}`,
            barStackMode: "grouped",
            subtitle: `grouped by ${stackColor}`,
            score: Math.max(44, rec.score - 2),
          });
        }
        if (rec.barStackMode !== "stacked") {
          pushVariant({
            ...base,
            id: `${rec.id}-stacked-${stackColor}`,
            barStackMode: "stacked",
            subtitle: `stacked by ${stackColor}`,
            score: Math.max(48, rec.score - 1),
          });
        }
        if (rec.barStackMode !== "percent") {
          pushVariant({
            ...base,
            id: `${rec.id}-percent-${stackColor}`,
            barStackMode: "percent",
            subtitle: `100% stacked by ${stackColor}`,
            score: Math.max(45, rec.score - 3),
          });
        }
      }
    }

    // Compare Y / earlier half on multi-measure time series
    if ((rec.kind === "line" || rec.kind === "area") && rec.yField && !rec.y2Field && !rec.comparePrevious) {
      const y2 = numCols.find((c) => c.name !== rec.yField && c.name !== rec.xField);
      if (y2) {
        pushVariant({
          ...rec,
          id: `${rec.id}-vs-${y2.name}`,
          y2Field: y2.name,
          subtitle: `compare ${rec.yField} vs ${y2.name}`,
          score: Math.max(44, rec.score - 5),
        });
      } else {
        pushVariant({
          ...rec,
          id: `${rec.id}-prev`,
          comparePrevious: true,
          subtitle: rec.subtitle ? `${rec.subtitle} · vs earlier half` : "vs earlier half",
          score: Math.max(42, rec.score - 6),
        });
      }
    }

    // Rolling mean / rebase / log-Y on line & area
    if ((rec.kind === "line" || rec.kind === "area") && rec.yField) {
      if (!rec.rollingWindow) {
        pushVariant({
          ...rec,
          id: `${rec.id}-roll7`,
          rollingWindow: 7,
          subtitle: "7-point rolling mean",
          score: Math.max(50, rec.score - 2),
        });
        pushVariant({
          ...rec,
          id: `${rec.id}-roll30`,
          rollingWindow: 30,
          subtitle: "30-point rolling mean",
          score: Math.max(48, rec.score - 3),
        });
      }
      if (!rec.seriesNormalize && rec.colorField) {
        const yCol = columns.find((c) => c.name === rec.yField);
        const colorCol = columns.find((c) => c.name === rec.colorField);
        const yMin = Number(yCol?.min_value);
        const seriesCount = colorCol?.distinct_count ?? 0;
        if (seriesCount >= 2 && Number.isFinite(yMin) && yMin > 0) {
          pushVariant({
            ...rec,
            id: `${rec.id}-idx100`,
            seriesNormalize: "index100",
            subtitle: "indexed to 100 at start",
            score: Math.max(47, rec.score - 4),
          });
        }
        if (seriesCount >= 2) {
          pushVariant({
            ...rec,
            id: `${rec.id}-zscore`,
            seriesNormalize: "zscore",
            subtitle: "z-scored series",
            score: Math.max(46, rec.score - 5),
          });
        }
      }
      if ((!rec.yScale || rec.yScale === "linear") && yFieldSupportsLogScale(rec.yField, columns)) {
        pushVariant({
          ...rec,
          id: `${rec.id}-logy`,
          yScale: "log",
          subtitle: "log Y scale",
          score: Math.max(45, rec.score - 4),
        });
      }
      if (!rec.anomalyHighlight) {
        pushVariant({
          ...rec,
          id: `${rec.id}-anom`,
          anomalyHighlight: true,
          subtitle: "anomaly rings (|z|>2.5)",
          score: Math.max(49, rec.score - 2),
        });
      }
    }

    // Period-over-period ghost on ordered bars
    if (rec.kind === "bar" && !rec.comparePrevious && !rec.colorField) {
      const xCol = columns.find((c) => c.name === rec.xField);
      const ordered =
        xCol &&
        (inferType(xCol.data_type, xCol.name) === "temporal" ||
          /^(year|yr|date|day|month|week|ts|time|fy)/i.test(xCol.name));
      if (ordered) {
        pushVariant({
          ...rec,
          id: `${rec.id}-pop`,
          comparePrevious: true,
          subtitle: "vs earlier half of the period",
          score: Math.max(46, rec.score - 3),
        });
      }
    }

    // Pareto from busy category bars
    if (
      (rec.kind === "bar" || rec.kind === "lollipop") &&
      (columns.find((c) => c.name === rec.xField)?.distinct_count ?? 0) >= 5
    ) {
      pushVariant({
        ...rec,
        id: `${rec.id}-pareto`,
        kind: "pareto",
        barStackMode: null,
        colorField: null,
        rowField: null,
        title: rec.yField ? `Pareto — ${rec.yField} by ${rec.xField}` : `Pareto — ${rec.xField}`,
        subtitle: "bars + cumulative % (80/20)",
        score: Math.max(52, rec.score - 1),
      });
    }

    // Residuals + anomaly on numeric scatters
    if (rec.kind === "scatter" && rec.yField) {
      if (!rec.residualOverlay) {
        pushVariant({
          ...rec,
          id: `${rec.id}-resid`,
          residualOverlay: true,
          subtitle: "residuals vs linear fit",
          score: Math.max(51, rec.score - 2),
        });
      }
      if (!rec.anomalyHighlight) {
        pushVariant({
          ...rec,
          id: `${rec.id}-anom`,
          anomalyHighlight: true,
          subtitle: "anomaly rings (|z|>2.5)",
          score: Math.max(50, rec.score - 2),
        });
      }
      if ((!rec.yScale || rec.yScale === "linear") && yFieldSupportsLogScale(rec.yField, columns)) {
        pushVariant({
          ...rec,
          id: `${rec.id}-logy`,
          yScale: "log",
          subtitle: "log Y scale",
          score: Math.max(44, rec.score - 5),
        });
      }
    }

    // Correlation matrix when enough numerics
    if (numCols.length >= 3 && rec.kind === "scatter") {
      const labels = numCols.slice(0, 8).map((c) => c.name);
      pushVariant({
        id: `corrMatrix-${labels.join("-")}`,
        kind: "corrMatrix",
        title: "Correlation matrix",
        subtitle: `Pearson r across ${labels.length} measures`,
        score: Math.max(55, rec.score - 8),
        spec: {},
        xField: labels[0]!,
        yField: labels[1]!,
        colorField: null,
        tooltipFields: labels,
      });
    }

    // Contour density promote from scatter
    if (rec.kind === "scatter" && rec.yField && oddChartDataSupport(columns, "contour").ok) {
      const cont = buildOddChartRec("contour", columns, rec.xField, rec.yField, rec.colorField, "data", {});
      if (cont) {
        pushVariant({
          ...cont,
          id: `${rec.id}-contour`,
          score: Math.max(54, rec.score - 3),
          subtitle: "2D density contours",
        });
      }
    }

    if (rec.kind === "wordCloud" && rec.wordCloudMode !== "compare" && rec.wordCloudMode !== "grid") {
      const group = wordCloudCompareColumn(columns, rec.xField);
      if (group) {
        pushVariant({
          ...rec,
          id: `${rec.id}-${group.mode}`,
          colorField: group.name,
          wordCloudMode: group.mode,
          title: group.mode === "compare" ? `${rec.xField} compared by ${group.name}` : `${rec.xField} for each ${group.name}`,
          subtitle: group.mode === "compare"
            ? "words lean to the group where they count more"
            : "one cloud per group — same size means the same total",
          score: Math.max(50, rec.score - 2),
        });
      }
    }

    // Delta-rank bump
    if (rec.kind === "bump" && rec.bumpMode !== "delta") {
      pushVariant({
        ...rec,
        id: `${rec.id}-delta`,
        bumpMode: "delta",
        subtitle: "Δ rank over time",
        score: Math.max(50, rec.score - 2),
      });
    }

    // Mirror pyramid — same vs separate scales + Δ labels
    if (rec.kind === "pyramid" && rec.yField && rec.sizeField) {
      if (!rec.pyramidScaleMode || rec.pyramidScaleMode === "auto") {
        pushVariant({
          ...rec,
          id: `${rec.id}-scale-shared`,
          pyramidScaleMode: "shared",
          subtitle: rec.subtitle ? `${rec.subtitle} · same scale` : "same scale (comparable lengths)",
          score: Math.max(52, rec.score - 1),
        });
        pushVariant({
          ...rec,
          id: `${rec.id}-scale-indep`,
          pyramidScaleMode: "independent",
          subtitle: rec.subtitle ? `${rec.subtitle} · separate scales` : "separate scales",
          score: Math.max(51, rec.score - 2),
        });
      }
      if (!rec.deltaDisplay || rec.deltaDisplay === "off") {
        pushVariant({
          ...rec,
          id: `${rec.id}-delta-diff`,
          deltaDisplay: "diff",
          subtitle: rec.subtitle ? `${rec.subtitle} · Δ labeled` : "Δ Right − Left",
          score: Math.max(53, rec.score - 1),
        });
        pushVariant({
          ...rec,
          id: `${rec.id}-delta-pct`,
          deltaDisplay: "pct",
          subtitle: rec.subtitle ? `${rec.subtitle} · % change` : "% change labeled",
          score: Math.max(52, rec.score - 2),
        });
      }
    }

    // Slope / dumbbell — Δ and % labels
    if ((rec.kind === "slope" || rec.kind === "dumbbell") && rec.yField && rec.sizeField) {
      if (!rec.deltaDisplay || rec.deltaDisplay === "off") {
        pushVariant({
          ...rec,
          id: `${rec.id}-delta-diff`,
          deltaDisplay: "diff",
          subtitle: rec.subtitle ? `${rec.subtitle} · Δ labeled` : "Δ End − Start",
          score: Math.max(53, rec.score - 1),
        });
        pushVariant({
          ...rec,
          id: `${rec.id}-delta-pct`,
          deltaDisplay: "pct",
          subtitle: rec.subtitle ? `${rec.subtitle} · % change` : "% change labeled",
          score: Math.max(51, rec.score - 2),
        });
      }
    }

    // Promote dual numerics → dumbbell / slope / pyramid when schema fits
    if (
      (rec.kind === "bar" || rec.kind === "scatter" || rec.kind === "lollipop") &&
      rec.yField &&
      numCols.length >= 2
    ) {
      const nomOk =
        (columns.find((c) => c.name === rec.xField)?.distinct_count ?? 0) >= 2 &&
        (columns.find((c) => c.name === rec.xField)?.distinct_count ?? 99) <= 40;
      const other = numCols.find((c) => c.name !== rec.yField)?.name;
      if (nomOk && other) {
        if (oddChartDataSupport(columns, "pyramid").ok) {
          const pyr = buildOddChartRec("pyramid", columns, rec.xField, rec.yField, null, "data", {
            sizeField: other,
            yAggregate: "sum",
          });
          if (pyr) {
            pushVariant({
              ...pyr,
              id: `${rec.id}-as-pyramid`,
              pyramidScaleMode: "auto",
              deltaDisplay: "diff",
              topN: rec.topN ?? 14,
              subtitle: `mirror ${rec.yField} ↔ ${other}`,
              score: Math.max(56, rec.score - 4),
            });
          }
        }
        pushVariant({
          ...rec,
          id: `${rec.id}-as-dumbbell`,
          kind: "dumbbell",
          sizeField: other,
          colorField: null,
          rowField: null,
          barStackMode: null,
          yAggregate: "mean",
          deltaDisplay: "diff",
          title: `${rec.yField} → ${other} by ${rec.xField}`,
          subtitle: "dumbbell — start to end · Δ labeled",
          score: Math.max(55, rec.score - 5),
        });
        if (oddChartDataSupport(columns, "slope").ok) {
          const sl = buildOddChartRec("slope", columns, rec.xField, rec.yField, null, "data", {
            sizeField: other,
          });
          if (sl) {
            pushVariant({
              ...sl,
              id: `${rec.id}-as-slope`,
              deltaDisplay: "diff",
              subtitle: `slope ${rec.yField} → ${other}`,
              score: Math.max(54, rec.score - 5),
            });
          }
        }
      }
    }

    // Time windows — slice recent rows independent of the X axis
    if (!rec.timeWindow || rec.timeWindow === "all") {
      const twField = pickDefaultTimeField(columns, rec);
      if (twField) {
        const suggested = suggestedChartTimeWindows(twField);
        const windows = options?.exhaustive ? suggested : suggested.slice(0, 2);
        windows.forEach((range, i) => {
          const label = chartTimeWindowLabel(
            range,
            fieldLooksFutureDated(twField) ? "forward" : "wall",
          )?.toLowerCase() ?? range;
          pushVariant({
            ...rec,
            id: `${rec.id}-tw-${range}`,
            timeWindowField: twField,
            timeWindow: range,
            subtitle: rec.subtitle ? `${rec.subtitle} · ${label}` : label,
            score: Math.max(46, rec.score - 2 - i),
          });
        });
      }
    }
  }

  // One correlation matrix if schema supports and none was pushed from a scatter seed
  if (numCols.length >= 3 && !out.some((r) => r.kind === "corrMatrix")) {
    const labels = numCols.slice(0, 8).map((c) => c.name);
    push({
      id: `corrMatrix-${labels.join("-")}`,
      kind: "corrMatrix",
      title: "Correlation matrix",
      subtitle: `Pearson r across ${labels.length} measures`,
      score: 60,
      spec: {},
      xField: labels[0]!,
      yField: labels[1]!,
      colorField: null,
      tooltipFields: labels,
    });
  }

  return out;
}

/** Short, human-readable reason why this chart type fits the data. No LLM required. */
export function getRecommendationReason(rec: ChartRecommendation): string {
  const { kind, xField, yField, colorField } = rec;
  switch (kind) {
    case "scatter":
      return yField ? "Two numeric columns → good for correlation or distribution" : "Numeric pairs for relationship";
    case "line":
      return "Time or sequence on X, value on Y → trend over time";
    case "bar":
      return colorField
        ? "Category + subcategory on Color → dodged, stacked, or 100% bars"
        : yField
          ? "Category vs value (sum/mean/count) → compare groups"
          : "Count by category";
    case "pareto":
      return "Ranked bars + cumulative share → see the 80/20 cut";
    case "corrMatrix":
      return "Pearson r across numeric columns → which measures move together";
    case "histogram":
      return "Single numeric column → distribution of values";
    case "area":
      return "Stacked or single series over X → cumulative or trend";
    case "pie":
      return "Part-to-whole by category";
    case "heatmap":
      return "Two categories + count → density or contingency";
    case "strip":
      return "One numeric, optional category → spread across axis";
    case "box":
      return "Distribution by category → quartiles and outliers";
    case "bubble":
      return "Three numeric columns → position + size encodes a third variable";
    case "violin":
      return "Numeric per category → full distribution shape, not just quartiles";
    case "radar":
      return "Multiple numeric axes → compare profiles across categories";
    case "waterfall":
      return "Sequential categories → show cumulative gains and losses";
    case "lollipop":
      return "Category vs value → clean stem+dot, easier to read than bars";
    case "dumbbell":
      return "Two measures per category → before/after or range comparison";
    case "ridgeline":
      return "Numeric density stacked by group → compare shapes without overlap clutter";
    case "hexbin":
      return "Two numerics when points pile up → hexagonal density instead of overplot";
    case "funnel":
      return "Ordered stages → conversion or attrition through a pipeline";
    case "parallel":
      return "Three or more numerics → multi-axis profiles across rows or groups";
    case "treemap":
      return "Nested rectangles → part-of-whole with optional hierarchy";
    case "sunburst":
      return "Radial slices → hierarchical composition at a glance";
    case "choropleth":
      return "Region codes joined to world/US polygons — real filled map";
    case "forceBubble":
      return "Packed circles → size comparison without axes, grouped by category";
    case "sankey":
      return "Two categories → flow and volume between groups";
    case "network":
      return "Two categories → force-directed node-link graph of connections";
    case "arcDiagram":
      return "Two categories → nodes on a line with arcs for each link";
    default:
      if (isGpuSceneKind(kind)) return gpuSceneRecommendationReason(kind);
      if (isGeoMapKind(kind)) return geoMapRecommendationReason(kind);
      if (isOddChartKind(kind)) return oddRecommendationReason(kind);
      return "Fits your column types and cardinality";
  }
}
