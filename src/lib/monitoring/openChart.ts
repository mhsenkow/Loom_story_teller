// =================================================================
// Loom — Jump from a monitor (or alert) back to its chart
// =================================================================
// Opens the monitor's feed and, when it was made from a chart, restores
// that exact chart via the shared-link path (ChartLinkSync applies it
// once the feed's rows are loaded). Otherwise lands on the feed's chart.
// =================================================================

import { useLoomStore } from "../store";
import { activateDataset } from "../datasetPipeline";
import { decodeChartLink } from "../chartLink";
import { sourceSnapshot, sourceStart } from "../tauri";
import { SOURCE_BY_KIND, SOURCE_EXPLORE_ROWS, sourceStreamPath } from "../sourceRegistry";
import type { Monitor } from "./types";

export async function openMonitorChart(m: Monitor): Promise<void> {
  const store = useLoomStore.getState();
  const kind = m.metric.source;
  const def = SOURCE_BY_KIND[kind];
  const link = m.chart ? decodeChartLink(m.chart.link) : null;
  const path = sourceStreamPath(kind);
  if (link) store.setChartLink(link);

  if (store.selectedFile?.path !== path) {
    store.setToast(`Opening ${def.label}…`);
    await sourceStart(kind);
    let snap = await sourceSnapshot(kind, SOURCE_EXPLORE_ROWS);
    for (let i = 0; i < 10 && !snap.sample.rows.length; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      snap = await sourceSnapshot(kind, SOURCE_EXPLORE_ROWS);
    }
    if (!snap.sample.rows.length) {
      store.setToast(`${def.label} is still connecting. Try again in a moment.`);
      return;
    }
    activateDataset({
      file: { path, name: def.fileName, extension: "stream", row_count: snap.sample.total_rows, size_bytes: 0, sourceHome: def.homepage, sourceCredit: def.attribution },
      stats: snap.stats,
      sample: snap.sample,
      shortlist: { type: "source", kind },
    });
  }
  useLoomStore.getState().setViewMode("chart");
}
