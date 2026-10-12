// =================================================================
// Loom — Staged browser cache hydration coordinator
// =================================================================
// Applies file index before row payloads so startup stays interactive.
// User actions during hydration cancel background sample merges.
// =================================================================

import type { ColumnInfo, QueryResult } from "./store";
import { loadWebFileIndex, loadWebFileInspectPayload } from "./webFileStore";

export type WebHydrationPhase = "idle" | "index" | "samples" | "ready" | "cancelled";

let hydrationRunId = 0;
let userActionGeneration = 0;

/** Call when the user selects a file or starts an import during startup hydrate. */
export function bumpWebHydrationUserAction(): number {
  userActionGeneration += 1;
  return userActionGeneration;
}

export function webHydrationUserActionGeneration(): number {
  return userActionGeneration;
}

export function cancelWebCacheHydration(): void {
  hydrationRunId += 1;
}

export async function stagedHydrateWebFileCache(handlers: {
  onPhase?: (phase: WebHydrationPhase) => void;
  onIndex: (
    entries: {
      path: string;
      name: string;
      extension: string;
      row_count: number;
      size_bytes: number;
    }[],
  ) => void;
  onSample?: (path: string, payload: { stats: ColumnInfo[]; sample: QueryResult }) => void;
}): Promise<void> {
  const runId = ++hydrationRunId;
  const actionAtStart = userActionGeneration;
  handlers.onPhase?.("index");

  const entries = await loadWebFileIndex();
  if (runId !== hydrationRunId) {
    handlers.onPhase?.("cancelled");
    return;
  }
  handlers.onIndex(entries);

  if (!handlers.onSample || entries.length === 0) {
    handlers.onPhase?.("ready");
    return;
  }

  handlers.onPhase?.("samples");
  for (const entry of entries) {
    if (runId !== hydrationRunId) {
      handlers.onPhase?.("cancelled");
      return;
    }
    if (userActionGeneration !== actionAtStart) {
      handlers.onPhase?.("cancelled");
      return;
    }
    const payload = await loadWebFileInspectPayload(entry.path);
    if (!payload) continue;
    if (runId !== hydrationRunId || userActionGeneration !== actionAtStart) {
      handlers.onPhase?.("cancelled");
      return;
    }
    handlers.onSample(entry.path, payload);
    await new Promise<void>((r) => setTimeout(r, 0));
  }
  if (runId === hydrationRunId) handlers.onPhase?.("ready");
}
