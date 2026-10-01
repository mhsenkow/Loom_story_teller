// =================================================================
// WebSessionResume — Restore last stream:// session on web cold load
// =================================================================
// In-memory poll buffers die on refresh. If the user last viewed a live
// source, reconnect once and open Chart so the site isn’t an empty shell.
// A shared `#dive=` link wins: reopen its stream (or demo file) and land
// in Dive with the shared query.
// =================================================================

"use client";

import { useEffect, useRef } from "react";
import { useLoomStore } from "@/lib/store";
import { getLastSession } from "@/lib/persist";
import { decodeDiveLink } from "@/lib/dive";
import {
  inspectFile,
  isTauri,
  scanFolder,
  sourceStart,
  sourceSnapshot,
  streamStart,
  streamSnapshot,
  type SourceKind,
} from "@/lib/tauri";
import { recommendSourceStory, recommendStreamStory } from "@/lib/recommendations";

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

    const link = typeof window !== "undefined" ? decodeDiveLink(window.location.hash) : null;
    if (link) {
      useLoomStore.setState({ diveLink: link, viewMode: "dive" });
    }
    if (isTauri()) return;
    const landView = link ? ("dive" as const) : ("chart" as const);

    if (link?.src.startsWith("mock://")) {
      void (async () => {
        try {
          const files = await scanFolder("");
          const entry = files.find((f) => f.path === link.src);
          const inspect = await inspectFile(link.src, 500);
          useLoomStore.setState({
            selectedFile: entry ?? { path: link.src, name: link.src.replace(/^mock:\/\//, ""), extension: "csv", row_count: inspect.sample.total_rows, size_bytes: 0 },
            columnStats: inspect.stats,
            sampleRows: inspect.sample,
            viewMode: "dive",
          });
        } catch {
          /* leave the link banner up */
        }
      })();
      return;
    }

    const session = getLastSession();
    const path = link?.src.startsWith("stream://") ? link.src : session?.filePath;
    if (!path?.startsWith("stream://")) return;

    // Let Onboarding / hydrate settle; skip if user already loaded something.
    const id = window.setTimeout(() => {
      void (async () => {
        if (useLoomStore.getState().selectedFile) return;
        // First-visit discover modal still open — don’t fight it (unless a link asked for this stream).
        try {
          if (!link && !window.localStorage.getItem("loom-discover-v1")) return;
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
            for (let i = 0; link && i < 6 && !snap.sample.rows.length; i++) {
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
        }
      })();
    }, 600);

    return () => window.clearTimeout(id);
  }, []);

  return null;
}
