// =================================================================
// chartStageStatus — loading / empty / error copy (LOOM-137–139, LOOM-618)
// =================================================================

export type ChartStageStatus =
  | { kind: "idle" }
  | { kind: "loading"; message: string }
  | { kind: "empty"; message: string }
  | { kind: "error"; message: string };

export function chartStageStatus(args: {
  loadingSample: boolean;
  hasChart: boolean;
  hasRows: boolean;
  renderError: string | null;
}): ChartStageStatus {
  if (args.renderError) return { kind: "error", message: args.renderError };
  if (args.loadingSample) return { kind: "loading", message: "Loading chart data…" };
  if (args.hasChart && !args.hasRows) {
    return { kind: "empty", message: "No rows to plot for this encoding." };
  }
  return { kind: "idle" };
}

export function chartStageLiveMessage(status: ChartStageStatus): string | null {
  if (status.kind === "idle") return null;
  return status.message;
}
