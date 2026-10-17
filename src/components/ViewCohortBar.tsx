// =================================================================
// ViewCohortBar — shared “what you’re looking at” chrome
// =================================================================
// One quiet strip for filters · brush · sort · time · color lock.
// Reset restores the open sample without drama.
// =================================================================

"use client";

import { useMemo } from "react";
import { useLoomStore } from "@/lib/store";
import {
  CHART_TIME_RANGES,
  pickDefaultTimeField,
  resolveEffectiveTimeRec,
  temporalColumnNames,
  type ChartTimeRange,
} from "@/lib/chartTime";
import { describeViewCohort } from "@/lib/viewCohort";
import { createChartRec } from "@/lib/recommendations";

export function ViewCohortBar({ surface }: { surface: "explorer" | "chart" }) {
  const tableColumnFilters = useLoomStore((s) => s.tableColumnFilters);
  const tableFilterRowIndices = useLoomStore((s) => s.tableFilterRowIndices);
  const tableSortColumn = useLoomStore((s) => s.tableSortColumn);
  const tableSortDir = useLoomStore((s) => s.tableSortDir);
  const selectedRowIndices = useLoomStore((s) => s.selectedRowIndices);
  const viewTimeField = useLoomStore((s) => s.viewTimeField);
  const viewTimeWindow = useLoomStore((s) => s.viewTimeWindow);
  const lockedColorField = useLoomStore((s) => s.lockedColorField);
  const brushLinksFilter = useLoomStore((s) => s.brushLinksFilter);
  const columnStats = useLoomStore((s) => s.columnStats);
  const activeChart = useLoomStore((s) => s.activeChart);
  const setViewTimeWindow = useLoomStore((s) => s.setViewTimeWindow);
  const setBrushLinksFilter = useLoomStore((s) => s.setBrushLinksFilter);
  const resetViewCohort = useLoomStore((s) => s.resetViewCohort);
  const unlockColorAndResetLocks = useLoomStore((s) => s.unlockColorAndResetLocks);
  const applyBrushSelection = useLoomStore((s) => s.applyBrushSelection);
  const setActiveChart = useLoomStore((s) => s.setActiveChart);
  const selectedFile = useLoomStore((s) => s.selectedFile);
  const setToast = useLoomStore((s) => s.setToast);

  function applySharedTime(field: string | null, range: ChartTimeRange) {
    setViewTimeWindow(field, range);
    const chart = useLoomStore.getState().activeChart;
    const stats = useLoomStore.getState().columnStats;
    if (!chart || !stats.length || !field) return;
    const tableName = selectedFile?.name?.replace(/\.[^.]+$/, "") ?? "data";
    const rec = createChartRec(chart.kind, stats, chart.xField, chart.yField, chart.colorField, tableName, {
      sizeField: chart.sizeField,
      zField: chart.zField,
      timeField: chart.timeField,
      yAggregate: chart.yAggregate,
      topN: chart.topN,
      barStackMode: chart.barStackMode ?? undefined,
      rollingWindow: chart.rollingWindow,
      yScale: chart.yScale,
      residualOverlay: chart.residualOverlay,
      anomalyHighlight: chart.anomalyHighlight,
      timeWindowField: range === "all" ? null : field,
      timeWindow: range === "all" ? null : range,
    });
    if (rec) setActiveChart(rec);
  }

  const cohort = useMemo(
    () =>
      describeViewCohort({
        tableColumnFilters,
        tableFilterRowIndices,
        tableSortColumn,
        tableSortDir,
        selectedRowIndices,
        viewTimeWindow,
        viewTimeField,
        lockedColorField,
      }),
    [
      tableColumnFilters,
      tableFilterRowIndices,
      tableSortColumn,
      tableSortDir,
      selectedRowIndices,
      viewTimeWindow,
      viewTimeField,
      lockedColorField,
    ],
  );

  const timeCols = useMemo(() => temporalColumnNames(columnStats), [columnStats]);
  const defaultTime = useMemo(
    () => viewTimeField ?? pickDefaultTimeField(columnStats, activeChart) ?? timeCols[0] ?? null,
    [viewTimeField, columnStats, activeChart, timeCols],
  );
  const effectiveTime = useMemo(
    () => resolveEffectiveTimeRec(viewTimeWindow, viewTimeField, activeChart),
    [viewTimeWindow, viewTimeField, activeChart],
  );
  const brushable =
    surface === "explorer" ||
    activeChart?.kind === "scatter" ||
    activeChart?.kind === "bubble" ||
    activeChart?.kind === "hexbin";

  const summary = useMemo(() => {
    if (cohort.hasTimeWindow || effectiveTime.timeWindow === "all") return cohort.summary;
    const bit = `${effectiveTime.timeWindow}${effectiveTime.timeWindowField ? ` · ${effectiveTime.timeWindowField}` : ""}`;
    if (cohort.summary === "Full sample") return bit;
    return `${cohort.summary} · ${bit}`;
  }, [cohort.hasTimeWindow, cohort.summary, effectiveTime]);

  if (!cohort.active && timeCols.length === 0 && effectiveTime.timeWindow === "all") return null;

  return (
    <div
      className="view-cohort-bar flex items-center gap-2 px-2.5 py-1.5 min-h-9 border-b border-loom-accent/20 bg-[color-mix(in_srgb,var(--loom-accent)_6%,var(--loom-bg))] backdrop-blur-sm"
      role="status"
      aria-label="Current view cohort"
    >
      <span
        className="shrink-0 size-1.5 rounded-full bg-loom-accent shadow-[0_0_8px_color-mix(in_srgb,var(--loom-accent)_70%,transparent)]"
        aria-hidden
      />
      <p className="min-w-0 flex-1 text-2xs font-mono text-loom-text truncate" title={summary}>
        <span className="text-loom-muted uppercase tracking-[0.14em] mr-1.5">
          {surface === "chart" ? "View" : "Cohort"}
        </span>
        {summary}
      </p>

      {timeCols.length > 0 && (
        <div className="hidden sm:flex items-center gap-0.5 shrink-0">
          {CHART_TIME_RANGES.filter((r) => ["all", "24h", "7d", "30d"].includes(r.value)).map((r) => {
            const on = effectiveTime.timeWindow === r.value;
            return (
              <button
                key={r.value}
                type="button"
                title={r.label}
                aria-pressed={on}
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors ${
                  on
                    ? "bg-loom-accent/25 text-loom-text border border-loom-accent/45"
                    : "text-loom-muted border border-transparent hover:border-loom-border hover:text-loom-text"
                }`}
                onClick={() => {
                  if (!defaultTime && r.value !== "all") {
                    setToast("No time column to window");
                    return;
                  }
                  applySharedTime(defaultTime, r.value);
                }}
              >
                {r.short}
              </button>
            );
          })}
        </div>
      )}

      {brushable && (
      <button
        type="button"
        title={brushLinksFilter ? "Brush filters the table (on)" : "Brush only selects (off)"}
        aria-pressed={brushLinksFilter}
        className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono border transition-colors ${
          brushLinksFilter
            ? "border-loom-accent/40 text-loom-accent bg-loom-accent/10"
            : "border-loom-border text-loom-muted hover:text-loom-text"
        }`}
        onClick={() => {
          setBrushLinksFilter(!brushLinksFilter);
          setToast(!brushLinksFilter ? "Brush links to table" : "Brush selects only");
        }}
      >
        link
      </button>
      )}

      {selectedRowIndices.length > 0 && !cohort.hasRowFilter && (
        <button
          type="button"
          className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono border border-loom-accent/40 text-loom-accent hover:bg-loom-accent/15"
          onClick={() => {
            applyBrushSelection(selectedRowIndices);
            setToast(`Showing ${selectedRowIndices.length} selected`);
          }}
        >
          show selected
        </button>
      )}

      {lockedColorField && (
        <button
          type="button"
          title={`Unpin color · ${lockedColorField}`}
          className="shrink-0 min-h-7 px-2 py-0.5 rounded-md text-2xs border border-loom-accent/35 text-loom-text hover:bg-loom-accent/10"
          onClick={() => {
            unlockColorAndResetLocks();
            setToast("Color unpinned");
          }}
        >
          Unpin color
        </button>
      )}

      {cohort.active && (
        <button
          type="button"
          className="shrink-0 min-h-7 px-2 rounded-md text-2xs font-medium border border-loom-border bg-loom-surface/90 text-loom-text hover:border-loom-accent hover:text-loom-accent transition-colors"
          onClick={() => {
            resetViewCohort();
            setToast("View reset");
          }}
        >
          Reset view
        </button>
      )}
    </div>
  );
}
