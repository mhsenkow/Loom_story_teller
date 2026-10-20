// Outcome-first chart analysis controls; shared configuration stays in Zustand.
"use client";

import { useState, useMemo, type ReactNode } from "react";
import { ANOMALY_SOURCE, FORECAST_SOURCES } from "@/lib/timeSeriesAnalysisSource";
import { useShallow } from "zustand/react/shallow";
import { applyExplorerViewToRows } from "@/lib/explorerViewRows";
import { applyChartTimeWindow, resolveEffectiveTimeRec } from "@/lib/chartTime";
import { timeBuckets } from "@/lib/canvasCharts/axisHelpers";
import { buildXModel } from "@/lib/chartAxes";
import { useLoomStore } from "@/lib/store";
import { createChartMonitorDraft } from "@/lib/monitoring/chartBridge";
import { analysisScope, analysisUnavailable, FORECAST_METHOD_LABEL, type ForecastMethod, type TimeSeriesAnalysis } from "@/lib/timeSeriesAnalysis";
import { FocusCurtain } from "./FocusCurtain";
import { ForecastMethodList } from "./ForecastCurtain";

export function useAnalysisConfig() {
  const chart = useLoomStore(s => s.activeChart);
  const saved = useLoomStore(s => s.smartResults?.analysis);
  const setResults = useLoomStore(s => s.setSmartResults);
  const input = useLoomStore(useShallow(s => ({ sample: s.sampleRows, columnFilters: s.tableColumnFilters, filterRowIndices: s.tableFilterRowIndices, columnStats: s.columnStats, sortColumn: s.tableSortColumn, sortDir: s.tableSortDir, timeField: s.viewTimeField, timeWindow: s.viewTimeWindow })));
  const series = useMemo(() => {
    if (!input.sample || !chart) return { count: 0, kind: "band" as const };
    const { rows: source, columns } = input.sample;
    const view = applyExplorerViewToRows(source, columns, input);
    const rows = applyChartTimeWindow(view.rows, columns, resolveEffectiveTimeRec(input.timeWindow, input.timeField, chart)).rows;
    const xi = columns.indexOf(chart.xField), yi = columns.indexOf(chart.yField ?? "");
    const buckets = timeBuckets(rows, xi);
    const keys = [...new Set(rows.filter(r => yi < 0 || (r[yi] != null && r[yi] !== "" && Number.isFinite(Number(r[yi])))).map(buckets.keyOf))];
    return { count: keys.length, kind: buildXModel(keys).kind };
  }, [input, chart]);
  const scope = chart ? analysisScope(chart) : "";
  const config: TimeSeriesAnalysis = saved?.scope === scope ? saved : { scope };
  const update = (patch: Partial<TimeSeriesAnalysis>) => setResults(prev => ({ ...prev, analysis: { ...(prev?.analysis?.scope === scope ? prev.analysis : { scope }), ...patch } }));
  return { chart, config, update, series, unavailable: analysisUnavailable(chart) ?? (series.kind === "band" ? "Choose a date or numeric X axis to add analysis." : null) };
}

function AnalysisCard({ title, outcome, status, explained, onExplain, children, enabled, toggle, remove }: { title: string; outcome: string; status: string; explained: boolean; onExplain: () => void; children: ReactNode; enabled?: boolean; toggle?: () => void; remove?: () => void }) {
  return <section className="loom-card p-3 space-y-3">
    <div className="flex items-center gap-2">
      <h3 className="text-sm font-semibold flex-1">{title}</h3>
      <button type="button" className="loom-btn-ghost min-w-8 min-h-8" aria-label={`About ${title.toLowerCase()}`} aria-expanded={explained} onClick={onExplain}>ⓘ</button>
      {toggle && <button type="button" className="loom-btn-ghost text-xs min-h-8" aria-label={`${enabled ? "Hide" : "Show"} ${title.toLowerCase()}`} aria-pressed={enabled} onClick={toggle}>{enabled ? "Visible" : "Hidden"}</button>}
      {remove && <button type="button" className="loom-btn-ghost min-w-8 min-h-8" aria-label={`Remove ${title.toLowerCase()}`} onClick={remove}>×</button>}
    </div>
    <p className="text-sm text-loom-text">{outcome}</p>
    {children}
    <div className="border-t border-loom-border pt-2 space-y-1">
      <p className="text-2xs uppercase tracking-wider text-loom-muted">Complex analysis on the chart</p>
      <p className="text-xs text-loom-muted" role="status">{status}</p>
    </div>
  </section>;
}

export default function AnalysisCards() {
  const { chart, config, update, unavailable, series } = useAnalysisConfig();
  const [horizon, setHorizon] = useState(config.forecast?.horizon ?? 7);
  const [method, setMethod] = useState<ForecastMethod>(config.forecast?.method ?? "line");
  const [season, setSeason] = useState(config.forecast?.season ?? 12);
  const [window, setWindow] = useState(config.anomaly?.window ?? 10);
  const [threshold, setThreshold] = useState(config.anomaly?.threshold ?? 3.5);
  const [curtain, setCurtain] = useState<"forecast" | "anomaly" | null>(null);
  const isLiveFeed = useLoomStore((s) => !!s.selectedFile?.path.startsWith("stream://"));
  const setView = useLoomStore(s => s.setViewMode);
  const apply = (patch: Partial<TimeSeriesAnalysis>) => { update(patch); setView("chart"); };
  const clamp = (value: string, min: number, max: number) => Math.max(min, Math.min(max, Math.round(Number(value) || min)));
  const methodLabel = FORECAST_METHOD_LABEL[config.forecast?.method ?? method];
  const chooseMethod = (next: ForecastMethod) => {
    setMethod(next);
    if (config.forecast) update({ forecast: { ...config.forecast, method: next, season } });
  };
  const chooseSeason = (next: number) => {
    setSeason(next);
    if (config.forecast) update({ forecast: { ...config.forecast, method, season: next } });
  };
  return <div className="space-y-3">
    <div><h2 className="text-base font-semibold">Go beyond the line</h2><p className="text-xs text-loom-muted mt-1">Add a layer. Open the explanation when the method needs a closer look.</p></div>
    {unavailable && <p className="text-xs p-3 rounded border border-loom-border text-loom-muted">{unavailable}</p>}
    {!unavailable && <p className="text-xs text-loom-muted">Analyzing {chart?.yField ?? "row count"} over {chart?.xField}. {series.count} plotted points. Forecast needs 8; detection needs more points than its lookback.</p>}
    <AnalysisCard title="Forecast" outcome={config.forecast ? `${methodLabel} is the path on the chart.` : "See where this series could go next."} enabled={config.forecast?.enabled} explained={curtain === "forecast"} onExplain={() => setCurtain("forecast")}
      status={config.forecast ? unavailable || series.count < 8 ? "Paused · needs a supported chart with 8 plotted points" : `${config.forecast.enabled ? "On chart" : "Hidden"} · ${methodLabel} · ${config.forecast.horizon} future intervals` : `Next add uses ${methodLabel}`}
      toggle={config.forecast ? () => update({ forecast: { ...config.forecast!, enabled: !config.forecast!.enabled } }) : undefined}
      remove={config.forecast ? () => update({ forecast: undefined }) : undefined}>
      <label className="block text-xs text-loom-muted">Forecast ahead <span className="text-loom-text">· intervals</span><input aria-label="Forecast intervals" className="loom-input w-full mt-1" type="number" min={1} max={50} value={horizon} onChange={e => setHorizon(clamp(e.target.value, 1, 50))} /></label>
      <button type="button" disabled={!!unavailable || series.count < 8} className="loom-btn-primary w-full text-xs disabled:opacity-50" onClick={() => apply({ forecast: { enabled: true, horizon, method, season } })}>{config.forecast ? "Update forecast" : "Add forecast"}</button>
    </AnalysisCard>
    <AnalysisCard title="Anomaly detection" outcome="Spot values that break the recent pattern." enabled={config.anomaly?.enabled} explained={curtain === "anomaly"} onExplain={() => setCurtain("anomaly")}
      status={config.anomaly ? unavailable || series.count <= config.anomaly.window ? "Paused · needs more history than the lookback window" : `${config.anomaly.enabled ? "On chart" : "Hidden"} · previous ${config.anomaly.window} points · sensitivity ${config.anomaly.threshold}` : "Add rings around unusual plotted values"}
      toggle={config.anomaly ? () => update({ anomaly: { ...config.anomaly!, enabled: !config.anomaly!.enabled } }) : undefined}
      remove={config.anomaly ? () => update({ anomaly: undefined }) : undefined}>
      <label className="block text-xs text-loom-muted">Look back · points<input aria-label="Anomaly lookback" className="loom-input w-full mt-1" type="number" min={5} max={50} value={window} onChange={e => setWindow(clamp(e.target.value, 5, 50))} /></label>
      <label className="block text-xs text-loom-muted">Sensitivity<select className="loom-input w-full mt-1" value={threshold} onChange={e => setThreshold(Number(e.target.value))}><option value={2.5}>More sensitive</option><option value={3.5}>Balanced</option><option value={5}>Only large departures</option></select></label>
      <button type="button" disabled={!!unavailable || series.count <= window} className="loom-btn-primary w-full text-xs disabled:opacity-50" onClick={() => apply({ anomaly: { enabled: true, window, threshold } })}>{config.anomaly ? "Update detection" : "Find anomalies"}</button>
      {isLiveFeed && (
        <button type="button" className="loom-btn w-full text-xs" onClick={() => createChartMonitorDraft({ anomaly: { sensitivity: threshold, window } })}>
          Alert me when this happens
        </button>
      )}
    </AnalysisCard>
    <p className="text-2xs text-loom-muted">First draft · layers are session-only and included in PNG captures. Shared links, saved views, and Vega SVG do not include these layers.</p>
    <FocusCurtain open={curtain === "forecast"} title="Compare forecast methods" onClose={() => setCurtain(null)}>
      <ForecastMethodList method={method} season={season} code={FORECAST_SOURCES[method] ?? ""} onMethod={chooseMethod} onSeason={chooseSeason} />
    </FocusCurtain>
    <FocusCurtain open={curtain === "anomaly"} title="How unusual points are found" onClose={() => setCurtain(null)}>
      <div className="space-y-3 text-sm text-loom-text">
        <p>Each value is compared with the median of the preceding window using median absolute deviation (MAD). A lower threshold flags more points. The initial window is warm-up history. If that history is flat, any change above numerical tolerance is flagged.</p>
        <p>These are unusual observations, not proof of an error or a cause. Trends and seasonality may also trigger flags. Empty values are skipped. The result describes the loaded data, not unseen rows.</p>
        <details><summary className="cursor-pointer">Full calculation code · TypeScript</summary><pre className="mt-2 overflow-auto max-h-72 whitespace-pre text-2xs" tabIndex={0}><code>{ANOMALY_SOURCE}</code></pre></details>
      </div>
    </FocusCurtain>
  </div>;
}
