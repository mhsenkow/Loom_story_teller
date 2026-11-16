// =================================================================
// Loom — Jump from a monitor (or alert) back to its chart
// =================================================================
// Opens the monitor's feed and, when it was made from a chart, restores
// that exact chart via the shared-link path (ChartLinkSync applies it
// once the feed's rows are loaded). Otherwise lands on the feed's chart.
// =================================================================

import { openSourceChart } from "../openSourceChart";
import type { Monitor } from "./types";

export async function openMonitorChart(m: Monitor): Promise<void> {
  await openSourceChart(m.metric.source, m.chart?.link ?? null);
}
