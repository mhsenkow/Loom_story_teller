"use client";

import { useState, useCallback, useMemo, useEffect, useRef, useId, type ReactNode, type DragEvent } from "react";
import { formatVegaSpecJson } from "@/lib/vegaSpecDisplay";
import { defaultAppLookSettings, emptyChartVisualOverrides } from "@/lib/lookSettingsDefaults";
import { clampSmartFloat, clampSmartInt, SMART_TOP_N, SMART_Z } from "@/lib/smartInputClamp";
import { useIsMobile, useMobileLiveEdit, MOBILE_LIVE_EDIT_SHEET } from "@/lib/useMediaQuery";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { clearPersistedPreferences } from "@/lib/persist";
import { Button } from "@/components/ui/Button";
import { WorkspaceBackupControls } from "@/components/WorkspaceBackupControls";
import { useShallow } from "zustand/react/shallow";
import { useLoomStore, type PanelTab, type ChartVisualOverrides, type AppTheme, type FontScale } from "@/lib/store";
import { formatNumber } from "@/lib/format";
import { ChartKindPicker } from "@/components/ChartKindPicker";
import {
  AXIS_LABEL_COLOR_SWATCHES,
  AXIS_LINE_COLOR_SWATCHES,
  COLOR_PALETTES,
  palettesGrouped,
  resolveChartColors,
  type PaletteKind,
} from "@/lib/chartPalettes";
import {
  THEMES,
  THEME_LABEL,
  UI_CHROMES,
  UI_CHROME_LABEL,
  APP_FONTS,
  APP_FONT_LABEL,
  FACES_SOURCES,
  VISUAL_PRESETS,
  VISUAL_PRESET_BLURB,
  shuffleVisualOverrides,
  VISUAL_SHUFFLE_SECTIONS,
  type VisualPresetId,
  type VisualShuffleLocks,
  type VisualShuffleSection,
  normalizeTheme,
  type LookTheme,
  type UiChrome,
  type AppFont,
  type FacesSource,
} from "@/lib/lookSystem";
import {
  createChartRec,
  fitEncodingToKind,
  Y_AGGREGATE_OPTIONS,
  getRecommendationReason,
  getRandomEncoding,
  applyEncodingLocks,
  chartKindDataSupport,
  tryBuildRandomChartRec,
  randomEncodingToExtra,
  recommendStorySequence,
  recommendStreamStory,
  type ChartKind,
  type YAggregateOption,
  type EncodingShuffleLocks,
} from "@/lib/recommendations";
import {
  computeDataQualityHints,
  formatChartAggregationSummary,
  chartCapabilities,
  encodingChannelLabels,
  CHART_LAYOUT_DIRECTIONS,
  CHART_Y_SCALE_OPTIONS,
  type ChartLayoutDirection,
  type ChartYScaleOption,
} from "@/lib/chartSupport";
import {
  chromeDomId,
  chromeSectionFor,
  type ChartChromeTarget,
} from "@/lib/chartChromeLink";
import { CHART_TOOLTIP_MODES, type ChartTooltipMode } from "@/lib/chartTooltipMode";
import {
  resolveDataProvenance,
  provenanceKindLabel,
  type DataProvenance,
} from "@/lib/dataProvenance";
import { TOP_N_OPTIONS, clampTopN, DEFAULT_TOP_N } from "@/lib/chartFacets";
import {
  CHART_TIME_RANGES,
  applyChartTimeWindow,
  chartTimeRangeOptions,
  pickDefaultTimeField,
  temporalColumnNames,
  timeColumnSpanMs,
  type ChartTimeRange,
} from "@/lib/chartTime";
import {
  runAnomaly,
  runForecast,
  runTrend,
  runReferenceLines,
  runClustering,
  runCorrelationMatrix,
  type AnomalyMethod,
} from "@/lib/smartAnalytics";
import { corrCellInk, corrFillT, sampleCorrDiverging, DEFAULT_CORR_DIVERGING } from "@/lib/corrMatrixStyle";
import { queryResultToCsv, downloadCsv } from "@/lib/csvExport";
import { buildDashboardMicrositeHtml } from "@/lib/dashboardMicrosite";
import { exportDashboardMicrosite, streamSnapshot, isDesktop, isTauri, openExternalUrl } from "@/lib/tauri";
import { isNumericColumnType } from "@/lib/dataCubeSchema";
import { captureStoryDashboardPreviews } from "@/lib/captureStoryPreviews";
import {
  SOCIAL_PRESETS,
  getSocialPreset,
  buildSocialCaption,
  shareOrDownloadFile,
  copyTextToClipboard,
  slugifyFilename,
  publishStoryToWorker,
  recordCanvasVideo,
} from "@/lib/socialExport";
import { downloadBlob } from "@/lib/zipStore";

export default function SmartTab() {
  const anomalyColId = useId();
  const anomalyMethodId = useId();
  const anomalyThresholdId = useId();
  const activeChart = useLoomStore((s) => s.activeChart);
  const sampleRows = useLoomStore((s) => s.sampleRows);
  const columnStats = useLoomStore((s) => s.columnStats);
  const setSmartResults = useLoomStore((s) => s.setSmartResults);
  const smartResults = useLoomStore((s) => s.smartResults);
  const setTableFilterRowIndices = useLoomStore((s) => s.setTableFilterRowIndices);
  const setToast = useLoomStore((s) => s.setToast);
  const [anomalyCol, setAnomalyCol] = useState("");
  const [anomalyMethod, setAnomalyMethod] = useState<AnomalyMethod>("z-score");
  const [anomalyThreshold, setAnomalyThreshold] = useState(2.5);
  const [forecastHorizon, setForecastHorizon] = useState(5);
  const [forecastMethod, setForecastMethod] = useState<"linear" | "moving-avg">("linear");
  const [refCol, setRefCol] = useState("");
  const [refAxis, setRefAxis] = useState<"x" | "y">("y");
  const [refTypes, setRefTypes] = useState<("mean" | "median" | "q1" | "q3")[]>(["mean", "median"]);
  const [clusterK, setClusterK] = useState(3);

  const columns = columnStats?.map((c) => c.name) ?? [];
  const numericCols = columnStats?.filter((c) => isNumericColumnType(c.data_type ?? "")).map((c) => c.name) ?? [];
  const rows = sampleRows?.rows ?? [];
  const canRun = rows.length > 0 && columns.length > 0 && activeChart;

  const runAnomalyCard = useCallback(() => {
    if (!canRun || !anomalyCol) return;
    const result = runAnomaly(rows, anomalyCol, columns, anomalyMethod, anomalyThreshold);
    if (result) setSmartResults((prev) => ({ ...prev, anomaly: result }));
  }, [canRun, anomalyCol, anomalyMethod, anomalyThreshold, rows, columns, setSmartResults]);

  const runForecastCard = useCallback(() => {
    if (!canRun || !activeChart?.yField) return;
    const result = runForecast(
      rows,
      activeChart.xField,
      activeChart.yField,
      columns,
      forecastHorizon,
      forecastMethod,
    );
    if (result) setSmartResults((prev) => ({ ...prev, forecast: result }));
  }, [canRun, activeChart, forecastHorizon, forecastMethod, rows, columns, setSmartResults]);

  const runTrendCard = useCallback(() => {
    if (!canRun || !activeChart?.yField) return;
    const result = runTrend(rows, activeChart.xField, activeChart.yField, columns);
    if (result) setSmartResults((prev) => ({ ...prev, trend: result }));
  }, [canRun, activeChart, rows, columns, setSmartResults]);

  const runRefLinesCard = useCallback(() => {
    if (!canRun || !refCol) return;
    const result = runReferenceLines(rows, refCol, columns, refAxis, refTypes);
    if (result) setSmartResults((prev) => ({ ...prev, referenceLines: result }));
  }, [canRun, refCol, refAxis, refTypes, rows, columns, setSmartResults]);

  const runClusteringCard = useCallback(() => {
    if (!canRun || !activeChart?.yField) return;
    const result = runClustering(
      rows,
      activeChart.xField,
      activeChart.yField,
      columns,
      clusterK,
    );
    if (result) setSmartResults((prev) => ({ ...prev, clusters: result }));
  }, [canRun, activeChart, clusterK, rows, columns, setSmartResults]);

  const clearSmart = useCallback(() => {
    setSmartResults(null);
  }, [setSmartResults]);

  if (!activeChart) {
    return (
      <div className="p-4 text-center text-sm text-loom-muted">
        Select a chart to run smart analytics. Results visualize on the chart.
      </div>
    );
  }

  return (
    <div className="p-3 space-y-4">
      <p className="text-2xs text-loom-muted">
        Run analytics below; results appear on the chart. Switch to Chart view to see them.
      </p>
      <button
        type="button"
        onClick={clearSmart}
        className="text-2xs py-1 px-2 rounded border border-loom-border text-loom-muted hover:border-loom-accent hover:text-loom-text"
      >
        Clear all overlays
      </button>

      {/* Anomaly detection */}
      <div className="loom-card p-2 space-y-2">
        <p className="text-xs font-semibold text-loom-text">Anomaly detection</p>
        <p className="text-2xs text-loom-muted">Highlight outliers in a numeric column (table + chart).</p>
        <div>
          <label htmlFor={anomalyColId} className="block text-2xs text-loom-muted mb-0.5">Column</label>
          <select
            id={anomalyColId}
            value={anomalyCol}
            onChange={(e) => setAnomalyCol(e.target.value)}
            className="loom-input w-full text-xs py-1"
          >
            <option value="">Select…</option>
            {numericCols.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={anomalyMethodId} className="block text-2xs text-loom-muted mb-0.5">Method</label>
          <select
            id={anomalyMethodId}
            value={anomalyMethod}
            onChange={(e) => setAnomalyMethod(e.target.value as AnomalyMethod)}
            className="loom-input w-full text-xs py-1"
          >
            <option value="z-score">Z-score</option>
            <option value="iqr">IQR</option>
            <option value="mad">MAD</option>
          </select>
        </div>
        {(anomalyMethod === "z-score" || anomalyMethod === "mad") && (
          <div>
            <label htmlFor={anomalyThresholdId} className="block text-2xs text-loom-muted mb-0.5">Threshold</label>
            <input
              id={anomalyThresholdId}
              type="number"
              min={1}
              max={5}
              step={0.5}
              value={anomalyThreshold}
              onChange={(e) => setAnomalyThreshold(clampSmartFloat(Number(e.target.value), SMART_Z))}
              className="loom-input w-full text-xs py-1"
            />
          </div>
        )}
        <button
          type="button"
          onClick={runAnomalyCard}
          disabled={!anomalyCol || rows.length === 0}
          title={!anomalyCol ? "Pick a column first" : rows.length === 0 ? "No rows loaded" : undefined}
          className="w-full px-2 py-1.5 text-xs font-medium text-loom-text bg-loom-accent/20 border border-loom-accent rounded hover:bg-loom-accent/30"
        >
          Run
        </button>
        {smartResults?.anomaly?.rowIndices && smartResults.anomaly.rowIndices.length > 0 && (
          <button
            type="button"
            onClick={() => setTableFilterRowIndices(smartResults.anomaly!.rowIndices)}
            className="w-full px-2 py-1 text-2xs text-loom-muted border border-loom-border rounded hover:bg-loom-elevated"
          >
            Filter table to anomalies
          </button>
        )}
      </div>

      {/* Forecast */}
      <div className="loom-card p-2 space-y-2">
        <p className="text-xs font-semibold text-loom-text">Forecast</p>
        <p className="text-2xs text-loom-muted">Extend the chart with predicted points (linear or moving avg).</p>
        <div>
          <label className="block text-2xs text-loom-muted mb-0.5">Horizon (points)</label>
          <input
            type="number"
            min={1}
            max={50}
            value={forecastHorizon}
            onChange={(e) => setForecastHorizon(Number(e.target.value))}
            className="loom-input w-full text-xs py-1"
          />
        </div>
        <div>
          <label className="block text-2xs text-loom-muted mb-0.5">Method</label>
          <select
            value={forecastMethod}
            onChange={(e) => setForecastMethod(e.target.value as "linear" | "moving-avg")}
            className="loom-input w-full text-xs py-1"
          >
            <option value="linear">Linear</option>
            <option value="moving-avg">Moving average</option>
          </select>
        </div>
        <button
          type="button"
          onClick={runForecastCard}
          disabled={!activeChart.yField || rows.length === 0}
          className="w-full px-2 py-1.5 text-xs font-medium text-loom-text bg-loom-accent/20 border border-loom-accent rounded hover:bg-loom-accent/30"
        >
          Run
        </button>
      </div>

      {/* Trend line */}
      <div className="loom-card p-2 space-y-2">
        <p className="text-xs font-semibold text-loom-text">Trend line</p>
        <p className="text-2xs text-loom-muted">Linear regression over X × Y. Shows on scatter/line.</p>
        <button
          type="button"
          onClick={runTrendCard}
          disabled={!activeChart.yField || rows.length < 2}
          className="w-full px-2 py-1.5 text-xs font-medium text-loom-text bg-loom-accent/20 border border-loom-accent rounded hover:bg-loom-accent/30"
        >
          Run
        </button>
      </div>

      {/* Reference lines */}
      <div className="loom-card p-2 space-y-2">
        <p className="text-xs font-semibold text-loom-text">Reference lines</p>
        <p className="text-2xs text-loom-muted">Mean, median, Q1, Q3 on an axis.</p>
        <div>
          <label className="block text-2xs text-loom-muted mb-0.5">Column</label>
          <select value={refCol} onChange={(e) => setRefCol(e.target.value)} className="loom-input w-full text-xs py-1">
            <option value="">Select…</option>
            {numericCols.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-2xs text-loom-muted mb-0.5">Axis</label>
          <select value={refAxis} onChange={(e) => setRefAxis(e.target.value as "x" | "y")} className="loom-input w-full text-xs py-1">
            <option value="x">X</option>
            <option value="y">Y</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-1">
          {(["mean", "median", "q1", "q3"] as const).map((t) => (
            <label key={t} className="flex items-center gap-1 text-2xs text-loom-muted cursor-pointer">
              <input
                type="checkbox"
                checked={refTypes.includes(t)}
                onChange={(e) =>
                  setRefTypes((prev) =>
                    e.target.checked ? [...prev, t] : prev.filter((x) => x !== t),
                  )
                }
                className="rounded border-loom-border accent-loom-accent"
              />
              {t.toUpperCase()}
            </label>
          ))}
        </div>
        <button
          type="button"
          onClick={runRefLinesCard}
          disabled={!refCol || refTypes.length === 0 || rows.length === 0}
          className="w-full px-2 py-1.5 text-xs font-medium text-loom-text bg-loom-accent/20 border border-loom-accent rounded hover:bg-loom-accent/30"
        >
          Run
        </button>
      </div>

      {/* Clustering */}
      <div className="loom-card p-2 space-y-2">
        <p className="text-xs font-semibold text-loom-text">Clustering</p>
        <p className="text-2xs text-loom-muted">Group points by position (k-means style). Colors by cluster on scatter.</p>
        <div>
          <label className="block text-2xs text-loom-muted mb-0.5">Clusters (k)</label>
          <input
            type="number"
            min={2}
            max={8}
            value={clusterK}
            onChange={(e) => setClusterK(Number(e.target.value))}
            className="loom-input w-full text-xs py-1"
          />
        </div>
        <button
          type="button"
          onClick={runClusteringCard}
          disabled={!activeChart.yField || rows.length < clusterK}
          className="w-full px-2 py-1.5 text-xs font-medium text-loom-text bg-loom-accent/20 border border-loom-accent rounded hover:bg-loom-accent/30"
        >
          Run
        </button>
      </div>

      {/* Correlation matrix */}
      <div className="loom-card p-2 space-y-2">
        <p className="text-xs font-semibold text-loom-text">Correlation matrix</p>
        <p className="text-2xs text-loom-muted">Pairwise Pearson r across numeric columns.</p>
        <button
          type="button"
          disabled={numericCols.length < 2}
          onClick={() => {
            const corr = runCorrelationMatrix(rows, columns, 8);
            if (!corr) {
              setToast("Need at least two numeric columns");
              return;
            }
            setSmartResults((prev) => ({ ...prev, correlation: corr }));
            setToast("Correlation matrix computed");
          }}
          className="w-full px-2 py-1.5 text-xs font-medium text-loom-text bg-loom-accent/20 border border-loom-accent rounded hover:bg-loom-accent/30"
        >
          Compute
        </button>
        {(smartResults as Record<string, unknown>)?.correlation ? (() => {
          const corr = (smartResults as Record<string, unknown>).correlation as { columns: string[]; matrix: number[][] };
          return (
            <div className="overflow-x-auto mt-1">
              <table className="text-2xs font-mono border-collapse">
                <thead>
                  <tr>
                    <th className="px-1 py-0.5" />
                    {corr.columns.map((c) => <th key={c} className="px-1 py-0.5 text-loom-muted truncate max-w-[48px]">{c.slice(0, 6)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {corr.columns.map((c, i) => (
                    <tr key={c}>
                      <td className="px-1 py-0.5 text-loom-muted truncate max-w-[48px]">{c.slice(0, 6)}</td>
                      {corr.matrix[i].map((v, j) => {
                        const fill = sampleCorrDiverging(DEFAULT_CORR_DIVERGING, corrFillT(v));
                        const ink = corrCellInk(v, fill, "var(--loom-surface)", "var(--loom-text)");
                        return (
                          <td
                            key={j}
                            className="px-1 py-0.5 text-center"
                            style={{ background: fill, color: ink }}
                            title={`${corr.columns[i]} × ${corr.columns[j]}: ${Number.isFinite(v) ? v.toFixed(3) : "n/a"}`}
                          >
                            {Number.isFinite(v) ? v.toFixed(2) : "—"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })() : null}
      </div>

      {/* AI / Vision (future) */}
      <div className="loom-card p-2 space-y-2 opacity-80">
        <p className="text-xs font-semibold text-loom-text">Chart insight (AI)</p>
        <p className="text-2xs text-loom-muted">
          Future: use a vision model (e.g. Ollama with LLaVA) to &quot;look&quot; at the chart — describe it, suggest anomalies, or answer questions.
        </p>
        <button type="button" disabled className="w-full px-2 py-1.5 text-xs text-loom-muted border border-loom-border rounded cursor-not-allowed">
          Coming soon
        </button>
      </div>
    </div>
  );
}
