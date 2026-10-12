// =================================================================
// deepScan.worker — off-main-thread swipe deck scan
// =================================================================

import type { ColumnInfo, QueryResult } from "./store";
import { deepRecommend, type DeepScanResult, type DeepScanSource } from "./deepScan";
import type { VizPreferenceModel } from "./vizPreferences";

interface DeepScanWorkerRequest {
  columns: ColumnInfo[];
  data: QueryResult | null;
  prefs: VizPreferenceModel | null | undefined;
  source: DeepScanSource;
  deckLimit: number;
}

type DeepScanWorkerResponse =
  | { type: "progress"; message: string }
  | { type: "done"; result: DeepScanResult }
  | { type: "error"; message: string };

const post = (message: DeepScanWorkerResponse) => {
  self.postMessage(message);
};

self.onmessage = (event: MessageEvent<DeepScanWorkerRequest>) => {
  const payload = event.data;
  post({ type: "progress", message: "Scoring charts…" });
  setTimeout(() => {
    try {
      post({ type: "progress", message: "Ranking for you…" });
      const result = deepRecommend(
        payload.columns,
        payload.data,
        payload.prefs,
        payload.source,
        payload.deckLimit,
      );
      post({ type: "done", result });
    } catch (err) {
      post({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, 0);
};
