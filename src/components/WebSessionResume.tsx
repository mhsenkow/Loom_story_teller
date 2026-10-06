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
import { getLastSession } from "@/lib/persist";
import { decodeDiveLink } from "@/lib/dive";
import { chartLinkDatasetLabel, decodeChartLink, isPortableChartLink, type ChartLink } from "@/lib/chartLink";
import { parseCsvToInspectResult } from "@/lib/mock-data";
import {
  fetchCsvTextWeb,
  inspectFile,
  isTauri,
  scanFolder,
  sourceStart,
  sourceSnapshot,
  streamStart,
  streamSnapshot,
  type SourceKind,
} from "@/lib/tauri";
import { recommend, recommendSourceStory, recommendStreamStory } from "@/lib/recommendations";
import { ChartLinkSync } from "./ChartLinkSync";
import { SOURCE_DEFS, SOURCE_EXPLORE_ROWS, SOURCE_BY_KIND, sourceKindFromPath } from "@/lib/sourceRegistry";
import { parseShareDataSnapshot, sharedStoryPath, storyIdFromSharedPath } from "@/lib/shareLineage";
import { guessHomepageFromDataUrl } from "@/lib/dataProvenance";

const STREAM_NAMES: Record<string, string> = {
  wiki: "Wikipedia Live",
  ...Object.fromEntries(SOURCE_DEFS.map((d) => [d.kind, d.fileName])),
};

function parseStoryId(hash: string): string | null {
  const m = hash.match(/#story=([a-z0-9]{8,16})\b/i);
  return m?.[1] ?? null;
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
    if (isTauri()) {
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
            useLoomStore.setState({ selectedFile: file, columnStats: inspect.stats, sampleRows: inspect.sample, viewMode: "dive" });
            return;
          }
          const recs = recommend(inspect.stats, inspect.sample, file.name);
          useLoomStore.setState({
            mountedFolder: "mock://demo-folder",
            files,
            selectedFile: file,
            columnStats: inspect.stats,
            sampleRows: inspect.sample,
            chartRecs: recs,
            activeChart: recs[0] ?? null,
            vegaSpec: recs[0]?.spec ?? null,
            viewMode: "chart",
          });
        } catch {
          /* leave the link banner up */
          if (chartLink) useLoomStore.getState().setToast("Couldn’t open the demo data for this shared chart");
        }
      })();
      return;
    }

    if (chartLink && !sharedSrc?.startsWith("stream://")) {
      if (chartLink.url) void openSharedCsv(chartLink.src, chartLink.url);
      else waitForFileToast(chartLink);
      return;
    }

    const session = getLastSession();
    const path = sharedSrc?.startsWith("stream://") ? sharedSrc : session?.filePath;
    if (!path?.startsWith("stream://")) return;

    // Let Onboarding / hydrate settle; skip if user already loaded something.
    const id = window.setTimeout(() => {
      void (async () => {
        if (useLoomStore.getState().selectedFile) return;
        // First-visit discover modal still open — don’t fight it (unless a link asked for this stream).
        try {
          if (!sharedSrc && !window.localStorage.getItem("loom-discover-v1")) return;
        } catch {
          /* continue */
        }

        const kind = path.replace(/^stream:\/\//, "");
        const name = STREAM_NAMES[kind] ?? kind;
        try {
          if (kind === "wiki") {
            await streamStart();
            // Fresh SSE buffers start empty — give a shared link a few seconds to fill.
            let snap = await new Promise<Awaited<ReturnType<typeof streamSnapshot>>>((r) => setTimeout(() => r(streamSnapshot(500)), 800));
            for (let i = 0; sharedSrc && i < 6 && !snap.sample.rows.length; i++) {
              await new Promise((r) => setTimeout(r, 800));
              snap = await streamSnapshot(500);
            }
            if (!snap.sample.rows.length) return;
            const file = {
              path,
              name,
              extension: "stream",
              row_count: snap.sample.total_rows,
              size_bytes: 0,
            };
            const story = recommendStreamStory(snap.stats, snap.sample);
            useLoomStore.setState({
              selectedFile: file,
              columnStats: snap.stats,
              sampleRows: snap.sample,
              streamActive: true,
              chartRecs: story.charts,
              activeChart: story.charts[0] ?? null,
              viewMode: landView,
              panelTab: "chart",
              dataSourcesExpanded: false,
              dataRegionOpen: false,
              sidebarOpen: window.matchMedia("(max-width: 767px)").matches ? false : useLoomStore.getState().sidebarOpen,
            });
            return;
          }

          await sourceStart(kind as SourceKind);
          const snap = await sourceSnapshot(kind as SourceKind, SOURCE_EXPLORE_ROWS);
          if (!snap.sample.rows.length) return;
          const file = {
            path,
            name,
            extension: "stream",
            row_count: snap.sample.total_rows,
            size_bytes: 0,
          };
          const story = recommendSourceStory(kind as SourceKind, snap.stats, snap.sample);
          useLoomStore.setState({
            selectedFile: file,
            columnStats: snap.stats,
            sampleRows: snap.sample,
            streamActive: true,
            chartRecs: story.charts,
            activeChart: story.charts[0] ?? null,
            viewMode: landView,
            panelTab: "chart",
            dataSourcesExpanded: false,
            dataRegionOpen: false,
            sidebarOpen: window.matchMedia("(max-width: 767px)").matches
              ? false
              : useLoomStore.getState().sidebarOpen,
          });
        } catch {
          /* leave empty shell — Chart CTA still works */
          if (chartLink) useLoomStore.getState().setToast("Couldn’t reach the live feed for this shared chart — try again in a moment");
        }
      })();
    }, 600);

    return () => window.clearTimeout(id);
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
    const recs = recommend(stats, sample, entry.name);
    // Point the pending chart link at this hydrated path so ChartLinkSync applies encodings.
    const pendingChart = snap.chart ? { ...snap.chart, src: path, url: undefined } : null;
    const s = useLoomStore.getState();
    useLoomStore.setState({
      webFileCache: { ...s.webFileCache, [path]: { stats, sample } },
      mountedFolder: "web://",
      files: [...s.files.filter((f) => f.path !== path), entry],
      selectedFile: entry,
      columnStats: stats,
      sampleRows: sample,
      chartRecs: recs,
      activeChart: recs[0] ?? null,
      vegaSpec: recs[0]?.spec ?? null,
      viewMode: "chart",
      panelTab: "chart",
      chartLink: pendingChart,
      dataSourcesExpanded: false,
      dataRegionOpen: false,
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
    const inspect = parseCsvToInspectResult(name, text);
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
    const recs = recommend(inspect.stats, inspect.sample, name);
    useLoomStore.setState({
      webFileCache: { ...s.webFileCache, [path]: inspect },
      mountedFolder: "web://",
      files: [...s.files.filter((f) => f.path.startsWith("web://") && f.path !== path), entry],
      selectedFile: entry,
      columnStats: inspect.stats,
      sampleRows: inspect.sample,
      chartRecs: recs,
      activeChart: recs[0] ?? null,
      vegaSpec: recs[0]?.spec ?? null,
      viewMode: "chart",
    });
  } catch {
    useLoomStore.getState().setToast(`Couldn’t download ${name} for this shared chart`);
  }
}
