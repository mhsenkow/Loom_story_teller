// Bounded chart-edit snapshots. Keep the portable spec and rendered options in sync.
import type { LoomState } from "./store/types";

export const CHART_EDIT_HISTORY_LIMIT = 20;
export type ChartEditSnapshot = Pick<
  LoomState,
  | "activeChart"
  | "chartVisualOverrides"
  | "barStackMode"
  | "connectScatterTrail"
  | "showMarginals"
  | "chartTitleOverrides"
  | "chartAnnotations"
  | "customRefLines"
  | "aiSuggestionReason"
>;

export function chartEditSnapshot(s: LoomState): ChartEditSnapshot {
  return JSON.parse(
    JSON.stringify({
      activeChart: s.activeChart,
      chartVisualOverrides: s.chartVisualOverrides,
      barStackMode: s.barStackMode,
      connectScatterTrail: s.connectScatterTrail,
      showMarginals: s.showMarginals,
      chartTitleOverrides: s.chartTitleOverrides,
      chartAnnotations: s.chartAnnotations,
      customRefLines: s.customRefLines,
      aiSuggestionReason: s.aiSuggestionReason,
    }),
  ) as ChartEditSnapshot;
}

export function restoreChartEdit(snap: ChartEditSnapshot): Partial<LoomState> {
  return {
    ...snap,
    vegaSpec: snap.activeChart?.spec ?? null,
    chartEditGroup: null,
  };
}

export function chartHistoryCheckpoint(s: LoomState): Partial<LoomState> {
  return {
    chartEditUndoStack: [chartEditSnapshot(s), ...s.chartEditUndoStack].slice(
      0,
      CHART_EDIT_HISTORY_LIMIT,
    ),
    chartEditRedoStack: [],
    chartEditGroup: null,
  };
}
