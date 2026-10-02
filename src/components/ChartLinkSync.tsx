// =================================================================
// ChartLinkSync — keep `#chart=` in the URL and apply shared links
// =================================================================
// 1. While Chart view is showing, mirror the chart setup into the hash
//    (debounced replaceState) so the address bar is always shareable.
//    Leaving Chart view drops `#chart=` (Dive writes its own `#dive=`).
// 2. When a shared link is pending (store `chartLink`, set by
//    WebSessionResume) and its dataset is open, rebuild the chart from
//    the columns and apply overrides, then clear the pending link.
// =================================================================

"use client";

import { useEffect, useRef } from "react";
import { useLoomStore, type ChartVisualOverrides } from "@/lib/store";
import {
  chartLinkDatasetLabel,
  chartLinkFromState,
  chartLinkMatchesFile,
  encodeChartLink,
  restoreChartRec,
} from "@/lib/chartLink";

const SYNC_DEBOUNCE_MS = 400;

/** Absolute share URL for the current chart, or null when there's nothing to share. */
export function currentChartShareUrl(): string | null {
  if (typeof window === "undefined") return null;
  const link = chartLinkFromState(useLoomStore.getState());
  if (!link) return null;
  return `${window.location.origin}${window.location.pathname}#${encodeChartLink(link)}`;
}

function replaceHash(hash: string) {
  const url = `${window.location.pathname}${window.location.search}${hash}`;
  window.history.replaceState(window.history.state, "", url);
}

export function ChartLinkSync() {
  const viewMode = useLoomStore((s) => s.viewMode);
  const selectedFile = useLoomStore((s) => s.selectedFile);
  const activeChart = useLoomStore((s) => s.activeChart);
  const chartTitleOverrides = useLoomStore((s) => s.chartTitleOverrides);
  const chartVisualOverrides = useLoomStore((s) => s.chartVisualOverrides);
  const barStackMode = useLoomStore((s) => s.barStackMode);
  const connectScatterTrail = useLoomStore((s) => s.connectScatterTrail);
  const showMarginals = useLoomStore((s) => s.showMarginals);
  const chartAspect = useLoomStore((s) => s.appSettings.chartAspect);
  const chartDevice = useLoomStore((s) => s.appSettings.chartDevice);
  const columnStats = useLoomStore((s) => s.columnStats);
  const sampleRows = useLoomStore((s) => s.sampleRows);
  const inspectingFilePath = useLoomStore((s) => s.inspectingFilePath);
  const chartLink = useLoomStore((s) => s.chartLink);
  const prevView = useRef<string | null>(null);

  // Apply a shared link once its dataset (columns + rows) is open.
  useEffect(() => {
    if (!chartLink || !selectedFile || !chartLinkMatchesFile(chartLink, selectedFile)) return;
    if (!columnStats.length || !sampleRows || inspectingFilePath === selectedFile.path) return;
    const s = useLoomStore.getState();
    const rec = restoreChartRec(chartLink, columnStats, s.chartRecs, selectedFile.name.replace(/\.\w+$/, ""));
    if (!rec) {
      s.setChartLink(null);
      s.setToast("This data no longer has the columns the shared chart uses");
      return;
    }
    useLoomStore.setState({
      activeChart: rec,
      vegaSpec: rec.spec ?? null,
      aiSuggestionReason: null,
      chartRecs: s.chartRecs.some((r) => r.id === rec.id) ? s.chartRecs : [rec, ...s.chartRecs],
      chartVisualOverrides: { ...(chartLink.visual ?? {}) } as ChartVisualOverrides,
      chartTitleOverrides: chartLink.titleOverride
        ? { ...s.chartTitleOverrides, [rec.id]: chartLink.titleOverride }
        : (() => {
            const next = { ...s.chartTitleOverrides };
            delete next[rec.id];
            return next;
          })(),
      barStackMode: chartLink.barStackMode ?? "grouped",
      connectScatterTrail: !!chartLink.connectScatterTrail,
      showMarginals: !!chartLink.showMarginals,
      appSettings: {
        ...s.appSettings,
        chartAspect: chartLink.chartAspect ?? "free",
        chartDevice: chartLink.chartDevice ?? "auto",
      },
      viewMode: "chart",
      panelTab: s.panelTab === "settings" ? "chart" : s.panelTab,
      chartLink: null,
    });
    s.setToast(`Opened shared chart · ${chartLinkDatasetLabel(chartLink)}`);
  }, [chartLink, selectedFile, columnStats, sampleRows, inspectingFilePath]);

  // Mirror the chart setup into the hash while Chart view is showing.
  useEffect(() => {
    const was = prevView.current;
    prevView.current = viewMode;
    if (viewMode !== "chart") {
      // Only on the way out of Chart — never on first mount, where a shared
      // #chart= link may not have been read yet.
      if (was === "chart" && !useLoomStore.getState().chartLink && window.location.hash.startsWith("#chart=")) replaceHash("");
      return;
    }
    if (chartLink) return; // keep the shared link in the bar until it applies
    const link = chartLinkFromState({
      selectedFile,
      activeChart,
      chartTitleOverrides,
      chartVisualOverrides,
      barStackMode,
      connectScatterTrail,
      showMarginals,
      appSettings: { chartAspect, chartDevice },
    });
    if (!link) return;
    const hash = `#${encodeChartLink(link)}`;
    const id = window.setTimeout(() => {
      if (useLoomStore.getState().viewMode !== "chart") return;
      if (window.location.hash !== hash) replaceHash(hash);
    }, SYNC_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [
    viewMode,
    chartLink,
    selectedFile,
    activeChart,
    chartTitleOverrides,
    chartVisualOverrides,
    barStackMode,
    connectScatterTrail,
    showMarginals,
    chartAspect,
    chartDevice,
  ]);

  return null;
}
