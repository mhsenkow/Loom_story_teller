// =================================================================
// shareReadySession — restore chart aspect after share-ready preview
// =================================================================
// Share-ready temporarily locks a social aspect into appSettings (which
// persist). Stash the prior aspect so Esc / Exit always undo the lock.
// =================================================================

import type { ChartAspectId } from "./chartViewport";
import { useLoomStore } from "./store";

let aspectBeforeShare: ChartAspectId | null = null;

/** Enter share-ready framing; optionally apply a preset aspect. */
export function beginShareReadyAspect(aspectId?: ChartAspectId): void {
  if (aspectBeforeShare == null) {
    aspectBeforeShare = useLoomStore.getState().appSettings.chartAspect ?? "free";
  }
  if (aspectId) {
    useLoomStore.getState().setAppSettings((s) => ({ ...s, chartAspect: aspectId }));
  }
}

/** Restore the aspect from before share-ready (no-op if never entered). */
export function endShareReadyAspect(): void {
  if (aspectBeforeShare == null) return;
  const prev = aspectBeforeShare;
  aspectBeforeShare = null;
  useLoomStore.getState().setAppSettings((s) => ({ ...s, chartAspect: prev }));
}

/** Test helper. */
export function clearShareReadyAspectBackup(): void {
  aspectBeforeShare = null;
}
