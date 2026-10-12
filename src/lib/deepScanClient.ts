// =================================================================
// deepScanClient — Worker wrapper with main-thread fallback
// =================================================================

import type { ColumnInfo, QueryResult } from "./store";
import { deepRecommend, type DeepScanResult, type DeepScanSource } from "./deepScan";
import type { VizPreferenceModel } from "./vizPreferences";

interface DeepScanInput {
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

function nextFrame(): Promise<void> {
  if (typeof requestAnimationFrame === "undefined") {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function runDeepScanFallback(
  input: DeepScanInput,
  onProgress: (message: string) => void,
): Promise<DeepScanResult> {
  onProgress("Scoring charts…");
  await nextFrame();
  onProgress("Ranking for you…");
  await nextFrame();
  return deepRecommend(input.columns, input.data, input.prefs, input.source, input.deckLimit);
}

export function runDeepScan(
  input: DeepScanInput,
  onProgress: (message: string) => void,
): Promise<DeepScanResult> {
  if (typeof Worker === "undefined") return runDeepScanFallback(input, onProgress);

  return new Promise((resolve, reject) => {
    let settled = false;
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL("./deepScan.worker.ts", import.meta.url), { type: "module" });
    } catch {
      void runDeepScanFallback(input, onProgress).then(resolve, reject);
      return;
    }

    worker.onmessage = (event: MessageEvent<DeepScanWorkerResponse>) => {
      const message = event.data;
      if (message.type === "progress") {
        onProgress(message.message);
        return;
      }
      settled = true;
      worker?.terminate();
      worker = null;
      if (message.type === "done") resolve(message.result);
      else reject(new Error(message.message));
    };
    worker.onerror = (event) => {
      if (settled) return;
      settled = true;
      worker?.terminate();
      worker = null;
      reject(event.error instanceof Error ? event.error : new Error(event.message));
    };
    worker.postMessage(input);
  });
}
