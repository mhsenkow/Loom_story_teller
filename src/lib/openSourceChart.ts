// =================================================================
// Loom — Open a live feed and (optionally) restore a chart link on it
// =================================================================
// Shared by monitors ("jump to the chart this alert came from") and the
// community strip ("open the chart people are voting for"). The chart is
// restored through the shared-link path: ChartLinkSync applies it once the
// feed's rows are loaded. Without a link, the feed lands on its own chart.
// =================================================================

import { useLoomStore } from "./store";
import { activateDataset } from "./datasetPipeline";
import { decodeChartLink } from "./chartLink";
import { sourceSnapshot, sourceStart } from "./tauri";
import { SOURCE_BY_KIND, SOURCE_EXPLORE_ROWS, isSourceKind, sourceStreamPath, type SourceKind } from "./sourceRegistry";

/** Returns false when the feed isn't known or never produced rows (a toast explains). */
export async function openSourceChart(kindRaw: string, linkHash: string | null | undefined): Promise<boolean> {
  const store = useLoomStore.getState();
  if (!isSourceKind(kindRaw)) {
    store.setToast("That chart’s feed isn’t available here.");
    return false;
  }
  const kind: SourceKind = kindRaw;
  const def = SOURCE_BY_KIND[kind];
  const link = linkHash ? decodeChartLink(linkHash) : null;
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
      return false;
    }
    activateDataset({
      file: { path, name: def.fileName, extension: "stream", row_count: snap.sample.total_rows, size_bytes: 0, sourceHome: def.homepage, sourceCredit: def.attribution },
      stats: snap.stats,
      sample: snap.sample,
      shortlist: { type: "source", kind },
    });
  }
  useLoomStore.getState().setViewMode("chart");
  return true;
}
