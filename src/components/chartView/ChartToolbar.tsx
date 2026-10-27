// Desktop / mobile chart tool rails and scatter mode bar (LOOM-141).
"use client";
import type { ReactNode } from "react";
import {
  CellIconBtn,
  ChartCellRail,
  IconArrange,
  IconDataTable,
  IconBell,
  IconEditTitle,
  IconRefresh,
  IconSave,
  IconWhy,
} from "@/components/ChartCellChrome";
import type { ChartRecommendation } from "@/lib/recommendations";

export type ScatterModeBarProps = {
  isMobile: boolean;
  chartInteractionMode: string;
  densityHint: string | null;
  onSetMode: (mode: "pan" | "crosshair" | "select" | "lasso") => void;
  onApplyClarity: () => void;
};

export function ScatterModeBar(props: ScatterModeBarProps): ReactNode {
  const { isMobile, chartInteractionMode, densityHint, onSetMode, onApplyClarity } = props;
  return (
    <div className="flex items-center gap-1 px-3 py-1 border-b border-loom-border/50 bg-transparent" role="group" aria-label="Chart interaction mode">
      {([
        { mode: "pan" as const, label: "Pan", tip: "Drag to pan · pinch to zoom · Shift+drag brush" },
        { mode: "crosshair" as const, label: "Cross", tip: "Read values · tap to pin ruler" },
        ...(isMobile
          ? [{ mode: "select" as const, label: "Select", tip: "Drag to brush-select points" }]
          : [{ mode: "lasso" as const, label: "Lasso", tip: "Draw to select points (G)" }]),
      ]).map(({ mode, label, tip }) => (
        <button
          key={mode}
          type="button"
          onClick={() => onSetMode(mode)}
          aria-pressed={chartInteractionMode === mode}
          title={tip}
          className={`px-2 py-1 text-2xs rounded min-h-8 sm:min-h-0 ${chartInteractionMode === mode ? "bg-loom-accent/25 text-loom-text border border-loom-accent/50" : "text-loom-muted border border-transparent hover:border-loom-border"}`}
        >
          {label}
        </button>
      ))}
      {densityHint && (
        <>
          <span
            className="ml-auto loom-badge text-2xs text-loom-accent border-loom-accent/30 max-w-[140px] truncate"
            title="Point size and opacity scale down when many rows would overplot. Zoom in to reveal more points."
          >
            {densityHint}
          </span>
          <button
            type="button"
            onClick={onApplyClarity}
            className="px-2 py-1 text-2xs font-medium rounded border border-loom-accent/50 bg-loom-accent/10 text-loom-accent min-h-8"
            title="One-click Clarity preset: small marks, low opacity, no stroke"
          >
            Clarity
          </button>
        </>
      )}
    </div>
  );
}

export type ChartToolRailProps = {
  orientation: "horizontal" | "vertical";
  whyReasonOpen: boolean;
  whyReasonText: string;
  onCloseWhy: () => void;
  onRefresh: () => void;
  showSave: boolean;
  onSave: () => void;
  showMonitor: boolean;
  chartMonitorCount: number;
  onMonitor: () => void;
  chartDataTableOpen: boolean;
  onToggleDataTable: () => void;
  onToggleWhy: () => void;
  showArrange: boolean;
  arranging: boolean;
  onToggleArranging: () => void;
  onEditTitle: () => void;
  wrapperClassName?: string;
  whyPanelClassName?: string;
};

export function ChartToolRail(props: ChartToolRailProps): ReactNode {
  const {
    orientation,
    whyReasonOpen,
    whyReasonText,
    onCloseWhy,
    onRefresh,
    showSave,
    onSave,
    showMonitor,
    chartMonitorCount,
    onMonitor,
    chartDataTableOpen,
    onToggleDataTable,
    onToggleWhy,
    showArrange,
    arranging,
    onToggleArranging,
    onEditTitle,
    wrapperClassName,
    whyPanelClassName,
  } = props;

  const whyPanel = whyReasonOpen ? (
    <div className={whyPanelClassName ?? "rounded-lg border border-loom-border bg-loom-surface/95 p-2.5 shadow-sm"} role="note">
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-2xs font-medium text-loom-text">Why this chart</span>
        <button type="button" className="text-loom-muted hover:text-loom-text text-xs leading-none px-1" onClick={onCloseWhy} aria-label="Close why">
          ×
        </button>
      </div>
      <p className="text-2xs text-loom-muted leading-snug">{whyReasonText}</p>
    </div>
  ) : null;

  const rail = (
    <ChartCellRail orientation={orientation}>
      <CellIconBtn label="Redraw chart" title="Redraw chart" onClick={onRefresh}>
        <IconRefresh />
      </CellIconBtn>
      {showSave && (
        <CellIconBtn label="Save chart view" title="Save this chart for dashboards" onClick={onSave}>
          <IconSave />
        </CellIconBtn>
      )}
      {showMonitor && (
        <CellIconBtn
          label="Monitor this chart"
          title={
            chartMonitorCount
              ? `Watching ${chartMonitorCount} monitor${chartMonitorCount === 1 ? "" : "s"} on this feed. Click to add another`
              : "Get alerted when this chart does something unusual"
          }
          pressed={chartMonitorCount > 0}
          onClick={onMonitor}
        >
          <IconBell />
        </CellIconBtn>
      )}
      <CellIconBtn label="Data table" title="Show chart values as a table" pressed={chartDataTableOpen} onClick={onToggleDataTable}>
        <IconDataTable />
      </CellIconBtn>
      <CellIconBtn label="Why this chart" title="Why this chart?" pressed={whyReasonOpen} onClick={onToggleWhy}>
        <IconWhy />
      </CellIconBtn>
      {showArrange && (
        <CellIconBtn
          label={arranging ? "Done arranging" : "Arrange chart layout"}
          title={arranging ? "Finish arranging" : "Move title, legend, and plot on the canvas"}
          pressed={arranging}
          onClick={onToggleArranging}
        >
          <IconArrange />
        </CellIconBtn>
      )}
      <CellIconBtn label="Edit chart title" title="Edit title" onClick={onEditTitle}>
        <IconEditTitle />
      </CellIconBtn>
    </ChartCellRail>
  );

  if (orientation === "horizontal") {
    return (
      <div className={wrapperClassName ?? "loom-chart-tools flex flex-col items-stretch gap-1.5"}>
        {whyPanel}
        <div className="flex justify-end">{rail}</div>
      </div>
    );
  }

  return (
    <div className={wrapperClassName ?? "loom-chart-tools flex flex-col gap-1.5 self-start items-start shrink-0"}>
      {whyPanel}
      {rail}
    </div>
  );
}

/** Convenience helper for recommendation reason text. */
export function chartWhyReasonText(activeChart: ChartRecommendation | null, aiSuggestionReason: string | null, fallback: (c: ChartRecommendation) => string): string {
  if (!activeChart) return "";
  return aiSuggestionReason ?? fallback(activeChart);
}
