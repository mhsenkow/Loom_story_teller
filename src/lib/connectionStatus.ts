// =================================================================
// connectionStatus — offline detection + impact copy (LOOM-416)
// =================================================================
// navigator.onLine is only a hint (captive portals, VPN, Worker down).
// `probeConnection` makes a tiny no-store request to our own origin and
// treats a network failure/timeout as "offline". `describeOfflineImpact`
// states which open data can't refresh while durable uploads still work.
// =================================================================

import { sourceKindFromPath } from "./sourceRegistry";

const PROBE_PATH = "/build-id.txt";

export type ProbeFetch = (input: string, init?: RequestInit) => Promise<{ ok: boolean }>;

/** True when the app's own origin answers within `timeoutMs` (any HTTP response counts as reachable). */
export async function probeConnection(
  fetchImpl: ProbeFetch = (u, i) => fetch(u, i),
  timeoutMs = 4000,
): Promise<boolean> {
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    await fetchImpl(`${PROBE_PATH}?t=${Date.now()}`, { cache: "no-store", signal: ctl?.signal });
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Remote (cannot refresh offline) dataset paths. */
export function isRemoteDatasetPath(path: string | null | undefined): boolean {
  if (!path) return false;
  return sourceKindFromPath(path) !== null || path === "stream://wiki" || path.startsWith("web://shared/");
}

export interface OfflineImpact {
  headline: string;
  detail: string;
  remoteBlocked: boolean;
}

/** Banner copy for a cold or mid-session offline state. */
export function describeOfflineImpact(args: {
  activePath: string | null;
  activeName: string | null;
  durableUploadCount: number;
  snapshotCapturedAt: number | null;
  now?: number;
}): OfflineImpact {
  const remoteBlocked = isRemoteDatasetPath(args.activePath);
  const uploads =
    args.durableUploadCount > 0
      ? `${args.durableUploadCount} saved upload${args.durableUploadCount === 1 ? "" : "s"} still open from Recent files.`
      : "No saved uploads on this device yet.";
  if (!remoteBlocked) {
    return { headline: "You're offline", detail: `${uploads} Live sources can't refresh until you reconnect.`, remoteBlocked };
  }
  const name = args.activeName ?? "This live source";
  let age = "";
  if (args.snapshotCapturedAt) {
    const mins = Math.max(0, Math.round(((args.now ?? Date.now()) - args.snapshotCapturedAt) / 60000));
    age = mins < 1 ? " Showing the last snapshot from under a minute ago." : ` Showing the last snapshot from ${mins} min ago.`;
  } else {
    age = " No cached snapshot — nothing to show yet.";
  }
  return { headline: `${name} can't refresh offline`, detail: `${age.trim()} ${uploads}`, remoteBlocked };
}
