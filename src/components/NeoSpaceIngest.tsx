"use client";

/**
 * Suite → Loom handoff: accept CSVs via postMessage and open chart view.
 * NeoSpace insights (`neospace-loom-data`) and bruh page datasets (`bruh-loom-data`).
 */

import { useEffect, useRef } from "react";
import { parseCsvToInspectResultAsync } from "@/lib/parseCsvAsync";
import { createChartRec, parseChartKind, recommend } from "@/lib/recommendations";
import { activateDataset } from "@/lib/datasetPipeline";
import { useLoomStore, type FileEntry } from "@/lib/store";
import { WEB_VAULT_PATH } from "@/lib/webDataFolder";
import { isAllowedNeoSpaceOrigin, safeNeoSpaceFileName } from "@/lib/neospace";
import { leaveSourcesShowChart } from "@/lib/shellHandoff";

type IncomingFile = { name: string; csv: string; label?: string };
type Preferred = {
  file: string;
  kind?: string;
  xField?: string;
  yField?: string;
  colorField?: string;
  title?: string;
  subtitle?: string;
};

type Incoming = {
  type: "neospace-loom-data" | "bruh-loom-data";
  v: 1;
  files: IncomingFile[];
  preferred?: Preferred;
  source?: { label?: string; acct?: string; home?: string };
};

export function NeoSpaceIngest() {
  const handledRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const from = params.get("from");
    const fromNeo = from === "neospace";
    const fromBruh = from === "bruh";

    const announceReady = () => {
      if ((!fromNeo && !fromBruh) || !window.opener) return;
      try {
        const target = (() => {
          try {
            return (window.opener as Window).location.origin;
          } catch {
            return fromBruh ? "https://bruh.ibm.io" : "https://neospace.ibm.io";
          }
        })();
        const type = fromBruh ? "loom-bruh-ready" : "loom-neospace-ready";
        (window.opener as Window).postMessage({ type, v: 1 }, target);
      } catch {
        try {
          const fallback = fromBruh ? "https://bruh.ibm.io" : "https://neospace.ibm.io";
          const type = fromBruh ? "loom-bruh-ready" : "loom-neospace-ready";
          (window.opener as Window).postMessage({ type, v: 1 }, fallback);
        } catch {
          /* ignore */
        }
      }
    };

    const ackSender = (origin: string, kind: Incoming["type"]) => {
      try {
        if (!window.opener || window.opener.closed) return;
        const type = kind === "bruh-loom-data" ? "loom-bruh-ack" : "loom-neospace-ack";
        (window.opener as Window).postMessage({ type, v: 1 }, origin);
      } catch {
        /* ignore */
      }
    };

    const ingest = async (msg: Incoming, origin: string) => {
      if (handledRef.current) return;
      const files = Array.isArray(msg.files) ? msg.files.filter((f) => f?.csv && f?.name) : [];
      if (!files.length) return;
      handledRef.current = true;
      ackSender(origin, msg.type);

      const fromBruhMsg = msg.type === "bruh-loom-data";
      const store = useLoomStore.getState();
      const cache: Record<string, { stats: import("@/lib/store").ColumnInfo[]; sample: import("@/lib/store").QueryResult }> = {
        ...store.webFileCache,
      };
      const entries: FileEntry[] = [];
      const credit = msg.source?.label || (fromBruhMsg ? "bruh page" : "NeoSpace insights");
      const home = msg.source?.home || (fromBruhMsg ? "https://bruh.ibm.io/" : "https://neospace.ibm.io/");

      store.setToast("Parsing datasets…");
      for (const f of files) {
        const name = safeNeoSpaceFileName(f.name);
        const path = `web://${name}`;
        try {
          const inspect = await parseCsvToInspectResultAsync(name, f.csv);
          const rowCount = inspect.sample.total_rows ?? inspect.sample.rows.length;
          cache[path] = inspect;
          entries.push({
            path,
            name,
            extension: "csv",
            row_count: rowCount,
            size_bytes: f.csv.length,
            sourceCredit: credit,
            sourceHome: home,
          });
        } catch (e) {
          console.error("Suite CSV parse failed:", name, e);
        }
      }

      if (!entries.length) {
        handledRef.current = false;
        store.setToast(fromBruhMsg ? "Could not read bruh datasets." : "Could not read NeoSpace insight data.");
        return;
      }

      const preferredName = msg.preferred?.file ? safeNeoSpaceFileName(msg.preferred.file) : entries[0]!.name;
      const selected = entries.find((e) => e.name === preferredName) || entries[0]!;
      const inspect = cache[selected.path]!;

      store.setWebFileCache(cache);
      store.setMountedFolder(WEB_VAULT_PATH);
      store.setFiles([
        ...store.files.filter((f) => f.path.startsWith("web://") && !entries.some((e) => e.path === f.path)),
        ...entries,
      ]);
      const recs = recommend(inspect.stats, inspect.sample, selected.name);
      let active = recs[0] || null;
      let charts = recs;
      if (msg.preferred?.kind && msg.preferred.xField) {
        const kind = parseChartKind(msg.preferred.kind);
        const forced = kind
          ? createChartRec(
          kind,
          inspect.stats,
          msg.preferred.xField,
          msg.preferred.yField || null,
          msg.preferred.colorField || null,
          selected.name,
        )
          : null;
        if (forced) {
          if (msg.preferred.title) forced.title = msg.preferred.title;
          if (msg.preferred.subtitle) forced.subtitle = msg.preferred.subtitle;
          active = forced;
          charts = [forced, ...recs.filter((r) => r.id !== forced.id)];
        }
      } else {
        if (msg.preferred?.title && active) active = { ...active, title: msg.preferred.title };
        if (msg.preferred?.subtitle && active) active = { ...active, subtitle: msg.preferred.subtitle };
      }
      activateDataset({ file: selected, stats: inspect.stats, sample: inspect.sample, charts, active });
      store.addRecentFile(selected);
      store.setLastSession({ folderPath: "web://", filePath: selected.path, viewMode: "chart" });
      store.setViewMode("chart");
      store.setDataRegionOpen(false);
      store.setDataSourcesExpanded(false);
      leaveSourcesShowChart();
      store.setToast(
        fromBruhMsg
          ? `bruh · ${entries.length} dataset${entries.length > 1 ? "s" : ""} · ${selected.name}`
          : `NeoSpace insights · ${selected.name}`,
      );

      try {
        const url = new URL(window.location.href);
        url.searchParams.delete("from");
        url.searchParams.delete("dataset");
        url.searchParams.delete("hint");
        window.history.replaceState(null, "", url.pathname + url.search + url.hash);
      } catch {
        /* ignore */
      }
      handledRef.current = false;
    };

    const onMessage = (event: MessageEvent) => {
      if (!isAllowedNeoSpaceOrigin(event.origin)) return;
      const data = event.data as Incoming | null;
      if (!data || typeof data !== "object" || data.v !== 1) return;
      if (data.type !== "neospace-loom-data" && data.type !== "bruh-loom-data") return;
      void ingest(data, event.origin);
    };

    window.addEventListener("message", onMessage);
    announceReady();
    // Retry ready in case NeoSpace listener attaches late
    const t1 = window.setTimeout(announceReady, 400);
    const t2 = window.setTimeout(announceReady, 1200);

    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  return null;
}
