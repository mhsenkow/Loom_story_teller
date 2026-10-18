"use client";

import { useState, useCallback, useId } from "react";
import { useLoomStore } from "@/lib/store";
import { runAnomaly, type AnomalyMethod, runTrend, runReferenceLines, runClustering, runCorrelationMatrix } from "@/lib/smartAnalytics";
import { isNumericColumnType } from "@/lib/dataCubeSchema";
import { corrCellInk, corrFillT, sampleCorrDiverging, DEFAULT_CORR_DIVERGING } from "@/lib/corrMatrixStyle";
import { clampSmartFloat, SMART_Z } from "@/lib/smartInputClamp";
import AnalysisCards from "./AnalysisCards";

export default function SmartTab() {
  const anomalyColId = useId();
  const anomalyMethodId = useId();
  const anomalyThresholdId = useId();
  const [anomalyCol, setAnomalyCol] = useState("");
  const [anomalyMethod, setAnomalyMethod] = useState<AnomalyMethod>("z-score");
  const [anomalyThreshold, setAnomalyThreshold] = useState(2.5);
  const setTableFilterRowIndices = useLoomStore(s => s.setTableFilterRowIndices);
  const activeChart = useLoomStore((s) => s.activeChart);
  const sampleRows = useLoomStore((s) => s.sampleRows);
  const columnStats = useLoomStore((s) => s.columnStats);
  const setSmartResults = useLoomStore((s) => s.setSmartResults);
  const smartResults = useLoomStore((s) => s.smartResults);
  const setToast = useLoomStore((s) => s.setToast);
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
    const result = runAnomaly(rows, anomalyCol, columns, anomalyMethod, anomalyMethod === "iqr" ? 1.5 : anomalyThreshold);
    if (result) setSmartResults((prev) => ({ ...prev, anomaly: result }));
  }, [canRun, anomalyCol, anomalyMethod, anomalyThreshold, rows, columns, setSmartResults]);

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
      <AnalysisCards key={activeChart.id} />
      <details className="space-y-3"><summary className="text-sm font-medium cursor-pointer">More analysis tools</summary>
      <button type="button" className="loom-btn-ghost text-xs" onClick={clearSmart}>Clear all analysis and events</button>
      {/* Anomaly detection */}
      <div className="loom-card p-2 space-y-2">
        <p className="text-xs font-semibold text-loom-text">Column outliers</p>
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
                    {corr.columns.map((c) => <th key={c} scope="col" title={c} className="px-2 py-1 text-loom-label whitespace-normal break-words min-w-[6rem] max-w-[10rem]">{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {corr.columns.map((c, i) => (
                    <tr key={c}>
                      <th scope="row" title={c} className="px-2 py-1 text-left font-medium text-loom-label whitespace-normal break-words min-w-[6rem] max-w-[10rem]">{c}</th>
                      {corr.matrix[i].map((v, j) => {
                        const valid = Number.isFinite(v);
                        const fill = valid ? sampleCorrDiverging(DEFAULT_CORR_DIVERGING, corrFillT(v)) : "var(--loom-elevated)";
                        const ink = valid ? corrCellInk(v, fill, "var(--loom-surface)", "var(--loom-text)") : "var(--loom-label)";
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

      </details>
    </div>
  );
}
