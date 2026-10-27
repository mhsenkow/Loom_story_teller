// Scatter point packing for WebGPU upload and axes overlay (LOOM-141).
// @ts-nocheck
import { useCallback } from "react";
import { groupChartChannels } from "@/lib/channelGroups";
import { chartNumber } from "@/lib/chartNumbers";
import { gpuCategoryIndex } from "@/lib/gpuPalette";
import type { GPUScatterPoint } from "@/lib/webgpu";

export type ScatterDataBounds = {
  points: GPUScatterPoint[];
  rowIndices: number[];
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
};

export function getEffectiveScatterBounds(
  sd: { xMin: number; xMax: number; yMin: number; yMax: number },
  view: { scale: number; panX: number; panY: number },
) {
  const { scale, panX, panY } = view;
  const cx = (sd.xMin + sd.xMax) / 2;
  const cy = (sd.yMin + sd.yMax) / 2;
  const halfX = (sd.xMax - sd.xMin) / 2;
  const halfY = (sd.yMax - sd.yMin) / 2;
  return {
    xMin: cx + panX - halfX / scale,
    xMax: cx + panX + halfX / scale,
    yMin: cy + panY - halfY / scale,
    yMax: cy + panY + halfY / scale,
  };
}

type ChartSampleRows = {
  rows: unknown[][];
  columns: string[];
  rowSourceIndices?: number[];
} | null | undefined;

type ActiveChartForScatter = {
  spec?: unknown;
  xField?: string;
  yField?: string;
  colorField?: string | null;
  sizeField?: string | null;
  yScale?: string;
  channelInvert?: { size?: boolean };
} | null;

export function extractScatterDataFromRows(
  chartSampleRows: ChartSampleRows,
  activeChart: ActiveChartForScatter,
): ScatterDataBounds | null {
  if (!chartSampleRows || !activeChart) return null;
  const spec = activeChart.spec as Record<string, unknown>;
  const encoding = spec.encoding as Record<string, { field: string }> | undefined;
  const xFieldName = encoding?.x?.field ?? activeChart.xField;
  const yFieldName = encoding?.y?.field ?? activeChart.yField;
  if (!xFieldName || !yFieldName) return null;

  const grouped = groupChartChannels(chartSampleRows.rows, chartSampleRows.columns, activeChart);
  const xIdx = grouped.columns.indexOf(xFieldName);
  const yIdx = grouped.columns.indexOf(yFieldName);
  const colorField =
    grouped.colorField ??
    (encoding?.color as { field?: string } | undefined)?.field ??
    activeChart.colorField ??
    undefined;
  const sizeField = (encoding?.size as { field?: string } | undefined)?.field ?? activeChart.sizeField;
  const cIdx = colorField ? grouped.columns.indexOf(colorField) : -1;
  const sizeIdx = sizeField ? grouped.columns.indexOf(sizeField) : -1;
  if (xIdx === -1 || yIdx === -1) return null;

  let sizeMin = Infinity,
    sizeMax = -Infinity;
  if (sizeIdx >= 0) {
    for (const row of grouped.rows) {
      const v = chartNumber(row[sizeIdx]);
      if (!isNaN(v)) {
        sizeMin = Math.min(sizeMin, v);
        sizeMax = Math.max(sizeMax, v);
      }
    }
    if (sizeMin === sizeMax) {
      sizeMin = sizeMin - 1;
      sizeMax = sizeMax + 1;
    }
  }
  const sizeRange = sizeMax - sizeMin || 1;

  const catMap = new Map<string, number>();
  let nextCat = 0;
  const points: GPUScatterPoint[] = [];
  const rowIndices: number[] = [];
  let xMin = Infinity,
    xMax = -Infinity,
    yMin = Infinity,
    yMax = -Infinity;

  const rowSource = chartSampleRows.rowSourceIndices;
  grouped.rows.forEach((row, rowIndex) => {
    const x = chartNumber(row[xIdx]),
      y = chartNumber(row[yIdx]);
    if (isNaN(x) || isNaN(y) || (activeChart.yScale === "log" && y <= 0)) return;
    let cat = 0;
    if (cIdx >= 0) {
      const k = String(row[cIdx]);
      if (!catMap.has(k)) {
        catMap.set(k, nextCat++);
      }
      cat = catMap.get(k)!;
    }
    let size: number | undefined;
    if (sizeIdx >= 0) {
      const s = chartNumber(row[sizeIdx]);
      size = isNaN(s)
        ? undefined
        : activeChart.channelInvert?.size
          ? 1 - (s - sizeMin) / sizeRange
          : (s - sizeMin) / sizeRange;
    }
    points.push({ x, y, category: cat, size });
    rowIndices.push(rowSource?.[rowIndex] ?? rowIndex);
    xMin = Math.min(xMin, x);
    xMax = Math.max(xMax, x);
    yMin = Math.min(yMin, y);
    yMax = Math.max(yMax, y);
  });
  if (points.length === 0) return null;
  const distinct = catMap.size;
  if (distinct > 0) {
    for (let i = 0; i < points.length; i++) {
      points[i]!.category = gpuCategoryIndex(points[i]!.category, distinct);
    }
  }
  const xPad = (xMax - xMin) * 0.05 || 1;
  const yPad = (yMax - yMin) * 0.05 || 1;
  return { points, rowIndices, xMin: xMin - xPad, xMax: xMax + xPad, yMin: yMin - yPad, yMax: yMax + yPad };
}

export function useExtractScatterData(chartSampleRows: ChartSampleRows, activeChart: ActiveChartForScatter) {
  const extractScatterData = useCallback(
    (): ScatterDataBounds | null => extractScatterDataFromRows(chartSampleRows, activeChart),
    [chartSampleRows, activeChart],
  );
  return extractScatterData;
}
