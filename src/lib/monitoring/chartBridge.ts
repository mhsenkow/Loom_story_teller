// =================================================================
// Loom — "Monitor this chart" entry point (Chart rail, Analyze card)
// =================================================================

import { useLoomStore } from "../store";
import { chartLinkFromState } from "../chartLink";
import { monitorDraftFromChart } from "./fromChart";

/** Seed the monitor editor from the active chart, or explain why it can't be. */
/** `anomaly` carries the Analyze card's settings so the monitor flags the same points the chart rings. */
export function createChartMonitorDraft(opts?: { anomaly?: { sensitivity: number; window: number } }): boolean {
  const s = useLoomStore.getState();
  const rec = s.activeChart;
  const title = rec ? s.chartTitleOverrides?.[rec.id] ?? rec.title : undefined;
  const res = monitorDraftFromChart(
    rec && opts?.anomaly ? { ...rec, anomalyHighlight: true } : rec,
    s.selectedFile?.path,
    chartLinkFromState(s),
    title,
  );
  if ("error" in res) {
    s.setToast(res.error);
    return false;
  }
  if (opts?.anomaly) res.draft.rule = { kind: "anomaly", sensitivity: opts.anomaly.sensitivity, window: Math.max(5, opts.anomaly.window), seasonal: "none" };
  s.openMonitorEditor("new", res.draft);
  s.setViewMode("monitor");
  return true;
}

