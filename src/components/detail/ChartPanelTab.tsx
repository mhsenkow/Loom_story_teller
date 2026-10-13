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

const DRAG_TYPE_COLUMN = "application/x-loom-column";

type EncodingOption = { value: string; label: string; type?: string; disabled?: boolean };

/** Single channel control: label + select (+ optional type), doubles as column drop target. */
function EncodingSlot({
  label,
  value,
  options,
  typeHint,
  allowEmpty,
  emptyLabel = "None",
  isDropActive,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  onChange,
  trailing,
  chromeTarget,
  chromeActive,
  onChromeEnter,
  onChromeLeave,
}: {
  label: string;
  value: string;
  options: EncodingOption[];
  typeHint?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  isDropActive?: boolean;
  onDragEnter?: (e: DragEvent) => void;
  onDragOver?: (e: DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: DragEvent) => void;
  onChange: (value: string) => void;
  trailing?: ReactNode;
  chromeTarget?: ChartChromeTarget;
  chromeActive?: boolean;
  onChromeEnter?: (target: ChartChromeTarget) => void;
  onChromeLeave?: () => void;
}) {
  const droppable = Boolean(onDrop);
  return (
    <div
      className="space-y-1"
      id={chromeTarget ? chromeDomId(chromeTarget) : undefined}
      data-chrome-target={chromeTarget}
      onMouseEnter={chromeTarget && onChromeEnter ? () => onChromeEnter(chromeTarget) : undefined}
      onMouseLeave={onChromeLeave}
    >
      <div
        onDragEnter={
          droppable
            ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                onDragEnter?.(e);
              }
            : undefined
        }
        onDragOver={
          droppable
            ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "copy";
                onDragOver?.(e);
              }
            : undefined
        }
        onDragLeave={
          droppable
            ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                onDragLeave?.();
              }
            : undefined
        }
        onDrop={
          droppable
            ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                onDrop?.(e);
              }
            : undefined
        }
        className={`
          flex items-stretch gap-0 rounded-md border overflow-hidden transition-colors
          ${chromeActive ? "border-loom-accent bg-loom-accent/15 ring-2 ring-loom-accent/50" : ""}
          ${!chromeActive && isDropActive ? "border-loom-accent bg-loom-accent/10 ring-1 ring-loom-accent/40" : ""}
          ${!chromeActive && !isDropActive ? "border-loom-border bg-loom-elevated/40" : ""}
          ${droppable && !isDropActive && !chromeActive ? "border-dashed" : ""}
        `}
      >
        <span
          className="shrink-0 w-[4.5rem] px-1.5 flex items-center text-2xs font-semibold uppercase tracking-wide text-loom-muted bg-loom-bg/60 border-r border-loom-border/80 leading-tight"
          title={droppable ? `${label} — pick a column or drop from Schema` : label}
        >
          {label}
        </span>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="loom-input flex-1 min-w-0 border-0 rounded-none bg-transparent text-xs py-2 px-2 font-mono focus:ring-0"
          aria-label={`${label} field`}
        >
          {allowEmpty && <option value="">{emptyLabel}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled} title={o.type}>
              {o.type ? `${o.label}` : o.label}
            </option>
          ))}
        </select>
        {typeHint ? (
          <span className="hidden sm:flex shrink-0 max-w-[5.5rem] items-center px-1.5 text-2xs font-mono text-loom-muted truncate border-l border-loom-border/80" title={typeHint}>
            {typeHint.replace(/^(VARCHAR|DOUBLE|INTEGER|BIGINT|BOOLEAN|TIMESTAMP|FLOAT|DECIMAL|REAL)/i, (m) => m.slice(0, 3).toUpperCase())}
          </span>
        ) : null}
      </div>
      {trailing}
    </div>
  );
}

function EncodingSectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-2xs font-semibold text-loom-muted uppercase tracking-wider pt-1">{children}</p>
  );
}

type IconToggleOption<T extends string | number> = {
  value: T;
  label: string;
  icon: ReactNode;
};

const COLOR_SCALE_KIND_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "categorical", label: "Categorical" },
  { value: "sequential", label: "Sequential" },
  { value: "diverging", label: "Diverging" },
  { value: "spectrum", label: "Spectrum" },
  { value: "semantic", label: "Semantic" },
] as const;

const PALETTE_KIND_LABELS: Record<PaletteKind | "auto", string> = {
  auto: "Auto",
  categorical: "Categorical",
  sequential: "Sequential",
  diverging: "Diverging",
  semantic: "Semantic",
  reference: "Reference",
  spectrum: "Spectrum",
};

const MARK_SHAPE_OPTIONS = [
  { value: "circle", label: "Circle" },
  { value: "square", label: "Square" },
  { value: "diamond", label: "Diamond" },
  { value: "triangle", label: "Triangle" },
  { value: "cross", label: "Cross" },
  { value: "star", label: "Star" },
  { value: "hexagon", label: "Hexagon" },
  { value: "ring", label: "Ring" },
] as const;

const BLEND_MODE_OPTIONS: { value: GlobalCompositeOperation; label: string }[] = [
  { value: "source-over", label: "Normal" },
  { value: "screen", label: "Screen" },
  { value: "multiply", label: "Multiply" },
  { value: "lighten", label: "Lighten" },
];

/** Compact icon button group for small discrete option sets (≤6). */
function IconToggleGroup<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: IconToggleOption<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div>
      <p className="text-2xs text-loom-muted mb-1">{label}</p>
      <div className="flex flex-wrap gap-1" role="group" aria-label={label}>
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={String(opt.value)}
              type="button"
              title={opt.label}
              aria-label={opt.label}
              aria-pressed={active}
              onClick={() => onChange(opt.value)}
              className={`
                min-h-9 min-w-9 px-2 rounded-md border flex items-center justify-center transition-colors
                ${active
                  ? "border-loom-accent bg-loom-accent/15 text-loom-text"
                  : "border-loom-border text-loom-muted hover:border-loom-accent/40 hover:text-loom-text hover:bg-loom-elevated"}
              `}
            >
              {opt.icon}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ColorSwatchGroup({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string; color: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <p className="text-2xs text-loom-muted mb-1">{label}</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              title={opt.label}
              aria-label={opt.label}
              aria-pressed={active}
              onClick={() => onChange(opt.value)}
              className={`
                min-h-9 min-w-9 rounded-md border flex items-center justify-center transition-colors
                ${active ? "border-loom-accent ring-1 ring-loom-accent/50" : "border-loom-border hover:border-loom-accent/40"}
              `}
            >
              <span
                className="w-4 h-4 rounded-sm border border-loom-border/70"
                style={{
                  background:
                    opt.color === "theme"
                      ? "var(--loom-border)"
                      : opt.color,
                }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

const Ico = {
  plain: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="2" y="3" width="12" height="10" rx="1" />
    </svg>
  ),
  viz: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M2 12V8M6 12V5M10 12V7M14 12V3" strokeLinecap="round" />
    </svg>
  ),
  deep: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M2 13V6M5 13V4M8 13V7M11 13V3M14 13V8" strokeLinecap="round" />
      <path d="M2 3h12" opacity="0.4" />
    </svg>
  ),
  dots: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <circle cx="4" cy="5" r="1.5" /><circle cx="9" cy="8" r="1.5" /><circle cx="12" cy="4" r="1.5" /><circle cx="6" cy="12" r="1.5" />
    </svg>
  ),
  squares: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <rect x="2" y="3" width="4" height="4" rx="0.5" /><rect x="9" y="6" width="4" height="4" rx="0.5" /><rect x="5" y="11" width="3" height="3" rx="0.5" />
    </svg>
  ),
  ticks: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M3 4v3M7 6v5M11 3v4M14 8v3" strokeLinecap="round" />
    </svg>
  ),
  bar: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <rect x="2" y="8" width="3" height="6" rx="0.5" /><rect x="6.5" y="4" width="3" height="10" rx="0.5" /><rect x="11" y="6" width="3" height="8" rx="0.5" />
    </svg>
  ),
  ring: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <circle cx="8" cy="8" r="4.5" /><circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  ),
  rule: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M3 13h10M3 13V3" strokeLinecap="round" />
    </svg>
  ),
  ladder: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M3 13h10M3 13V3M3 6h4M3 9h6M3 11h3" strokeLinecap="round" />
    </svg>
  ),
  mercury: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M8 2v9" strokeLinecap="round" /><circle cx="8" cy="13" r="2" fill="currentColor" stroke="none" />
    </svg>
  ),
  spine: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M8 2v12M3 13h10" strokeLinecap="round" />
    </svg>
  ),
  index: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M3 13h10M3 13V3M2 5h3M2 8h3M2 11h3" strokeLinecap="round" />
    </svg>
  ),
  tape: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M2 12h12M4 12V8M7 12V5M10 12V9M13 12V6" strokeLinecap="round" opacity="0.85" />
      <path d="M2 4h12" strokeDasharray="2 2" />
    </svg>
  ),
  tint: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <rect x="2" y="3" width="12" height="10" rx="1" opacity="0.35" /><rect x="5" y="6" width="6" height="4" rx="0.5" />
    </svg>
  ),
  wash: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <rect x="2" y="3" width="12" height="10" rx="1" opacity="0.2" /><path d="M2 8h12" stroke="currentColor" strokeWidth="3" opacity="0.45" />
    </svg>
  ),
  dot: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <circle cx="8" cy="8" r="5" opacity="0.35" /><circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" />
    </svg>
  ),
  alarm: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M8 3l6 10H2L8 3z" strokeLinejoin="round" /><circle cx="8" cy="11" r="0.8" fill="currentColor" stroke="none" /><path d="M8 7v2.5" strokeLinecap="round" />
    </svg>
  ),
  tag: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M2 8l6-6h5v5L7 13 2 8z" strokeLinejoin="round" /><circle cx="11" cy="5" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  pair: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M2 4h8M2 7h5" strokeLinecap="round" /><rect x="2" y="10" width="12" height="4" rx="0.5" opacity="0.4" />
    </svg>
  ),
  stack: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M3 3h10M3 6h7M3 9h10M3 12h6" strokeLinecap="round" />
    </svg>
  ),
  titleSpine: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M3 3v10M6 4h7M6 7h5" strokeLinecap="round" />
    </svg>
  ),
  caption: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <rect x="2" y="2" width="12" height="8" rx="1" opacity="0.45" /><path d="M3 13h10M3 15h6" strokeLinecap="round" />
    </svg>
  ),
  ticket: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <rect x="2" y="4" width="12" height="8" rx="1" /><path d="M5 4v8" strokeDasharray="1.5 1.5" /><path d="M7 7h5M7 9h3" strokeLinecap="round" />
    </svg>
  ),
  slab: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <rect x="2" y="3" width="12" height="4" rx="0.5" /><rect x="2" y="9" width="12" height="4" rx="0.5" opacity="0.35" />
    </svg>
  ),
  hero: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <rect x="1.5" y="2" width="13" height="12" rx="1" /><path d="M4 6h8M4 9h5" strokeLinecap="round" />
    </svg>
  ),
  compact: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <rect x="4" y="4" width="8" height="8" rx="1" /><path d="M6 7h4M6 9h2" strokeLinecap="round" />
    </svg>
  ),
  focus: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3" strokeLinecap="round" strokeLinejoin="round" /><circle cx="8" cy="8" r="2" />
    </svg>
  ),
  whisper: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <circle cx="8" cy="8" r="5" opacity="0.2" />
    </svg>
  ),
  soft: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <circle cx="8" cy="8" r="5" opacity="0.45" />
    </svg>
  ),
  firm: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <circle cx="8" cy="8" r="5" opacity="0.8" />
    </svg>
  ),
  se: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <rect x="2" y="2" width="12" height="12" rx="1" opacity="0.4" /><circle cx="11" cy="11" r="2" fill="currentColor" stroke="none" />
    </svg>
  ),
  sw: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <rect x="2" y="2" width="12" height="12" rx="1" opacity="0.4" /><circle cx="5" cy="11" r="2" fill="currentColor" stroke="none" />
    </svg>
  ),
  ne: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <rect x="2" y="2" width="12" height="12" rx="1" opacity="0.4" /><circle cx="11" cy="5" r="2" fill="currentColor" stroke="none" />
    </svg>
  ),
  nw: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <rect x="2" y="2" width="12" height="12" rx="1" opacity="0.4" /><circle cx="5" cy="5" r="2" fill="currentColor" stroke="none" />
    </svg>
  ),
  tipAuto: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <circle cx="8" cy="8" r="5.5" strokeDasharray="2.5 2" /><circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  ),
  tipHover: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M3 3l4 9 1.5-3.5L12 7 3 3z" strokeLinejoin="round" /><rect x="8" y="2" width="6" height="4" rx="0.8" opacity="0.85" />
    </svg>
  ),
  tipGlass: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <rect x="3" y="4" width="10" height="8" rx="2" opacity="0.55" /><path d="M5 7h6M5 9.5h4" strokeLinecap="round" opacity="0.9" />
    </svg>
  ),
  tipDock: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <rect x="2" y="2" width="12" height="8" rx="1" opacity="0.35" /><rect x="2" y="11" width="12" height="3" rx="0.8" fill="currentColor" stroke="none" opacity="0.85" />
    </svg>
  ),
  tipCompact: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <rect x="2" y="6" width="12" height="4" rx="2" /><path d="M5 8h6" strokeLinecap="round" />
    </svg>
  ),
  tipOff: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <rect x="3" y="4" width="10" height="7" rx="1.5" /><path d="M3 3l10 10" strokeLinecap="round" />
    </svg>
  ),
  alignLeft: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M3 4h10M3 7h7M3 10h10M3 13h6" strokeLinecap="round" />
    </svg>
  ),
  alignCenter: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M3 4h10M5 7h6M3 10h10M5 13h6" strokeLinecap="round" />
    </svg>
  ),
  alignRight: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M3 4h10M6 7h7M3 10h10M7 13h6" strokeLinecap="round" />
    </svg>
  ),
  weightLight: <span className="text-2xs font-light leading-none">Ag</span>,
  weightRegular: <span className="text-2xs font-normal leading-none">Ag</span>,
  weightSemi: <span className="text-2xs font-semibold leading-none">Ag</span>,
  weightBold: <span className="text-2xs font-bold leading-none">Ag</span>,
  rot0: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M3 12h10" /><text x="4" y="9" fontSize="6" fill="currentColor" stroke="none">abc</text>
    </svg>
  ),
  rot30: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <path d="M3 12h10" /><path d="M5 11l3-5" strokeLinecap="round" /><path d="M9 11l3-5" strokeLinecap="round" />
    </svg>
  ),
  rot45: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <path d="M3 12h10" /><path d="M5 11l4-4" strokeLinecap="round" /><path d="M9 11l4-4" strokeLinecap="round" />
    </svg>
  ),
  rot60: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <path d="M3 12h10" /><path d="M6 11l2-6" strokeLinecap="round" /><path d="M10 11l2-6" strokeLinecap="round" />
    </svg>
  ),
  rot90: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <path d="M3 12h10" /><path d="M6 11V4" strokeLinecap="round" /><path d="M10 11V4" strokeLinecap="round" />
    </svg>
  ),
  solid: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M2 8h12" strokeLinecap="round" />
    </svg>
  ),
  dashed: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M2 8h12" strokeLinecap="round" strokeDasharray="3 2" />
    </svg>
  ),
  dotted: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M2 8h12" strokeLinecap="round" strokeDasharray="1 2.5" />
    </svg>
  ),
  none: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <circle cx="8" cy="8" r="5" /><path d="M4.5 4.5l7 7" strokeLinecap="round" />
    </svg>
  ),
} as const;


// --- Save chart view button (used in Chart tab) ---
function SaveChartViewButton() {
  const selectedFile = useLoomStore((s) => s.selectedFile);
  const activeChart = useLoomStore((s) => s.activeChart);
  const chartVisualOverrides = useLoomStore((s) => s.chartVisualOverrides);
  const addChartView = useLoomStore((s) => s.addChartView);
  const setToast = useLoomStore((s) => s.setToast);
  const setPromptDialog = useLoomStore((s) => s.setPromptDialog);
  const querySql = useLoomStore((s) => s.querySql);
  const sampleRows = useLoomStore((s) => s.sampleRows);
  const pngExportHandler = useLoomStore((s) => s.pngExportHandler);
  if (!selectedFile || !activeChart) return null;
  return (
    <button
      type="button"
      onClick={() => {
        setPromptDialog({
          title: "Name for this chart view",
          defaultValue: activeChart.title || "Chart view",
          onConfirm: async (name) => {
            if (name == null || !name.trim()) return;
            let snapshotImageDataUrl: string | null = null;
            if (pngExportHandler) {
              try {
                const blob = await pngExportHandler();
                if (blob) {
                  snapshotImageDataUrl = await new Promise<string>((res, rej) => {
                    const r = new FileReader();
                    r.onload = () => res(r.result as string);
                    r.onerror = rej;
                    r.readAsDataURL(blob);
                  });
                }
              } catch (_) { /* ignore */ }
            }
            const sample = sampleRows ? { columns: sampleRows.columns, types: sampleRows.types ?? [], rows: sampleRows.rows, total_rows: sampleRows.total_rows } : undefined;
            const ok = addChartView(name.trim(), selectedFile.path, selectedFile.name, activeChart, { ...chartVisualOverrides }, querySql, sample, snapshotImageDataUrl);
            setToast(ok ? "Chart view saved. Add it in the Dashboards tab with \"Add to dashboard\" or \"+ Add view\"." : "Could not save chart view");
          }
        });
      }}
      className="text-2xs py-0.5 px-1.5 rounded border border-loom-border text-loom-muted hover:text-loom-text hover:border-loom-accent"
    >
      Save view
    </button>
  );
}

export default function ChartPanelTab() {
  const {
    activeChart,
    vegaSpec,
    sampleRows,
    columnStats,
    chartVisualOverrides,
    setChartVisualOverrides,
    setActiveChart,
    selectedFile,
    aiSuggestionReason,
    chartAnnotations,
    addChartAnnotation,
    removeChartAnnotation,
    barStackMode,
    setBarStackMode,
    connectScatterTrail,
    setConnectScatterTrail,
    showMarginals,
    setShowMarginals,
    customRefLines,
    addCustomRefLine,
    removeCustomRefLine,
    setPromptDialog,
    setToast,
    appSettings,
    chartPanelSection,
    setChartPanelSection,
    chartChromeFocus,
    setChartChromeFocus,
    pushChartEditUndo,
    lockedColorField,
    setLockedColorField,
    unlockColorAndResetLocks,
  } = useLoomStore(
    useShallow((s) => ({
      activeChart: s.activeChart,
      vegaSpec: s.vegaSpec,
      sampleRows: s.sampleRows,
      columnStats: s.columnStats,
      chartVisualOverrides: s.chartVisualOverrides,
      setChartVisualOverrides: s.setChartVisualOverrides,
      setActiveChart: s.setActiveChart,
      selectedFile: s.selectedFile,
      aiSuggestionReason: s.aiSuggestionReason,
      chartAnnotations: s.chartAnnotations,
      addChartAnnotation: s.addChartAnnotation,
      removeChartAnnotation: s.removeChartAnnotation,
      barStackMode: s.barStackMode,
      setBarStackMode: s.setBarStackMode,
      connectScatterTrail: s.connectScatterTrail,
      setConnectScatterTrail: s.setConnectScatterTrail,
      showMarginals: s.showMarginals,
      setShowMarginals: s.setShowMarginals,
      customRefLines: s.customRefLines,
      addCustomRefLine: s.addCustomRefLine,
      removeCustomRefLine: s.removeCustomRefLine,
      setPromptDialog: s.setPromptDialog,
      setToast: s.setToast,
      appSettings: s.appSettings,
      chartPanelSection: s.chartPanelSection,
      setChartPanelSection: s.setChartPanelSection,
      chartChromeFocus: s.chartChromeFocus,
      setChartChromeFocus: s.setChartChromeFocus,
      pushChartEditUndo: s.pushChartEditUndo,
      lockedColorField: s.lockedColorField,
      setLockedColorField: s.setLockedColorField,
      unlockColorAndResetLocks: s.unlockColorAndResetLocks,
    })),
  );
  const [specExpanded, setSpecExpanded] = useState(true);
  const [specCopyOk, setSpecCopyOk] = useState(false);
  const [dragOverSlot, setDragOverSlot] = useState<"x" | "y" | "color" | null>(null);
  const [activeChartOpen, setActiveChartOpen] = useState(true);

  const focusChromeFromPanel = useCallback(
    (target: ChartChromeTarget) => {
      setChartChromeFocus({ section: chromeSectionFor(target), target, source: "panel" });
    },
    [setChartChromeFocus],
  );
  const clearChromeFromPanel = useCallback(() => {
    const cur = useLoomStore.getState().chartChromeFocus;
    if (cur?.source === "panel") setChartChromeFocus(null);
  }, [setChartChromeFocus]);

  // Chart hovered an axis / title → switch tab and scroll the matching control into view
  useEffect(() => {
    if (!chartChromeFocus || chartChromeFocus.source !== "chart") return;
    const el = document.getElementById(chromeDomId(chartChromeFocus.target));
    if (!el) return;
    const t = window.setTimeout(() => {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 80);
    return () => window.clearTimeout(t);
  }, [chartChromeFocus]);
  const [vegaOpen, setVegaOpen] = useState(false);
  const [chartWhyOpen, setChartWhyOpen] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(true);
  const [moreChannelsOpen, setMoreChannelsOpen] = useState(() =>
    Boolean(
      activeChart?.sizeField ||
        activeChart?.glowField ||
        activeChart?.outlineField ||
        activeChart?.opacityField,
    ),
  );
  const [encodingLocks, setEncodingLocks] = useState<EncodingShuffleLocks>({});
  const [visualLocks, setVisualLocks] = useState<VisualShuffleLocks>({});

  const toggleEncodingLock = useCallback((key: keyof EncodingShuffleLocks) => {
    setEncodingLocks((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const toggleVisualLock = useCallback((key: VisualShuffleSection) => {
    setVisualLocks((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const tableName = selectedFile?.name?.replace(/\.\w+$/, "") ?? "";

  const extraFromChart = useCallback(
    () => ({
      sizeField: activeChart?.sizeField ?? null,
      zField: activeChart?.zField ?? null,
      timeField: activeChart?.timeField ?? null,
      trailId: activeChart?.trailId ?? null,
      rowField: activeChart?.rowField ?? null,
      glowField: activeChart?.glowField ?? null,
      outlineField: activeChart?.outlineField ?? null,
      opacityField: activeChart?.opacityField ?? null,
      yAggregate: activeChart?.yAggregate ?? null,
      topN: activeChart?.topN ?? null,
      y2Field: activeChart?.y2Field ?? null,
      comparePrevious: activeChart?.comparePrevious ?? null,
      rollingWindow: activeChart?.rollingWindow ?? null,
      yScale: activeChart?.yScale ?? null,
      seriesNormalize: activeChart?.seriesNormalize ?? null,
      residualOverlay: activeChart?.residualOverlay ?? null,
      anomalyHighlight: activeChart?.anomalyHighlight ?? null,
      bumpMode: activeChart?.bumpMode ?? null,
      timeWindowField: activeChart?.timeWindowField ?? null,
      timeWindow: activeChart?.timeWindow ?? null,
      tooltipFields: activeChart?.tooltipFields,
      tooltipKeyField: activeChart?.tooltipKeyField ?? null,
      layoutDirection: activeChart?.layoutDirection ?? null,
      barStackMode,
    }),
    [
      activeChart?.sizeField,
      activeChart?.zField,
      activeChart?.timeField,
      activeChart?.trailId,
      activeChart?.rowField,
      activeChart?.glowField,
      activeChart?.outlineField,
      activeChart?.opacityField,
      activeChart?.yAggregate,
      activeChart?.topN,
      activeChart?.y2Field,
      activeChart?.comparePrevious,
      activeChart?.rollingWindow,
      activeChart?.yScale,
      activeChart?.seriesNormalize,
      activeChart?.residualOverlay,
      activeChart?.anomalyHighlight,
      activeChart?.bumpMode,
      activeChart?.timeWindowField,
      activeChart?.timeWindow,
      activeChart?.tooltipFields,
      activeChart?.tooltipKeyField,
      activeChart?.layoutDirection,
      barStackMode,
    ],
  );

  const handleDrop = useCallback(
    (slot: "x" | "y" | "color") => (e: DragEvent) => {
      e.preventDefault();
      setDragOverSlot(null);
      const colName = e.dataTransfer.getData(DRAG_TYPE_COLUMN) || e.dataTransfer.getData("text/plain");
      if (!colName || !activeChart || columnStats.length === 0) return;
      const newX = slot === "x" ? colName : activeChart.xField;
      const newY = slot === "y" ? colName : activeChart.yField;
      const newColor = slot === "color" ? colName : activeChart.colorField;
      const rec = createChartRec(activeChart.kind, columnStats, newX, newY, newColor, tableName, extraFromChart());
      if (rec) setActiveChart(rec);
    },
    [activeChart, columnStats, tableName, setActiveChart, extraFromChart],
  );

  const handleDragEnter = useCallback((slot: "x" | "y" | "color") => () => setDragOverSlot(slot), []);
  const handleDragOver = useCallback((slot: "x" | "y" | "color") => (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragOverSlot(slot);
  }, []);
  const handleDragLeave = useCallback(() => setDragOverSlot(null), []);

  const updateOverride = useCallback(
    (key: keyof ChartVisualOverrides, value: number | string | boolean | undefined) => {
      setChartVisualOverrides((prev) => ({ ...prev, [key]: value }));
    },
    [setChartVisualOverrides],
  );

  const handleCopySpec = useCallback(() => {
    if (!vegaSpec) return;
    const json = JSON.stringify(vegaSpec, null, 2);
    navigator.clipboard.writeText(json).then(() => {
      setSpecCopyOk(true);
      setTimeout(() => setSpecCopyOk(false), 1500);
    });
  }, [vegaSpec]);

  const applyEncoding = useCallback(
    (slot: "x" | "y" | "color", colName: string) => {
      if (!activeChart || columnStats.length === 0) return;
      const newX = slot === "x" ? colName : activeChart.xField;
      const newY = slot === "y" ? (colName === "" ? null : colName) : activeChart.yField;
      const newColor = slot === "color" ? (colName === "__none__" || colName === "" ? null : colName) : activeChart.colorField;
      const rec = createChartRec(activeChart.kind, columnStats, newX, newY, newColor, tableName, extraFromChart());
      if (rec) setActiveChart(rec);
    },
    [activeChart, columnStats, tableName, setActiveChart, extraFromChart],
  );

  const applyEncodingExtra = useCallback(
    (slot: "size" | "z" | "row" | "glow" | "outline" | "opacity" | "y2", colName: string) => {
      if (!activeChart || columnStats.length === 0) return;
      const sizeField = slot === "size" ? (colName === "__none__" || colName === "" ? null : colName) : (activeChart.sizeField ?? null);
      const zField = slot === "z" ? (colName === "__none__" || colName === "" ? null : colName) : (activeChart.zField ?? null);
      const rowField = slot === "row" ? (colName === "__none__" || colName === "" ? null : colName) : (activeChart.rowField ?? null);
      const glowField = slot === "glow" ? (colName === "__none__" || colName === "" ? null : colName) : (activeChart.glowField ?? null);
      const outlineField = slot === "outline" ? (colName === "__none__" || colName === "" ? null : colName) : (activeChart.outlineField ?? null);
      const opacityField = slot === "opacity" ? (colName === "__none__" || colName === "" ? null : colName) : (activeChart.opacityField ?? null);
      const y2Field = slot === "y2" ? (colName === "__none__" || colName === "" ? null : colName) : (activeChart.y2Field ?? null);
      const rec = createChartRec(
        activeChart.kind,
        columnStats,
        activeChart.xField,
        activeChart.yField,
        activeChart.colorField,
        tableName,
        {
          ...extraFromChart(),
          sizeField,
          zField,
          rowField,
          glowField,
          outlineField,
          opacityField,
          y2Field,
        },
      );
      if (rec) setActiveChart(rec);
    },
    [activeChart, columnStats, tableName, setActiveChart, extraFromChart],
  );

  const applySplitMode = useCallback(
    (mode: "color" | "facet" | "both") => {
      if (!activeChart || columnStats.length === 0) return;
      const splitField = activeChart.colorField ?? activeChart.rowField;
      if (!splitField) return;
      let colorField: string | null = activeChart.colorField;
      let rowField: string | null = activeChart.rowField ?? null;
      if (mode === "color") {
        colorField = splitField;
        rowField = null;
      } else if (mode === "facet") {
        colorField = null;
        rowField = splitField;
      } else {
        colorField = splitField;
        rowField = splitField;
      }
      const rec = createChartRec(
        activeChart.kind,
        columnStats,
        activeChart.xField,
        activeChart.yField,
        colorField,
        tableName,
        { ...extraFromChart(), rowField },
      );
      if (rec) setActiveChart(rec);
    },
    [activeChart, columnStats, tableName, setActiveChart, extraFromChart],
  );

  const applyTopN = useCallback(
    (n: number) => {
      if (!activeChart || columnStats.length === 0) return;
      const rec = createChartRec(
        activeChart.kind,
        columnStats,
        activeChart.xField,
        activeChart.yField,
        activeChart.colorField,
        tableName,
        { ...extraFromChart(), topN: clampTopN(n) },
      );
      if (rec) setActiveChart(rec);
    },
    [activeChart, columnStats, tableName, setActiveChart, extraFromChart],
  );

  const applyComparePrevious = useCallback(
    (on: boolean) => {
      if (!activeChart || columnStats.length === 0) return;
      const rec = createChartRec(
        activeChart.kind,
        columnStats,
        activeChart.xField,
        activeChart.yField,
        activeChart.colorField,
        tableName,
        { ...extraFromChart(), comparePrevious: on },
      );
      if (rec) setActiveChart(rec);
    },
    [activeChart, columnStats, tableName, setActiveChart, extraFromChart],
  );

  const applyTimeWindow = useCallback(
    (next: { field?: string | null; range?: ChartTimeRange | null }) => {
      if (!activeChart || columnStats.length === 0) return;
      const field =
        next.field !== undefined
          ? next.field
          : (activeChart.timeWindowField ?? pickDefaultTimeField(columnStats, activeChart));
      let range = next.range !== undefined ? next.range : (activeChart.timeWindow ?? "all");
      if (!field) range = "all";
      const rec = createChartRec(
        activeChart.kind,
        columnStats,
        activeChart.xField,
        activeChart.yField,
        activeChart.colorField,
        tableName,
        {
          ...extraFromChart(),
          timeWindowField: field,
          timeWindow: range && range !== "all" ? range : null,
        },
      );
      if (rec) setActiveChart(rec);
      // Shared cohort — Explorer + Chart ViewCohortBar stay in sync
      useLoomStore.getState().setViewTimeWindow(
        field,
        (range && range !== "all" ? range : "all") as ChartTimeRange,
      );
    },
    [activeChart, columnStats, tableName, setActiveChart, extraFromChart],
  );

  /** Drop Encoding extras the target kind cannot render (stale Facet / Top N / Compare). */
  const extrasForKind = useCallback(
    (kind: ChartKind, base: ReturnType<typeof extraFromChart>) => {
      const caps = chartCapabilities(kind);
      return {
        ...base,
        rowField: caps.facetRow ? base.rowField : null,
        topN: caps.topN ? base.topN : null,
        y2Field: caps.compareY ? base.y2Field : null,
        comparePrevious: caps.compareY ? base.comparePrevious : null,
        // Pass null explicitly so bubble/dumbbell don't auto-fill on kind switch
        sizeField: caps.sizeChannel ? base.sizeField : null,
        zField: caps.zChannel ? base.zField : null,
        glowField: caps.glowOutline ? base.glowField : null,
        outlineField: caps.glowOutline ? base.outlineField : null,
        opacityField: caps.opacityChannel ? base.opacityField : null,
        layoutDirection: caps.layoutDirection ? base.layoutDirection : null,
        yScale: caps.yScale ? base.yScale : null,
      };
    },
    [],
  );

  const applyLayoutDirection = useCallback(
    (dir: ChartLayoutDirection) => {
      if (!activeChart || columnStats.length === 0) return;
      const rec = createChartRec(
        activeChart.kind,
        columnStats,
        activeChart.xField,
        activeChart.yField,
        activeChart.colorField,
        tableName,
        { ...extraFromChart(), layoutDirection: dir === "auto" ? null : dir },
      );
      if (rec) setActiveChart(rec);
    },
    [activeChart, columnStats, tableName, setActiveChart, extraFromChart],
  );

  const applyYScale = useCallback(
    (scale: ChartYScaleOption) => {
      if (!activeChart || columnStats.length === 0) return;
      const rec = createChartRec(
        activeChart.kind,
        columnStats,
        activeChart.xField,
        activeChart.yField,
        activeChart.colorField,
        tableName,
        { ...extraFromChart(), yScale: scale === "linear" ? null : scale },
      );
      if (rec) setActiveChart(rec);
    },
    [activeChart, columnStats, tableName, setActiveChart, extraFromChart],
  );

  const applyChartType = useCallback(
    (kind: ChartKind) => {
      if (!activeChart || columnStats.length === 0) return;
      const lockedColorField = useLoomStore.getState().lockedColorField;
      const fit = fitEncodingToKind(kind, columnStats, activeChart, { lockedColorField });
      const sanitized = extrasForKind(kind, extraFromChart());
      let rec = createChartRec(kind, columnStats, fit.xField, fit.yField, fit.colorField, tableName, sanitized);
      if (!rec) {
        for (let i = 0; i < 24; i++) {
          const enc = getRandomEncoding(columnStats, kind);
          if (!enc) break;
          const extra: Parameters<typeof createChartRec>[6] = {
            ...sanitized,
            ...randomEncodingToExtra(enc),
          };
          // Re-sanitize after random extras (which may set facet/topN/compare).
          const cleaned = extrasForKind(kind, { ...extraFromChart(), ...extra });
          rec = createChartRec(kind, columnStats, enc.xField, enc.yField, enc.colorField, tableName, cleaned);
          if (rec) break;
        }
      }
      if (rec) setActiveChart(rec);
      else setToast(`Can’t build a ${kind} chart from these columns`);
    },
    [activeChart, columnStats, tableName, setActiveChart, extraFromChart, extrasForKind, setToast],
  );

  const kindSupport = useCallback((kind: ChartKind) => chartKindDataSupport(columnStats, kind), [columnStats]);

  const applyYAggregate = useCallback(
    (agg: YAggregateOption) => {
      if (!activeChart || columnStats.length === 0) return;
      const rec = createChartRec(
        activeChart.kind,
        columnStats,
        activeChart.xField,
        activeChart.yField,
        activeChart.colorField,
        tableName,
        { ...extraFromChart(), yAggregate: agg },
      );
      if (rec) setActiveChart(rec);
    },
    [activeChart, columnStats, tableName, setActiveChart, extraFromChart],
  );

  const applyTooltipFields = useCallback(
    (fields: string[]) => {
      if (!activeChart || columnStats.length === 0) return;
      const rec = createChartRec(
        activeChart.kind,
        columnStats,
        activeChart.xField,
        activeChart.yField,
        activeChart.colorField,
        tableName,
        { ...extraFromChart(), tooltipFields: fields.length > 0 ? fields : undefined },
      );
      if (rec) setActiveChart(rec);
    },
    [activeChart, columnStats, tableName, setActiveChart, extraFromChart],
  );

  const applyTooltipKeyField = useCallback(
    (col: string | null) => {
      if (!activeChart || columnStats.length === 0) return;
      const rec = createChartRec(
        activeChart.kind,
        columnStats,
        activeChart.xField,
        activeChart.yField,
        activeChart.colorField,
        tableName,
        { ...extraFromChart(), tooltipKeyField: col === null ? undefined : col },
      );
      if (rec) setActiveChart(rec);
    },
    [activeChart, columnStats, tableName, setActiveChart, extraFromChart],
  );

  const handleRandomize = useCallback(() => {
    if (columnStats.length === 0) return;
    const keep = activeChart
      ? {
          kind: activeChart.kind,
          xField: activeChart.xField,
          yField: activeChart.yField,
          colorField: activeChart.colorField,
          sizeField: activeChart.sizeField ?? null,
        }
      : undefined;
    const rec = tryBuildRandomChartRec(columnStats, tableName, { locks: encodingLocks, keep });
    if (rec) {
      setActiveChart(rec);
      const locked = Object.entries(encodingLocks).filter(([, v]) => v).map(([k]) => k);
      setToast(
        locked.length
          ? `Random · ${rec.kind} (locked ${locked.join(", ")})`
          : `Random · ${rec.kind}`,
      );
    } else {
      setToast("Couldn’t find a random chart for these columns");
    }
  }, [columnStats, tableName, setActiveChart, setToast, encodingLocks, activeChart]);

  const handleRandomizeEncoding = useCallback(() => {
    if (columnStats.length === 0 || !activeChart) return;
    if (!chartKindDataSupport(columnStats, activeChart.kind).ok) {
      setToast(`This table can’t support ${activeChart.kind} — pick another type`);
      return;
    }
    const keep = {
      xField: activeChart.xField,
      yField: activeChart.yField,
      colorField: activeChart.colorField,
      sizeField: activeChart.sizeField ?? null,
    };
    for (let i = 0; i < 48; i++) {
      const drawn = getRandomEncoding(columnStats, activeChart.kind);
      if (!drawn) continue;
      const enc = applyEncodingLocks(drawn, encodingLocks, keep);
      const extra: Parameters<typeof createChartRec>[6] = {
        ...extraFromChart(),
        ...randomEncodingToExtra(enc),
      };
      const rec = createChartRec(
        activeChart.kind,
        columnStats,
        enc.xField,
        enc.yField,
        enc.colorField,
        tableName,
        extra,
      );
      if (rec) {
        pushChartEditUndo();
        setActiveChart(rec);
        const bits = [
          rec.xField,
          rec.yField,
          encodingLocks.color ? null : rec.colorField,
          rec.rowField ? `facets:${rec.rowField}` : null,
          rec.topN ? `top ${rec.topN}` : null,
          rec.y2Field ? `vs ${rec.y2Field}` : null,
          rec.comparePrevious ? "vs earlier" : null,
          rec.rollingWindow ? `roll ${rec.rollingWindow}` : null,
          rec.seriesNormalize === "index100" ? "index 100" : rec.seriesNormalize === "zscore" ? "z-score" : null,
          rec.yScale && rec.yScale !== "linear" ? `${rec.yScale} Y` : null,
          rec.residualOverlay ? "residuals" : null,
          rec.anomalyHighlight ? "anomalies" : null,
          rec.bumpMode === "delta" ? "Δ rank" : null,
        ].filter(Boolean);
        setToast(`Shuffled · ${bits.join(" × ")}`, { undo: true });
        return;
      }
    }
    setToast("Couldn’t shuffle fields for this chart type");
  }, [columnStats, tableName, setActiveChart, activeChart, extraFromChart, setToast, encodingLocks]);

  const specJson = useMemo(
    () => (vegaOpen && activeChart && vegaSpec ? formatVegaSpecJson(vegaSpec) : "{}"),
    [vegaOpen, vegaSpec, activeChart],
  );

  if (!activeChart) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <p className="text-sm text-loom-muted">No chart selected</p>
        <p className="text-2xs text-loom-muted mt-1">Pick a suggestion from the Chart view</p>
      </div>
    );
  }
  const rowCount = sampleRows?.rows.length ?? 0;
  const totalRows = sampleRows?.total_rows ?? rowCount;
  const aggSummary = formatChartAggregationSummary(activeChart);
  const caps = chartCapabilities(activeChart.kind);
  const channelLabels = encodingChannelLabels(activeChart.kind);
  const showX = caps.xChannel;
  const showY = caps.yChannel;
  const showColor = caps.colorChannel;
  const showSize = caps.sizeChannel;
  /** Pyramid / slope / dumbbell need the second measure visible — not buried under More. */
  const sizeInPrimary =
    activeChart.kind === "pyramid" ||
    activeChart.kind === "slope" ||
    activeChart.kind === "dumbbell" ||
    activeChart.kind === "dataCube";
  const isDataCube = activeChart.kind === "dataCube";
  const cubeAggregate: YAggregateOption = activeChart.sizeField ? (activeChart.yAggregate ?? "sum") : "count";
  const showAggregate = caps.aggregate;
  const effectiveAggregate: YAggregateOption = !activeChart.yField
    ? "count"
    : (activeChart.yAggregate ?? (activeChart.kind === "line" ? "mean" : "sum"));
  const showRow = caps.facetRow;
  const showTopN = caps.topN;
  const showCompareY = caps.compareY;
  const showMarkPoints = caps.markPoints;
  const showOpacityEnc = caps.opacityChannel;
  const showGlowOutline = caps.glowOutline;
  const splitField = activeChart.colorField ?? activeChart.rowField ?? null;
  /** Split chips only make sense when Color and Facet share (or could share) one field. */
  const splitCompatible =
    !!splitField &&
    (!activeChart.colorField ||
      !activeChart.rowField ||
      activeChart.colorField === activeChart.rowField);
  const splitMode: "color" | "facet" | "both" | null = !splitCompatible
    ? null
    : activeChart.colorField && activeChart.rowField
      ? "both"
      : activeChart.rowField
        ? "facet"
        : "color";
  const numericCols = columnStats.filter((c) => isNumericColumnType(c.data_type ?? ""));
  const nominalForRow = columnStats.filter((c) => {
    if (numericCols.some((n) => n.name === c.name)) return false;
    const d = c.distinct_count ?? 0;
    if (d < 2 || d > 30) return false;
    // Don't facet by the same field already on X or Y
    if (c.name === activeChart.xField || c.name === activeChart.yField) return false;
    return true;
  });

  const colType = (name: string) => columnStats.find((c) => c.name === name)?.data_type ?? "";
  const timeColNames = temporalColumnNames(columnStats);
  const timeFieldActive = activeChart.timeWindowField ?? pickDefaultTimeField(columnStats, activeChart);
  const timeIdx = sampleRows && timeFieldActive ? sampleRows.columns.indexOf(timeFieldActive) : -1;
  const timeSpanMs =
    sampleRows && timeIdx >= 0 ? timeColumnSpanMs(sampleRows.rows, timeIdx) : 0;
  const timeRangeChoices = chartTimeRangeOptions(timeSpanMs);
  const timeWindowActive = activeChart.timeWindow ?? "all";
  const allColOptions: EncodingOption[] = columnStats.map((c) => ({
    value: c.name,
    label: c.name,
    type: c.data_type,
  }));
  const numericOptions: EncodingOption[] = numericCols.map((c) => ({
    value: c.name,
    label: c.name,
    type: c.data_type,
  }));
  const rowOptions: EncodingOption[] = nominalForRow.map((c) => ({
    value: c.name,
    label: c.name,
    type: c.data_type,
  }));
  const tooltipSelectedCount = activeChart.tooltipFields?.length ?? 0;
  const extraChannelCount = [
    showMarkPoints && activeChart.sizeField,
    showGlowOutline && activeChart.glowField,
    showGlowOutline && activeChart.outlineField,
    showOpacityEnc && activeChart.opacityField,
  ].filter(Boolean).length;

  return (
    <div className="flex flex-col min-h-0">
      {/* Sticky Encoding | Visual secondary header */}
      <div
        role="tablist"
        aria-label="Chart panel sections"
        className="sticky top-0 z-10 flex items-center gap-0.5 px-2 py-1.5 border-b border-loom-border bg-loom-surface shrink-0"
      >
        <div className="flex items-center gap-0.5 bg-loom-elevated rounded-md p-0.5 w-full">
          {(
            [
              { id: "encoding" as const, label: "Encoding" },
              { id: "visual" as const, label: "Visual" },
            ]
          ).map((sec) => (
            <button
              key={sec.id}
              type="button"
              role="tab"
              id={`chart-section-${sec.id}`}
              aria-controls={`chart-section-panel-${sec.id}`}
              aria-selected={chartPanelSection === sec.id}
              tabIndex={chartPanelSection === sec.id ? 0 : -1}
              onClick={() => setChartPanelSection(sec.id)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  e.preventDefault();
                  const next = chartPanelSection === "encoding" ? "visual" : "encoding";
                  setChartPanelSection(next);
                  queueMicrotask(() => document.getElementById(`chart-section-${next}`)?.focus());
                }
              }}
              className={`
                flex-1 min-h-9 px-3 py-1.5 text-xs font-medium rounded transition-colors
                ${chartPanelSection === sec.id
                  ? "bg-loom-surface text-loom-text shadow-sm border border-loom-border"
                  : "text-loom-muted hover:text-loom-text border border-transparent"}
              `}
            >
              {sec.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 p-3">
      {chartPanelSection === "encoding" && (
        <div
          role="tabpanel"
          id="chart-section-panel-encoding"
          aria-labelledby="chart-section-encoding"
          className="flex flex-col gap-3"
        >
      {/* Encoding */}
      <div className="loom-card overflow-hidden">
        <div className="space-y-2.5 px-2.5 py-3">
            {(() => {
              const curSupport = chartKindDataSupport(columnStats, activeChart.kind);
              if (!curSupport.ok) {
                return (
                  <div role="alert" className="rounded-md border border-loom-warning/40 bg-loom-warning/10 px-2.5 py-2 text-2xs text-loom-warning">
                    <span className="font-medium">Doesn’t fit this table:</span> {curSupport.reason}
                  </div>
                );
              }
              return null;
            })()}

            <div className="flex gap-1.5 items-stretch">
              <div className="flex-1 min-w-0">
                <ChartKindPicker
                  value={activeChart.kind}
                  support={kindSupport}
                  onChange={(v) => {
                    if (!chartKindDataSupport(columnStats, v).ok) return;
                    applyChartType(v);
                  }}
                />
              </div>
              <button
                type="button"
                onClick={handleRandomizeEncoding}
                className="shrink-0 min-h-9 min-w-9 px-2 rounded-md border border-loom-border text-loom-muted hover:text-loom-text hover:bg-loom-elevated transition-colors"
                title="Shuffle unlocked fields (keeps chart type; respects locks)"
                aria-label="Shuffle fields"
              >
                ⟳
              </button>
              <button
                type="button"
                onClick={handleRandomize}
                className="shrink-0 min-h-9 min-w-9 px-2 rounded-md border border-loom-border text-loom-muted hover:text-loom-accent hover:bg-loom-elevated transition-colors"
                title="Random chart — respects locks (type / x / y / color / size)"
                aria-label="Randomize chart"
              >
                ✦
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1">
              <span className="text-2xs text-loom-muted mr-0.5">Lock</span>
              {(
                [
                  ["kind", "Type"],
                  ["x", "X"],
                  ["y", "Y"],
                  ["color", "Color"],
                    ["size", channelLabels.size],
                  ] as const
                ).map(([key, label]) => {
                const on = !!encodingLocks[key];
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleEncodingLock(key)}
                    title={on ? `Unlock ${label} for random` : `Lock ${label} while randomizing`}
                    className={`px-1.5 py-0.5 text-2xs rounded border ${
                      on
                        ? "border-loom-accent/60 text-loom-accent bg-loom-accent/10"
                        : "border-loom-border text-loom-muted hover:border-loom-accent/40"
                    }`}
                  >
                    {label}{on ? " · locked" : ""}
                  </button>
                );
              })}
            </div>

            <EncodingSectionLabel>Channels</EncodingSectionLabel>
            <div className="space-y-2">
              {showX && (
              <EncodingSlot
                label={channelLabels.x}
                value={activeChart.xField}
                options={allColOptions}
                typeHint={colType(activeChart.xField)}
                isDropActive={dragOverSlot === "x"}
                onDragEnter={handleDragEnter("x")}
                onDragOver={handleDragOver("x")}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop("x")}
                onChange={(v) => applyEncoding("x", v)}
                chromeTarget="x"
                chromeActive={chartChromeFocus?.target === "x"}
                onChromeEnter={focusChromeFromPanel}
                onChromeLeave={clearChromeFromPanel}
              />
              )}

              {!showX && activeChart.kind === "radar" && (
                <p className="text-2xs text-loom-muted px-0.5">
                  Radar uses all numeric columns as axes. Set Series (color) to compare groups.
                </p>
              )}

              {showY && (
                <EncodingSlot
                  label={channelLabels.y}
                  value={activeChart.yField ?? ""}
                  options={allColOptions}
                  allowEmpty
                  emptyLabel="—"
                  typeHint={activeChart.yField ? colType(activeChart.yField) : undefined}
                  isDropActive={dragOverSlot === "y"}
                  onDragEnter={handleDragEnter("y")}
                  onDragOver={handleDragOver("y")}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop("y")}
                  onChange={(v) => applyEncoding("y", v)}
                  chromeTarget="y"
                  chromeActive={chartChromeFocus?.target === "y"}
                  onChromeEnter={focusChromeFromPanel}
                  onChromeLeave={clearChromeFromPanel}
                  trailing={
                    showAggregate ? (
                      <div className="flex items-center gap-2 pl-0.5">
                        <label className="text-2xs text-loom-muted shrink-0" htmlFor="loom-y-agg">
                          Aggregate
                        </label>
                        <select
                          id="loom-y-agg"
                          value={effectiveAggregate}
                          onChange={(e) => applyYAggregate(e.target.value as YAggregateOption)}
                          className="loom-input flex-1 text-xs py-1.5 min-h-8"
                          title="How values are summarized"
                        >
                          {Y_AGGREGATE_OPTIONS.map((opt) => (
                            <option
                              key={opt.value}
                              value={opt.value}
                              disabled={!activeChart.yField && opt.value !== "count"}
                            >
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : undefined
                  }
                />
              )}

              {showColor && !(activeChart.kind === "pyramid" || activeChart.kind === "slope") && (
                <EncodingSlot
                  label={channelLabels.color}
                  value={activeChart.colorField ?? ""}
                  options={allColOptions}
                  allowEmpty
                  emptyLabel="None"
                  typeHint={activeChart.colorField ? colType(activeChart.colorField) : undefined}
                  isDropActive={dragOverSlot === "color"}
                  onDragEnter={handleDragEnter("color")}
                  onDragOver={handleDragOver("color")}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop("color")}
                  onChange={(v) => {
                    applyEncoding("color", v === "" ? "__none__" : v);
                    if (v && lockedColorField) setLockedColorField(v);
                  }}
                  chromeTarget="color"
                  chromeActive={chartChromeFocus?.target === "color"}
                  onChromeEnter={focusChromeFromPanel}
                  onChromeLeave={clearChromeFromPanel}
                  trailing={
                    activeChart.colorField ? (
                      <div className="flex items-center gap-1.5 flex-wrap pl-0.5">
                        <button
                          type="button"
                          title={
                            lockedColorField === activeChart.colorField
                              ? "Color locked across chart types"
                              : "Lock color so it sticks when you change mark type"
                          }
                          aria-pressed={lockedColorField === activeChart.colorField}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${
                            lockedColorField === activeChart.colorField
                              ? "border-loom-accent/50 bg-loom-accent/15 text-loom-accent"
                              : "border-loom-border text-loom-muted hover:text-loom-text"
                          }`}
                          onClick={() => {
                            if (lockedColorField === activeChart.colorField) {
                              unlockColorAndResetLocks();
                              setToast("Color unlocked");
                            } else if (activeChart.colorField) {
                              setLockedColorField(activeChart.colorField);
                              setToast(`Color locked · ${activeChart.colorField}`);
                            }
                          }}
                        >
                          {lockedColorField === activeChart.colorField ? "locked" : "lock"}
                        </button>
                        {activeChart.kind === "bar" && (
                          <>
                            <span className="text-2xs text-loom-muted shrink-0">Layout</span>
                            <div className="flex gap-1 flex-wrap">
                              {(["grouped", "stacked", "percent"] as const).map((m) => (
                                <button
                                  key={m}
                                  type="button"
                                  aria-pressed={barStackMode === m}
                                  onClick={() => {
                                    setBarStackMode(m);
                                    if (columnStats.length === 0) return;
                                    const rec = createChartRec(
                                      activeChart.kind,
                                      columnStats,
                                      activeChart.xField,
                                      activeChart.yField,
                                      activeChart.colorField,
                                      tableName,
                                      { ...extraFromChart(), barStackMode: m },
                                    );
                                    if (rec) setActiveChart(rec);
                                  }}
                                  className={`min-h-8 px-2.5 text-2xs rounded-md capitalize ${
                                    barStackMode === m
                                      ? "bg-loom-accent/20 text-loom-text border border-loom-accent/50"
                                      : "text-loom-muted border border-loom-border hover:border-loom-accent/40"
                                  }`}
                                >
                                  {m}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    ) : undefined
                  }
                />
              )}
              {showRow && (
                <EncodingSlot
                  label="Facet"
                  value={activeChart.rowField ?? ""}
                  options={rowOptions}
                  allowEmpty
                  emptyLabel="None"
                  typeHint={activeChart.rowField ? colType(activeChart.rowField) : undefined}
                  onChange={(v) => applyEncodingExtra("row", v === "" ? "__none__" : v)}
                />
              )}
              {showRow && splitCompatible && splitField && (
                <div className="flex items-center gap-1.5 flex-wrap pl-0.5">
                  <span className="text-2xs text-loom-muted shrink-0">Split</span>
                  <div className="flex gap-1 flex-wrap">
                    {(
                      [
                        ["color", "Color"],
                        ["facet", "Facet"],
                        ["both", "Both"],
                      ] as const
                    ).map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        aria-pressed={splitMode === mode}
                        onClick={() => applySplitMode(mode)}
                        className={`min-h-8 px-2.5 text-2xs rounded-md ${
                          splitMode === mode
                            ? "bg-loom-accent/20 text-loom-text border border-loom-accent/50"
                            : "text-loom-muted border border-loom-border hover:border-loom-accent/40"
                        }`}
                        title={
                          mode === "color"
                            ? "Overlay series by color"
                            : mode === "facet"
                              ? "Small multiples (one panel per value)"
                              : "Color within each facet panel"
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {showTopN && (
                <div className="flex items-center gap-2 pl-0.5">
                  <label className="text-2xs text-loom-muted shrink-0" htmlFor="loom-top-n">
                    Top N
                  </label>
                  <select
                    id="loom-top-n"
                    value={clampTopN(activeChart.topN, DEFAULT_TOP_N)}
                    onChange={(e) => applyTopN(Number(e.target.value))}
                    className="loom-input flex-1 text-xs py-1.5 min-h-8"
                    title="How many categories to keep (ranked by value)"
                  >
                    {TOP_N_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {caps.layoutDirection && (
                <div
                  id={chromeDomId("direction")}
                  className={`space-y-1 pl-0.5 rounded-md transition-colors ${
                    chartChromeFocus?.target === "direction" ? "ring-2 ring-loom-accent/50 bg-loom-accent/10 p-1 -ml-1" : ""
                  }`}
                  onMouseEnter={() => focusChromeFromPanel("direction")}
                  onMouseLeave={clearChromeFromPanel}
                >
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-2xs text-loom-muted shrink-0">Direction</span>
                    <div className="flex gap-1 flex-wrap" role="group" aria-label="Chart direction">
                      {CHART_LAYOUT_DIRECTIONS.map((d) => {
                        const cur = activeChart.layoutDirection ?? "auto";
                        const on = cur === d.value;
                        return (
                          <button
                            key={d.value}
                            type="button"
                            onClick={() => applyLayoutDirection(d.value)}
                            className={`min-h-8 min-w-8 px-2 text-2xs rounded-md ${
                              on
                                ? "bg-loom-accent/20 text-loom-text border border-loom-accent/50"
                                : "text-loom-muted border border-loom-border hover:border-loom-accent/40"
                            }`}
                            title={d.title}
                            aria-pressed={on}
                          >
                            {d.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {(activeChart.layoutDirection === "down" || activeChart.layoutDirection === "left") && (
                    <p className="text-2xs text-loom-muted leading-snug">
                      {activeChart.layoutDirection === "down"
                        ? "Zero at the top — good for ranks, losses, latency, deficits."
                        : "Zero on the right — same idea, horizontal."}
                    </p>
                  )}
                </div>
              )}
              {caps.yScale && (
                <div
                  id={chromeDomId("yScale")}
                  className={`flex items-center gap-1.5 flex-wrap pl-0.5 rounded-md transition-colors ${
                    chartChromeFocus?.target === "yScale" ? "ring-2 ring-loom-accent/50 bg-loom-accent/10 p-1 -ml-1" : ""
                  }`}
                  onMouseEnter={() => focusChromeFromPanel("yScale")}
                  onMouseLeave={clearChromeFromPanel}
                >
                  <span className="text-2xs text-loom-muted shrink-0">Y scale</span>
                  <div className="flex gap-1 flex-wrap" role="group" aria-label="Y axis scale">
                    {CHART_Y_SCALE_OPTIONS.map((s) => {
                      const cur = activeChart.yScale ?? "linear";
                      const on = cur === s.value;
                      return (
                        <button
                          key={s.value}
                          type="button"
                          onClick={() => applyYScale(s.value)}
                          className={`min-h-8 px-2.5 text-2xs rounded-md ${
                            on
                              ? "bg-loom-accent/20 text-loom-text border border-loom-accent/50"
                              : "text-loom-muted border border-loom-border hover:border-loom-accent/40"
                          }`}
                          title={s.title}
                          aria-pressed={on}
                        >
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {showCompareY && (
                <>
                  <EncodingSlot
                    label="Compare Y"
                    value={activeChart.y2Field ?? ""}
                    options={numericOptions.filter((o) => o.value !== activeChart.yField)}
                    allowEmpty
                    emptyLabel="None"
                    typeHint={activeChart.y2Field ? colType(activeChart.y2Field) : undefined}
                    onChange={(v) => applyEncodingExtra("y2", v === "" ? "__none__" : v)}
                  />
                  <label className="flex items-center gap-1.5 text-2xs text-loom-muted cursor-pointer pl-0.5">
                    <input
                      type="checkbox"
                      checked={!!activeChart.comparePrevious}
                      onChange={(e) => applyComparePrevious(e.target.checked)}
                      className="rounded border-loom-border accent-loom-accent"
                    />
                    Overlay earlier half (compare)
                  </label>
                </>
              )}
              {timeColNames.length > 0 && (
                <>
                  <EncodingSlot
                    label="Time"
                    value={timeFieldActive ?? ""}
                    options={timeColNames.map((n) => ({ value: n, label: n }))}
                    allowEmpty
                    emptyLabel="None"
                    typeHint={timeFieldActive ? colType(timeFieldActive) : undefined}
                    onChange={(v) =>
                      applyTimeWindow({
                        field: v === "" || v === "__none__" ? null : v,
                        range: v === "" || v === "__none__" ? "all" : timeWindowActive,
                      })
                    }
                  />
                  <div className="flex items-center gap-1.5 flex-wrap pl-0.5">
                    <span className="text-2xs text-loom-muted shrink-0">Window</span>
                    <div className="flex gap-1 flex-wrap">
                      {(timeRangeChoices.includes(timeWindowActive)
                        ? timeRangeChoices
                        : [timeWindowActive, ...timeRangeChoices.filter((r) => r !== timeWindowActive)]
                      ).map((r) => {
                        const spec = CHART_TIME_RANGES.find((x) => x.value === r);
                        const on = timeWindowActive === r;
                        return (
                          <button
                            key={r}
                            type="button"
                            aria-pressed={on}
                            disabled={!timeFieldActive && r !== "all"}
                            onClick={() => applyTimeWindow({ field: timeFieldActive, range: r })}
                            className={`min-h-8 px-2.5 text-2xs rounded-md ${
                              on
                                ? "bg-loom-accent/20 text-loom-text border border-loom-accent/50"
                                : "text-loom-muted border border-loom-border hover:border-loom-accent/40"
                            }`}
                            title={spec?.label ?? r}
                          >
                            {spec?.short ?? r}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {timeWindowActive !== "all" && sampleRows && (
                    <p className="text-2xs text-loom-muted pl-0.5">
                      {(() => {
                        const slice = applyChartTimeWindow(sampleRows.rows, sampleRows.columns, {
                          timeWindowField: timeFieldActive,
                          timeWindow: timeWindowActive,
                        });
                        if (!slice.filtered) {
                          return "Window uses the wall clock for live data, or the newest sample time for historical files.";
                        }
                        const modeHint =
                          slice.mode === "forward"
                            ? "upcoming from now"
                            : slice.mode === "wall"
                              ? "wall clock"
                              : "from newest sample";
                        return `${slice.kept.toLocaleString()} of ${slice.total.toLocaleString()} rows (${modeHint})`;
                      })()}
                    </p>
                  )}
                </>
              )}
              {caps.zChannel && (
                <EncodingSlot
                  label={isDataCube ? "Depth" : "Z"}
                  value={activeChart.zField ?? ""}
                  options={isDataCube ? allColOptions : numericOptions}
                  allowEmpty={!isDataCube}
                  emptyLabel="Auto"
                  typeHint={activeChart.zField ? colType(activeChart.zField) : undefined}
                  onChange={(v) => applyEncodingExtra("z", v === "" ? "__none__" : v)}
                />
              )}
              {showSize && sizeInPrimary && (
                <EncodingSlot
                  label={channelLabels.size}
                  value={activeChart.sizeField ?? ""}
                  options={numericOptions}
                  allowEmpty
                  emptyLabel={isDataCube ? "Row count" : "None"}
                  typeHint={activeChart.sizeField ? colType(activeChart.sizeField) : undefined}
                  onChange={(v) => applyEncodingExtra("size", v === "" ? "__none__" : v)}
                  chromeTarget="size"
                  chromeActive={chartChromeFocus?.target === "size"}
                  onChromeEnter={focusChromeFromPanel}
                  onChromeLeave={clearChromeFromPanel}
                  trailing={
                    isDataCube ? (
                      <div className="flex items-center gap-2 pl-0.5">
                        <label className="text-2xs text-loom-muted shrink-0" htmlFor="loom-cube-agg">
                          Aggregate
                        </label>
                        <select
                          id="loom-cube-agg"
                          value={cubeAggregate}
                          onChange={(e) => applyYAggregate(e.target.value as YAggregateOption)}
                          disabled={!activeChart.sizeField}
                          className="loom-input flex-1 text-xs py-1.5 min-h-8"
                          title="How each cell's rows are summarized"
                        >
                          {Y_AGGREGATE_OPTIONS.filter((opt) => opt.value !== "count" || !activeChart.sizeField).map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : undefined
                  }
                />
              )}
            </div>

            {(showSize || showGlowOutline || showOpacityEnc) && (
              <div className="space-y-2">
                <button
                  type="button"
                  aria-expanded={moreChannelsOpen}
                  aria-controls="loom-more-channels-panel"
                  onClick={() => setMoreChannelsOpen((o) => !o)}
                  className="flex w-full items-center justify-between text-2xs text-loom-muted hover:text-loom-text py-1"
                >
                  <span>
                    More channels
                    {extraChannelCount > 0 ? ` · ${extraChannelCount} set` : ""}
                  </span>
                  <span aria-hidden>{moreChannelsOpen ? "▼" : "▶"}</span>
                </button>
                {moreChannelsOpen && (
                  <div id="loom-more-channels-panel" className="space-y-2">
                    {showSize && !sizeInPrimary && (
                      <EncodingSlot
                        label={channelLabels.size}
                        value={activeChart.sizeField ?? ""}
                        options={numericOptions}
                        allowEmpty
                        typeHint={activeChart.sizeField ? colType(activeChart.sizeField) : undefined}
                        onChange={(v) => applyEncodingExtra("size", v === "" ? "__none__" : v)}
                      />
                    )}
                    {showGlowOutline && (
                      <>
                        <EncodingSlot
                          label="Glow"
                          value={activeChart.glowField ?? ""}
                          options={allColOptions}
                          allowEmpty
                          onChange={(v) => applyEncodingExtra("glow", v === "" ? "__none__" : v)}
                        />
                        <EncodingSlot
                          label="Outline"
                          value={activeChart.outlineField ?? ""}
                          options={allColOptions}
                          allowEmpty
                          onChange={(v) => applyEncodingExtra("outline", v === "" ? "__none__" : v)}
                        />
                      </>
                    )}
                    {showOpacityEnc && (
                      <EncodingSlot
                        label="Opacity"
                        value={activeChart.opacityField ?? ""}
                        options={allColOptions}
                        allowEmpty
                        onChange={(v) => applyEncodingExtra("opacity", v === "" ? "__none__" : v)}
                      />
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="border-t border-loom-border/70 pt-2 space-y-2">
              <button
                type="button"
                aria-expanded={tooltipOpen}
                aria-controls="loom-tooltip-panel"
                onClick={() => setTooltipOpen((o) => !o)}
                className="flex w-full items-center justify-between text-2xs text-loom-muted hover:text-loom-text py-1"
              >
                <span>
                  Tooltip
                  {chartVisualOverrides.tooltipMode && chartVisualOverrides.tooltipMode !== "auto"
                    ? ` · ${chartVisualOverrides.tooltipMode}`
                    : " · on"}
                  {tooltipSelectedCount > 0
                    ? ` · ${tooltipSelectedCount} fields`
                    : ""}
                </span>
                <span aria-hidden>{tooltipOpen ? "▼" : "▶"}</span>
              </button>
              {tooltipOpen && (
                <div id="loom-tooltip-panel" className="space-y-2">
                  <IconToggleGroup
                    label="Style"
                    value={(chartVisualOverrides.tooltipMode ?? "auto") as ChartTooltipMode}
                    onChange={(v) => updateOverride("tooltipMode", v === "auto" ? undefined : v)}
                    options={CHART_TOOLTIP_MODES.map((m) => ({
                      value: m.value,
                      label: m.title,
                      icon:
                        m.value === "auto"
                          ? Ico.tipAuto
                          : m.value === "hover"
                            ? Ico.tipHover
                            : m.value === "glass"
                              ? Ico.tipGlass
                              : m.value === "dock"
                                ? Ico.tipDock
                                : m.value === "compact"
                                  ? Ico.tipCompact
                                  : Ico.tipOff,
                    }))}
                  />
                  <p className="text-2xs text-loom-muted leading-snug pl-0.5">
                    {(chartVisualOverrides.tooltipMode ?? "auto") === "auto"
                      ? "Auto: float on desktop, frosted sheet on phone — so a finger doesn’t cover the readout."
                      : CHART_TOOLTIP_MODES.find((m) => m.value === chartVisualOverrides.tooltipMode)?.title}
                  </p>
                  {!caps.tooltipHover && (
                    <p className="text-2xs text-loom-muted leading-snug">
                      Hover tooltips aren’t available for this chart type yet — field picks still save for share / when you switch kinds.
                    </p>
                  )}
                  <p className="text-2xs text-loom-muted pl-0.5">Fields</p>
                  <div className="flex flex-wrap gap-1.5">
                    {columnStats.map((c) => {
                      const on = activeChart.tooltipFields?.includes(c.name) ?? false;
                      return (
                        <button
                          key={c.name}
                          type="button"
                          aria-pressed={on}
                          onClick={() => {
                            const cur = new Set(activeChart.tooltipFields ?? []);
                            if (on) cur.delete(c.name);
                            else cur.add(c.name);
                            applyTooltipFields([...cur]);
                          }}
                          className={`min-h-8 px-2 rounded-md text-2xs border transition-colors ${
                            on
                              ? "border-loom-accent/50 bg-loom-accent/15 text-loom-text"
                              : "border-loom-border text-loom-muted hover:border-loom-accent/30 hover:text-loom-text"
                          }`}
                          title={c.data_type}
                        >
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => applyTooltipFields([])}
                      className="text-2xs text-loom-muted hover:text-loom-text"
                    >
                      Use encoding defaults
                    </button>
                  </div>
                  <EncodingSlot
                    label="Link"
                    value={activeChart.tooltipKeyField ?? ""}
                    options={allColOptions}
                    allowEmpty
                    emptyLabel="Same as X"
                    onChange={(v) => applyTooltipKeyField(v === "" ? null : v)}
                  />
                  <p className="text-2xs text-loom-muted leading-snug">
                    Link key is used when you press L on the chart to filter by a value.
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <p className="text-2xs text-loom-muted tabular-nums truncate">
                {rowCount.toLocaleString()}
                {totalRows > rowCount ? ` / ${totalRows.toLocaleString()}` : ""} rows · {aggSummary}
              </p>
              <SaveChartViewButton />
            </div>
          </div>
      </div>

      {/* Active chart — toggles & annotations */}
      <div className="loom-card overflow-hidden">
        <button
          type="button"
          aria-expanded={activeChartOpen}
          aria-controls="loom-active-chart-panel"
          onClick={() => setActiveChartOpen((o) => !o)}
          className="w-full flex items-center justify-between px-2.5 py-2 text-left hover:bg-loom-elevated/50 transition-colors"
        >
          <span className="text-xs font-semibold text-loom-text">Active chart</span>
          <span className="text-loom-muted text-xs" aria-hidden>{activeChartOpen ? "▼" : "▶"}</span>
        </button>
        {activeChartOpen && (
          <div id="loom-active-chart-panel" className="space-y-2 px-2.5 pb-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="loom-badge capitalize">{activeChart.kind}</span>
              <button
                type="button"
                className="text-2xs text-loom-muted hover:text-loom-text border-b border-dotted border-loom-muted/40"
                aria-expanded={chartWhyOpen}
                onClick={() => setChartWhyOpen((o) => !o)}
              >
                Why this chart?
              </button>
            </div>
            {chartWhyOpen && (
              <p className="text-2xs text-loom-label leading-snug" role="note">
                {aiSuggestionReason ?? getRecommendationReason(activeChart)}
              </p>
            )}
            {caps.scatterExtras && (
              <div className="mt-2 space-y-1">
                <label className="flex items-center gap-1.5 text-2xs text-loom-muted cursor-pointer">
                  <input type="checkbox" checked={connectScatterTrail} onChange={(e) => setConnectScatterTrail(e.target.checked)} className="rounded border-loom-border accent-loom-accent" />
                  Connect points (trail)
                </label>
                <label className="flex items-center gap-1.5 text-2xs text-loom-muted cursor-pointer">
                  <input type="checkbox" checked={showMarginals} onChange={(e) => setShowMarginals(e.target.checked)} className="rounded border-loom-border accent-loom-accent" />
                  Marginal distributions
                </label>
              </div>
            )}
            {/* Custom reference lines */}
            {caps.referenceLines && (
            <div className="mt-2">
              <button type="button" onClick={() => {
                setPromptDialog({
                  title: "Reference line value (number)",
                  defaultValue: "",
                  onConfirm: (val) => {
                    if (val == null || isNaN(Number(val))) return;
                    setTimeout(() => {
                      setPromptDialog({
                        title: "Label",
                        defaultValue: "Ref",
                        onConfirm: (label) => {
                          if (label != null) addCustomRefLine(activeChart.id, "y", Number(val), label || "Ref");
                        }
                      });
                    }, 50);
                  }
                });
              }} className="text-2xs text-loom-muted hover:text-loom-text">+ Add reference line</button>
              {(customRefLines[activeChart.id] ?? []).map((l) => (
                <div key={l.id} className="flex items-center justify-between text-2xs text-loom-text mt-0.5">
                  <span>{l.axis.toUpperCase()}={l.value} {l.label}</span>
                  <button type="button" onClick={() => removeCustomRefLine(activeChart.id, l.id)} className="text-loom-muted hover:text-loom-text">×</button>
                </div>
              ))}
            </div>
            )}
          </div>
        )}
      </div>

      {/* Vega-Lite spec — under Encoding */}
      <div className="loom-card overflow-hidden">
        <button
          type="button"
          aria-expanded={vegaOpen}
          aria-controls="loom-vega-spec-panel"
          onClick={() => setVegaOpen((o) => !o)}
          className="w-full flex items-center justify-between px-2 py-1.5 text-left hover:bg-loom-elevated/50 rounded transition-colors"
        >
          <span className="text-xs font-semibold text-loom-text">Vega-Lite spec</span>
          <span className="text-loom-muted text-xs" aria-hidden>{vegaOpen ? "▼" : "▶"}</span>
        </button>
        {vegaOpen && (
          <div id="loom-vega-spec-panel" className="space-y-2 px-2 pb-2">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setSpecExpanded(!specExpanded)}
                className="text-2xs text-loom-muted hover:text-loom-accent transition-colors"
              >
                {specExpanded ? "Collapse JSON" : "Expand JSON"}
              </button>
              <button
                type="button"
                onClick={handleCopySpec}
                className="text-2xs px-2 py-1 rounded border border-loom-border hover:border-loom-accent text-loom-muted hover:text-loom-text transition-colors"
              >
                {specCopyOk ? "Copied" : "Copy JSON"}
              </button>
            </div>
            {specExpanded && (
              <pre className="text-2xs font-mono text-loom-muted bg-loom-bg rounded p-2 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-all">
                {specJson}
              </pre>
            )}
          </div>
        )}
      </div>
        </div>
      )}

      {chartPanelSection === "visual" && (
        <div
          role="tabpanel"
          id="chart-section-panel-visual"
          aria-labelledby="chart-section-visual"
        >
      {/* Visual */}
      <div className="loom-card overflow-hidden">
        <div className="space-y-4 px-2.5 py-3">
            {/* Presets — full replace */}
            <div className="space-y-1.5">
              <p className="text-2xs font-semibold text-loom-muted uppercase tracking-wide">Design system</p>
              <p className="text-2xs text-loom-muted leading-snug">
                Full looks — Tufte / Bauhaus / Newspaper / Military change ink, axes, and atmosphere on every chart kind.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(VISUAL_PRESETS) as VisualPresetId[]).map((id) => (
                  <button
                    key={id}
                    type="button"
                    title={VISUAL_PRESET_BLURB[id]}
                    onClick={() => {
                      pushChartEditUndo();
                      setChartVisualOverrides({ ...VISUAL_PRESETS[id].overrides });
                      setToast(`Applied ${VISUAL_PRESETS[id].name} look`, { undo: true });
                    }}
                    className={`px-2.5 py-1.5 min-h-9 text-2xs rounded border ${
                      id === "tufte" || id === "bauhaus" || id === "newspaper" || id === "military"
                        ? "border-loom-accent/50 text-loom-text bg-loom-accent/5 hover:bg-loom-accent/12"
                        : id === "clarity"
                          ? "border-loom-accent/60 text-loom-accent bg-loom-accent/10 hover:bg-loom-accent/15"
                          : "border-loom-border text-loom-text hover:border-loom-accent hover:bg-loom-accent/10"
                    }`}
                  >
                    {VISUAL_PRESETS[id].name}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    pushChartEditUndo();
                    setChartVisualOverrides(emptyChartVisualOverrides());
                    setToast("Reset visual overrides", { undo: true });
                  }}
                  className="px-2.5 py-1.5 min-h-9 text-2xs rounded border border-loom-border text-loom-muted hover:text-loom-text"
                >
                  Reset visual
                </button>
                <button
                  type="button"
                  onClick={() => {
                    pushChartEditUndo();
                    const next = shuffleVisualOverrides(chartVisualOverrides, visualLocks);
                    setChartVisualOverrides(next);
                    const locked = VISUAL_SHUFFLE_SECTIONS.filter((s) => visualLocks[s.id]).map((s) => s.label);
                    setToast(
                      locked.length
                        ? `Shuffled look · kept ${locked.join(", ")}`
                        : "Shuffled look · color + design",
                      { undo: true },
                    );
                  }}
                  className="px-2.5 py-1.5 min-h-9 text-2xs rounded border border-loom-accent/50 text-loom-accent hover:bg-loom-accent/10"
                  title="Randomize unlocked Visual sections (Color included when unlocked)"
                >
                  Shuffle look
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1 pt-0.5">
                <span className="text-2xs text-loom-muted mr-0.5">Lock</span>
                {VISUAL_SHUFFLE_SECTIONS.map((s) => {
                  const on = !!visualLocks[s.id];
                  return (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleVisualLock(s.id)}
                      title={on ? `Unlock ${s.label}` : `Lock ${s.label} while shuffling`}
                      className={`px-1.5 py-0.5 text-2xs rounded border ${
                        on
                          ? "border-loom-accent/60 text-loom-accent bg-loom-accent/10"
                          : "border-loom-border text-loom-muted hover:border-loom-accent/40"
                      }`}
                    >
                      {s.label}{on ? " · locked" : ""}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Color palettes */}
            <div className="space-y-2">
              <p className="text-2xs font-semibold text-loom-muted uppercase tracking-wide">Color</p>
              <p className="text-2xs text-loom-muted leading-snug">
                Data-viz scales — Auto picks categorical, sequential, or semantic from the chart.
              </p>
              <div className="flex flex-wrap gap-1">
                {COLOR_SCALE_KIND_OPTIONS.map(({ value: id, label }) => {
                  const cur = chartVisualOverrides.colorScaleKind ?? "auto";
                  const active = cur === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        updateOverride("colorScaleKind", id);
                        if (id === "auto") updateOverride("colorPalette", "auto");
                        else {
                          const first = COLOR_PALETTES.find(
                            (p) => p.kind === id && p.source === "system" && p.id !== "auto",
                          );
                          if (first) updateOverride("colorPalette", first.id);
                        }
                      }}
                      className={`px-2 py-1 text-2xs rounded border ${
                        active
                          ? "border-loom-accent text-loom-accent bg-loom-accent/10"
                          : "border-loom-border text-loom-muted hover:border-loom-accent/50"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <label className="flex items-center gap-2 text-2xs text-loom-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!chartVisualOverrides.colorPaletteReverse}
                  onChange={(e) => updateOverride("colorPaletteReverse", e.target.checked)}
                  className="rounded border-loom-border bg-loom-elevated accent-loom-accent"
                />
                Reverse scale
              </label>
              {(() => {
                const applied = resolveChartColors({
                  paletteId: chartVisualOverrides.colorPalette ?? "auto",
                  theme: appSettings.theme,
                  colorblind: !!appSettings.colorblindCharts,
                  chartKind: activeChart?.kind ?? null,
                  reverse: !!chartVisualOverrides.colorPaletteReverse,
                  scaleKind: chartVisualOverrides.colorScaleKind ?? "auto",
                });
                const kindFilter = chartVisualOverrides.colorScaleKind ?? "auto";
                const grouped = palettesGrouped();
                const filterList = (list: typeof grouped.system) =>
                  kindFilter === "auto"
                    ? list
                    : list.filter((p) => p.kind === (kindFilter as PaletteKind));
                const sections: { title: string; items: typeof grouped.system }[] = [
                  { title: "System", items: filterList(grouped.system) },
                  { title: "Theme", items: filterList(grouped.theme) },
                  { title: "Research", items: filterList(grouped.research) },
                ].filter((s) => s.items.length > 0);
                const selectedId = chartVisualOverrides.colorPalette ?? "auto";
                return (
                  <div className="space-y-2.5">
                    <div className="rounded border border-loom-border/60 bg-loom-elevated/40 px-2 py-1.5">
                      <p className="text-2xs text-loom-muted mb-1">
                        Applied · {applied.paletteId}
                        {applied.continuous ? " · continuous" : ""}
                      </p>
                      <div className="flex h-3 rounded overflow-hidden">
                        {applied.colors.map((c, i) => (
                          <span key={`${c}-${i}`} className="flex-1" style={{ background: c }} title={c} />
                        ))}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        updateOverride("colorPalette", "auto");
                        updateOverride("colorScaleKind", "auto");
                      }}
                      className={`w-full text-left rounded border px-2 py-1.5 ${
                        selectedId === "auto"
                          ? "border-loom-accent bg-loom-accent/10"
                          : "border-loom-border hover:border-loom-accent/40"
                      }`}
                    >
                      <span className="text-2xs text-loom-text font-medium">Auto</span>
                      <span className="block text-2xs text-loom-muted">Match scale to chart kind</span>
                    </button>
                    {sections.map((sec) => (
                      <div key={sec.title} className="space-y-1">
                        <p className="text-2xs text-loom-muted uppercase tracking-wide">{sec.title}</p>
                        <div className="space-y-1 max-h-48 overflow-y-auto pr-0.5">
                          {sec.items.map((p) => {
                            const active = selectedId === p.id;
                            return (
                              <button
                                key={p.id}
                                type="button"
                                aria-pressed={active}
                                onClick={() => {
                                  updateOverride("colorPalette", p.id);
                                  updateOverride("colorScaleKind", p.kind);
                                }}
                                className={`w-full text-left rounded border px-2 py-1.5 ${
                                  active
                                    ? "border-loom-accent bg-loom-accent/10"
                                    : "border-loom-border hover:border-loom-accent/40"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2 mb-1">
                                  <span className="text-2xs text-loom-text font-medium truncate">{p.name}</span>
                                  <span className="text-2xs text-loom-muted shrink-0">{PALETTE_KIND_LABELS[p.kind]}</span>
                                </div>
                                <div className="flex h-2.5 rounded overflow-hidden">
                                  {p.colors.map((c, i) => (
                                    <span key={`${p.id}-${i}`} className="flex-1" style={{ background: c }} />
                                  ))}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

            {/* Look spectrum — only controls that affect this chart kind */}
            <div className="space-y-2.5">
              <p className="text-2xs font-semibold text-loom-muted uppercase tracking-wide">Look</p>
              <IconToggleGroup
                label="Detail"
                value={chartVisualOverrides.chartDetail ?? "viz"}
                onChange={(v) => updateOverride("chartDetail", v)}
                options={[
                  { value: "plain", label: "Plain", icon: Ico.plain },
                  { value: "viz", label: "Viz", icon: Ico.viz },
                  { value: "deep", label: "Deep", icon: Ico.deep },
                ]}
              />
              {caps.markMotif && (
                <div
                  id={chromeDomId("marks")}
                  className={chartChromeFocus?.target === "marks" ? "rounded-md ring-2 ring-loom-accent/50 bg-loom-accent/10 p-1" : ""}
                  onMouseEnter={() => focusChromeFromPanel("marks")}
                  onMouseLeave={clearChromeFromPanel}
                >
                  <IconToggleGroup
                    label="Mark motif"
                    value={chartVisualOverrides.markMotif ?? "dots"}
                    onChange={(v) => updateOverride("markMotif", v)}
                    options={[
                      { value: "dots", label: "Dots", icon: Ico.dots },
                      { value: "squares", label: "Squares", icon: Ico.squares },
                      { value: "ticks", label: "Ticks", icon: Ico.ticks },
                      { value: "bar", label: "Bar", icon: Ico.bar },
                      { value: "ring", label: "Ring", icon: Ico.ring },
                    ]}
                  />
                </div>
              )}
              {caps.cartesian && (
                <div
                  id={chromeDomId("axes")}
                  className={chartChromeFocus?.target === "axes" ? "rounded-md ring-2 ring-loom-accent/50 bg-loom-accent/10 p-1" : ""}
                  onMouseEnter={() => focusChromeFromPanel("axes")}
                  onMouseLeave={clearChromeFromPanel}
                >
                  <IconToggleGroup
                    label="Axis style"
                    value={chartVisualOverrides.axisStyle ?? "rule"}
                    onChange={(v) => updateOverride("axisStyle", v)}
                    options={[
                      { value: "rule", label: "Rule", icon: Ico.rule },
                      { value: "ladder", label: "Ladder", icon: Ico.ladder },
                      { value: "mercury", label: "Mercury", icon: Ico.mercury },
                      { value: "spine", label: "Spine", icon: Ico.spine },
                      { value: "index", label: "Index", icon: Ico.index },
                      { value: "tape", label: "Tape", icon: Ico.tape },
                    ]}
                  />
                </div>
              )}
              <div
                id={chromeDomId("title")}
                className={chartChromeFocus?.target === "title" ? "rounded-md ring-2 ring-loom-accent/50 bg-loom-accent/10 p-1" : ""}
                onMouseEnter={() => focusChromeFromPanel("title")}
                onMouseLeave={clearChromeFromPanel}
              >
                <IconToggleGroup
                  label="Title layout"
                  value={chartVisualOverrides.titleLayout ?? "pair"}
                  onChange={(v) => updateOverride("titleLayout", v)}
                  options={[
                    { value: "pair", label: "Pair", icon: Ico.pair },
                    { value: "stack", label: "Stack", icon: Ico.stack },
                    { value: "spine", label: "Spine", icon: Ico.titleSpine },
                    { value: "caption", label: "Caption", icon: Ico.caption },
                    { value: "ticket", label: "Ticket", icon: Ico.ticket },
                    { value: "slab", label: "Slab", icon: Ico.slab },
                  ]}
                />
              </div>
              <IconToggleGroup
                label="Frame"
                value={chartVisualOverrides.chartFrame ?? "focus"}
                onChange={(v) => updateOverride("chartFrame", v)}
                options={[
                  { value: "hero", label: "Hero", icon: Ico.hero },
                  { value: "compact", label: "Compact", icon: Ico.compact },
                  { value: "focus", label: "Focus", icon: Ico.focus },
                ]}
              />
              <div className="space-y-1.5">
                <p className="text-2xs text-loom-muted">Source footnote</p>
                <p className="text-2xs text-loom-muted/80 leading-snug">
                  Drawn on the chart (and in Share / PNG) — pathway back to the data.
                </p>
                <select
                  className="loom-input text-2xs w-full py-1.5"
                  value={chartVisualOverrides.sourceFootnote ?? "credit"}
                  onChange={(e) =>
                    updateOverride(
                      "sourceFootnote",
                      e.target.value as "off" | "name" | "credit" | "full",
                    )
                  }
                >
                  <option value="off">Off</option>
                  <option value="name">Name only</option>
                  <option value="credit">Name + credit</option>
                  <option value="full">Full lineage</option>
                </select>
                {(chartVisualOverrides.sourceFootnote ?? "credit") !== "off" && (
                  <IconToggleGroup
                    label="Footnote align"
                    value={chartVisualOverrides.sourceFootnoteAlign ?? "left"}
                    onChange={(v) => updateOverride("sourceFootnoteAlign", v)}
                    options={[
                      { value: "left", label: "Left", icon: Ico.alignLeft },
                      { value: "center", label: "Center", icon: Ico.alignCenter },
                      { value: "right", label: "Right", icon: Ico.alignRight },
                    ]}
                  />
                )}
              </div>
              <label className="flex items-center gap-2 text-2xs text-loom-muted cursor-pointer min-h-8">
                <input
                  type="checkbox"
                  checked={chartVisualOverrides.ghostEnabled ?? false}
                  onChange={(e) => updateOverride("ghostEnabled", e.target.checked)}
                  className="rounded border-loom-border bg-loom-elevated accent-loom-accent"
                />
                Ghost overlay
              </label>
              {chartVisualOverrides.ghostEnabled && (
                <div className="space-y-2.5 pl-0.5">
                  <IconToggleGroup
                    label="Ghost weight"
                    value={chartVisualOverrides.ghostWeight ?? "soft"}
                    onChange={(v) => updateOverride("ghostWeight", v)}
                    options={[
                      { value: "whisper", label: "Whisper", icon: Ico.whisper },
                      { value: "soft", label: "Soft", icon: Ico.soft },
                      { value: "firm", label: "Firm", icon: Ico.firm },
                    ]}
                  />
                  <IconToggleGroup
                    label="Ghost place"
                    value={chartVisualOverrides.ghostPlace ?? "se"}
                    onChange={(v) => updateOverride("ghostPlace", v)}
                    options={[
                      { value: "nw", label: "Top left", icon: Ico.nw },
                      { value: "ne", label: "Top right", icon: Ico.ne },
                      { value: "sw", label: "Bottom left", icon: Ico.sw },
                      { value: "se", label: "Bottom right", icon: Ico.se },
                    ]}
                  />
                </div>
              )}
            </div>
            {/* Typography */}
            <div className="space-y-2.5">
              <p className="text-2xs font-semibold text-loom-muted uppercase tracking-wide">Typography</p>
              <div>
                <label className="block text-2xs text-loom-muted mb-1">Font family</label>
                <select
                  value={chartVisualOverrides.fontFamily ?? "Inter"}
                  onChange={(e) => updateOverride("fontFamily", e.target.value)}
                  className="loom-input w-full text-xs py-1.5"
                >
                  {["Inter", "JetBrains Mono", "IBM Plex Sans", "Libre Baskerville", "Lora", "Fira Code", "Geist"].map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>
              <IconToggleGroup
                label="Title weight"
                value={chartVisualOverrides.titleFontWeight ?? 600}
                onChange={(v) => updateOverride("titleFontWeight", v)}
                options={[
                  { value: 300, label: "Light", icon: Ico.weightLight },
                  { value: 400, label: "Regular", icon: Ico.weightRegular },
                  { value: 600, label: "Semibold", icon: Ico.weightSemi },
                  { value: 700, label: "Bold", icon: Ico.weightBold },
                ]}
              />
              <label className="flex items-center gap-2 text-2xs text-loom-muted cursor-pointer min-h-8">
                <input
                  type="checkbox"
                  checked={chartVisualOverrides.titleItalic ?? false}
                  onChange={(e) => updateOverride("titleItalic", e.target.checked)}
                  className="rounded border-loom-border bg-loom-elevated accent-loom-accent"
                />
                Title italic
              </label>
              {caps.cartesian && (
                <IconToggleGroup
                  label="Tick label rotation"
                  value={chartVisualOverrides.tickRotation ?? 0}
                  onChange={(v) => updateOverride("tickRotation", v)}
                  options={[
                    { value: 0, label: "0°", icon: Ico.rot0 },
                    { value: 30, label: "30°", icon: Ico.rot30 },
                    { value: 45, label: "45°", icon: Ico.rot45 },
                    { value: 60, label: "60°", icon: Ico.rot60 },
                    { value: 90, label: "90°", icon: Ico.rot90 },
                  ]}
                />
              )}
            </div>

            {/* Marks — only for kinds that draw marks this way */}
            {(caps.markPoints || caps.barMarks || caps.lineMarks) && (
            <div className="space-y-2">
              <p className="text-2xs font-semibold text-loom-muted uppercase tracking-wide">Marks</p>
              {caps.markPoints && (
                <>
                  <div>
                    <label className="block text-2xs text-loom-muted mb-1">Point size</label>
                    <input
                      type="range"
                      min={2}
                      max={24}
                      value={chartVisualOverrides.pointSize ?? 12}
                      onChange={(e) => updateOverride("pointSize", Number(e.target.value))}
                      className="w-full h-1.5 rounded-full appearance-none bg-loom-elevated accent-loom-accent"
                    />
                    <span className="text-2xs font-mono text-loom-muted ml-2">{chartVisualOverrides.pointSize ?? 12}</span>
                  </div>
                  <div>
                    <label className="block text-2xs text-loom-muted mb-1">Mark shape</label>
                    <select
                      value={chartVisualOverrides.markShape ?? "circle"}
                      onChange={(e) => updateOverride("markShape", e.target.value)}
                      className="loom-input w-full text-xs py-1.5"
                    >
                      {MARK_SHAPE_OPTIONS.map((shape) => (
                        <option key={shape.value} value={shape.value}>{shape.label}</option>
                      ))}
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-2xs text-loom-muted cursor-pointer">
                    <input
                      type="checkbox"
                      checked={chartVisualOverrides.markStroke ?? false}
                      onChange={(e) => updateOverride("markStroke", e.target.checked)}
                      className="rounded border-loom-border bg-loom-elevated accent-loom-accent"
                    />
                    Mark outline
                  </label>
                  {chartVisualOverrides.markStroke && (
                    <div className="grid grid-cols-2 gap-1">
                      <div>
                        <label className="block text-2xs text-loom-muted mb-0.5">Stroke width</label>
                        <input
                          type="number"
                          min={0.5}
                          max={3}
                          step={0.5}
                          value={chartVisualOverrides.markStrokeWidth ?? 1}
                          onChange={(e) => updateOverride("markStrokeWidth", Number(e.target.value) || undefined)}
                          className="loom-input w-full text-xs py-1"
                        />
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="block text-2xs text-loom-muted mb-1">Jitter (px)</label>
                    <input
                      type="range"
                      min={0}
                      max={10}
                      value={chartVisualOverrides.markJitter ?? 0}
                      onChange={(e) => updateOverride("markJitter", Number(e.target.value))}
                      className="w-full h-1.5 rounded-full appearance-none bg-loom-elevated accent-loom-accent"
                    />
                    <span className="text-2xs font-mono text-loom-muted ml-2">{chartVisualOverrides.markJitter ?? 0}</span>
                  </div>
                  <div>
                    <label className="block text-2xs text-loom-muted mb-1">Size scale</label>
                    <input
                      type="range"
                      min={0.5}
                      max={2}
                      step={0.1}
                      value={chartVisualOverrides.sizeScale ?? 1}
                      onChange={(e) => updateOverride("sizeScale", Number(e.target.value))}
                      className="w-full h-1.5 rounded-full appearance-none bg-loom-elevated accent-loom-accent"
                    />
                    <span className="text-2xs font-mono text-loom-muted ml-2">
                      {(chartVisualOverrides.sizeScale ?? 1).toFixed(1)}×
                      {activeChart.sizeField && (() => {
                        const s = chartVisualOverrides.sizeScale ?? 1;
                        return (
                          <span className="ml-1 text-loom-muted/80" title="Size encoding min–max multiplier">
                            {" "}(range {(0.4 * s).toFixed(1)}× – {(1.2 * s).toFixed(1)}×)
                          </span>
                        );
                      })()}
                    </span>
                  </div>
                </>
              )}
              {caps.barMarks && (
                <div>
                  <label className="block text-2xs text-loom-muted mb-1">Bar corner radius (px)</label>
                  <input
                    type="range"
                    min={0}
                    max={12}
                    value={chartVisualOverrides.barCornerRadius ?? 3}
                    onChange={(e) => updateOverride("barCornerRadius", Number(e.target.value))}
                    className="w-full h-1.5 rounded-full appearance-none bg-loom-elevated accent-loom-accent"
                  />
                  <span className="text-2xs font-mono text-loom-muted ml-2">{chartVisualOverrides.barCornerRadius ?? 3}</span>
                </div>
              )}
              {caps.lineMarks && (
                <>
                  <IconToggleGroup
                    label="Line style"
                    value={chartVisualOverrides.lineStrokeStyle ?? "solid"}
                    onChange={(v) => updateOverride("lineStrokeStyle", v)}
                    options={[
                      { value: "solid", label: "Solid", icon: Ico.solid },
                      { value: "dashed", label: "Dashed", icon: Ico.dashed },
                      { value: "dotted", label: "Dotted", icon: Ico.dotted },
                    ]}
                  />
                  <label className="flex items-center gap-2 text-2xs text-loom-muted cursor-pointer min-h-8">
                    <input
                      type="checkbox"
                      checked={chartVisualOverrides.lineCurveSmooth ?? false}
                      onChange={(e) => updateOverride("lineCurveSmooth", e.target.checked)}
                      className="rounded border-loom-border bg-loom-elevated accent-loom-accent"
                    />
                    Smooth curve
                  </label>
                </>
              )}
            </div>
            )}

            {/* Axes & Grid — cartesian charts only */}
            {caps.cartesian && (
            <div className="space-y-2.5">
              <p className="text-2xs font-semibold text-loom-muted uppercase tracking-wide">Axes & Grid</p>
              <ColorSwatchGroup
                label="Axis line color"
                value={chartVisualOverrides.axisLineColor ?? "theme"}
                onChange={(v) => updateOverride("axisLineColor", v === "theme" ? undefined : v)}
                options={AXIS_LINE_COLOR_SWATCHES}
              />
              <div>
                <label className="block text-2xs text-loom-muted mb-1">Axis line width</label>
                <input
                  type="range"
                  min={0.5}
                  max={4}
                  step={0.5}
                  value={chartVisualOverrides.axisLineWidth ?? 1}
                  onChange={(e) => updateOverride("axisLineWidth", Number(e.target.value))}
                  className="w-full h-1.5 rounded-full appearance-none bg-loom-elevated accent-loom-accent"
                />
                <span className="text-2xs font-mono text-loom-muted ml-2">{chartVisualOverrides.axisLineWidth ?? 1}</span>
              </div>
              <IconToggleGroup
                label="Grid style"
                value={chartVisualOverrides.gridStyle ?? "solid"}
                onChange={(v) => updateOverride("gridStyle", v)}
                options={[
                  { value: "solid", label: "Solid", icon: Ico.solid },
                  { value: "dashed", label: "Dashed", icon: Ico.dashed },
                  { value: "dotted", label: "Dotted", icon: Ico.dotted },
                  { value: "none", label: "None", icon: Ico.none },
                ]}
              />
              <div>
                <label className="block text-2xs text-loom-muted mb-1">Grid opacity</label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.1}
                  value={chartVisualOverrides.gridOpacity ?? 0.5}
                  onChange={(e) => updateOverride("gridOpacity", Number(e.target.value))}
                  className="w-full h-1.5 rounded-full appearance-none bg-loom-elevated accent-loom-accent"
                />
                <span className="text-2xs font-mono text-loom-muted ml-2">{((chartVisualOverrides.gridOpacity ?? 0.5) * 100).toFixed(0)}%</span>
              </div>
              <div>
                <label className="block text-2xs text-loom-muted mb-1">Tick count</label>
                <input
                  type="range"
                  min={3}
                  max={10}
                  value={chartVisualOverrides.tickCount ?? 5}
                  onChange={(e) => updateOverride("tickCount", Number(e.target.value))}
                  className="w-full h-1.5 rounded-full appearance-none bg-loom-elevated accent-loom-accent"
                />
                <span className="text-2xs font-mono text-loom-muted ml-2">{chartVisualOverrides.tickCount ?? 5}</span>
              </div>
              <ColorSwatchGroup
                label="Axis label color"
                value={chartVisualOverrides.axisLabelColor ?? "theme"}
                onChange={(v) => updateOverride("axisLabelColor", v === "theme" ? undefined : v)}
                options={AXIS_LABEL_COLOR_SWATCHES}
              />
              <div>
                <label className="block text-2xs text-loom-muted mb-1">Axis font size</label>
                <input
                  type="number"
                  min={8}
                  max={16}
                  value={chartVisualOverrides.axisFontSize ?? 11}
                  onChange={(e) => updateOverride("axisFontSize", Number(e.target.value) || undefined)}
                  className="loom-input w-full text-xs py-1"
                />
              </div>
              <label
                id={chromeDomId("grid")}
                className={`flex items-center gap-2 text-2xs text-loom-muted cursor-pointer rounded-md ${
                  chartChromeFocus?.target === "grid" ? "ring-2 ring-loom-accent/50 bg-loom-accent/10 p-1" : ""
                }`}
                onMouseEnter={() => focusChromeFromPanel("grid")}
                onMouseLeave={clearChromeFromPanel}
              >
                <input
                  type="checkbox"
                  checked={chartVisualOverrides.showGrid ?? true}
                  onChange={(e) => updateOverride("showGrid", e.target.checked)}
                  className="rounded border-loom-border bg-loom-elevated accent-loom-accent"
                />
                Show grid
              </label>
            </div>
            )}

            {/* Layout */}
            <div className="space-y-2">
              <p className="text-2xs font-semibold text-loom-muted uppercase tracking-wide">Layout</p>
              <div>
                <label className="block text-2xs text-loom-muted mb-1">Chart padding (px)</label>
                <input
                  type="range"
                  min={20}
                  max={80}
                  value={chartVisualOverrides.chartPadding ?? 56}
                  onChange={(e) => updateOverride("chartPadding", Number(e.target.value))}
                  className="w-full h-1.5 rounded-full appearance-none bg-loom-elevated accent-loom-accent"
                />
                <span className="text-2xs font-mono text-loom-muted ml-2">{chartVisualOverrides.chartPadding ?? 56}</span>
              </div>
              <div
                id={chromeDomId("legend")}
                className={chartChromeFocus?.target === "legend" || chartChromeFocus?.target === "color" ? "rounded-md ring-2 ring-loom-accent/50 bg-loom-accent/10 p-1" : ""}
                onMouseEnter={() => focusChromeFromPanel("legend")}
                onMouseLeave={clearChromeFromPanel}
              >
                <label className="block text-2xs text-loom-muted mb-1">Legend position</label>
                <select
                  value={chartVisualOverrides.legendPosition ?? "auto"}
                  onChange={(e) => updateOverride("legendPosition", e.target.value)}
                  className="loom-input w-full text-xs py-1.5"
                  disabled={!caps.legend}
                >
                  {[
                    ["auto", "Auto (emptiest corner)"],
                    ["top-right", "Top right"],
                    ["top-left", "Top left"],
                    ["bottom-right", "Bottom right"],
                    ["bottom-left", "Bottom left"],
                    ["none", "None"],
                  ].map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                {!caps.legend && (
                  <p className="text-2xs text-loom-muted mt-0.5">Legend isn’t used for this chart type.</p>
                )}
              </div>
              {caps.dataLabels && (
                <label className="flex items-center gap-2 text-2xs text-loom-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={chartVisualOverrides.showDataLabels ?? false}
                    onChange={(e) => updateOverride("showDataLabels", e.target.checked)}
                    className="rounded border-loom-border bg-loom-elevated accent-loom-accent"
                  />
                  Data labels
                </label>
              )}
            </div>

            {/* Atmosphere */}
            <div className="space-y-2">
              <p className="text-2xs font-semibold text-loom-muted uppercase tracking-wide">Atmosphere</p>
              <div>
                <label className="block text-2xs text-loom-muted mb-1">Background</label>
                <select
                  value={chartVisualOverrides.backgroundStyle ?? "default"}
                  onChange={(e) => updateOverride("backgroundStyle", e.target.value)}
                  className="loom-input w-full text-xs py-1.5"
                >
                  {["default", "tufte", "newsprint", "bauhaus", "carbon", "blueprint", "ruled", "gradient", "paper", "transparent"].map((b) => (
                    <option key={b} value={b}>
                      {b === "default" ? "Default"
                        : b === "tufte" ? "Tufte clean"
                        : b === "newsprint" ? "Newsprint"
                        : b === "bauhaus" ? "Bauhaus blocks"
                        : b === "carbon" ? "Carbon hatch"
                        : b === "blueprint" ? "Blueprint"
                        : b === "ruled" ? "Ruled notebook"
                        : b === "gradient" ? "Gradient vignette"
                        : b === "paper" ? "Paper grain"
                        : "Transparent"}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-2xs text-loom-muted mb-1">Blend mode</label>
                <select
                  value={chartVisualOverrides.blendMode ?? "source-over"}
                  onChange={(e) => updateOverride("blendMode", e.target.value as GlobalCompositeOperation)}
                  className="loom-input w-full text-xs py-1.5"
                >
                  {BLEND_MODE_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              {caps.markPoints && (
                <>
                  <label className="flex items-center gap-2 text-2xs text-loom-muted cursor-pointer">
                    <input
                      type="checkbox"
                      checked={chartVisualOverrides.glowEnabled ?? false}
                      onChange={(e) => updateOverride("glowEnabled", e.target.checked)}
                      className="rounded border-loom-border bg-loom-elevated accent-loom-accent"
                    />
                    Glow on marks
                  </label>
                  {chartVisualOverrides.glowEnabled && (
                    <div>
                      <label className="block text-2xs text-loom-muted mb-1">Glow intensity</label>
                      <input
                        type="range"
                        min={1}
                        max={20}
                        value={chartVisualOverrides.glowIntensity ?? 8}
                        onChange={(e) => updateOverride("glowIntensity", Number(e.target.value))}
                        className="w-full h-1.5 rounded-full appearance-none bg-loom-elevated accent-loom-accent"
                      />
                      <span className="text-2xs font-mono text-loom-muted ml-2">{chartVisualOverrides.glowIntensity ?? 8}</span>
                    </div>
                  )}
                </>
              )}
              <label className="flex items-center gap-2 text-2xs text-loom-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={chartVisualOverrides.animateEntrance ?? false}
                  onChange={(e) => updateOverride("animateEntrance", e.target.checked)}
                  className="rounded border-loom-border bg-loom-elevated accent-loom-accent"
                />
                Animate entrance
              </label>
            </div>

            {/* Annotations */}
            {activeChart && (
              <div className="space-y-2">
                <p className="text-2xs font-semibold text-loom-muted uppercase tracking-wide">Annotations</p>
                <button
                  type="button"
                  onClick={() => {
                    setPromptDialog({
                      title: "Annotation text",
                      defaultValue: "",
                      onConfirm: (text) => {
                        if (text?.trim()) addChartAnnotation(activeChart.id, text.trim());
                      }
                    });
                  }}
                  className="w-full px-2 py-1 text-2xs rounded border border-loom-border text-loom-text hover:border-loom-accent"
                >
                  Add note
                </button>
                {(chartAnnotations[activeChart.id] ?? []).map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-1 text-2xs text-loom-text bg-loom-elevated/50 rounded px-2 py-1">
                    <span className="truncate min-w-0">{a.text}</span>
                    <button type="button" onClick={() => removeChartAnnotation(activeChart.id, a.id)} className="shrink-0 text-loom-muted hover:text-loom-text" aria-label="Remove">×</button>
                  </div>
                ))}
              </div>
            )}

            {/* Shared */}
            <div className="space-y-2 pt-2 border-t border-loom-border">
              <div>
                <label className="block text-2xs text-loom-muted mb-1">Opacity</label>
                <input
                  type="range"
                  min={0.2}
                  max={1}
                  step={0.05}
                  value={chartVisualOverrides.opacity ?? 0.7}
                  onChange={(e) => updateOverride("opacity", Number(e.target.value))}
                  className="w-full h-1.5 rounded-full appearance-none bg-loom-elevated accent-loom-accent"
                />
                <span className="text-2xs font-mono text-loom-muted ml-2">{((chartVisualOverrides.opacity ?? 0.7) * 100).toFixed(0)}%</span>
              </div>
            </div>
          </div>
      </div>
        </div>
      )}
      </div>
    </div>
  );
}
