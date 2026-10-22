// =================================================================
// WebSessionResume — Restore last stream:// session on web cold load
// =================================================================
// In-memory poll buffers die on refresh. If the user last viewed a live
// source, reconnect once and open Chart so the site isn’t an empty shell.
// A shared `#dive=` link wins: reopen its stream (or demo file) and land
// in Dive with the shared query. A shared `#chart=` link does the same and
// lands in Chart; ChartLinkSync (rendered here) applies the chart once the
// dataset is open and keeps the hash in sync afterwards.
// `#story={id}` hydrates the published data snapshot from `/s/{id}.data`
// so the chart the sender shared keeps the rows that built it.
// =================================================================

"use client";

import { useEffect, useRef } from "react";
import { useLoomStore } from "@/lib/store";
import { shellModeFromWidth, sidebarOverlays as sidebarOverlaysMode } from "@/lib/shellLayout";
import { getLastSession } from "@/lib/persist";
import { decodeDiveLink } from "@/lib/dive";
import { chartLinkDatasetLabel, decodeChartLink, isPortableChartLink, type ChartLink } from "@/lib/chartLink";
import { parseCsvToInspectResultAsync } from "@/lib/parseCsvAsync";
import { WEB_VAULT_PATH } from "@/lib/webDataFolder";
import {
  fetchCsvTextWeb,
  inspectFile,
  isDesktop,
  scanFolder,
  sourceStart,
  sourceSnapshot,
  streamStart,
  streamSnapshot,
  type SourceKind,
} from "@/lib/tauri";
import { activateDataset } from "@/lib/datasetPipeline";
import { ChartLinkSync } from "./ChartLinkSync";
import { probeConnection } from "@/lib/connectionStatus";
import { RECONNECTED_EVENT } from "./OfflineBanner";
import { SOURCE_DEFS, SOURCE_EXPLORE_ROWS, SOURCE_BY_KIND, sourceKindFromPath } from "@/lib/sourceRegistry";
import { parseShareDataSnapshot, sharedStoryPath, storyIdFromSharedPath } from "@/lib/shareLineage";
import { feedHealthNote, loadFeedHealth } from "@/lib/sourceHealth";
import { guessHomepageFromDataUrl } from "@/lib/dataProvenance";
import { remoteCsvLoadPrompt } from "@/lib/webSharedLink";

const STREAM_NAMES: Record<string, string> = {
  wiki: "Wikipedia Live",
  ...Object.fromEntries(SOURCE_DEFS.map((d) => [d.kind, d.fileName])),
};

function parseStoryId(hash: string): string | null {
  const m = hash.match(/#story=([a-z0-9]{8,16})\b/i);
  return m?.[1] ?? null;
}

/** Landing view + collapsed chrome applied with the resumed live feed. */
function landExtra(landView: "dive" | "chart") {
  // A notification / push opened Monitor (or a moment) — resuming the feed must not pull it away.
  const st = useLoomStore.getState();
  const stayOnMonitor = st.viewMode === "monitor" || !!st.focusedMomentId;
  return {
    viewMode: stayOnMonitor ? ("monitor" as const) : landView,
    panelTab: "chart" as const,
    dataSourcesExpanded: false,
    dataRegionOpen: false,
    sidebarOpen: sidebarOverlaysMode(shellModeFromWidth(window.innerWidth))
      ? false
      : useLoomStore.getState().sidebarOpen,
  };
}

export function WebSessionResume() {
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const hash = typeof window !== "undefined" ? window.location.hash : "";
    const storyId = parseStoryId(hash);
    if (storyId) {
      void openSharedStory(storyId);
      return;
    }

    const link = decodeDiveLink(hash);
    const chartLink = link ? null : decodeChartLink(hash);
    // #chart= pointing at a frozen share path → reload the snapshot (not a broken web://shared/…)
    const chartStoryId = chartLink ? storyIdFromSharedPath(chartLink.src) : null;
    if (chartStoryId) {
      void openSharedStory(chartStoryId);
      return;
    }
    if (link) {
      useLoomStore.setState({ diveLink: link, viewMode: "dive" });
    }
    if (chartLink) {
      useLoomStore.setState({ chartLink, viewMode: "chart" });
    }
    if (isDesktop()) {
      if (chartLink) waitForFileToast(chartLink);
      return;
    }
    const landView = link ? ("dive" as const) : ("chart" as const);
    const sharedSrc = link?.src ?? chartLink?.src;

    if (sharedSrc?.startsWith("mock://")) {
      void (async () => {
        try {
          const files = await scanFolder("");
          const entry = files.find((f) => f.path === sharedSrc);
          const inspect = await inspectFile(sharedSrc, 500);
          const file = entry ?? { path: sharedSrc, name: sharedSrc.replace(/^mock:\/\//, ""), extension: "csv", row_count: inspect.sample.total_rows, size_bytes: 0 };
          if (!chartLink) {
            activateDataset({
              file,
              stats: inspect.stats,
              sample: inspect.sample,
              shortlist: { type: "none" },
              extra: { viewMode: "dive" },
            });
            return;
          }
          activateDataset({
            file,
            stats: inspect.stats,
            sample: inspect.sample,
            extra: { mountedFolder: "mock://demo-folder", files, viewMode: "chart" },
          });
        } catch {
          /* leave the link banner up */
          if (chartLink) useLoomStore.getState().setToast("Couldn’t open the demo data for this shared chart");
        }
      })();
      return;
    }

    if (chartLink && !sharedSrc?.startsWith("stream://")) {
      if (chartLink.url) {
        if (typeof window !== "undefined" && !window.confirm(remoteCsvLoadPrompt(chartLink.url))) {
          waitForFileToast(chartLink);
          return;
        }
        void openSharedCsv(chartLink.src, chartLink.url);
      } else waitForFileToast(chartLink);
      return;
    }

    const session = getLastSession();
    const path = sharedSrc?.startsWith("stream://") ? sharedSrc : session?.filePath;
    if (!path?.startsWith("stream://")) return;

    // Let Onboarding / hydrate settle; skip if user already loaded something.
    // LOOM-416: never hammer a remote feed on a cold offline start — keep
    // local uploads usable and retry this one source when we reconnect.
    let pendingOffline = false;
    const resumeStream = async () => {
      {
        // Startup precedence (startupIntent.ts) keeps Onboarding closed whenever a
        // saved session exists, so there's no discover sheet to wait for here.
        if (useLoomStore.getState().selectedFile) return;

        const kind = path.replace(/^stream:\/\//, "");
        const name = STREAM_NAMES[kind] ?? kind;
        /** Say we tried — otherwise a down feed just lands on an empty start screen. */
        const feedDown = async () => {
          if (useLoomStore.getState().selectedFile) return;
          const { setToast } = useLoomStore.getState();
          if (chartLink) {
            setToast("Couldn’t reach the live feed for this shared chart — try again in a moment");
            return;
          }
          let note: string | null = null;
          try {
            note = feedHealthNote((await loadFeedHealth({ timeoutMs: 1500 }))[kind]);
          } catch {
            /* health is optional */
          }
          if (useLoomStore.getState().selectedFile) return;
          setToast(note ? `Couldn’t reopen ${name}. ${note}` : `Couldn’t reopen ${name} — the feed isn’t answering right now`);
        };
        try {
          if (kind === "wiki") {
            await streamStart();
            // Fresh SSE buffers start empty — give the feed a few seconds to fill
            // before calling it down (a saved session too, not just shared links).
            let snap = await new Promise<Awaited<ReturnType<typeof streamSnapshot>>>((r) => setTimeout(() => r(streamSnapshot(500)), 800));
            for (let i = 0; i < 6 && !snap.sample.rows.length; i++) {
              if (useLoomStore.getState().selectedFile) return;
              await new Promise((r) => setTimeout(r, 800));
              snap = await streamSnapshot(500);
            }
            if (useLoomStore.getState().selectedFile) return;
            if (!snap.sample.rows.length) {
              await feedDown();
              return;
            }
            const file = {
              path,
              name,
              extension: "stream",
              row_count: snap.sample.total_rows,
              size_bytes: 0,
            };
            activateDataset({
              file,
              stats: snap.stats,
              sample: snap.sample,
              shortlist: { type: "stream" },
              extra: landExtra(landView),
            });
            return;
          }

          await sourceStart(kind as SourceKind);
          const snap = await sourceSnapshot(kind as SourceKind, SOURCE_EXPLORE_ROWS);
          if (!snap.sample.rows.length) {
            await feedDown();
            return;
          }
          const file = {
            path,
            name,
            extension: "stream",
            row_count: snap.sample.total_rows,
            size_bytes: 0,
          };
          activateDataset({
            file,
            stats: snap.stats,
            sample: snap.sample,
            shortlist: { type: "source", kind: kind as SourceKind },
            extra: landExtra(landView),
          });
        } catch {
          /* leave empty shell — Chart CTA still works */
          await feedDown();
        }
      }
    };

    const id = window.setTimeout(() => {
      void (async () => {
        if (!(await probeConnection())) {
          pendingOffline = true;
          if (!useLoomStore.getState().selectedFile) {
            useLoomStore.getState().setToast("Offline — live feed can't refresh. Reopen a saved upload from Recent files; the feed resumes when you reconnect.");
          }
          return;
        }
        await resumeStream();
      })();
    }, 600);
    const onReconnect = () => {
      if (!pendingOffline) return;
      pendingOffline = false;
      void resumeStream();
    };
    window.addEventListener(RECONNECTED_EVENT, onReconnect);

    return () => {
      window.clearTimeout(id);
      window.removeEventListener(RECONNECTED_EVENT, onReconnect);
    };
  }, []);

  return <ChartLinkSync />;
}

/** Hydrate a published story’s data snapshot so the shared chart keeps its rows. */
async function openSharedStory(storyId: string) {
  try {
    const res = await fetch(`/s/${storyId}.data`);
    if (!res.ok) {
      useLoomStore.getState().setToast("Shared data expired or missing — try the live chart link instead");
      return;
    }
    const snap = parseShareDataSnapshot(await res.json());
    if (!snap) {
      useLoomStore.getState().setToast("Couldn’t read the shared data snapshot");
      return;
    }
    const path = sharedStoryPath(storyId);
    const sample = {
      columns: snap.columns,
      types: snap.types,
      rows: snap.rows,
      total_rows: snap.totalRows,
    };
    const stats =
      snap.stats ??
      snap.columns.map((name, i) => ({
        name,
        data_type: snap.types[i] ?? "VARCHAR",
        null_count: 0,
        distinct_count: Math.min(sample.rows.length, 100),
        min_value: null as string | null,
        max_value: null as string | null,
      }));
    const entry = {
      path,
      name: `${snap.source.label} (shared)`,
      extension: "csv",
      row_count: snap.totalRows,
      size_bytes: 0,
      ...(snap.source.url ? { sourceUrl: snap.source.url } : {}),
      originPath: snap.source.path,
      capturedAt: snap.capturedAt,
      sourceCredit: snap.source.label ? `${snap.source.label} · shared snapshot` : "Shared snapshot",
      sourceHome: (() => {
        const kind = sourceKindFromPath(snap.source.path);
        if (kind) return SOURCE_BY_KIND[kind].homepage;
        if (snap.source.path === "stream://wiki") return "https://www.wikimedia.org/";
        if (snap.source.url) return guessHomepageFromDataUrl(snap.source.url) ?? undefined;
        return undefined;
      })(),
    };
    // Point the pending chart link at this hydrated path so ChartLinkSync applies encodings.
    const pendingChart = snap.chart ? { ...snap.chart, src: path, url: undefined } : null;
    const s = useLoomStore.getState();
    activateDataset({
      file: entry,
      stats,
      sample,
      extra: {
        webFileCache: { ...s.webFileCache, [path]: { stats, sample } },
        mountedFolder: WEB_VAULT_PATH,
        files: [...s.files.filter((f) => f.path !== path), entry],
        viewMode: "chart",
        panelTab: "chart",
        chartLink: pendingChart,
        dataSourcesExpanded: false,
        dataRegionOpen: false,
      },
    });
    useLoomStore.getState().setToast(
      snap.truncated
        ? `Opened shared snapshot (${snap.rows.length.toLocaleString()} of ${snap.totalRows.toLocaleString()} rows)`
        : `Opened shared snapshot (${snap.rows.length.toLocaleString()} rows)`,
    );
  } catch {
    useLoomStore.getState().setToast("Couldn’t load shared data — check your connection");
  }
}

/** A shared chart built on a file only the sender has — wait for the recipient to open it. */
function waitForFileToast(link: ChartLink) {
  if (isPortableChartLink(link)) return;
  useLoomStore
    .getState()
    .setToast(`This shared chart uses ${chartLinkDatasetLabel(link)} — open that file and the chart appears`);
}

/** Refetch a catalog CSV (web:// with a source URL) and open it like Sidebar's Explore. */
async function openSharedCsv(path: string, url: string) {
  const name = path.replace(/^web:\/\//, "") || "dataset.csv";
  try {
    const { text } = await fetchCsvTextWeb(url);
    const inspect = await parseCsvToInspectResultAsync(name, text);
    const s = useLoomStore.getState();
    const entry = {
      path,
      name,
      extension: "csv",
      row_count: inspect.sample.total_rows ?? inspect.sample.rows.length,
      size_bytes: text.length,
      sourceUrl: url,
      sourceHome: guessHomepageFromDataUrl(url) ?? undefined,
    };
    activateDataset({
      file: entry,
      stats: inspect.stats,
      sample: inspect.sample,
      extra: {
        webFileCache: { ...s.webFileCache, [path]: inspect },
        mountedFolder: WEB_VAULT_PATH,
        files: [...s.files.filter((f) => f.path.startsWith("web://") && f.path !== path), entry],
        viewMode: "chart",
      },
    });
  } catch {
    useLoomStore.getState().setToast(`Couldn’t download ${name} for this shared chart`);
  }
}
