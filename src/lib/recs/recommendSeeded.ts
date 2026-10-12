// =================================================================
// recommendSeeded — schema-driven candidate generation and scoring.
// (split from recommendations.ts — LOOM-195; public API re-exported there)
// =================================================================

import { classifyColumns } from "../columnClassify";
import { COLORS, columnsHaveLatLon, defaultLineAreaAggregate, diversifyRecommendations, isLatLonPair, isRateLikeField, measureColumns, nominalQualityBoost, pearsonAbs, pickColorColumn, sampleNumericPair } from "./columns";
import { baseConfig } from "./createChartRec";
import { expandRecommendationsWithExtras } from "./expand";
import { isGeoRegionField } from "../geoFields";
import { GEO_MAP_KIND_OPTIONS, buildGeoMapRec, geoMapDataSupport, getGeoMapRandomEncoding } from "../geoMapsRec";
import { suggestDataCubeRec } from "../gpuScenesRec";
import { ODD_CHART_KIND_OPTIONS, buildOddChartRec, getOddRandomEncoding, oddChartDataSupport } from "../oddChartsRec";
import { type ColumnInfo, type QueryResult } from "../queryTypes";
import { recRandom } from "../seededRandom";
import { type ChartKind, type ChartRecommendation } from "./types";
import { type VizPreferenceModel, applyPreferenceBoosts, getCachedVizPreferences } from "../vizPreferences";

export function recommendSeeded(
  columns: ColumnInfo[],
  data: QueryResult | null,
  fileName: string,
  prefs?: VizPreferenceModel | null,
): ChartRecommendation[] {
  const recs: ChartRecommendation[] = [];
  const name = fileName.replace(/\.\w+$/, "");
  const nRows = data?.rows?.length ?? 0;
  const dense = nRows >= 2500;
  const veryDense = nRows >= 6000;

  const numCols = measureColumns(columns, nRows);
  const { nominal: nomCols, temporal: timeCols } = classifyColumns(columns);

  // Dense bivariate → density heatmap beats a bubble soup
  if (dense && numCols.length >= 2) {
    const a = numCols[0]!;
    const b = numCols[1]!;
    recs.push({
      id: `heatmap-density-${a.name}-${b.name}`,
      kind: "heatmap",
      title: `${a.name} × ${b.name} density`,
      subtitle: veryDense
        ? `${nRows.toLocaleString()} rows · binned (clearer than bubbles)`
        : "binned density · less overplotting",
      score: veryDense ? 94 : 86,
      spec: {},
      xField: a.name,
      yField: b.name,
      colorField: null,
    });
  }

  // --- SCATTER: every pair of numeric columns ---
  const colorCol = pickColorColumn(nomCols);
  for (let i = 0; i < numCols.length && i < 5; i++) {
    for (let j = i + 1; j < numCols.length && j < 6; j++) {
      const x = numCols[i]!;
      const y = numCols[j]!;

      const encoding: Record<string, unknown> = {
        x: { field: x.name, type: "quantitative" },
        y: { field: y.name, type: "quantitative" },
      };
      if (colorCol) {
        encoding.color = { field: colorCol.name, type: "nominal", scale: { range: COLORS } };
      }

      let score = 68;
      if (x.distinct_count > 50 && y.distinct_count > 50) score += 12;
      if (colorCol && colorCol.distinct_count >= 3 && colorCol.distinct_count <= 12) score += 12;
      else if (colorCol) score += 6;
      if (dense) score += 4;

      const geoPair = isLatLonPair(x.name, y.name);
      // Sample correlation: strong relationships beat arbitrary numeric pairs
      const pair = sampleNumericPair(data, x.name, y.name);
      let corrNote = "numeric relationship";
      if (geoPair) {
        score += 28; // map-like layout beats noise correlation penalty
        corrNote = "geographic coordinates";
      } else if (pair) {
        const absR = pearsonAbs(pair.xs, pair.ys);
        if (absR >= 0.75) {
          score += 22;
          corrNote = `strong correlation (|r|≈${absR.toFixed(2)})`;
        } else if (absR >= 0.45) {
          score += 14;
          corrNote = `moderate correlation (|r|≈${absR.toFixed(2)})`;
        } else if (absR >= 0.2) {
          score += 6;
          corrNote = `weak correlation (|r|≈${absR.toFixed(2)})`;
        } else {
          score -= 4; // near-noise pair: still show, but rank lower
          corrNote = "loose cloud (low correlation)";
        }
      }

      recs.push({
        id: `scatter-${x.name}-${y.name}`,
        kind: "scatter",
        title: geoPair
          ? (x.name.toLowerCase().includes("lon") ? `${y.name} × ${x.name}` : `${x.name} × ${y.name}`)
          : `${x.name} vs ${y.name}`,
        subtitle: colorCol ? `${corrNote} · colored by ${colorCol.name}` : corrNote,
        score,
        spec: {
          $schema: "https://vega.github.io/schema/vega-lite/v5.json",
          mark: { type: "circle", opacity: 0.65, size: 12 },
          encoding,
          width: "container", height: "container",
          config: baseConfig(),
        },
        xField: x.name,
        yField: y.name,
        colorField: colorCol?.name ?? null,
      });
    }
  }

  // --- BAR: each nominal × each numeric (sum) — allow up to 50 categories (e.g. US states) ---
  for (const nom of nomCols.slice(0, 5)) {
    if (nom.distinct_count < 2 || nom.distinct_count > 50) continue;
    for (const num of numCols.slice(0, 4)) {
      const rate = isRateLikeField(num.name);
      let score = 62;
      if (nom.distinct_count >= 3 && nom.distinct_count <= 20) score += 15;
      score += nominalQualityBoost(nom.name);
      if (rate) score -= 35; // summing %/rates is almost always wrong

      recs.push({
        id: `bar-sum-${nom.name}-${num.name}`,
        kind: "bar",
        title: `Sum of ${num.name} by ${nom.name}`,
        subtitle: rate ? `⚠ sum of rates — prefer average` : `total ${num.name}, grouped`,
        score,
        spec: {
          $schema: "https://vega.github.io/schema/vega-lite/v5.json",
          mark: { type: "bar", cornerRadiusTopLeft: 3, cornerRadiusTopRight: 3 },
          encoding: {
            x: { field: nom.name, type: "nominal", sort: "-y" },
            y: { field: num.name, type: "quantitative", aggregate: "sum" },
            color: { value: COLORS[0] },
          },
          width: "container", height: "container",
          config: baseConfig(),
        },
        xField: nom.name,
        yField: num.name,
        colorField: null,
        yAggregate: "sum",
      });
    }
  }

  // --- BAR: nominal × numeric (mean) — good for "average cost by state" / rates ---
  for (const nom of nomCols.slice(0, 4)) {
    if (nom.distinct_count < 2 || nom.distinct_count > 40) continue;
    for (const num of numCols.slice(0, 4)) {
      const rate = isRateLikeField(num.name);
      let score = 58;
      if (nom.distinct_count >= 3 && nom.distinct_count <= 20) score += 10;
      score += nominalQualityBoost(nom.name);
      if (rate) score += 30; // prefer mean for % / proportion columns

      recs.push({
        id: `bar-mean-${nom.name}-${num.name}`,
        kind: "bar",
        title: rate
          ? `${num.name.replace(/\s*\(%\)\s*$/, "").replace(/\s+/g, " ").trim()} by ${nom.name}`
          : `Average ${num.name} by ${nom.name}`,
        subtitle: rate ? `rate / proportion (mean)` : `mean per group`,
        score,
        spec: {
          $schema: "https://vega.github.io/schema/vega-lite/v5.json",
          mark: { type: "bar", cornerRadiusTopLeft: 3, cornerRadiusTopRight: 3 },
          encoding: {
            x: { field: nom.name, type: "nominal", sort: "-y" },
            y: { field: num.name, type: "quantitative", aggregate: "mean" },
            color: { value: COLORS[1] },
          },
          width: "container", height: "container",
          config: baseConfig(),
        },
        xField: nom.name,
        yField: num.name,
        colorField: null,
        yAggregate: "mean",
      });
    }
  }

  // --- BAR: count by category (nominal × row count) ---
  for (const nom of nomCols.slice(0, 5)) {
    if (nom.distinct_count < 2 || nom.distinct_count > 50) continue;
    recs.push({
      id: `bar-count-${nom.name}`,
      kind: "bar",
      title: `Count by ${nom.name}`,
      subtitle: "number of rows per category",
      score: 55,
      spec: {
        $schema: "https://vega.github.io/schema/vega-lite/v5.json",
        mark: { type: "bar", cornerRadiusTopLeft: 3, cornerRadiusTopRight: 3 },
        encoding: {
          x: { field: nom.name, type: "nominal", sort: "-y" },
          y: { aggregate: "count", type: "quantitative" },
          color: { value: COLORS[2] },
        },
        width: "container", height: "container",
        config: baseConfig(),
      },
      xField: nom.name,
      yField: null, // no numeric field; we use count
      colorField: null,
    });
  }

  // --- BAR: category × subcategory × numeric (dodged bars) ---
  for (const xNom of nomCols.slice(0, 4)) {
    if (xNom.distinct_count < 2 || xNom.distinct_count > 25) continue;
    for (const cNom of nomCols) {
      if (cNom.name === xNom.name) continue;
      if (cNom.distinct_count < 2 || cNom.distinct_count > 18) continue;
      for (const num of numCols.slice(0, 3)) {
        const rate = isRateLikeField(num.name);
        let score = 64;
        if (xNom.distinct_count <= 8 && cNom.distinct_count >= 3) score += 8;
        if (rate) score -= 35;
        recs.push({
          id: `bar-facet-sum-${xNom.name}-${cNom.name}-${num.name}`,
          kind: "bar",
          title: `Sum of ${num.name} by ${xNom.name} × ${cNom.name}`,
          subtitle: rate ? `⚠ sum of rates — prefer average` : `grouped by ${cNom.name}`,
          score,
          spec: {
            $schema: "https://vega.github.io/schema/vega-lite/v5.json",
            mark: { type: "bar", cornerRadiusTopLeft: 3, cornerRadiusTopRight: 3 },
            encoding: {
              x: { field: xNom.name, type: "nominal", sort: "-y" },
              y: { field: num.name, type: "quantitative", aggregate: "sum" },
              xOffset: { field: cNom.name, type: "nominal" },
              color: { field: cNom.name, type: "nominal", scale: { range: COLORS } },
            },
            width: "container",
            height: "container",
            config: baseConfig(),
          },
          xField: xNom.name,
          yField: num.name,
          colorField: cNom.name,
        });
      }
    }
  }

  // --- BAR: count by category × subcategory ---
  for (const xNom of nomCols.slice(0, 4)) {
    if (xNom.distinct_count < 2 || xNom.distinct_count > 25) continue;
    for (const cNom of nomCols) {
      if (cNom.name === xNom.name) continue;
      if (cNom.distinct_count < 2 || cNom.distinct_count > 18) continue;
      recs.push({
        id: `bar-facet-count-${xNom.name}-${cNom.name}`,
        kind: "bar",
        title: `Count by ${xNom.name} × ${cNom.name}`,
        subtitle: `rows per ${xNom.name} and ${cNom.name}`,
        score: 60,
        spec: {
          $schema: "https://vega.github.io/schema/vega-lite/v5.json",
          mark: { type: "bar", cornerRadiusTopLeft: 3, cornerRadiusTopRight: 3 },
          encoding: {
            x: { field: xNom.name, type: "nominal", sort: "-y" },
            y: { aggregate: "count", type: "quantitative" },
            xOffset: { field: cNom.name, type: "nominal" },
            color: { field: cNom.name, type: "nominal", scale: { range: COLORS } },
          },
          width: "container",
          height: "container",
          config: baseConfig(),
        },
        xField: xNom.name,
        yField: null,
        colorField: cNom.name,
      });
    }
  }

  // --- HISTOGRAM: each numeric column ---
  for (const num of numCols.slice(0, 5)) {
    let score = 50;
    if (num.distinct_count > 20) score += 15;
    const range = Number(num.max_value) - Number(num.min_value);
    if (range > 0) score += 5;

    recs.push({
      id: `hist-${num.name}`,
      kind: "histogram",
      title: `Distribution of ${num.name}`,
      subtitle: `${num.min_value} → ${num.max_value}`,
      score,
      spec: {
        $schema: "https://vega.github.io/schema/vega-lite/v5.json",
        mark: { type: "bar", cornerRadiusTopLeft: 2, cornerRadiusTopRight: 2 },
        encoding: {
          x: { field: num.name, type: "quantitative", bin: { maxbins: 30 } },
          y: { aggregate: "count", type: "quantitative" },
          color: { value: COLORS[1] },
        },
        width: "container", height: "container",
        config: baseConfig(),
      },
      xField: num.name,
      yField: null,
      colorField: null,
    });
  }

  // --- LINE (time series): temporal × numeric ---
  for (const time of timeCols.slice(0, 2)) {
    for (const num of numCols.slice(0, 4)) {
      const groupCol = pickColorColumn(nomCols.filter((c) => c.distinct_count <= 12));
      let score = 82; // time trends are usually the most actionable story
      if (groupCol) score += 10;

      const encoding: Record<string, unknown> = {
        x: { field: time.name, type: "temporal" },
        y: { field: num.name, type: "quantitative", aggregate: "mean" },
      };
      if (groupCol) {
        encoding.color = { field: groupCol.name, type: "nominal", scale: { range: COLORS } };
      }

      recs.push({
        id: `line-${time.name}-${num.name}`,
        kind: "line",
        title: `${num.name} over ${time.name}`,
        subtitle: groupCol ? `split by ${groupCol.name}` : "time trend",
        score,
        spec: {
          $schema: "https://vega.github.io/schema/vega-lite/v5.json",
          mark: { type: "line", strokeWidth: 1.5 },
          encoding,
          width: "container", height: "container",
          config: baseConfig(),
        },
        xField: time.name,
        yField: num.name,
        colorField: groupCol?.name ?? null,
      });
    }
  }

  const distributionPairs = new Set<string>();
  const rowCountHint = data?.rows?.length ?? 0;
  const pickDistributionKind = (groups: number, rows: number): ChartKind | null => {
    if (groups < 2) return null;
    if (groups <= 4) return "strip";
    if (groups <= 10 && rows >= 50) return "violin";
    if (groups <= 10) return "ridgeline";
    if (groups <= 20) return "box";
    return null;
  };
  for (const nom of nomCols.slice(0, 4)) {
    if (nom.distinct_count < 2 || nom.distinct_count > 20) continue;
    for (const num of numCols.slice(0, 4)) {
      const pairKey = `${nom.name}|${num.name}`;
      if (distributionPairs.has(pairKey)) continue;
      const kind = pickDistributionKind(nom.distinct_count, rowCountHint);
      if (!kind) continue;
      distributionPairs.add(pairKey);
      const score =
        kind === "box" ? 68 : kind === "violin" ? 66 : kind === "ridgeline" ? 65 : 55;
      const subtitle =
        kind === "box"
          ? "box plot — quartiles per group"
          : kind === "violin"
            ? "violin — density shape per group"
            : kind === "ridgeline"
              ? "ridgeline — overlapping densities"
              : "strip plot — distribution per group";
      recs.push({
        id: `${kind}-${nom.name}-${num.name}`,
        kind,
        title: `${num.name} by ${nom.name}`,
        subtitle,
        score,
        spec: {},
        xField: kind === "strip" || kind === "ridgeline" ? num.name : nom.name,
        yField: kind === "strip" || kind === "ridgeline" ? nom.name : num.name,
        colorField: kind === "strip" ? nom.name : null,
      });
    }
  }

  // --- AREA (stacked): temporal or nominal × numeric ---
  for (const time of timeCols.slice(0, 2)) {
    for (const num of numCols.slice(0, 3)) {
      const groupCol = nomCols.length > 0 && nomCols[0].distinct_count <= 12 ? nomCols[0] : null;
      const encoding: Record<string, unknown> = {
        x: { field: time.name, type: "temporal" },
        y: {
          field: num.name,
          type: "quantitative",
          aggregate: defaultLineAreaAggregate(num.name, columns),
        },
      };
      if (groupCol) {
        encoding.color = { field: groupCol.name, type: "nominal", scale: { range: COLORS } };
      }
      recs.push({
        id: `area-${time.name}-${num.name}`,
        kind: "area",
        title: `${num.name} over ${time.name}`,
        subtitle: groupCol ? `stacked by ${groupCol.name}` : "area trend",
        score: 72,
        spec: {
          $schema: "https://vega.github.io/schema/vega-lite/v5.json",
          mark: { type: "area", line: true, opacity: 0.7 },
          encoding,
          width: "container", height: "container",
          config: baseConfig(),
        },
        xField: time.name,
        yField: num.name,
        colorField: groupCol?.name ?? null,
      });
    }
  }

  // --- PIE / DONUT: one nominal, count or sum of numeric ---
  for (const nom of nomCols.slice(0, 4)) {
    if (nom.distinct_count < 2 || nom.distinct_count > 15) continue;
    const num = numCols[0];
    recs.push({
      id: `pie-${nom.name}-${num?.name ?? "count"}`,
      kind: "pie",
      title: num ? `${num.name} by ${nom.name}` : `Count by ${nom.name}`,
      subtitle: num ? `sum of ${num.name}` : "distribution",
      score: 58,
      spec: {
        $schema: "https://vega.github.io/schema/vega-lite/v5.json",
        mark: { type: "arc", innerRadius: 40 },
        encoding: {
          theta: num
            ? { field: num.name, type: "quantitative", aggregate: "sum" }
            : { aggregate: "count", type: "quantitative" },
          color: { field: nom.name, type: "nominal", scale: { range: COLORS } },
        },
        width: "container", height: "container",
        config: baseConfig(),
      },
      xField: nom.name,
      yField: num?.name ?? null,
      colorField: nom.name,
    });
  }

  // --- HEATMAP: more combos (not just first two nominals) ---
  for (let i = 0; i < Math.min(nomCols.length, 3); i++) {
    for (let j = i + 1; j < Math.min(nomCols.length, 4); j++) {
      const a = nomCols[i];
      const b = nomCols[j];
      if (a.distinct_count <= 20 && b.distinct_count <= 20 && a.distinct_count >= 2 && b.distinct_count >= 2) {
        recs.push({
          id: `heatmap-${a.name}-${b.name}`,
          kind: "heatmap",
          title: `${a.name} × ${b.name}`,
          subtitle: "count heatmap",
          score: 65,
          spec: {
            $schema: "https://vega.github.io/schema/vega-lite/v5.json",
            mark: "rect",
            encoding: {
              x: { field: a.name, type: "nominal" },
              y: { field: b.name, type: "nominal" },
              color: { aggregate: "count", type: "quantitative", scale: { scheme: "purples" } },
            },
            width: "container", height: "container",
            config: baseConfig(),
          },
          xField: a.name,
          yField: b.name,
          colorField: null,
        });
      }
    }
  }

  // --- BUBBLE: three numeric columns (x, y, size) ---
  for (let i = 0; i < numCols.length && i < 3; i++) {
    for (let j = i + 1; j < numCols.length && j < 4; j++) {
      for (let k = 0; k < numCols.length && k < 5; k++) {
        if (k === i || k === j) continue;
        const colorCol = nomCols.length > 0 && nomCols[0].distinct_count <= 15 ? nomCols[0] : null;
        recs.push({
          id: `bubble-${numCols[i].name}-${numCols[j].name}-${numCols[k].name}`,
          kind: "bubble",
          title: `${numCols[i].name} vs ${numCols[j].name} sized by ${numCols[k].name}`,
          subtitle: colorCol
            ? `colored by ${colorCol.name}`
            : (dense ? "three-variable · prefer Clarity or density heatmap when crowded" : "three-variable view"),
          score: veryDense ? 42 : dense ? 55 : 73,
          spec: {},
          xField: numCols[i].name,
          yField: numCols[j].name,
          colorField: colorCol?.name ?? null,
          sizeField: numCols[k].name,
        });
        if (recs.filter(r => r.kind === "bubble").length >= 3) break;
      }
      if (recs.filter(r => r.kind === "bubble").length >= 3) break;
    }
    if (recs.filter(r => r.kind === "bubble").length >= 3) break;
  }

  // --- RADAR: 3+ numeric columns, optionally grouped by a nominal ---
  if (numCols.length >= 3) {
    const axes = numCols.slice(0, 6);
    const groupCol = nomCols.length > 0 && nomCols[0].distinct_count >= 2 && nomCols[0].distinct_count <= 8 ? nomCols[0] : null;
    recs.push({
      id: `radar-${axes.map(c => c.name).join("-")}`,
      kind: "radar",
      title: `Radar: ${axes.map(c => c.name).join(", ")}`,
      subtitle: groupCol ? `per ${groupCol.name}` : "multi-axis profile",
      score: 60,
      spec: {},
      xField: axes[0].name,
      yField: axes[1].name,
      colorField: groupCol?.name ?? null,
    });
  }

  // --- WATERFALL: nominal × numeric (sequential gains/losses) ---
  for (const nom of nomCols.slice(0, 3)) {
    if (nom.distinct_count < 3 || nom.distinct_count > 20) continue;
    for (const num of numCols.slice(0, 2)) {
      recs.push({
        id: `waterfall-${nom.name}-${num.name}`,
        kind: "waterfall",
        title: `${num.name} waterfall by ${nom.name}`,
        subtitle: "cumulative gains and losses",
        score: 62,
        spec: {},
        xField: nom.name,
        yField: num.name,
        colorField: null,
      });
    }
  }

  // --- LOLLIPOP: nominal × numeric (cleaner ranked bar) ---
  for (const nom of nomCols.slice(0, 4)) {
    if (nom.distinct_count < 2 || nom.distinct_count > 30) continue;
    for (const num of numCols.slice(0, 3)) {
      recs.push({
        id: `lollipop-${nom.name}-${num.name}`,
        kind: "lollipop",
        title: `${num.name} by ${nom.name}`,
        subtitle: "lollipop — stem + dot",
        score: 61,
        spec: {},
        xField: nom.name,
        yField: num.name,
        colorField: null,
      });
    }
  }

  // --- DUMBBELL: category × two numerics (before → after / range) ---
  if (numCols.length >= 2) {
    for (const nom of nomCols.slice(0, 3)) {
      if (nom.distinct_count < 2 || nom.distinct_count > 24) continue;
      for (let i = 0; i < Math.min(numCols.length, 3); i++) {
        for (let j = i + 1; j < Math.min(numCols.length, 4); j++) {
          recs.push({
            id: `dumbbell-${nom.name}-${numCols[i].name}-${numCols[j].name}`,
            kind: "dumbbell",
            title: `${numCols[i].name} → ${numCols[j].name} by ${nom.name}`,
            subtitle: "dumbbell — start to end",
            score: 67,
            spec: {},
            xField: nom.name,
            yField: numCols[i].name,
            colorField: null,
            sizeField: numCols[j].name,
            yAggregate: "mean",
          });
          if (recs.filter(r => r.kind === "dumbbell").length >= 4) break;
        }
        if (recs.filter(r => r.kind === "dumbbell").length >= 4) break;
      }
      if (recs.filter(r => r.kind === "dumbbell").length >= 4) break;
    }
  }

  // --- HEXBIN: dense two-numeric density (prefer when crowded) ---
  for (let i = 0; i < numCols.length && i < 3; i++) {
    for (let j = i + 1; j < numCols.length && j < 4; j++) {
      recs.push({
        id: `hexbin-${numCols[i].name}-${numCols[j].name}`,
        kind: "hexbin",
        title: `${numCols[i].name} × ${numCols[j].name}`,
        subtitle: dense ? "hexbin — density for crowded points" : "hexbin — density tiles",
        score: veryDense ? 78 : dense ? 70 : 58,
        spec: {},
        xField: numCols[i].name,
        yField: numCols[j].name,
        colorField: null,
      });
      if (recs.filter(r => r.kind === "hexbin").length >= 3) break;
    }
    if (recs.filter(r => r.kind === "hexbin").length >= 3) break;
  }

  // --- FUNNEL: ordered stages (category × value) ---
  for (const nom of nomCols.slice(0, 3)) {
    if (nom.distinct_count < 3 || nom.distinct_count > 12) continue;
    for (const num of numCols.slice(0, 2)) {
      recs.push({
        id: `funnel-${nom.name}-${num.name}`,
        kind: "funnel",
        title: `${num.name} funnel by ${nom.name}`,
        subtitle: "funnel — stage conversion",
        score: 64,
        spec: {},
        xField: nom.name,
        yField: num.name,
        colorField: null,
      });
    }
  }

  // --- PARALLEL: 3+ numeric axes ---
  if (numCols.length >= 3) {
    const axes = numCols.slice(0, 6);
    const groupCol = nomCols.find(c => c.distinct_count >= 2 && c.distinct_count <= 10) ?? null;
    recs.push({
      id: `parallel-${axes.map(c => c.name).join("-")}`,
      kind: "parallel",
      title: `Parallel: ${axes.map(c => c.name).join(", ")}`,
      subtitle: groupCol ? `profiles by ${groupCol.name}` : "parallel coordinates",
      score: 61,
      spec: {},
      xField: axes[0].name,
      yField: axes[1].name,
      colorField: groupCol?.name ?? null,
    });
  }

  // --- TREEMAP: nominal × numeric (part-of-whole rectangles) ---
  for (const nom of nomCols.slice(0, 3)) {
    if (nom.distinct_count < 3 || nom.distinct_count > 30) continue;
    for (const num of numCols.slice(0, 2)) {
      const colorCol = nomCols.find(c => c.name !== nom.name && c.distinct_count >= 2 && c.distinct_count <= 10) ?? null;
      recs.push({
        id: `treemap-${nom.name}-${num.name}`,
        kind: "treemap",
        title: `${num.name} by ${nom.name}`,
        subtitle: colorCol ? `nested by ${colorCol.name}` : "treemap",
        score: 64,
        spec: {},
        xField: nom.name,
        yField: num.name,
        colorField: colorCol?.name ?? null,
      });
    }
  }

  // --- SUNBURST: nominal × numeric (radial hierarchy) ---
  for (const nom of nomCols.slice(0, 3)) {
    if (nom.distinct_count < 3 || nom.distinct_count > 20) continue;
    const innerCol = nomCols.find(c => c.name !== nom.name && c.distinct_count >= 2 && c.distinct_count <= 8) ?? null;
    for (const num of numCols.slice(0, 2)) {
      recs.push({
        id: `sunburst-${nom.name}-${num.name}`,
        kind: "sunburst",
        title: `${num.name} by ${nom.name}`,
        subtitle: innerCol ? `inner: ${innerCol.name}` : "sunburst",
        score: 58,
        spec: {},
        xField: nom.name,
        yField: num.name,
        colorField: innerCol?.name ?? null,
      });
    }
  }

  // --- CHOROPLETH: region-like columns × numeric (real polygon map) ---
  const geoCol = nomCols.find(c => isGeoRegionField(c.name) && c.distinct_count >= 3);
  if (geoCol) {
    for (const num of numCols.slice(0, 2)) {
      recs.push({
        id: `choropleth-${geoCol.name}-${num.name}`,
        kind: "choropleth",
        title: `${num.name} by ${geoCol.name}`,
        subtitle: `filled map — ${geoCol.name}`,
        score: 78,
        spec: {},
        xField: geoCol.name,
        yField: num.name,
        colorField: null,
      });
    }
  }

  // --- FORCE BUBBLE: nominal × numeric (packed circles) ---
  for (const nom of nomCols.slice(0, 3)) {
    if (nom.distinct_count < 3 || nom.distinct_count > 40) continue;
    for (const num of numCols.slice(0, 2)) {
      const colorCol = nomCols.find(c => c.name !== nom.name && c.distinct_count >= 2 && c.distinct_count <= 12) ?? null;
      recs.push({
        id: `forceBubble-${nom.name}-${num.name}`,
        kind: "forceBubble",
        title: `${num.name} by ${nom.name}`,
        subtitle: "packed circles",
        score: 63,
        spec: {},
        xField: nom.name,
        yField: num.name,
        colorField: colorCol?.name ?? null,
      });
    }
  }

  // --- SANKEY / NETWORK / ARC: two nominals (A → B, count or sum) ---
  for (let i = 0; i < nomCols.length && i < 3; i++) {
    for (let j = i + 1; j < nomCols.length && j < 4; j++) {
      const a = nomCols[i], b = nomCols[j];
      if (a.distinct_count < 2 || a.distinct_count > 20 || b.distinct_count < 2 || b.distinct_count > 20) continue;
      const weight = numCols.length > 0 ? numCols[0].name : null;
      recs.push({
        id: `sankey-${a.name}-${b.name}`,
        kind: "sankey",
        title: `${a.name} → ${b.name}`,
        subtitle: "flow between categories",
        score: 74,
        spec: {},
        xField: a.name,
        yField: weight,
        colorField: b.name,
      });
      recs.push({
        id: `network-${a.name}-${b.name}`,
        kind: "network",
        title: `${a.name} ↔ ${b.name}`,
        subtitle: "force-directed network",
        score: 73,
        spec: {},
        xField: a.name,
        yField: weight,
        colorField: b.name,
      });
      recs.push({
        id: `arcDiagram-${a.name}-${b.name}`,
        kind: "arcDiagram",
        title: `${a.name} → ${b.name}`,
        subtitle: "arc diagram",
        score: 72,
        spec: {},
        xField: a.name,
        yField: weight,
        colorField: b.name,
      });
    }
  }

  // Sort by score (with local viz preference boost), then diversify so Suggest / rail aren't 20 near-identical bars
  // Sprinkle creative odd charts when the schema can support them
  const oddKindsShuffle = [...ODD_CHART_KIND_OPTIONS.map((o) => o.value)].sort(() => recRandom() - 0.5);
  for (const ok of oddKindsShuffle.slice(0, 8)) {
    if (!oddChartDataSupport(columns, ok).ok) continue;
    const enc = getOddRandomEncoding(columns, ok);
    if (!enc) continue;
    const rec = buildOddChartRec(ok, columns, enc.xField, enc.yField, enc.colorField, name, {
      sizeField: enc.sizeField,
    });
    if (rec) {
      rec.score = 58 + Math.floor(recRandom() * 12);
      recs.push(rec);
    }
  }

  // Three usable dimensions → offer the rows × columns × depth data cube
  const cubeRec = suggestDataCubeRec(columns, 66 + Math.floor(recRandom() * 10));
  if (cubeRec) recs.push(cubeRec);

  // Sprinkle geography charts (maps / globe) when lat/lon columns exist
  const hasLonLat = columnsHaveLatLon(columns);
  if (hasLonLat) {
    const geoKindsShuffle = [...GEO_MAP_KIND_OPTIONS.map((o) => o.value)].sort(() => recRandom() - 0.5);
    let geoAdded = 0;
    for (const gk of geoKindsShuffle) {
      if (geoAdded >= 4) break;
      if (!geoMapDataSupport(columns, gk).ok) continue;
      const enc = getGeoMapRandomEncoding(columns, gk);
      if (!enc) continue;
      const rec = buildGeoMapRec(gk, columns, enc.xField, enc.yField, enc.colorField, {
        sizeField: enc.sizeField,
        score: 76 + Math.floor(recRandom() * 12),
      });
      if (rec) {
        recs.push(rec);
        geoAdded += 1;
      }
    }
  }

  const model = prefs !== undefined ? prefs : getCachedVizPreferences();
  const boosted = applyPreferenceBoosts(recs, model, columns);
  // Facet / Top N / Compare Y variants for the suggestion rail + story picker
  const withExtras = expandRecommendationsWithExtras(boosted, columns);
  return diversifyRecommendations(withExtras, 72);
}
