// =================================================================
// Loom — Vega-Lite Spec Generator
// =================================================================
// Generates Vega-Lite JSON specs from column metadata.
// These specs define the chart *logic* (scales, axes, marks).
// The actual rendering is handled by WebGPU, not Vega's own renderer.
//
// Vega-Lite is the "brain" — WebGPU is the "muscle."
// =================================================================

import type { ColumnInfo } from "./store";

const CHART_COLORS = [
  "#6c5ce7", "#00d68f", "#ff6b6b", "#ffd93d",
  "#00b4d8", "#e77c5c", "#a29bfe", "#74b9ff",
];

interface VegaEncoding {
  field: string;
  type: "quantitative" | "nominal" | "ordinal" | "temporal";
  [key: string]: unknown;
}

function inferVegaType(dataType: string): VegaEncoding["type"] {
  const t = dataType.toUpperCase();
  if (["INTEGER", "BIGINT", "FLOAT", "DOUBLE", "DECIMAL", "REAL", "HUGEINT", "TINYINT", "SMALLINT"].some(n => t.includes(n))) {
    return "quantitative";
  }
  if (["DATE", "TIMESTAMP", "TIME"].some(n => t.includes(n))) {
    return "temporal";
  }
  return "nominal";
}

export function generateScatterSpec(
  columns: ColumnInfo[],
  tableName: string,
): object | null {
  const numericCols = columns.filter(c => inferVegaType(c.data_type) === "quantitative");
  if (numericCols.length < 2) return null;

  const xCol = numericCols[0];
  const yCol = numericCols[1];
  const colorCol = columns.find(c => inferVegaType(c.data_type) === "nominal") ?? null;

  const encoding: Record<string, VegaEncoding> = {
    x: { field: xCol.name, type: "quantitative" },
    y: { field: yCol.name, type: "quantitative" },
  };

  if (colorCol) {
    encoding.color = {
      field: colorCol.name,
      type: "nominal",
      scale: { range: CHART_COLORS },
    };
  }

  return {
    $schema: "https://vega.github.io/schema/vega-lite/v5.json",
    title: `${tableName} — Scatterplot`,
    mark: { type: "circle", opacity: 0.7, size: 8 },
    encoding,
    width: "container",
    height: "container",
    config: {
      background: "transparent",
      axis: {
        labelColor: "#6b6b78",
        titleColor: "#e8e8ec",
        gridColor: "#2a2a30",
        domainColor: "#2a2a30",
      },
      title: {
        color: "#e8e8ec",
        fontSize: 14,
        fontWeight: 500,
      },
    },
  };
}

export function generateBarSpec(
  columns: ColumnInfo[],
  tableName: string,
): object | null {
  const nominalCol = columns.find(c => inferVegaType(c.data_type) === "nominal");
  const numericCol = columns.find(c => inferVegaType(c.data_type) === "quantitative");
  if (!nominalCol || !numericCol) return null;

  return {
    $schema: "https://vega.github.io/schema/vega-lite/v5.json",
    title: `${tableName} — Bar Chart`,
    mark: { type: "bar", cornerRadiusTopLeft: 3, cornerRadiusTopRight: 3 },
    encoding: {
      x: { field: nominalCol.name, type: "nominal", sort: "-y" },
      y: {
        field: numericCol.name,
        type: "quantitative",
        aggregate: "sum",
      },
      color: { value: CHART_COLORS[0] },
    },
    width: "container",
    height: "container",
    config: {
      background: "transparent",
      axis: {
        labelColor: "#6b6b78",
        titleColor: "#e8e8ec",
        gridColor: "#2a2a30",
        domainColor: "#2a2a30",
      },
    },
  };
}

export function generateHistogramSpec(
  columns: ColumnInfo[],
  tableName: string,
): object | null {
  const numericCol = columns.find(c => inferVegaType(c.data_type) === "quantitative");
  if (!numericCol) return null;

  return {
    $schema: "https://vega.github.io/schema/vega-lite/v5.json",
    title: `${tableName} — Distribution of ${numericCol.name}`,
    mark: { type: "bar", cornerRadiusTopLeft: 2, cornerRadiusTopRight: 2 },
    encoding: {
      x: { field: numericCol.name, type: "quantitative", bin: { maxbins: 40 } },
      y: { aggregate: "count", type: "quantitative" },
      color: { value: CHART_COLORS[0] },
    },
    width: "container",
    height: "container",
    config: {
      background: "transparent",
      axis: {
        labelColor: "#6b6b78",
        titleColor: "#e8e8ec",
        gridColor: "#2a2a30",
        domainColor: "#2a2a30",
      },
    },
  };
}

export function autoSpec(columns: ColumnInfo[], tableName: string): object | null {
  return (
    generateScatterSpec(columns, tableName) ??
    generateBarSpec(columns, tableName) ??
    generateHistogramSpec(columns, tableName)
  );
}
