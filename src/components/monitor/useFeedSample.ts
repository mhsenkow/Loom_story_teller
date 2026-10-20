"use client";

// Rows for a feed, for previews: the open dataset when it's that feed, otherwise
// a snapshot (connecting the feed if needed). Cached briefly per feed.

import { useEffect, useState } from "react";
import { useLoomStore } from "@/lib/store";
import { sourceSnapshot, sourceStart, sourceStatus } from "@/lib/tauri";
import { SOURCE_EXPLORE_ROWS, sourceStreamPath, type SourceKind } from "@/lib/sourceRegistry";
import type { QueryResult } from "@/lib/queryTypes";

const cache = new Map<SourceKind, { at: number; sample: QueryResult }>();
const inflight = new Map<SourceKind, Promise<QueryResult>>();
const TTL = 60_000;

/** One load per feed at a time, however many cards ask. */
function load(kind: SourceKind): Promise<QueryResult> {
  const hit = cache.get(kind);
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.sample);
  let p = inflight.get(kind);
  if (!p) {
    p = loadFresh(kind).finally(() => inflight.delete(kind));
    inflight.set(kind, p);
  }
  return p;
}

async function loadFresh(kind: SourceKind): Promise<QueryResult> {
  const st = await sourceStatus(kind);
  if (!st.running) await sourceStart(kind);
  let snap = await sourceSnapshot(kind, SOURCE_EXPLORE_ROWS);
  for (let i = 0; i < 12 && !snap.sample.rows.length; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    snap = await sourceSnapshot(kind, SOURCE_EXPLORE_ROWS);
  }
  cache.set(kind, { at: Date.now(), sample: snap.sample });
  return snap.sample;
}

export function useFeedSample(kind: SourceKind | null): { sample: QueryResult | null; loading: boolean; error: string | null } {
  // The open dataset is used only when it actually has rows (otherwise fetch like any other feed).
  const open = useLoomStore((s) => (kind && s.selectedFile?.path === sourceStreamPath(kind) && s.sampleRows?.rows.length ? s.sampleRows : null));
  const [state, setState] = useState<{ kind: SourceKind | null; sample: QueryResult | null; error: string | null }>({ kind: null, sample: null, error: null });
  useEffect(() => {
    if (!kind || open) return;
    let alive = true;
    load(kind)
      .then((sample) => alive && setState({ kind, sample, error: null }))
      .catch((e) => alive && setState({ kind, sample: null, error: e instanceof Error ? e.message : String(e) }));
    return () => { alive = false; };
  }, [kind, open]);
  if (!kind) return { sample: null, loading: false, error: null };
  if (open?.rows.length) return { sample: open, loading: false, error: null };
  const mine = state.kind === kind;
  return { sample: mine ? state.sample : null, loading: !mine, error: mine ? state.error : null };
}
