// =================================================================
// WebSessionResume — Restore last stream:// session on web cold load
// =================================================================
// In-memory poll buffers die on refresh. If the user last viewed a live
// source, reconnect once and open Chart so the site isn’t an empty shell.
// A shared `#dive=` link wins: reopen its stream (or demo file) and land
// in Dive with the shared query. A shared `#chart=` link does the same and
// lands in Chart; ChartLinkSync (rendered here) applies the chart once the
// dataset is open and keeps the hash in sync afterwards.
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

const STREAM_NAMES: Record<string, string> = {
  wiki: "Wikipedia Live",
  usgs: "USGS Quakes",
  meteo: "World Weather",
  nws: "NWS Alerts",
  world_bank: "World Bank",
  iss: "ISS Track",
  hn: "HN Front Page",
  crypto: "Crypto Markets",
  aq: "Air Quality",
  fx: "FX Rates",
  fema: "FEMA Disasters",
  opensky: "OpenSky Aircraft",
  countries: "World Countries",
  spacex: "SpaceX Launches",
  nyc311: "NYC 311",
  covid: "COVID Countries",
  launches: "Space Launches",
};

export function WebSessionResume() {
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const hash = typeof window !== "undefined" ? window.location.hash : "";
    const link = decodeDiveLink(hash);
    const chartLink = link ? null : decodeChartLink(hash);
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
          const snap = await sourceSnapshot(kind as SourceKind, 500);
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
