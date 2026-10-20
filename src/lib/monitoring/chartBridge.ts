// =================================================================
// Loom — "Monitor this chart" entry point (Chart rail, Analyze card)
// =================================================================

import { useLoomStore } from "../store";
import { chartLinkFromState } from "../chartLink";
import { monitorDraftFromChart } from "./fromChart";
import type { Monitor } from "./types";

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


/** Monitor limits that belong on the chart: same feed and the same plotted y column. */
export function monitorRefLines(
  monitors: Monitor[],
  filePath: string | null | undefined,
  yField: string | null | undefined,
): { id: string; axis: "y"; value: number; label: string }[] {
  if (!filePath?.startsWith("stream://") || !yField) return [];
  const out: { id: string; axis: "y"; value: number; label: string }[] = [];
  for (const m of monitors) {
    if (!m.enabled || `stream://${m.metric.source}` !== filePath || m.metric.column !== yField) continue;
    const r = m.rule;
    const add = (key: string, value: number | undefined, arrow: string) => {
      if (value != null && Number.isFinite(value)) out.push({ id: `mon-${m.id}-${key}`, axis: "y", value, label: `🔔 ${arrow} ${m.name}` });
    };
    if (r.kind === "threshold") { add("above", r.above, "▲"); add("below", r.below, "▼"); }
    if (r.kind === "range") { add("low", r.low, "▼"); add("high", r.high, "▲"); }
  }
  return out;
}
