// =================================================================
// WebSessionResume — Restore last stream:// session on web cold load
// =================================================================
// In-memory poll buffers die on refresh. If the user last viewed a live
// source, reconnect once and open Chart so the site isn’t an empty shell.
// =================================================================

"use client";

import { useEffect, useRef } from "react";
import { useLoomStore } from "@/lib/store";
import { getLastSession } from "@/lib/persist";
import {
  isTauri,
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
    if (ran.current || isTauri()) return;
    ran.current = true;

    const session = getLastSession();
    const path = session?.filePath;
    if (!path?.startsWith("stream://")) return;

    // Let Onboarding / hydrate settle; skip if user already loaded something.
    const id = window.setTimeout(() => {
      void (async () => {
        if (useLoomStore.getState().selectedFile) return;
        // First-visit discover modal still open — don’t fight it.
        try {
          if (!window.localStorage.getItem("loom-discover-v1")) return;
        } catch {
          /* continue */
        }

        const kind = path.replace(/^stream:\/\//, "");
        const name = STREAM_NAMES[kind] ?? kind;
        try {
          if (kind === "wiki") {
            await streamStart();
            await new Promise((r) => setTimeout(r, 800));
            const snap = await streamSnapshot(500);
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
              viewMode: "chart",
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
            viewMode: "chart",
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
