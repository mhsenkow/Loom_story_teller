"use client";

import { useState, useCallback, useMemo, useEffect, useRef, useId, type ReactNode, type DragEvent } from "react";
import { formatVegaSpecJson } from "@/lib/vegaSpecDisplay";
import { defaultAppLookSettings, emptyChartVisualOverrides } from "@/lib/lookSettingsDefaults";
import { clampSmartFloat, clampSmartInt, SMART_TOP_N, SMART_Z } from "@/lib/smartInputClamp";
import { useIsMobile, useMobileLiveEdit, MOBILE_LIVE_EDIT_SHEET } from "@/lib/useMediaQuery";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { clearPersistedPreferences } from "@/lib/persist";
import { Button } from "@/components/ui/Button";
import { WorkspaceBackupControls } from "@/components/WorkspaceBackupControls";
import { useShallow } from "zustand/react/shallow";
import { useLoomStore, type PanelTab, type ChartVisualOverrides, type AppTheme, type FontScale } from "@/lib/store";
import { formatNumber } from "@/lib/format";
import { ChartKindPicker } from "@/components/ChartKindPicker";
import {
  AXIS_LABEL_COLOR_SWATCHES,
  AXIS_LINE_COLOR_SWATCHES,
  COLOR_PALETTES,
  palettesGrouped,
  resolveChartColors,
  type PaletteKind,
} from "@/lib/chartPalettes";
import {
  THEMES,
  THEME_LABEL,
  UI_CHROMES,
  UI_CHROME_LABEL,
  APP_FONTS,
  APP_FONT_LABEL,
  FACES_SOURCES,
  VISUAL_PRESETS,
  VISUAL_PRESET_BLURB,
  shuffleVisualOverrides,
  VISUAL_SHUFFLE_SECTIONS,
  type VisualPresetId,
  type VisualShuffleLocks,
  type VisualShuffleSection,
  normalizeTheme,
  type LookTheme,
  type UiChrome,
  type AppFont,
  type FacesSource,
} from "@/lib/lookSystem";
import { requestDiscoverScan } from "@/lib/discoverStories";
import { CHANGELOG, requestHelp, requestWhatsNew } from "@/lib/changelog";
import {
  createChartRec,
  fitEncodingToKind,
  Y_AGGREGATE_OPTIONS,
  getRecommendationReason,
  getRandomEncoding,
  applyEncodingLocks,
  chartKindDataSupport,
  tryBuildRandomChartRec,
  randomEncodingToExtra,
  recommendStorySequence,
  recommendStreamStory,
  type ChartKind,
  type YAggregateOption,
  type EncodingShuffleLocks,
} from "@/lib/recommendations";
import {
  computeDataQualityHints,
  formatChartAggregationSummary,
  chartCapabilities,
  encodingChannelLabels,
  CHART_LAYOUT_DIRECTIONS,
  CHART_Y_SCALE_OPTIONS,
  type ChartLayoutDirection,
  type ChartYScaleOption,
} from "@/lib/chartSupport";
import {
  chromeDomId,
  chromeSectionFor,
  type ChartChromeTarget,
} from "@/lib/chartChromeLink";
import { CHART_TOOLTIP_MODES, type ChartTooltipMode } from "@/lib/chartTooltipMode";
import {
  resolveDataProvenance,
  provenanceKindLabel,
  type DataProvenance,
} from "@/lib/dataProvenance";
import { TOP_N_OPTIONS, clampTopN, DEFAULT_TOP_N } from "@/lib/chartFacets";
import {
  CHART_TIME_RANGES,
  applyChartTimeWindow,
  chartTimeRangeOptions,
  pickDefaultTimeField,
  temporalColumnNames,
  timeColumnSpanMs,
  type ChartTimeRange,
} from "@/lib/chartTime";
import {
  runAnomaly,
  runForecast,
  runTrend,
  runReferenceLines,
  runClustering,
  runCorrelationMatrix,
  type AnomalyMethod,
} from "@/lib/smartAnalytics";
import { corrCellInk, corrFillT, sampleCorrDiverging, DEFAULT_CORR_DIVERGING } from "@/lib/corrMatrixStyle";
import { queryResultToCsv, downloadCsv } from "@/lib/csvExport";
import { buildDashboardMicrositeHtml } from "@/lib/dashboardMicrosite";
import { exportDashboardMicrosite, streamSnapshot, isDesktop, isTauri, openExternalUrl } from "@/lib/tauri";
import { isNumericColumnType } from "@/lib/dataCubeSchema";
import { captureStoryDashboardPreviews } from "@/lib/captureStoryPreviews";
import {
  SOCIAL_PRESETS,
  getSocialPreset,
  buildSocialCaption,
  shareOrDownloadFile,
  copyTextToClipboard,
  slugifyFilename,
  publishStoryToWorker,
  recordCanvasVideo,
} from "@/lib/socialExport";
import { downloadBlob } from "@/lib/zipStore";

export default function StatsTab() {
  const columnStats = useLoomStore((s) => s.columnStats);
  const sampleRows = useLoomStore((s) => s.sampleRows);
  const selectedFile = useLoomStore((s) => s.selectedFile);
  const statsFocusColumn = useLoomStore((s) => s.statsFocusColumn);
  const setStatsFocusColumn = useLoomStore((s) => s.setStatsFocusColumn);
  const stats = columnStats ?? [];
  const dq = useMemo(() => computeDataQualityHints(stats, sampleRows), [stats, sampleRows]);
  const provenance = useMemo(
    () =>
      resolveDataProvenance(selectedFile, {
        loadedRows: sampleRows?.rows.length ?? null,
        totalRows: sampleRows?.total_rows ?? selectedFile?.row_count ?? null,
      }),
    [selectedFile, sampleRows],
  );

  useEffect(() => {
    if (!statsFocusColumn) return;
    const el = document.getElementById(`loom-stat-${CSS.escape(statsFocusColumn)}`);
    if (el) {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      el.classList.add("ring-1", "ring-loom-accent", "ring-offset-1", "ring-offset-loom-bg");
      const t = window.setTimeout(() => {
        el.classList.remove("ring-1", "ring-loom-accent", "ring-offset-1", "ring-offset-loom-bg");
        setStatsFocusColumn(null);
      }, 2200);
      return () => window.clearTimeout(t);
    }
    setStatsFocusColumn(null);
  }, [statsFocusColumn, setStatsFocusColumn, stats]);

  if (stats.length === 0 && !provenance) {
    return (
      <div className="p-4 text-center text-sm text-loom-muted">
        No column stats. Select a file or run a query to see stats.
      </div>
    );
  }

  return (
    <div className="p-3 space-y-2">
      {provenance && <ProvenanceCard provenance={provenance} />}
      {stats.length === 0 ? (
        <div className="text-center text-sm text-loom-muted py-4">No column stats yet.</div>
      ) : (
        <>
          {(dq.nullHeavy.length > 0 || dq.constantCols.length > 0 || dq.duplicateSummary) && (
            <div className="loom-card border border-loom-border/80 p-2 space-y-1.5">
              <p className="text-xs font-semibold text-loom-text">Data health</p>
              {dq.nullHeavy.length > 0 && (
                <div className="text-2xs text-loom-muted">
                  <span className="text-loom-text font-medium">High nulls: </span>
                  {dq.nullHeavy.map((h) => `${h.name} (${h.pct}%)`).join(", ")}
                </div>
              )}
              {dq.constantCols.length > 0 && (
                <div className="text-2xs text-loom-muted">
                  <span className="text-loom-text font-medium">Constant / single value: </span>
                  {dq.constantCols.join(", ")}
                </div>
              )}
              {dq.duplicateSummary && (
                <div className="text-2xs text-loom-muted">
                  <span className="text-loom-text font-medium">Duplicates: </span>
                  {dq.duplicateSummary}
                </div>
              )}
            </div>
          )}
          {stats.map((col) => (
            <div
              key={String(col.name)}
              id={col.name ? `loom-stat-${col.name}` : undefined}
              className="loom-card space-y-1.5 scroll-mt-3 transition-shadow"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-mono font-medium text-loom-text break-words min-w-0">{col.name ?? "—"}</span>
                <span className="loom-badge shrink-0">{col.data_type ?? "?"}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-2xs font-mono">
                <StatRow label="Distinct" value={formatNumber(Number(col.distinct_count) || 0)} />
                <StatRow label="Nulls" value={formatNumber(Number(col.null_count) || 0)} />
                <StatRow label="Min" value={col.min_value != null ? String(col.min_value) : "—"} />
                <StatRow label="Max" value={col.max_value != null ? String(col.max_value) : "—"} />
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function ProvenanceCard({ provenance }: { provenance: DataProvenance }) {
  const openLink = async (href: string) => {
    try {
      if (isTauri()) await openExternalUrl(href);
      else window.open(href, "_blank", "noopener,noreferrer");
    } catch {
      window.open(href, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="loom-card border border-loom-accent/25 bg-loom-accent/5 p-2.5 space-y-2">
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="min-w-0 space-y-0.5">
          <p className="text-2xs uppercase tracking-[0.12em] text-loom-muted/90">Source</p>
          <p className="text-xs font-semibold text-loom-text leading-snug break-words" title={provenance.title}>
            {provenance.title}
          </p>
        </div>
        <span className="shrink-0 text-2xs px-1.5 py-0.5 rounded border border-loom-border/80 text-loom-muted">
          {provenanceKindLabel(provenance.kind)}
        </span>
      </div>
      {provenance.credit && (
        <p className="text-2xs text-loom-muted leading-snug">{provenance.credit}</p>
      )}
      <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-2xs text-loom-muted font-mono">
        {provenance.rowsLabel && <span>{provenance.rowsLabel}</span>}
        {provenance.capturedAt && (
          <span title={provenance.capturedAt}>
            Captured {new Date(provenance.capturedAt).toLocaleString()}
          </span>
        )}
      </div>
      {provenance.links.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {provenance.links.map((link) => (
            <button
              key={link.href}
              type="button"
              onClick={() => void openLink(link.href)}
              className="text-2xs px-2 py-1 rounded border border-loom-accent/40 text-loom-accent hover:bg-loom-accent/10 transition-colors"
              title={link.href}
            >
              {link.label} ↗
            </button>
          ))}
        </div>
      )}
      {!provenance.links.length && provenance.kind === "local" && (
        <p className="text-2xs text-loom-muted/80 leading-snug">
          Local file — no public URL on this dataset. Export / share will still credit the filename.
        </p>
      )}
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  const wide = value.length > 10;
  return (
    <div className={`flex justify-between items-baseline gap-2 ${wide ? "col-span-2" : ""}`}>
      <span className="text-loom-muted shrink-0">{label}</span>
      <span className="text-loom-text text-right break-words min-w-0" title={value}>{value}</span>
    </div>
  );
}
