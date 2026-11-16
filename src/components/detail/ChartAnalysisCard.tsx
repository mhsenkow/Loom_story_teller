// One analysis entry point for every chart; statistical units come from the chart catalog.
"use client";
import EmptyState from "../EmptyState";
import AnalysisNumberInput from "../AnalysisNumberInput";
import AnalysisResultsTable from "../AnalysisResultsTable";
import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useLoomStore } from "@/lib/store";
import { chartDefinition } from "@/lib/chartDefinitions";
import { analyzeChart, chartAnalysisScope, chartForecast, type ChartAnomalyConfig, type ChartAnomalyMethod } from "@/lib/chartAnalysis";
import { applyExplorerViewToRows } from "@/lib/explorerViewRows";
import { applyChartTimeWindow, resolveEffectiveTimeRec } from "@/lib/chartTime";
import { chartNumber } from "@/lib/chartNumbers";
import { FORECAST_METHOD_LABEL, type ForecastMethod } from "@/lib/timeSeriesAnalysis";
import { FORECAST_SOURCES } from "@/lib/timeSeriesAnalysisSource";
import type { YAggregateOption } from "@/lib/recommendations";

const number = (n: number) => Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 3 }) : "Departure from flat baseline";

export default function ChartAnalysisCard() {
  const chart = useLoomStore(s => s.activeChart);
  const stored = useLoomStore(s => s.smartResults?.chartAnomaly);
  const setResults = useLoomStore(s => s.setSmartResults);
  const filterRows = useLoomStore(s => s.setTableFilterRowIndices);
  const input = useLoomStore(useShallow(s => ({ sample: s.sampleRows, columnFilters: s.tableColumnFilters, filterRowIndices: s.tableFilterRowIndices, columnStats: s.columnStats, sortColumn: s.tableSortColumn, sortDir: s.tableSortDir, timeField: s.viewTimeField, timeWindow: s.viewTimeWindow })));
  const view = useMemo(() => {
    if (!input.sample) return { rows: [], sourceIndices: [], columns: [] as string[] };
    const { rows, columns } = input.sample;
    const explorer = applyExplorerViewToRows(rows, columns, input);
    const timed = applyChartTimeWindow(explorer.rows, columns, resolveEffectiveTimeRec(input.timeWindow, input.timeField, chart));
    return { columns, rows: timed.rows, sourceIndices: timed.sourceIndices.map(i => explorer.sourceIndices[i]) };
  }, [input, chart]);
  const config = stored?.scope === (chart && chartAnalysisScope(chart)) ? stored : null;
  const [method, setMethod] = useState<ChartAnomalyMethod>(config?.method ?? "mad");
  const [threshold, setThreshold] = useState(config?.threshold ?? 3.5);
  const [window, setWindow] = useState(config?.window ?? 10);
  const [field, setField] = useState(config?.field ?? "");
  const numeric = useMemo(() => view.columns.filter((_, i) => view.rows.some(r => Number.isFinite(chartNumber(r[i])))), [view]);
  const ordered = view.columns.filter((name, i) => numeric.includes(name) || /DATE|TIME/i.test(input.sample?.types[i] ?? input.columnStats.find(c => c.name === name)?.data_type ?? ""));
  const [forecastX, setForecastX] = useState(chart?.timeField ?? chart?.xField ?? "");
  const [forecastY, setForecastY] = useState(chart?.yField ?? "");
  const [aggregate, setAggregate] = useState<YAggregateOption>("mean");
  const [forecastMethod, setForecastMethod] = useState<ForecastMethod>("line");
  const [horizon, setHorizon] = useState(7);
  const [season, setSeason] = useState(12);
  const [preview, setPreview] = useState(false);
  const report = useMemo(() => chart ? analyzeChart(chart, view.rows, view.columns, config ?? { scope: chartAnalysisScope(chart), enabled: true, method, threshold, window, field: field || undefined }) : null, [chart, view, config, method, threshold, window, field]);
  const forecast = useMemo(() => preview ? chartForecast(view.rows, view.columns, forecastX, forecastY, aggregate, horizon, forecastMethod, season, !numeric.includes(forecastX)) : null, [preview, view, forecastX, forecastY, aggregate, horizon, forecastMethod, season, numeric]);
  if (!chart || !report) return null;
  const policy = chartDefinition(chart.kind).analysis;
  const run = () => setResults(prev => ({ ...prev, chartAnomaly: { scope: chartAnalysisScope(chart), enabled: true, method, threshold, window, field: field || undefined } }));
  const patch = (value: Partial<ChartAnomalyConfig>) => config && setResults(prev => ({ ...prev, chartAnomaly: { ...config, ...value } }));
  const dirty = !!config && (config.method !== method || config.threshold !== threshold || config.window !== window || (config.field ?? "") !== field);
  const hasFilters = !!input.filterRowIndices?.length || Object.values(input.columnFilters).some(v => v.trim()) || input.timeWindow !== "all";
  const clearFilters = () => { const st = useLoomStore.getState(); st.setTableFilterRowIndices(null); st.setTableColumnFilters({}); st.setViewTimeWindow(null, "all"); };
  if (!view.rows.length) return <EmptyState variant="filter" title={hasFilters ? "No rows in this view" : "No data to analyze yet"}
    action={hasFilters ? <button className="loom-btn-primary" onClick={clearFilters}>Reset view filters</button> : undefined}>
    {hasFilters ? "Try a wider time range or reset the filters to bring your data back." : "Load a dataset with observations, then return here to explore its patterns."}
  </EmptyState>;
  return <div className="loom-analysis-panel space-y-4">
    <h2 className="text-base font-semibold">Analyze this chart</h2>
    <section className="loom-card p-3 space-y-3" aria-label="Chart anomaly detection">
      <h3 className="text-sm font-semibold">Anomaly detection</h3>
      <p className="text-xs text-loom-muted">{report.description}</p>
      <label className="block text-xs">Analyze<select aria-label="Analysis observations" className="loom-input w-full mt-1" value={field} onChange={e => { setField(e.target.value); if (e.target.value && method === "trailing") { setMethod("mad"); setThreshold(3.5); } }}>
        <option value="">{policy.basis === "rows" ? "Default numeric measure" : "Chart values"}</option>
        {numeric.map(name => <option key={name} value={name}>Source rows · {name}</option>)}
      </select></label>
      <label className="block text-xs">Detection method<select aria-label="Chart anomaly method" className="loom-input w-full mt-1" value={method} onChange={e => { setMethod(e.target.value as ChartAnomalyMethod); setThreshold(e.target.value === "iqr" ? 1.5 : 3.5); }}>
        <option value="mad">Median / MAD · robust outliers</option><option value="iqr">IQR · outside the middle half</option><option value="z-score">Z-score · distance from mean</option>
        {policy.basis === "series" && !field && <option value="trailing">Trailing median · recent departures</option>}
      </select></label>
      <label className="block text-xs">Threshold<AnalysisNumberInput label="Chart anomaly threshold" value={threshold} min={1} max={6} step={0.5} onCommit={setThreshold} /></label>
      {method === "trailing" && <label className="block text-xs">Lookback<AnalysisNumberInput label="Chart anomaly lookback" value={window} min={5} max={50} step={1} onCommit={setWindow} /></label>}
      <button className="loom-btn-primary w-full text-xs" disabled={!view.rows.length} onClick={run}>{config ? "Update chart analysis" : "Find chart anomalies"}</button>
      {dirty && <p className="text-xs text-loom-muted" role="status">Changes not applied. Update chart analysis to use these settings.</p>}
      {config && <div className="flex flex-wrap gap-2"><button className="loom-btn-ghost text-xs" onClick={() => patch({ enabled: !config.enabled })}>{config.enabled ? "Hide detection" : "Show detection"}</button><button className="loom-btn-ghost text-xs" onClick={() => setResults(prev => ({ ...prev, chartAnomaly: null }))}>Remove detection</button></div>}
      <p role="status" className="text-xs text-loom-muted">{config && !config.enabled ? "Detection hidden." : report.reason ?? (config ? `${report.flagged.length} unusual observations among ${report.observations.length}. ${report.flagged.length === 0 ? "No observations crossed the threshold." : report.overlay === "none" ? "Evidence below; no mark overlay for this analysis." : "Outlined on the chart; results include the full filtered cohort, even when marks are thinned or outside the current view."}` : `${report.observations.length} observations in the filtered sample. Run to show evidence.`)}</p>
      {config?.enabled && !report.reason && report.flagged.length === 0 && <EmptyState compact variant="quiet" title="Nothing unusual at this threshold">The current sample stays within your chosen threshold. Lower it to explore smaller departures.</EmptyState>}
      {report.reason && <EmptyState compact variant="data" title="A little more context needed">Try another measure or include more observations before comparing values.</EmptyState>}
      {config?.enabled && report.flagged.length > 0 && <>
        <button className="loom-btn-ghost text-xs" disabled={!report.rowIndices.length} onClick={() => filterRows(report.rowIndices.map(i => view.sourceIndices[i]))}>Filter table to contributing rows</button>
        <p className="text-2xs text-loom-muted">Filtering changes the cohort and recalculates detection.</p>
        <AnalysisResultsTable caption={`Unusual observations${report.flagged.length > 20 ? " · first 20" : ""}`} columns={["Observation", "Values", "Flagged measure", "Score"]}
          rows={report.flagged.slice(0, 20).map(p => [p.label, p.values.map(number).join(" · "), p.dimension, number(p.score)])} />
      </>}
      {input.filterRowIndices?.length ? <button className="loom-btn-ghost text-xs" onClick={() => filterRows(null)}>Clear row selection filter</button> : null}
      <details className="text-xs text-loom-muted"><summary className="cursor-pointer">How to interpret these flags</summary><p className="mt-2">MAD uses distance from the median divided by 1.4826 × median absolute deviation. IQR measures distance beyond Q1 or Q3 in interquartile ranges. Z-score uses sample standard deviation. Four observations per comparison group are required; flat baselines flag departures above numerical tolerance. Trailing detection compares only preceding points. These are potential outliers, not probabilities or proof of error. Axis-wise detection can miss unusual combinations of otherwise ordinary coordinates.</p><a className="underline" href="https://www.itl.nist.gov/div898/handbook/eda/section3/eda35h.htm" target="_blank" rel="noreferrer">Method reference · NIST</a></details>
    </section>
    <section className="loom-card p-3 space-y-3" aria-label="Forecast source data">
      <h3 className="text-sm font-semibold">Forecast / extrapolate</h3>
      <p className="text-xs text-loom-muted">Choose an ordered source field and a measure for any chart. This preview aggregates the filtered source rows across all groups. It does not extend category, map or 3D layout positions.</p>
      <label className="block text-xs">Order by<select aria-label="Forecast order" className="loom-input w-full mt-1" value={ordered.includes(forecastX) ? forecastX : ""} onChange={e => { setForecastX(e.target.value); setPreview(false); }}><option value="">Choose numeric or date field…</option>{ordered.map(f => <option key={f}>{f}</option>)}</select></label>
      <label className="block text-xs">Measure<select aria-label="Forecast measure" className="loom-input w-full mt-1" value={numeric.includes(forecastY) ? forecastY : ""} onChange={e => { setForecastY(e.target.value); setPreview(false); }}><option value="">Choose measure…</option>{numeric.map(f => <option key={f}>{f}</option>)}</select></label>
      <label className="block text-xs">Aggregate<select aria-label="Forecast aggregate" className="loom-input w-full mt-1" value={aggregate} onChange={e => setAggregate(e.target.value as YAggregateOption)}>{(["mean", "sum", "min", "max", "count"] as const).map(f => <option key={f}>{f}</option>)}</select></label>
      <label className="block text-xs">Method<select aria-label="Forecast preview method" className="loom-input w-full mt-1" value={forecastMethod} onChange={e => setForecastMethod(e.target.value as ForecastMethod)}>{Object.entries(FORECAST_METHOD_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {forecastMethod === "seasonal" && <label className="block text-xs">Cycle length<AnalysisNumberInput label="Forecast cycle length" value={season} min={2} max={24} step={1} onCommit={setSeason} /></label>}
      <label className="block text-xs">Future intervals<AnalysisNumberInput label="Forecast preview intervals" value={horizon} min={1} max={50} step={1} onCommit={setHorizon} /></label>
      <button className="loom-btn-primary w-full text-xs" disabled={!ordered.includes(forecastX) || (aggregate !== "count" && !numeric.includes(forecastY))} onClick={() => setPreview(true)}>Preview extrapolation</button>
      {forecast?.reason && <p role="status" className="text-xs text-loom-muted">{forecast.reason}</p>}
      {!forecast && <EmptyState compact variant="forecast" title="Make room for what comes next">Choose your fields, then preview a possible path and its uncertainty.</EmptyState>}
      {forecast?.reason && <EmptyState compact variant="forecast" title="This series needs another look">Adjust the fields or include more regularly spaced observations.</EmptyState>}
      {forecast?.forecast && <AnalysisResultsTable caption={`${forecast.points.length} observed intervals · approximate 95% prediction range`}
        columns={[`Future ${forecastX}`, "Estimate", "Lower", "Upper"]}
        rows={forecast.forecast.points.map(p => [forecast.time ? new Date(p.x).toISOString() : number(p.x), number(p.y), number(p.lower), number(p.upper)])} />}
      <details className="text-xs text-loom-muted"><summary className="cursor-pointer">Forecast assumptions and calculation</summary><p className="mt-2">At least 8 regularly spaced observations; repeating cycles need two complete cycles. Numeric order must represent meaningful progression. Estimates can be negative and are not constrained to physical limits. Ranges depend on the model assumptions and are not guaranteed coverage.</p><pre className="mt-2 max-h-64 overflow-auto text-2xs" tabIndex={0}><code>{FORECAST_SOURCES[forecastMethod]}</code></pre><a className="underline" href="https://otexts.com/fpp3/prediction-intervals.html" target="_blank" rel="noreferrer">Forecasting reference</a></details>
    </section>
    <p className="text-2xs text-loom-muted">Analysis uses the loaded, filtered sample. Detection outlines appear in PNG captures. Preview tables and analysis settings are session-only; saved views, shared links and SVG do not include them.</p>
  </div>;
}
