"use client";

import { isNumericType } from "@/lib/canvasCharts/shared";
import { useChartTheme } from "@/components/useChartTheme";
import { resolveThemeChartStyle } from "@/lib/themeChartStyle";
import { lazy, Suspense, useState, useCallback, useMemo, useEffect, useRef, useId, type ReactNode, type DragEvent } from "react";
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
import { ColumnFieldPicker } from "@/components/ColumnFieldPicker";
import { EncodingInfoTip } from "@/components/EncodingInfoTip";
import { ChartEditToolbar } from "@/components/ChartEditToolbar";
import { ChartLookLibrary } from "@/components/ChartLookLibrary";
import { ChartInspectorSection } from "@/components/ChartInspectorSection";
import { chartSpacePadding } from "@/lib/chartSpace";
import { goToDashboardsAfterSave, saveChartView } from "@/lib/saveChartView";
import {
  AXIS_LABEL_COLOR_SWATCHES,
  AXIS_LINE_COLOR_SWATCHES,
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
import { FONT_CHOICES, FONT_GROUPS, chartFontLabel, chartFontStack, resolveChartFontFamily } from "@/lib/fontCatalog";
import { chartTypeRamp, resolveChartAxisFontSize } from "@/lib/chartType";
import { requestDiscoverScan } from "@/lib/discoverStories";
import { CHANGELOG, requestHelp, requestWhatsNew } from "@/lib/changelog";
import {
  createChartRec,
  fitEncodingToKind,
  PART_TO_WHOLE_KINDS,
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
  encodingDirectionTip,
  encodingDirectionTitle,
  encodingKindBlurb,
  encodingPanelHints,
  encodingDropAllowed,
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
import { ATLAS_OPTIONS } from "@/lib/geoAtlas";
import { isGeoFamilyKind } from "@/lib/geoMaps";
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
import { inferColumnType } from "@/lib/columnClassify";
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
import { CURATED_MARK_EMOJIS, MARK_SHAPE_OPTIONS } from "@/lib/chartMarks";
import {
  assignChartEmoji,
  chartEmojiLabel,
  emojiFieldKeys,
  seedEmojiMap,
} from "@/lib/chartEmoji";
import { semanticEmojiMap } from "@/lib/discoverMarkers";

const DRAG_TYPE_COLUMN = "application/x-loom-column";

type EncodingOption = { value: string; label: string; type?: string; disabled?: boolean };

/** Abbreviate DuckDB-ish types for the Encoding slot chip. */
/** Same vocabulary as the field picker's type chips (# / Abc / Time); raw SQL type stays in the tooltip. */
function shortColType(typeHint: string, colName?: string): string {
  const kind = inferColumnType(typeHint, colName);
  return kind === "quantitative" ? "#" : kind === "temporal" ? "Time" : "Abc";
}

const ENCODING_LABEL_CLASS =
  "shrink-0 w-[5rem] px-1.5 flex items-center text-2xs font-semibold text-loom-label bg-loom-bg/60 border-r border-loom-border/80 leading-snug";

/** Label + control row matching EncodingSlot chrome (for Aggregate, etc.). */
function EncodingSelectSlot({
  label,
  htmlFor,
  title,
  children,
}: {
  label: string;
  htmlFor?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className="loom-encoding-slot flex items-stretch gap-0 rounded-md border border-loom-border bg-loom-elevated/40">
      <label
        htmlFor={htmlFor}
        className={ENCODING_LABEL_CLASS}
        title={title || label}
      >
        {label}
      </label>
      <div className="flex-1 min-w-0 flex items-stretch">{children}</div>
    </div>
  );
}

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
  description,
  info,
  invert,
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
  /** Live status under the slot (counts, window mode) — keep short. */
  description?: string;
  /** Longer help behind an ⓘ tip (preferred over always-on paragraphs). */
  info?: string;
  /** Flip high → low for this channel. Shown only when a field is chosen. */
  invert?: { on: boolean; hint: string; onToggle: () => void; always?: boolean } | null;
}) {
  const droppable = Boolean(onDrop);
  const descId = useId();
  const typeBadge = typeHint ? shortColType(typeHint, value) : undefined;
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
          loom-encoding-slot flex items-stretch gap-0 rounded-md border transition-colors
          ${chromeActive ? "border-loom-accent bg-loom-accent/15 ring-2 ring-loom-accent/50" : ""}
          ${!chromeActive && isDropActive ? "border-loom-accent bg-loom-accent/10 ring-1 ring-loom-accent/40" : ""}
          ${!chromeActive && !isDropActive ? "border-loom-border bg-loom-elevated/40" : ""}
          ${droppable && !isDropActive && !chromeActive ? "border-dashed" : ""}
        `}
      >
        <span
          className={`${ENCODING_LABEL_CLASS} gap-0.5`}
          title={droppable ? `${label} — pick a column or drop from Schema` : label}
          id={`${descId}-label`}
        >
          <span className="min-w-0 break-words">{label}</span>
          {info ? <EncodingInfoTip text={info} label={`About ${label}`} /> : null}
        </span>
        <ColumnFieldPicker
          value={value}
          options={options}
          onChange={onChange}
          allowEmpty={allowEmpty}
          emptyLabel={emptyLabel}
          labelledBy={`${descId}-label`}
          describedBy={description ? descId : undefined}
          ariaLabel={`${label} field`}
          typeBadge={typeBadge}
          typeBadgeTitle={typeHint}
        />
        {invert && (value || invert.always) ? (
          <button
            type="button"
            aria-pressed={invert.on}
            title={invert.hint}
            aria-label={invert.hint}
            onClick={(e) => {
              e.preventDefault();
              invert.onToggle();
            }}
            className={`shrink-0 grid w-7 place-items-center border-l text-[11px] leading-none ${
              invert.on
                ? "border-loom-accent/40 text-loom-accent bg-loom-accent/10"
                : "border-loom-border text-loom-muted/70 hover:text-loom-text"
            }`}
          >
            ↕
          </button>
        ) : null}
      </div>
      {description ? (
        <p id={descId} className="text-2xs text-loom-muted leading-snug pl-0.5">
          {description}
        </p>
      ) : null}
      {trailing}
    </div>
  );
}

function EncodingSectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-2xs font-semibold text-loom-muted uppercase tracking-wider pt-1">{children}</p>
  );
}

/** Shared “Keep while shuffling” chips — Encoding (✦/⟳) and Visual (Shuffle look). */
function ShuffleKeepRow({
  tip,
  chips,
}: {
  tip: string;
  chips: { id: string; label: string; on: boolean; onToggle: () => void }[];
}) {
  if (chips.length === 0) return null;
  const anyOn = chips.some((c) => c.on);
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Keep while shuffling">
      <span
        className={`inline-flex size-5 items-center justify-center ${anyOn ? "text-loom-accent" : "text-loom-muted/55"}`}
        title={tip}
        aria-label={tip}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <rect x="2.25" y="5" width="7.5" height="5.25" rx="1" stroke="currentColor" strokeWidth="1.1" />
          <path d="M4 5V3.6a2 2 0 0 1 4 0V5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
        </svg>
      </span>
      {chips.map((c) => (
        <button
          key={c.id}
          type="button"
          aria-pressed={c.on}
          onClick={c.onToggle}
          title={c.on ? `Locked — ${c.label} stays when you shuffle` : `Lock ${c.label} while shuffling`}
          className={`px-1.5 py-0.5 text-2xs rounded-full ${
            c.on
              ? "text-loom-accent bg-loom-accent/10"
              : "text-loom-muted hover:text-loom-text hover:bg-loom-elevated"
          }`}
        >
          {c.label}
        </button>
      ))}
    </div>
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

const MARK_SHAPE_ICON: Record<(typeof MARK_SHAPE_OPTIONS)[number]["value"], string> = {
  circle: "●",
  "pill-vertical": "▮",
  dash: "▬",
  triangle: "▲",
  "rounded-square": "▣",
  pentagon: "⬟",
  ring: "○",
  x: "✕",
  diamond: "◆",
  pin: "⬤",
  square: "■",
  cross: "✚",
  star: "★",
  hexagon: "⬢",
};

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
      <p className="text-2xs text-loom-muted mb-1" id={`icon-toggle-${label.replace(/\s+/g, "-").toLowerCase()}`}>
        {label}
      </p>
      <div
        className="flex flex-wrap gap-1"
        role="radiogroup"
        aria-labelledby={`icon-toggle-${label.replace(/\s+/g, "-").toLowerCase()}`}
        onKeyDown={(e) => {
          const i = options.findIndex((o) => o.value === value);
          if (i < 0) return;
          let next = i;
          if (e.key === "ArrowRight" || e.key === "ArrowDown") {
            next = (i + 1) % options.length;
          } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
            next = (i - 1 + options.length) % options.length;
          } else if (e.key === "Home") {
            next = 0;
          } else if (e.key === "End") {
            next = options.length - 1;
          } else return;
          e.preventDefault();
          onChange(options[next]!.value);
          e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
        }}
      >
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={String(opt.value)}
              type="button"
              role="radio"
              title={opt.label}
              aria-label={opt.label}
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(opt.value)}
              className={`
                min-h-11 min-w-11 px-2 py-1.5 rounded-md border flex flex-col gap-1 items-center justify-center transition-colors
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-loom-accent/50
                ${active
                  ? "border-loom-accent bg-loom-accent/15 text-loom-text"
                  : "border-loom-border text-loom-muted hover:border-loom-accent/40 hover:text-loom-text hover:bg-loom-elevated"}
              `}
            >
              {opt.icon}
              <span className="text-2xs leading-tight">{opt.label}</span>
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


function EmojiAssignments({
  field,
  rows,
  columns,
  map,
  onAssign,
}: {
  field: string;
  rows: unknown[][];
  columns: string[];
  map: import("@/lib/chartEmoji").ChartEmojiMap | null;
  onAssign: (map: import("@/lib/chartEmoji").ChartEmojiMap) => void;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const semantic = semanticEmojiMap(field) ?? null;
  const keys = useMemo(
    () => emojiFieldKeys(rows, columns, field),
    [rows, columns, field],
  );
  const seeded = useMemo(
    () => seedEmojiMap(field, keys, map, semantic),
    [field, keys, map, semantic],
  );
  if (!keys.length || !seeded) return null;
  const choose = (key: string, glyph: string) => {
    const next = assignChartEmoji(field, keys, map, key, glyph, semantic);
    if (next) onAssign(next);
    setOpenKey(null);
    setCustom("");
  };
  return (
    <div className="space-y-1 pl-0.5">
      <p className="text-2xs text-loom-muted">Which symbol is which</p>
      <ul className="space-y-1">
        {keys.map((key) => {
          const glyph = seeded.values[key] ?? "⭐";
          const label = chartEmojiLabel(key, field, seeded);
          const open = openKey === key;
          return (
            <li key={key} className="rounded-md border border-loom-border/70">
              <button
                type="button"
                aria-expanded={open}
                className="flex w-full items-center gap-2 min-h-8 px-2 text-left text-2xs"
                onClick={() => {
                  setOpenKey(open ? null : key);
                  setCustom("");
                }}
              >
                <span className="text-base leading-none shrink-0" aria-hidden>
                  {glyph}
                </span>
                <span className="min-w-0 flex-1 text-loom-text break-words">
                  {label}
                </span>
              </button>
              {open && (
                <div className="px-2 pb-2 space-y-1.5">
                  <div className="grid grid-cols-8 gap-1" role="listbox" aria-label={`Symbol for ${label}`}>
                    {CURATED_MARK_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        className={`h-8 rounded border text-base leading-none ${
                          glyph === emoji
                            ? "border-loom-accent bg-loom-accent/15"
                            : "border-loom-border hover:border-loom-accent/40"
                        }`}
                        onClick={() => choose(key, emoji)}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                  <label className="flex items-center gap-1.5 text-2xs text-loom-muted">
                    <span className="shrink-0">Or paste</span>
                    <input
                      value={custom}
                      onChange={(event) => setCustom(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") choose(key, custom);
                      }}
                      placeholder="🌪️"
                      className="min-w-0 flex-1 rounded border border-loom-border bg-transparent px-2 min-h-8 text-base"
                    />
                  </label>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// --- Save chart view button (used in Chart tab) ---
function SaveChartViewButton() {
  const selectedFile = useLoomStore((s) => s.selectedFile);
  const activeChart = useLoomStore((s) => s.activeChart);
  const chartVisualOverrides = useLoomStore((s) => s.chartVisualOverrides);
  const setToast = useLoomStore((s) => s.setToast);
  const setPromptDialog = useLoomStore((s) => s.setPromptDialog);
  const querySql = useLoomStore((s) => s.querySql);
  const sampleRows = useLoomStore((s) => s.sampleRows);
  if (!selectedFile || !activeChart) return null;
  return (
    <button
      type="button"
      onClick={() => {
        const base = {
          filePath: selectedFile.path,
          fileName: selectedFile.name,
          chart: activeChart,
          visualOverrides: chartVisualOverrides,
          querySql,
          sampleRows,
        };
        setPromptDialog({
          title: "Save chart view",
          message: "Name this view, then save it — or save and jump to Dashboards to place it.",
          defaultValue: activeChart.title || "Chart view",
          confirmLabel: "Save",
          secondaryConfirmLabel: "Save and go to Dashboards",
          onConfirm: async (name) => {
            if (name == null || !name.trim()) return;
            const id = await saveChartView({ ...base, name });
            setToast(id ? "Chart view saved" : "Could not save chart view");
          },
          onSecondaryConfirm: async (name) => {
            if (!name.trim()) return;
            const id = await saveChartView({ ...base, name });
            if (!id) {
              setToast("Could not save chart view");
              return;
            }
            goToDashboardsAfterSave();
            setToast("Saved — add it to a dashboard");
          },
        });
      }}
      className="text-2xs py-0.5 px-1.5 rounded border border-loom-border text-loom-muted hover:text-loom-text hover:border-loom-accent"
    >
      Save view
    </button>
  );
}

const AnalyzeSection = lazy(() => import("./SmartTab"));
const OverlaysSection = lazy(() => import("./OverlaysTab"));
const CHART_SECTIONS = [
  { id: "encoding", label: "Encoding", path: "M4 5h16M4 12h16M4 19h16M8 3v4M16 10v4M10 17v4" },
  { id: "visual", label: "Visual", path: "M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-3.7 1.5 1.5 0 0 1 1-2.8H17a4 4 0 0 0 4-4C21 6.4 17 3 12 3ZM7 10h.01M10 7h.01M15 7h.01M18 10h.01" },
  { id: "analyze", label: "Analyze", path: "M3 3v18h18M6 15l4-5 4 3 6-8M16 5h4v4" },
  { id: "overlays", label: "Overlays", path: "m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5" },
] as const;

export default function ChartPanelTab() {
  const {
    activeChart,
    vegaSpec,
    sampleRows,
    columnStats,
    chartVisualOverrides,
    setChartVisualOverrides,
    editChartVisualOverrides,
    setActiveChart,
    editActiveChart,
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
      editChartVisualOverrides: s.editChartVisualOverrides,
      setActiveChart: s.setActiveChart,
      editActiveChart: s.editActiveChart,
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
  const previewTitle = useLoomStore((s) => s.activeChart ? s.chartTitleOverrides[s.activeChart.id] ?? s.activeChart.title : "Your chart title");
  const setPanelTab = useLoomStore((s) => s.setPanelTab);
  const effectiveTheme = useChartTheme();
  const inheritedStyle = resolveThemeChartStyle(effectiveTheme);
  const previewFont = resolveChartFontFamily(chartVisualOverrides.fontFamily, appSettings.font, appSettings.faces);
  const previewType = chartTypeRamp(chartVisualOverrides.axisFontSize);
  const customFont = chartVisualOverrides.fontFamily && chartVisualOverrides.fontFamily !== "inherit" && !Object.values(FONT_CHOICES).some((font) => font.family === chartVisualOverrides.fontFamily);
  const [specExpanded, setSpecExpanded] = useState(true);
  const [specCopyOk, setSpecCopyOk] = useState(false);
  const [dragOverSlot, setDragOverSlot] = useState<"x" | "y" | "color" | "size" | "z" | null>(null);
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

  // Chart click on an axis / title → switch tab and scroll the matching control into view.
  // Hover only outlines the chart; it does not open or scroll the panel.
  useEffect(() => {
    if (!chartChromeFocus || chartChromeFocus.source !== "chart") return;
    const sections: Partial<Record<ChartChromeTarget, string>> = { color: "color", marks: "look", axes: "look", grid: "axes", title: "look", legend: "layout" };
    const section = sections[chartChromeFocus.target];
    if (section) setVisualSections((prev) => ({ ...prev, [section]: true }));
    const t = window.setTimeout(() => {
      document.getElementById(chromeDomId(chartChromeFocus.target))?.scrollIntoView({ block: "nearest", behavior: appSettings.reducedMotion ? "auto" : "smooth" });
    }, 80);
    return () => window.clearTimeout(t);
  }, [chartChromeFocus, appSettings.reducedMotion]);
  const [vegaOpen, setVegaOpen] = useState(false);
  const [chartWhyOpen, setChartWhyOpen] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(true);
  const [moreChannelsOpen, setMoreChannelsOpen] = useState(() =>
    Boolean(
      activeChart?.sizeField ||
        activeChart?.glowField ||
        activeChart?.outlineField ||
        activeChart?.opacityField ||
        activeChart?.shapeField ||
        activeChart?.emojiField,
    ),
  );
  const [visualSections, setVisualSections] = useState<Record<string, boolean>>({ design: true });
  const [paletteQuery, setPaletteQuery] = useState("");
  const toggleVisualSection = (key: string) => setVisualSections((prev) => ({ ...prev, [key]: !prev[key] }));
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
      shapeField: activeChart?.shapeField ?? null,
      emojiField: activeChart?.emojiField ?? null,
      emojiMap: activeChart?.emojiMap,
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
      pyramidScaleMode: activeChart?.pyramidScaleMode ?? null,
      deltaDisplay: activeChart?.deltaDisplay ?? null,
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
      activeChart?.shapeField,
      activeChart?.emojiField,
      activeChart?.yAggregate,
      activeChart?.emojiMap,
      activeChart?.topN,
      activeChart?.y2Field,
      activeChart?.comparePrevious,
      activeChart?.rollingWindow,
      activeChart?.yScale,
      activeChart?.seriesNormalize,
      activeChart?.residualOverlay,
      activeChart?.anomalyHighlight,
      activeChart?.bumpMode,
      activeChart?.pyramidScaleMode,
      activeChart?.deltaDisplay,
      activeChart?.timeWindowField,
      activeChart?.timeWindow,
      activeChart?.tooltipFields,
      activeChart?.tooltipKeyField,
      activeChart?.layoutDirection,
      barStackMode,
    ],
  );

  const commitRec = useCallback(
    (rec: NonNullable<ReturnType<typeof createChartRec>>, toastMsg?: string) => {
      editActiveChart(rec);
      if (toastMsg) setToast(toastMsg, { undo: true });
    },
    [editActiveChart, setToast],
  );

  const handleDragEnter = useCallback((slot: "x" | "y" | "color" | "size" | "z") => () => setDragOverSlot(slot), []);
  const handleDragOver = useCallback((slot: "x" | "y" | "color" | "size" | "z") => (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragOverSlot(slot);
  }, []);
  const handleDragLeave = useCallback(() => setDragOverSlot(null), []);

  const updateOverride = useCallback(
    (key: keyof ChartVisualOverrides, value: number | string | boolean | undefined) => {
      editChartVisualOverrides({ [key]: value }, typeof value === "number" ? key : undefined);
    },
    [editChartVisualOverrides],
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
      const resolved =
        colName === "" || colName === "__none__"
          ? null
          : colName;
      if (resolved) {
        const col = columnStats.find((c) => c.name === resolved);
        const gate = encodingDropAllowed(activeChart.kind, slot, col);
        if (!gate.ok) {
          setToast(gate.reason);
          return;
        }
      }
      const newX = slot === "x" ? (resolved ?? activeChart.xField) : activeChart.xField;
      const newY = slot === "y" ? resolved : activeChart.yField;
      const newColor = slot === "color" ? resolved : activeChart.colorField;
      if (slot === "x" && !resolved) return;
      const extra = extraFromChart();
      if (slot === "color" && (activeChart.kind === "heatmap" || activeChart.kind === "hexbin") && !activeChart.colorField && newColor) extra.yAggregate = "mean";
      const rec = createChartRec(activeChart.kind, columnStats, newX, newY, newColor, tableName, extra);
      if (rec) commitRec(rec);
    },
    [activeChart, columnStats, tableName, extraFromChart, setToast, commitRec],
  );

  const applyEncodingExtra = useCallback(
    (slot: "size" | "z" | "row" | "glow" | "outline" | "opacity" | "shape" | "emoji" | "y2", colName: string): boolean => {
      if (!activeChart || columnStats.length === 0) return false;
      const sizeField = slot === "size" ? (colName === "__none__" || colName === "" ? null : colName) : (activeChart.sizeField ?? null);
      const zField = slot === "z" ? (colName === "__none__" || colName === "" ? null : colName) : (activeChart.zField ?? null);
      const rowField = slot === "row" ? (colName === "__none__" || colName === "" ? null : colName) : (activeChart.rowField ?? null);
      const glowField = slot === "glow" ? (colName === "__none__" || colName === "" ? null : colName) : (activeChart.glowField ?? null);
      const outlineField = slot === "outline" ? (colName === "__none__" || colName === "" ? null : colName) : (activeChart.outlineField ?? null);
      const opacityField = slot === "opacity" ? (colName === "__none__" || colName === "" ? null : colName) : (activeChart.opacityField ?? null);
      const selectedSymbol = colName === "__none__" || colName === "" ? null : colName;
      const shapeField = slot === "shape" ? selectedSymbol : slot === "emoji" && selectedSymbol ? null : (activeChart.shapeField ?? null);
      const emojiField = slot === "emoji" ? selectedSymbol : slot === "shape" && selectedSymbol ? null : (activeChart.emojiField ?? null);
      const y2Field = slot === "y2" ? (colName === "__none__" || colName === "" ? null : colName) : (activeChart.y2Field ?? null);
      // Dual-measure kinds need two distinct numeric ends
      if (
        slot === "size" &&
        sizeField &&
        sizeField === activeChart.yField &&
        (activeChart.kind === "dumbbell" || activeChart.kind === "pyramid" || activeChart.kind === "slope")
      ) {
        setToast("Pick a different column for the second measure");
        return false;
      }
      if (slot === "size" && sizeField) {
        const gate = encodingDropAllowed(activeChart.kind, "size", columnStats.find((c) => c.name === sizeField));
        if (!gate.ok) {
          setToast(gate.reason);
          return false;
        }
      }
      if (slot === "z" && zField) {
        const gate = encodingDropAllowed(activeChart.kind, "z", columnStats.find((c) => c.name === zField));
        if (!gate.ok) {
          setToast(gate.reason);
          return false;
        }
      }
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
          shapeField: emojiField ? null : shapeField,
          emojiField: shapeField ? null : emojiField,
          emojiMap:
            !emojiField || shapeField
              ? null
              : activeChart.emojiMap?.field === emojiField
                ? activeChart.emojiMap
                : semanticEmojiMap(emojiField) ?? null,
          y2Field,
        },
      );
      if (!rec) return false;
      commitRec(rec);
      return true;
    },
    [activeChart, columnStats, tableName, extraFromChart, setToast, commitRec],
  );

  const handleDrop = useCallback(
    (slot: "x" | "y" | "color" | "size" | "z") => (e: DragEvent) => {
      e.preventDefault();
      setDragOverSlot(null);
      const colName = e.dataTransfer.getData(DRAG_TYPE_COLUMN) || e.dataTransfer.getData("text/plain");
      if (!colName || !activeChart || columnStats.length === 0) return;
      const col = columnStats.find((c) => c.name === colName);
      const gate = encodingDropAllowed(activeChart.kind, slot, col);
      if (!gate.ok) {
        setToast(gate.reason);
        return;
      }
      if (slot === "size" || slot === "z") {
        if (!applyEncodingExtra(slot, colName)) return;
        const labels = encodingChannelLabels(activeChart.kind);
        const slotLabel =
          slot === "size" ? labels.size : activeChart.kind === "dataCube" ? "Depth" : "Z";
        setToast(`Mapped ${colName} → ${slotLabel}`, { undo: true });
        return;
      }
      const newX = slot === "x" ? colName : activeChart.xField;
      const newY = slot === "y" ? colName : activeChart.yField;
      const newColor = slot === "color" ? colName : activeChart.colorField;
      const rec = createChartRec(activeChart.kind, columnStats, newX, newY, newColor, tableName, extraFromChart());
      if (rec) {
        const labels = encodingChannelLabels(activeChart.kind);
        const slotLabel = slot === "x" ? labels.x : slot === "y" ? labels.y : labels.color;
        commitRec(rec, `Mapped ${colName} → ${slotLabel}`);
      }
    },
    [activeChart, columnStats, tableName, extraFromChart, setToast, commitRec, applyEncodingExtra],
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
      if (rec) commitRec(rec);
    },
    [activeChart, columnStats, tableName, extraFromChart, commitRec],
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
      if (rec) commitRec(rec);
    },
    [activeChart, columnStats, tableName, extraFromChart, commitRec],
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
      if (rec) commitRec(rec);
    },
    [activeChart, columnStats, tableName, extraFromChart, commitRec],
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
      if (rec) commitRec(rec);
      // Shared cohort — Explorer + Chart ViewCohortBar stay in sync
      useLoomStore.getState().setViewTimeWindow(
        field,
        (range && range !== "all" ? range : "all") as ChartTimeRange,
      );
    },
    [activeChart, columnStats, tableName, extraFromChart, commitRec],
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
        comparePrevious: caps.comparePrevious ? base.comparePrevious : null,
        deltaDisplay: caps.deltaDisplay ? base.deltaDisplay : null,
        // Pass null explicitly so bubble/dumbbell don't auto-fill on kind switch
        sizeField: caps.sizeChannel ? base.sizeField : null,
        zField: caps.zChannel ? base.zField : null,
        glowField: caps.glowOutline ? base.glowField : null,
        outlineField: caps.glowOutline ? base.outlineField : null,
        opacityField: caps.opacityChannel ? base.opacityField : null,
        shapeField: caps.symbolChannel ? base.shapeField : null,
        emojiField: caps.symbolChannel ? base.emojiField : null,
        layoutDirection: caps.layoutDirection ? base.layoutDirection : null,
        yScale: caps.yScale ? base.yScale : null,
        rollingWindow: caps.rollingWindow ? base.rollingWindow : null,
        seriesNormalize: caps.seriesNormalize ? base.seriesNormalize : null,
        residualOverlay: caps.residualOverlay ? base.residualOverlay : null,
        anomalyHighlight: caps.anomalyHighlight ? base.anomalyHighlight : null,
        bumpMode: caps.bumpMode ? base.bumpMode : null,
        pyramidScaleMode: caps.pyramidScaleMode ? base.pyramidScaleMode : null,
        // Slices of averages / maxima don't add up to a whole — part-to-whole kinds sum
        yAggregate:
          PART_TO_WHOLE_KINDS.has(kind) && base.yAggregate && base.yAggregate !== "sum" && base.yAggregate !== "count"
            ? null
            : base.yAggregate,
      };
    },
    [],
  );

  const patchChartExtra = useCallback(
    (patch: Parameters<typeof createChartRec>[6]) => {
      if (!activeChart || columnStats.length === 0) return;
      const rec = createChartRec(
        activeChart.kind,
        columnStats,
        activeChart.xField,
        activeChart.yField,
        activeChart.colorField,
        tableName,
        { ...extraFromChart(), ...patch },
      );
      if (rec) commitRec(rec);
    },
    [activeChart, columnStats, tableName, extraFromChart, commitRec],
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
      if (rec) commitRec(rec);
    },
    [activeChart, columnStats, tableName, extraFromChart, commitRec],
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
      if (rec) commitRec(rec);
    },
    [activeChart, columnStats, tableName, extraFromChart, commitRec],
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
      if (rec) commitRec(rec);
      else setToast(`Can’t build a ${kind} chart from these columns`);
    },
    [activeChart, columnStats, tableName, extraFromChart, extrasForKind, setToast, commitRec],
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
      if (rec) commitRec(rec);
    },
    [activeChart, columnStats, tableName, extraFromChart, commitRec],
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
      if (rec) commitRec(rec);
    },
    [activeChart, columnStats, tableName, extraFromChart, commitRec],
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
      if (rec) commitRec(rec);
    },
    [activeChart, columnStats, tableName, extraFromChart, commitRec],
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
          zField: activeChart.zField ?? null,
        }
      : undefined;
    const rec = tryBuildRandomChartRec(columnStats, tableName, { locks: encodingLocks, keep });
    if (rec) {
      const locked = Object.entries(encodingLocks).filter(([, v]) => v).map(([k]) => k);
      commitRec(
        rec,
        locked.length
          ? `Random · ${rec.kind} (kept ${locked.join(", ")})`
          : `Random · ${rec.kind}`,
      );
    } else {
      setToast("Couldn’t find a random chart for these columns");
    }
  }, [columnStats, tableName, setToast, encodingLocks, activeChart, commitRec]);

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
      zField: activeChart.zField ?? null,
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
          rec.kind === "pyramid" && rec.pyramidScaleMode === "shared"
            ? "same scale"
            : rec.kind === "pyramid" && rec.pyramidScaleMode === "independent"
              ? "separate scales"
              : null,
          rec.deltaDisplay === "diff" ? "Δ" : rec.deltaDisplay === "pct" ? "%" : null,
        ].filter(Boolean);
        setToast(`Shuffled · ${bits.join(" × ")}`, { undo: true });
        return;
      }
    }
    setToast("Couldn’t shuffle fields for this chart type");
  }, [columnStats, tableName, setActiveChart, activeChart, extraFromChart, setToast, encodingLocks]);

  const toggleChannelInvert = useCallback((key: "size" | "color" | "opacity" | "glow" | "outline" | "z") => {
    if (!activeChart) return;
    const cur = { ...(activeChart.channelInvert ?? {}) };
    if (cur[key]) delete cur[key];
    else cur[key] = true;
    pushChartEditUndo();
    setActiveChart({ ...activeChart, channelInvert: Object.keys(cur).length ? cur : null });
  }, [activeChart, pushChartEditUndo, setActiveChart]);

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
  const showZ = caps.zChannel;
  /** Size is a defining channel for these kinds — keep it in primary Channels. */
  const sizeInPrimary =
    activeChart.kind === "pyramid" ||
    activeChart.kind === "slope" ||
    activeChart.kind === "dumbbell" ||
    activeChart.kind === "dataCube" ||
    activeChart.kind === "bubble" ||
    activeChart.kind === "geoBubbles" ||
    activeChart.kind === "geoPoints" ||
    activeChart.kind === "globe" ||
    activeChart.kind === "globeTrail" ||
    activeChart.kind === "chernoff" ||
    activeChart.kind === "glyphStar" ||
    activeChart.kind === "flower" ||
    activeChart.kind === "beeswarm" ||
    activeChart.kind === "bucketField" ||
    activeChart.kind === "trailRibbon" ||
    activeChart.kind === "isoScatter" ||
    activeChart.kind === "firefly" ||
    activeChart.kind === "scatter3d" ||
    activeChart.kind === "loomWeave";
  const kindBlurb = encodingKindBlurb(activeChart.kind);
  const isDataCube = activeChart.kind === "dataCube";
  const zChannelLabel =
    activeChart.kind === "quakeTerrain" ? "Height" : isDataCube ? "Depth" : "Z";
  const cubeAggregate: YAggregateOption = activeChart.sizeField ? (activeChart.yAggregate ?? "sum") : "count";
  const showAggregate = caps.aggregate;
  const isHeat = activeChart.kind === "heatmap" || activeChart.kind === "hexbin";
  const aggregateField = isHeat ? activeChart.colorField : activeChart.yField;
  const effectiveAggregate: YAggregateOption = !aggregateField
    ? "count"
    : (activeChart.yAggregate ?? (activeChart.kind === "line" || isHeat ? "mean" : "sum"));
  const showRow = caps.facetRow;
  const showTopN = caps.topN;
  const showCompareY = caps.compareY;
  const showMarkPoints = caps.markPoints;
  const showSymbolEnc = caps.symbolChannel;
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
  /** Disable columns that encodingDropAllowed would reject for this slot. */
  const gateOptions = (slot: "x" | "y" | "color" | "size" | "z", opts: EncodingOption[]): EncodingOption[] =>
    opts.map((o) => {
      const gate = encodingDropAllowed(
        activeChart.kind,
        slot,
        columnStats.find((c) => c.name === o.value),
      );
      if (gate.ok) return o;
      return { ...o, disabled: true, label: `${o.label} · skip` };
    });
  const xColOptions = gateOptions("x", allColOptions);
  const yColOptions = gateOptions("y", allColOptions);
  const sizeColOptions = gateOptions("size", numericOptions.length ? numericOptions : allColOptions);
  const zColOptions = gateOptions("z", isDataCube ? allColOptions : numericOptions);
  const tooltipSelectedCount = activeChart.tooltipFields?.length ?? 0;
  const extraChannelCount = [
    showMarkPoints && activeChart.sizeField,
    showGlowOutline && activeChart.glowField,
    showGlowOutline && activeChart.outlineField,
    showOpacityEnc && activeChart.opacityField,
    showSymbolEnc && activeChart.shapeField,
    showSymbolEnc && activeChart.emojiField,
  ].filter(Boolean).length;
  const panelHints = encodingPanelHints(activeChart, columnStats);
  const showSeriesTools =
    caps.rollingWindow ||
    caps.seriesNormalize ||
    caps.residualOverlay ||
    caps.anomalyHighlight ||
    caps.bumpMode ||
    caps.pyramidScaleMode;
  const xDistinct = columnStats.find((c) => c.name === activeChart.xField)?.distinct_count ?? 0;
  const topNChoices = TOP_N_OPTIONS.filter((opt) => xDistinct <= 0 || opt.value <= Math.max(xDistinct, 10));

  return (
    <div className="flex flex-col min-h-0">
      {/* Chart authoring sections share one sticky navigation strip. */}
      <div className="sticky top-0 z-10 bg-loom-surface">
      {(chartPanelSection === "encoding" || chartPanelSection === "visual") && <ChartEditToolbar />}
      <div
        role="tablist"
        aria-label="Chart panel sections"
        className="flex items-center gap-0.5 px-2 py-1.5 border-b border-loom-border bg-loom-surface shrink-0"
      >
        <div className="flex items-center gap-0.5 bg-loom-elevated rounded-md p-0.5 w-full">
          {CHART_SECTIONS.map((sec) => (
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
                if (["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) {
                  e.preventDefault();
                  const index = CHART_SECTIONS.findIndex(s => s.id === sec.id);
                  const nextIndex = e.key === "Home" ? 0 : e.key === "End" ? CHART_SECTIONS.length - 1 : (index + (e.key === "ArrowRight" ? 1 : -1) + CHART_SECTIONS.length) % CHART_SECTIONS.length;
                  const next = CHART_SECTIONS[nextIndex].id;
                  setChartPanelSection(next);
                  queueMicrotask(() => document.getElementById(`chart-section-${next}`)?.focus());
                }
              }}
              className={`
                flex-1 min-w-0 min-h-12 flex flex-col items-center justify-center gap-1 px-1 py-2 text-xs font-medium rounded transition-colors
                ${chartPanelSection === sec.id
                  ? "bg-loom-surface text-loom-text shadow-sm border border-loom-border"
                  : "text-loom-muted hover:text-loom-text border border-transparent"}
              `}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={sec.path} /></svg>
              {sec.label}
            </button>
          ))}
        </div>
      </div>
      </div>

      {(chartPanelSection === "analyze" || chartPanelSection === "overlays") && (
        <div role="tabpanel" id={`chart-section-panel-${chartPanelSection}`} aria-labelledby={`chart-section-${chartPanelSection}`}>
          <Suspense fallback={<div className="p-3 text-xs text-loom-muted">Loading…</div>}>
            {chartPanelSection === "analyze" ? <AnalyzeSection /> : <OverlaysSection />}
          </Suspense>
        </div>
      )}
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

            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5">
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
                {kindBlurb ? (
                  <EncodingInfoTip label="About this chart type" text={kindBlurb} />
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleRandomizeEncoding}
                  className="min-h-9 rounded-md border border-loom-border text-xs text-loom-muted hover:text-loom-text hover:bg-loom-elevated transition-colors inline-flex items-center justify-center gap-1.5"
                  title="Shuffle fields — respects locked channels below. Chart type stays."
                  aria-label="Shuffle fields"
                >
                  <span aria-hidden>⟳</span>
                  Shuffle
                </button>
                <button
                  type="button"
                  onClick={handleRandomize}
                  className="min-h-9 rounded-md border border-loom-border text-xs text-loom-muted hover:text-loom-accent hover:bg-loom-elevated transition-colors inline-flex items-center justify-center gap-1.5"
                  title="Random chart — respects locked channels below."
                  aria-label="Randomize chart"
                >
                  <span aria-hidden>✦</span>
                  Random
                </button>
              </div>
            </div>

            <ShuffleKeepRow
              tip="Only affects Shuffle fields (⟳) and Random chart (✦). Kept channels stay put; the rest reshuffle."
              chips={(
                [
                  { id: "kind", label: "Type", show: true as boolean },
                  { id: "x", label: channelLabels.x, show: showX },
                  { id: "y", label: channelLabels.y, show: showY },
                  { id: "color", label: channelLabels.color, show: showColor },
                  { id: "size", label: channelLabels.size, show: showSize },
                  { id: "z", label: zChannelLabel, show: showZ },
                ] as const
              )
                .filter((c) => c.show)
                .map((c) => ({
                  id: c.id,
                  label: c.label,
                  on: !!encodingLocks[c.id as keyof EncodingShuffleLocks],
                  onToggle: () => toggleEncodingLock(c.id as keyof EncodingShuffleLocks),
                }))}
            />

            <EncodingSectionLabel>Channels</EncodingSectionLabel>
            <div className="space-y-2">
              {showX && (
              <EncodingSlot
                label={channelLabels.x}
                value={activeChart.xField}
                options={xColOptions}
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

              {showY && (
                <>
                  <EncodingSlot
                    label={channelLabels.y}
                    value={activeChart.yField ?? ""}
                    options={yColOptions}
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
                  />
                  {showAggregate && !isHeat && (
                    <EncodingSelectSlot label="Agg" htmlFor="loom-y-agg" title="Aggregate">
                      <select
                        id="loom-y-agg"
                        value={effectiveAggregate}
                        onChange={(e) => applyYAggregate(e.target.value as YAggregateOption)}
                        className="loom-input flex-1 w-full text-xs py-1.5 min-h-9 px-2"
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
                    </EncodingSelectSlot>
                  )}
                </>
              )}

              {showColor && !(activeChart.kind === "pyramid" || activeChart.kind === "slope") && (
                <EncodingSlot
                  label={channelLabels.color}
                  value={activeChart.colorField ?? ""}
                  options={gateOptions("color", isHeat ? numericOptions : allColOptions)}
                  allowEmpty
                  emptyLabel={isHeat ? "Row count" : "None"}
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
                  invert={activeChart.colorField ? {
                    on: !!activeChart.channelInvert?.color,
                    hint: activeChart.channelInvert?.color
                      ? "Color is inverted — a high value uses the low end of the ramp"
                      : "Invert color — a high value uses the low end of the ramp",
                    onToggle: () => toggleChannelInvert("color"),
                  } : null}
                  trailing={
                    activeChart.kind === "bar" ? (
                      <div className="flex items-center gap-1.5 flex-wrap pl-0.5 pt-0.5">
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
                                    if (rec) commitRec(rec);
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
                      </div>
                    ) : undefined
                  }
                />
              )}
              {isHeat && (
                <EncodingSelectSlot label="Heat agg" htmlFor="loom-heat-agg" title="How each cell summarizes its heat measure">
                  <select id="loom-heat-agg" value={effectiveAggregate} onChange={(e) => applyYAggregate(e.target.value as YAggregateOption)} className="loom-input flex-1 w-full text-xs py-1.5 min-h-9 px-2">
                    {Y_AGGREGATE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value} disabled={!aggregateField && opt.value !== "count"}>{opt.label}</option>)}
                  </select>
                </EncodingSelectSlot>
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
                  info="Small multiples — one panel per category (max 8). Color overlays series in one plot; Facet splits panels."
                />
              )}
              {showRow && splitCompatible && splitField && (
                <div className="space-y-1 pl-0.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-2xs text-loom-muted shrink-0 flex items-center gap-1">
                      Split
                      <EncodingInfoTip
                        label="About Split"
                        text="Same field as Color or Facet — Color overlays, Facet splits panels, Both colors within each facet."
                      />
                    </span>
                    <div className="flex gap-1 flex-wrap" role="group" aria-label="Color versus facet split">
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
                              ? "Overlay series by color in one plot"
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
                </div>
              )}
              {showTopN && (
                <div className="space-y-1 pl-0.5">
                  <div className="flex items-center gap-2">
                    <label className="text-2xs text-loom-muted shrink-0 flex items-center gap-1" htmlFor="loom-top-n">
                      Top N
                      <EncodingInfoTip
                        label="About Top N"
                        text="Keep the largest categories by value; the rest roll into Other or drop, depending on the chart."
                      />
                    </label>
                    <select
                      id="loom-top-n"
                      value={clampTopN(activeChart.topN, DEFAULT_TOP_N)}
                      onChange={(e) => applyTopN(Number(e.target.value))}
                      className="loom-input flex-1 text-xs py-1.5 min-h-8"
                      title="How many categories to keep (ranked by value)"
                    >
                      {(topNChoices.length > 0 ? topNChoices : TOP_N_OPTIONS).map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                          {xDistinct > 0 && opt.value >= xDistinct ? " (all)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
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
                    <span className="text-2xs text-loom-muted shrink-0 flex items-center gap-1">
                      Direction
                      <EncodingInfoTip
                        label="About Direction"
                        text={encodingDirectionTip(activeChart.kind)}
                      />
                    </span>
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
                            title={encodingDirectionTitle(activeChart.kind, d.value)}
                            aria-pressed={on}
                          >
                            {d.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
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
                  <span className="text-2xs text-loom-muted shrink-0 flex items-center gap-1">
                    Y scale
                    <EncodingInfoTip
                      label="About Y scale"
                      text="Log and symlog stretch tall ranges so small values stay readable. Symlog keeps zero; log needs positive values."
                    />
                  </span>
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
                <EncodingSlot
                  label="Compare Y"
                  value={activeChart.y2Field ?? ""}
                  options={numericOptions.filter((o) => o.value !== activeChart.yField)}
                  allowEmpty
                  emptyLabel="None"
                  typeHint={activeChart.y2Field ? colType(activeChart.y2Field) : undefined}
                  onChange={(v) => applyEncodingExtra("y2", v === "" ? "__none__" : v)}
                />
              )}
              {caps.comparePrevious && (
                <label className="flex items-center gap-1.5 text-2xs text-loom-muted cursor-pointer pl-0.5">
                  <input
                    type="checkbox"
                    checked={!!activeChart.comparePrevious}
                    onChange={(e) => applyComparePrevious(e.target.checked)}
                    className="rounded border-loom-border accent-loom-accent"
                  />
                  Overlay earlier half (compare)
                  <EncodingInfoTip
                    label="About earlier-half compare"
                    text="Splits ordered categories or time along X in half and draws the earlier half as a ghost overlay on the later half — a quick before/after without a second measure."
                  />
                </label>
              )}
              {caps.deltaDisplay && (
                <div className="flex items-center gap-1.5 flex-wrap pl-0.5">
                  <span className="text-2xs text-loom-muted shrink-0">Delta</span>
                  <EncodingInfoTip
                    label="About delta"
                    text="Annotate each row with the change from Start→End or Left→Right: signed difference (Δ) or percent change. Works on dumbbell, slope, and mirror pyramid."
                  />
                  <div className="flex gap-1 flex-wrap" role="group" aria-label="Delta display">
                    {(
                      [
                        ["off", "Off"],
                        ["diff", "Δ"],
                        ["pct", "%"],
                      ] as const
                    ).map(([mode, label]) => {
                      const cur = activeChart.deltaDisplay ?? "off";
                      const on = cur === mode;
                      return (
                        <button
                          key={mode}
                          type="button"
                          aria-pressed={on}
                          onClick={() => patchChartExtra({ deltaDisplay: mode })}
                          className={`min-h-8 px-2.5 text-2xs rounded-md ${
                            on
                              ? "bg-loom-accent/20 text-loom-text border border-loom-accent/50"
                              : "text-loom-muted border border-loom-border hover:border-loom-accent/40"
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
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
                  {!timeFieldActive && (
                    <p className="text-2xs text-loom-muted pl-0.5">
                      Pick a Time column above to enable window chips (Last 24h, 7d, …).
                    </p>
                  )}
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
                        return `Showing ${slice.kept.toLocaleString()} / ${slice.total.toLocaleString()} rows (${modeHint})`;
                      })()}
                    </p>
                  )}
                </>
              )}
              {showZ && (
                <EncodingSlot
                  label={zChannelLabel}
                  value={activeChart.zField ?? ""}
                  options={zColOptions}
                  allowEmpty={!isDataCube}
                  emptyLabel="Auto"
                  typeHint={activeChart.zField ? colType(activeChart.zField) : undefined}
                  isDropActive={dragOverSlot === "z"}
                  onDragEnter={handleDragEnter("z")}
                  onDragOver={handleDragOver("z")}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop("z")}
                  onChange={(v) => applyEncodingExtra("z", v === "" ? "__none__" : v)}
                  invert={activeChart.zField ? {
                    on: !!activeChart.channelInvert?.z,
                    hint: activeChart.channelInvert?.z
                      ? "Depth is inverted — a high value sits at the low end"
                      : "Invert depth — a high value sits at the low end",
                    onToggle: () => toggleChannelInvert("z"),
                  } : null}
                  info={
                    isDataCube
                      ? "Third cube axis — stacks rows × columns into depth slices."
                      : activeChart.kind === "quakeTerrain"
                        ? "Cell height on the isometric floor — mean value per grid cell."
                        : "Third spatial axis for 3D scatter (numeric)."
                  }
                />
              )}
              {showSize && sizeInPrimary && (
                <>
                  <EncodingSlot
                    label={channelLabels.size}
                    value={activeChart.sizeField ?? ""}
                    options={sizeColOptions}
                    allowEmpty
                    emptyLabel={isDataCube ? "Row count" : "None"}
                    typeHint={activeChart.sizeField ? colType(activeChart.sizeField) : undefined}
                    isDropActive={dragOverSlot === "size"}
                    onDragEnter={handleDragEnter("size")}
                    onDragOver={handleDragOver("size")}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop("size")}
                    onChange={(v) => applyEncodingExtra("size", v === "" ? "__none__" : v)}
                    invert={activeChart.sizeField || isDataCube ? {
                      on: !!activeChart.channelInvert?.size,
                      always: isDataCube && !activeChart.sizeField,
                      hint: activeChart.channelInvert?.size
                        ? "Size is inverted — a large number draws a small mark"
                        : "Invert size — a large number draws a small mark",
                      onToggle: () => toggleChannelInvert("size"),
                    } : null}
                    chromeTarget="size"
                    chromeActive={chartChromeFocus?.target === "size"}
                    onChromeEnter={focusChromeFromPanel}
                    onChromeLeave={clearChromeFromPanel}
                  />
                  {isDataCube && (
                    <EncodingSelectSlot label="Agg" htmlFor="loom-cube-agg" title="Aggregate">
                      <select
                        id="loom-cube-agg"
                        value={cubeAggregate}
                        onChange={(e) => applyYAggregate(e.target.value as YAggregateOption)}
                        disabled={!activeChart.sizeField}
                        className="loom-input flex-1 w-full text-xs py-1.5 min-h-9 px-2"
                        title="How each cell's rows are summarized"
                      >
                        {Y_AGGREGATE_OPTIONS.filter((opt) => opt.value !== "count" || !activeChart.sizeField).map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </EncodingSelectSlot>
                  )}
                </>
              )}
            </div>

            {(showSize || showGlowOutline || showOpacityEnc || showSymbolEnc) && (
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
                    {extraChannelCount > 0
                      ? ` · ${[
                          showSize && !sizeInPrimary && activeChart.sizeField ? channelLabels.size : null,
                          showGlowOutline && activeChart.glowField ? "Glow" : null,
                          showGlowOutline && activeChart.outlineField ? "Outline" : null,
                          showOpacityEnc && activeChart.opacityField ? "Opacity" : null,
                          showSymbolEnc && activeChart.shapeField ? "Shape" : null,
                          showSymbolEnc && activeChart.emojiField ? "Emoji" : null,
                        ]
                          .filter(Boolean)
                          .join(", ")}`
                      : ""}
                  </span>
                  <span aria-hidden>{moreChannelsOpen ? "▼" : "▶"}</span>
                </button>
                {moreChannelsOpen && (
                  <div id="loom-more-channels-panel" className="space-y-2">
                    {showSize && !sizeInPrimary && (
                      <EncodingSlot
                        label={channelLabels.size}
                        value={activeChart.sizeField ?? ""}
                        options={sizeColOptions}
                        allowEmpty
                        typeHint={activeChart.sizeField ? colType(activeChart.sizeField) : undefined}
                        isDropActive={dragOverSlot === "size"}
                        onDragEnter={handleDragEnter("size")}
                        onDragOver={handleDragOver("size")}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop("size")}
                        onChange={(v) => applyEncodingExtra("size", v === "" ? "__none__" : v)}
                        invert={activeChart.sizeField ? {
                          on: !!activeChart.channelInvert?.size,
                          hint: activeChart.channelInvert?.size
                            ? "Size is inverted — a large number draws a small mark"
                            : "Invert size — a large number draws a small mark",
                          onToggle: () => toggleChannelInvert("size"),
                        } : null}
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
                          invert={activeChart.glowField ? {
                            on: !!activeChart.channelInvert?.glow,
                            hint: activeChart.channelInvert?.glow
                              ? "Glow is inverted — a high value glows less"
                              : "Invert glow — a high value glows less",
                            onToggle: () => toggleChannelInvert("glow"),
                          } : null}
                          info="Column turns glow on/off or scales intensity per point (scatter)."
                        />
                        <EncodingSlot
                          label="Outline"
                          value={activeChart.outlineField ?? ""}
                          options={allColOptions}
                          allowEmpty
                          onChange={(v) => applyEncodingExtra("outline", v === "" ? "__none__" : v)}
                          invert={activeChart.outlineField ? {
                            on: !!activeChart.channelInvert?.outline,
                            hint: activeChart.channelInvert?.outline
                              ? "Outline is inverted — a high value draws a thinner stroke"
                              : "Invert outline — a high value draws a thinner stroke",
                            onToggle: () => toggleChannelInvert("outline"),
                          } : null}
                          info="Column turns stroke on/off or scales outline width per point."
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
                        invert={activeChart.opacityField ? {
                          on: !!activeChart.channelInvert?.opacity,
                          hint: activeChart.channelInvert?.opacity
                            ? "Opacity is inverted — a high value draws faint"
                            : "Invert opacity — a high value draws faint",
                          onToggle: () => toggleChannelInvert("opacity"),
                        } : null}
                        info="Per-point opacity from a column (separate from Visual → Opacity)."
                      />
                    )}
                    {showSymbolEnc && (
                      <>
                        <EncodingSlot
                          label="Shape by category"
                          value={activeChart.shapeField ?? ""}
                          options={allColOptions}
                          allowEmpty
                          onChange={(v) => applyEncodingExtra("shape", v === "" ? "__none__" : v)}
                          info="Cycles distinct values through the marker palette. Selecting this clears Emoji from column."
                        />
                        <EncodingSlot
                          label="Emoji from column"
                          value={activeChart.emojiField ?? ""}
                          options={allColOptions}
                          allowEmpty
                          onChange={(v) => applyEncodingExtra("emoji", v === "" ? "__none__" : v)}
                          info="Each category keeps its own symbol. Picking a column clears Shape by category."
                        />
                        {activeChart.emojiField && sampleRows && (
                          <EmojiAssignments
                            field={activeChart.emojiField}
                            rows={sampleRows.rows}
                            columns={sampleRows.columns}
                            map={activeChart.emojiMap ?? null}
                            onAssign={(emojiMap) =>
                              patchChartExtra({
                                emojiField: activeChart.emojiField,
                                emojiMap,
                                shapeField: null,
                              })
                            }
                          />
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {showSeriesTools && (
              <div className="space-y-2 border-t border-loom-border/70 pt-2">
                <EncodingSectionLabel>Series tools</EncodingSectionLabel>
                {caps.rollingWindow && (
                  <div className="flex items-center gap-1.5 flex-wrap pl-0.5">
                    <span className="text-2xs text-loom-muted shrink-0">Rolling</span>
                    <div className="flex gap-1 flex-wrap" role="group" aria-label="Rolling mean window">
                      {(
                        [
                          [null, "Off"],
                          [7, "7"],
                          [30, "30"],
                        ] as const
                      ).map(([w, label]) => {
                        const on = (activeChart.rollingWindow ?? null) === w;
                        return (
                          <button
                            key={label}
                            type="button"
                            aria-pressed={on}
                            onClick={() => patchChartExtra({ rollingWindow: w })}
                            className={`min-h-8 px-2.5 text-2xs rounded-md ${
                              on
                                ? "bg-loom-accent/20 text-loom-text border border-loom-accent/50"
                                : "text-loom-muted border border-loom-border hover:border-loom-accent/40"
                            }`}
                            title={w ? `${w}-point rolling mean along X` : "No rolling mean"}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {caps.seriesNormalize && (
                  <div className="flex items-center gap-1.5 flex-wrap pl-0.5">
                    <span className="text-2xs text-loom-muted shrink-0">Normalize</span>
                    <div className="flex gap-1 flex-wrap" role="group" aria-label="Series normalize">
                      {(
                        [
                          [null, "Off"],
                          ["index100", "Index 100"],
                          ["zscore", "Z-score"],
                        ] as const
                      ).map(([mode, label]) => {
                        const on = (activeChart.seriesNormalize ?? null) === mode;
                        return (
                          <button
                            key={label}
                            type="button"
                            aria-pressed={on}
                            onClick={() => patchChartExtra({ seriesNormalize: mode })}
                            className={`min-h-8 px-2.5 text-2xs rounded-md ${
                              on
                                ? "bg-loom-accent/20 text-loom-text border border-loom-accent/50"
                                : "text-loom-muted border border-loom-border hover:border-loom-accent/40"
                            }`}
                            title={
                              mode === "index100"
                                ? "Rebase each series so the first point is 100"
                                : mode === "zscore"
                                  ? "Z-score each series for a common scale"
                                  : "Raw values"
                            }
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {caps.residualOverlay && (
                  <label className="flex items-center gap-1.5 text-2xs text-loom-muted cursor-pointer pl-0.5 min-h-8">
                    <input
                      type="checkbox"
                      checked={!!activeChart.residualOverlay}
                      onChange={(e) => patchChartExtra({ residualOverlay: e.target.checked })}
                      className="rounded border-loom-border accent-loom-accent"
                    />
                    <span className="flex items-center gap-1">
                      Residual stems
                      <EncodingInfoTip
                        label="About residual stems"
                        text="Draws a stem from each point to a linear fit — useful for spotting curvature and outliers."
                      />
                    </span>
                  </label>
                )}
                {caps.anomalyHighlight && (
                  <label className="flex items-center gap-1.5 text-2xs text-loom-muted cursor-pointer pl-0.5 min-h-8">
                    <input
                      type="checkbox"
                      checked={!!activeChart.anomalyHighlight}
                      onChange={(e) => patchChartExtra({ anomalyHighlight: e.target.checked })}
                      className="rounded border-loom-border accent-loom-accent"
                    />
                    <span className="flex items-center gap-1">
                      Highlight anomalies
                      <EncodingInfoTip
                        label="About anomalies"
                        text="Emphasizes points with large |z| relative to the series — high or low outliers."
                      />
                    </span>
                  </label>
                )}
                {caps.bumpMode && (
                  <div className="flex items-center gap-1.5 flex-wrap pl-0.5">
                    <span className="text-2xs text-loom-muted shrink-0">Bump</span>
                    <div className="flex gap-1 flex-wrap" role="group" aria-label="Bump mode">
                      {(
                        [
                          ["rank", "Rank"],
                          ["delta", "Δ rank"],
                        ] as const
                      ).map(([mode, label]) => {
                        const cur = activeChart.bumpMode ?? "rank";
                        const on = cur === mode;
                        return (
                          <button
                            key={mode}
                            type="button"
                            aria-pressed={on}
                            onClick={() => patchChartExtra({ bumpMode: mode })}
                            className={`min-h-8 px-2.5 text-2xs rounded-md ${
                              on
                                ? "bg-loom-accent/20 text-loom-text border border-loom-accent/50"
                                : "text-loom-muted border border-loom-border hover:border-loom-accent/40"
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {caps.pyramidScaleMode && (
                  <div className="flex flex-col gap-1.5 pl-0.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-2xs text-loom-muted shrink-0">Scale</span>
                      <EncodingInfoTip
                        label="About mirror scales"
                        text="Same scale makes Left and Right bar lengths comparable. Separate scales keep each arm readable when magnitudes differ (e.g. cases vs deaths). Auto picks separate when one side is ~5× the other."
                      />
                      <div className="flex gap-1 flex-wrap" role="group" aria-label="Pyramid scale mode">
                        {(
                          [
                            ["auto", "Auto"],
                            ["shared", "Same"],
                            ["independent", "Separate"],
                          ] as const
                        ).map(([mode, label]) => {
                          const cur = activeChart.pyramidScaleMode ?? "auto";
                          const on = cur === mode;
                          return (
                            <button
                              key={mode}
                              type="button"
                              aria-pressed={on}
                              onClick={() => patchChartExtra({ pyramidScaleMode: mode })}
                              className={`min-h-8 px-2.5 text-2xs rounded-md ${
                                on
                                  ? "bg-loom-accent/20 text-loom-text border border-loom-accent/50"
                                  : "text-loom-muted border border-loom-border hover:border-loom-accent/40"
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {activeChart.yField && activeChart.sizeField && (
                      <button
                        type="button"
                        className="self-start min-h-8 px-2.5 text-2xs rounded-md text-loom-muted border border-loom-border hover:border-loom-accent/40 hover:text-loom-text"
                        onClick={() => {
                          const rec = createChartRec(
                            activeChart.kind,
                            columnStats,
                            activeChart.xField,
                            activeChart.sizeField ?? null,
                            activeChart.colorField,
                            tableName,
                            {
                              ...extraFromChart(),
                              sizeField: activeChart.yField ?? null,
                            },
                          );
                          if (rec) commitRec(rec, "Swapped Left ↔ Right");
                        }}
                      >
                        Swap Left ↔ Right
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {panelHints.length > 0 && (
              <div className="space-y-1.5" role="status" aria-live="polite">
                {panelHints.map((h) => (
                  <div
                    key={h.id}
                    role={h.level === "error" ? "alert" : undefined}
                    className={`rounded-md border px-2.5 py-2 text-2xs leading-snug ${
                      h.level === "error"
                        ? "border-loom-error/40 bg-loom-error/10 text-loom-error"
                        : h.level === "warn"
                          ? "border-loom-warning/40 bg-loom-warning/10 text-loom-warning"
                          : "border-loom-border bg-loom-elevated/50 text-loom-muted"
                    }`}
                  >
                    {h.message}
                  </div>
                ))}
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
                  <div className="flex items-center gap-1.5">
                    <div className="flex-1 min-w-0">
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
                    </div>
                    <EncodingInfoTip
                      label="About tooltip style"
                      text={
                        (chartVisualOverrides.tooltipMode ?? "auto") === "auto"
                          ? "Auto: float on desktop, frosted sheet on phone — so a finger doesn’t cover the readout."
                          : (CHART_TOOLTIP_MODES.find((m) => m.value === chartVisualOverrides.tooltipMode)?.title ??
                            "Choose how hover readouts appear.")
                      }
                    />
                  </div>
                  {!caps.tooltipHover && (
                    <p className="text-2xs text-loom-muted leading-snug flex items-center gap-1">
                      No hover on this type
                      <EncodingInfoTip
                        label="About tooltips for this type"
                        text="Hover tooltips aren’t available for this chart type yet — field picks still save for share and when you switch kinds."
                      />
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
                          className={`min-h-8 max-w-full px-2 py-1 rounded-md text-2xs border text-left leading-snug break-words transition-colors ${
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
                    info="Link key is used when you press L on the chart to filter by a value."
                  />
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 pt-1 min-w-0">
              <p className="text-2xs text-loom-muted tabular-nums truncate min-w-0 flex-1" title={`${rowCount.toLocaleString()} rows · ${aggSummary}`}>
                {rowCount.toLocaleString()}
                {totalRows > rowCount ? ` / ${totalRows.toLocaleString()}` : ""} rows · {aggSummary}
              </p>
              <div className="shrink-0">
                <SaveChartViewButton />
              </div>
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
            <div className="flex items-center justify-between gap-2">
              <span className="text-2xs text-loom-muted">Your chart, your style</span>
              <div className="flex gap-1">
                <button type="button" onClick={() => setVisualSections(Object.fromEntries(["design", "personal", "color", "look", "type", "marks", "axes", "layout", "atmosphere", "notes"].map((key) => [key, true])))} className="loom-btn-ghost min-h-9 px-1.5 text-2xs">Expand all</button>
                <button type="button" onClick={() => setVisualSections({})} className="loom-btn-ghost min-h-9 px-1.5 text-2xs">Collapse all</button>
              </div>
            </div>
            <ChartInspectorSection title="My looks" open={!!visualSections.personal} onToggle={() => toggleVisualSection("personal")}>
              <ChartLookLibrary />
            </ChartInspectorSection>
            {(!caps.cartesian || !caps.markPoints) && (
              <p className="text-2xs text-loom-muted leading-snug rounded-md border border-loom-border/60 bg-loom-elevated/40 px-2.5 py-2">
                Controls that don’t affect {activeChart.kind} are hidden
                {!caps.cartesian ? " (no axes / grid)" : ""}
                {!caps.markPoints && caps.cartesian ? " · mark shape / jitter apply to scatter" : ""}
                .
              </p>
            )}
            {/* Presets — full replace */}
            <ChartInspectorSection title="Design system" open={!!visualSections.design} onToggle={() => toggleVisualSection("design")}>
              <div className="flex items-center gap-1 mb-0.5">
                <p className="text-2xs text-loom-muted leading-snug flex-1 min-w-0">
                  Presets replace the whole look. Shuffle randomizes sections you haven’t kept.
                </p>
                <EncodingInfoTip
                  label="About design system"
                  text="Tufte / Bauhaus / Newspaper / Military (and friends) replace ink, axes, and atmosphere. Keep chips below only affect Shuffle look — same idea as Encoding Keep for ✦/⟳."
                />
              </div>
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
                    const kept = VISUAL_SHUFFLE_SECTIONS.filter((s) => visualLocks[s.id]).map((s) => s.label);
                    setToast(
                      kept.length
                        ? `Shuffled look · kept ${kept.join(", ")}`
                        : "Shuffled look · color + design",
                      { undo: true },
                    );
                  }}
                  className="px-2.5 py-1.5 min-h-9 text-2xs rounded border border-loom-accent/50 text-loom-accent hover:bg-loom-accent/10"
                  title="Randomize Visual sections that aren’t marked Keep"
                >
                  Shuffle look
                </button>
              </div>
              <ShuffleKeepRow
                tip="Only affects Shuffle look. Kept sections stay; the rest reshuffle. Same pattern as Encoding Keep for field shuffle / random chart."
                chips={VISUAL_SHUFFLE_SECTIONS.map((s) => ({
                  id: s.id,
                  label: s.label,
                  on: !!visualLocks[s.id],
                  onToggle: () => toggleVisualLock(s.id),
                }))}
              />
            </ChartInspectorSection>

            {/* Color palettes */}
            <ChartInspectorSection title="Color" open={!!visualSections.color} onToggle={() => toggleVisualSection("color")}>
              <div className="flex items-center gap-1 mb-0.5">
                <p className="text-2xs text-loom-muted leading-snug flex-1 min-w-0">
                  Palette for the Color channel (and heat / density ramps).
                </p>
                <EncodingInfoTip
                  label="About color scales"
                  text="Auto picks categorical, sequential, or semantic from the chart. This is visual ink — Encoding → Color chooses which field; the lock row above Shuffle keeps it during Shuffle and Random."
                />
              </div>
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
                        editChartVisualOverrides({ colorScaleKind: id, colorPalette: "auto" });
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
                const colorColumn = caps.colorChannel ? columnStats.find((c) => c.name === activeChart?.colorField) : undefined;
                const applied = resolveChartColors({
                  paletteId: chartVisualOverrides.colorPalette ?? "auto",
                  theme: effectiveTheme,
                  colorblind: !!appSettings.colorblindCharts,
                  chartKind: activeChart?.kind ?? null,
                  reverse: !!chartVisualOverrides.colorPaletteReverse !== !!activeChart?.channelInvert?.color,
                  colorFieldType: colorColumn ? (isNumericType(colorColumn.data_type) ? "quantitative" : "nominal") : null,
                  scaleKind: chartVisualOverrides.colorScaleKind ?? "auto",
                });
                const kindFilter = chartVisualOverrides.colorScaleKind ?? "auto";
                const grouped = palettesGrouped();
                const query = paletteQuery.trim().toLowerCase();
                const filterList = (list: typeof grouped.system) => list.filter((p) =>
                  (kindFilter === "auto" || p.kind === (kindFilter as PaletteKind)) &&
                  (!query || `${p.name} ${p.id} ${p.kind} ${p.source}`.toLowerCase().includes(query)));
                const sections: { title: string; items: typeof grouped.system }[] = [
                  { title: "System", items: filterList(grouped.system) },
                  { title: "Theme", items: filterList(grouped.theme) },
                  { title: "Research", items: filterList(grouped.research) },
                ].filter((s) => s.items.length > 0);
                const selectedId = chartVisualOverrides.colorPalette ?? "auto";
                return (
                  <div className="space-y-2.5">
                    <input type="search" aria-label="Search color palettes" placeholder="Search palettes…" value={paletteQuery} onChange={(e) => setPaletteQuery(e.target.value)} className="loom-input w-full text-xs min-h-9 px-2" />
                    {!sections.length && <p role="status" className="text-2xs text-loom-muted">No palettes match this search and scale. Clear the search or choose Auto to browse all scales.</p>}
                    <div className="rounded border border-loom-border/60 bg-loom-elevated/40 px-2 py-1.5">
                      <p className="text-2xs text-loom-muted mb-1">
                        Applied · {applied.paletteId}{selectedId === "auto" ? " · automatic" : ""}
                        {applied.continuous ? " · continuous" : ""}
                      </p>
                      <div className="flex h-3 rounded overflow-hidden">
                        {applied.colors.map((c, i) => (
                          <span key={`${c}-${i}`} className="flex-1" style={{ background: c }} title={c} />
                        ))}
                      </div>
                    </div>
                    {appSettings.colorblindCharts && <p className="text-2xs text-loom-label">Colorblind defaults are on. Auto uses Okabe–Ito for categories and Cividis for magnitudes; explicit palettes stay selected.</p>}
                    <button
                      type="button"
                      aria-pressed={selectedId === "auto"}
                      onClick={() => {
                        editChartVisualOverrides({ colorPalette: "auto", colorScaleKind: "auto" });
                      }}
                      className={`w-full text-left rounded border px-2 py-1.5 ${
                        selectedId === "auto"
                          ? "border-loom-accent bg-loom-accent/10"
                          : "border-loom-border hover:border-loom-accent/40"
                      }`}
                    >
                      <span className="text-2xs text-loom-text font-medium">Auto</span>
                      <span className="block text-2xs text-loom-muted">Follow chart, theme, and accessibility settings</span>
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
                                  editChartVisualOverrides({ colorPalette: p.id, colorScaleKind: p.kind });
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
                                  {resolveChartColors({ paletteId: p.id, theme: effectiveTheme, colorblind: !!appSettings.colorblindCharts, chartKind: activeChart?.kind, reverse: !!chartVisualOverrides.colorPaletteReverse !== !!activeChart?.channelInvert?.color }).colors.map((c, i) => (
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
            </ChartInspectorSection>

            {/* Look spectrum — only controls that affect this chart kind */}
            <ChartInspectorSection title="Composition" open={!!visualSections.look} onToggle={() => toggleVisualSection("look")}>
              {activeChart && ["bar", "pie"].includes(activeChart.kind) && <label className="block text-2xs text-loom-muted">Mark material
                <select aria-label="Mark material" className="loom-input w-full mt-1" value={chartVisualOverrides.markMaterial ?? "auto"} onChange={(event) => updateOverride("markMaterial", event.target.value === "auto" ? undefined : event.target.value as ChartVisualOverrides["markMaterial"])}>
                  <option value="auto">Follow theme · {inheritedStyle.markMaterial}</option>
                  <option value="flat">Flat</option><option value="glaze">Glaze</option><option value="satin">Satin</option><option value="ink">Printed edge</option><option value="etched">Etched edge</option>
                </select>
              </label>}


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
                <p className="text-2xs text-loom-muted flex items-center gap-1">
                  Source / time info
                  <EncodingInfoTip
                    label="About source info"
                    text="Drawn on the chart (and in Share / PNG). Includes source credit, an automatic date range when a time column exists, and the color ramp."
                  />
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
                  aria-label="Source footnote detail"
                >
                  <option value="off">Off</option>
                  <option value="name">Name only</option>
                  <option value="credit">Name + credit</option>
                  <option value="full">Full lineage</option>
                </select>
                {(chartVisualOverrides.sourceFootnote ?? "credit") !== "off" && (
                  <>
                    <label className="block text-2xs text-loom-muted">
                      Place
                      <select
                        className="loom-input text-2xs w-full py-1.5 mt-1"
                        value={chartVisualOverrides.chromeInfoBand ?? "footer"}
                        onChange={(e) =>
                          updateOverride(
                            "chromeInfoBand",
                            e.target.value === "header" ? "header" : "footer",
                          )
                        }
                        aria-label="Source info placement"
                      >
                        <option value="footer">Footer (under chart)</option>
                        <option value="header">Header (under title)</option>
                      </select>
                    </label>
                    <IconToggleGroup
                      label="Align"
                      value={chartVisualOverrides.sourceFootnoteAlign ?? "left"}
                      onChange={(v) => updateOverride("sourceFootnoteAlign", v)}
                      options={[
                        { value: "left", label: "Left", icon: Ico.alignLeft },
                        { value: "center", label: "Center", icon: Ico.alignCenter },
                        { value: "right", label: "Right", icon: Ico.alignRight },
                      ]}
                    />
                  </>
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
            </ChartInspectorSection>
            {/* Typography */}
            <ChartInspectorSection title="Typography" open={!!visualSections.type} onToggle={() => toggleVisualSection("type")}>

              <div>
                <label className="block text-2xs text-loom-muted mb-1">Font family</label>
                <select aria-label="Font family"
                  value={chartVisualOverrides.fontFamily ?? "inherit"}
                  onChange={(e) => updateOverride("fontFamily", e.target.value === "inherit" ? undefined : e.target.value)}
                  className="loom-input w-full text-xs py-1.5"
                >
                  <option value="inherit">App typeface</option>
                  {customFont && <option value={chartVisualOverrides.fontFamily}>{chartVisualOverrides.fontFamily}</option>}
                  {FONT_GROUPS.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.fonts.map((id) => <option key={id} value={FONT_CHOICES[id].family}>{FONT_CHOICES[id].family}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="chart-text-size" className="block text-2xs text-loom-muted mb-1">Chart text size</label>
                <select id="chart-text-size" aria-label="Chart text size"
                  value={resolveChartAxisFontSize(chartVisualOverrides.axisFontSize)}
                  onChange={(e) => updateOverride("axisFontSize", Number(e.target.value))}
                  className="loom-input w-full text-xs py-1.5"
                >
                  <option value={11}>11 px · Compact</option>
                  <option value={12}>12 px · Balanced</option>
                  <option value={13}>13 px · Comfortable</option>
                  <option value={14}>14 px · Large</option>
                  <option value={15}>15 px · Larger</option>
                  <option value={16}>16 px · Presentation</option>
                </select>
                <p className="text-2xs text-loom-muted mt-1">Scales titles, axes, legends, values, and source notes. Crowded labels are spaced or skipped.</p>
              </div>
              <div className="loom-type-preview" role="group" aria-label="Chart typography sample" style={{ fontFamily: chartFontStack(previewFont), fontSize: previewType.tick }}>
                <span className="line-clamp-2" title={previewTitle} style={{ fontSize: previewType.title, fontWeight: chartVisualOverrides.titleFontWeight ?? inheritedStyle.titleFontWeight ?? 600, fontStyle: chartVisualOverrides.titleItalic ? "italic" : "normal", lineHeight: 1.3 }}>{previewTitle}</span>
                <span>{activeChart?.xField ?? "Category Aa"}{activeChart?.yField ? ` · ${activeChart.yField}` : ""}</span>
                <span className="tabular-nums">12,345.67 · −8.2%</span>
              </div>
              <p className="text-2xs text-loom-muted">
                {appSettings.faces === "web" ? "Selected typeface" : "Device typeface"}: {chartFontLabel(previewFont)}. {" "}
                <button type="button" onClick={() => setPanelTab("settings")} className="text-loom-accent underline underline-offset-2">Font settings</button>
              </p>
              <IconToggleGroup
                label="Title weight"
                value={chartVisualOverrides.titleFontWeight ?? inheritedStyle.titleFontWeight ?? 600}
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
              {caps.tickLabelRotation ? (
                <div className="space-y-1">
                  <IconToggleGroup
                    label="X tick label angle"
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
                  <p className="text-2xs text-loom-muted leading-snug">
                    Angles numeric labels along the bottom X axis. Category names and bar end-labels are separate.
                  </p>
                </div>
              ) : caps.cartesian ? (
                <p className="text-2xs text-loom-muted leading-snug rounded-md border border-loom-border/50 bg-loom-elevated/30 px-2 py-1.5">
                  {activeChart.kind === "bar" || activeChart.kind === "pareto" || activeChart.kind === "lollipop" || activeChart.kind === "waterfall"
                    ? "This chart uses category names + value labels on marks — no rotatable X tick numbers."
                    : "X tick label angle doesn’t apply to this chart type."}
                </p>
              ) : null}
                </ChartInspectorSection>

            {isGeoFamilyKind(activeChart.kind) && (
              <ChartInspectorSection
                title="Basemap"
                open={visualSections.map !== false}
                onToggle={() => toggleVisualSection("map")}
              >
                <div>
                  <span className="block text-2xs text-loom-muted mb-1">Geography</span>
                  <div className="grid grid-cols-2 gap-1" role="radiogroup" aria-label="Basemap">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={(chartVisualOverrides.geoAtlas ?? "auto") === "auto"}
                      title="Pick from the region column or chart kind"
                      onClick={() => updateOverride("geoAtlas", "auto")}
                      className={`min-h-8 rounded border px-2 text-2xs text-left ${
                        (chartVisualOverrides.geoAtlas ?? "auto") === "auto"
                          ? "border-loom-accent bg-loom-accent/15 text-loom-text"
                          : "border-loom-border text-loom-muted hover:text-loom-text"
                      }`}
                    >
                      Auto
                    </button>
                    {ATLAS_OPTIONS.map((option) => {
                      const selected = chartVisualOverrides.geoAtlas === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          title={option.description}
                          onClick={() => updateOverride("geoAtlas", option.value)}
                          className={`min-h-8 rounded border px-2 text-2xs text-left ${
                            selected
                              ? "border-loom-accent bg-loom-accent/15 text-loom-text"
                              : "border-loom-border text-loom-muted hover:text-loom-text"
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-2xs text-loom-muted mt-1.5 leading-snug">
                    Globes and lat/lon maps default to the full world. Switch to US states or counties when the story is domestic.
                  </p>
                </div>
              </ChartInspectorSection>
            )}

            {/* Marks — only for kinds that draw marks this way */}
            {(caps.pointMarker || caps.barMarks || caps.lineMarks) && (
            <ChartInspectorSection title="Marks" open={!!visualSections.marks} onToggle={() => toggleVisualSection("marks")}>

              {caps.pointMarker && (
                <>
                  <div>
                    <label className="block text-2xs text-loom-muted mb-1">Point size</label>
                    <input aria-label="Point size"
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
                    <span className="block text-2xs text-loom-muted mb-1">Marker</span>
                    <div className="grid grid-cols-7 gap-1" role="radiogroup" aria-label="Mark shape">
                      {MARK_SHAPE_OPTIONS.map((shape) => {
                        const selected =
                          (chartVisualOverrides.markerMode ?? "shape") === "shape" &&
                          (chartVisualOverrides.markShape ?? inheritedStyle.markShape ?? "circle") === shape.value;
                        return (
                          <button
                            key={shape.value}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            title={shape.label}
                            onClick={() => editChartVisualOverrides({ markerMode: "shape", markShape: shape.value })}
                            className={`h-8 rounded border text-base leading-none ${
                              selected
                                ? "border-loom-accent bg-loom-accent/15 text-loom-text"
                                : "border-loom-border text-loom-muted hover:text-loom-text"
                            }`}
                          >
                            {MARK_SHAPE_ICON[shape.value]}
                          </button>
                        );
                      })}
                    </div>
                    <div className="grid grid-cols-8 gap-1 mt-2" role="radiogroup" aria-label="Emoji marker">
                      {CURATED_MARK_EMOJIS.map((emoji) => {
                        const selected =
                          chartVisualOverrides.markerMode === "emoji" &&
                          chartVisualOverrides.markEmoji === emoji;
                        return (
                          <button
                            key={emoji}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            aria-label={`Emoji marker ${emoji}`}
                            onClick={() => editChartVisualOverrides({ markerMode: "emoji", markEmoji: emoji })}
                            className={`h-8 rounded border text-base leading-none ${
                              selected
                                ? "border-loom-accent bg-loom-accent/15"
                                : "border-loom-border hover:bg-loom-elevated"
                            }`}
                          >
                            {emoji}
                          </button>
                        );
                      })}
                    </div>
                    {showSymbolEnc && (
                      <p className="text-2xs text-loom-muted mt-1.5 leading-snug">
                        One marker for every point. For a symbol per category, use Encoding → Emoji or Shape from column.
                      </p>
                    )}
                  </div>
                </>
              )}
              {caps.markPoints && (
                <>
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
                        <input aria-label="Stroke width"
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
                    <input aria-label="Jitter (px)"
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
                    <input aria-label="Size scale"
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
                  <input aria-label="Bar corner radius (px)"
                    type="range"
                    min={0}
                    max={12}
                    value={chartVisualOverrides.barCornerRadius ?? inheritedStyle.barCornerRadius ?? 3}
                    onChange={(e) => updateOverride("barCornerRadius", Number(e.target.value))}
                    className="w-full h-1.5 rounded-full appearance-none bg-loom-elevated accent-loom-accent"
                  />
                  <span className="text-2xs font-mono text-loom-muted ml-2">{chartVisualOverrides.barCornerRadius ?? inheritedStyle.barCornerRadius ?? 3}</span>
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
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-2xs text-loom-label">Line endings
                      <select aria-label="Line endings" className="loom-input w-full mt-1" value={chartVisualOverrides.lineCap ?? "theme"}
                        onChange={(e) => updateOverride("lineCap", e.target.value === "theme" ? undefined : e.target.value as "round" | "butt" | "square")}>
                        <option value="theme">Follow theme</option><option value="round">Rounded</option><option value="butt">Flat</option><option value="square">Square</option>
                      </select>
                    </label>
                    <label className="text-2xs text-loom-label">Line corners
                      <select aria-label="Line corners" className="loom-input w-full mt-1" value={chartVisualOverrides.lineJoin ?? "theme"}
                        onChange={(e) => updateOverride("lineJoin", e.target.value === "theme" ? undefined : e.target.value as "round" | "bevel" | "miter")}>
                        <option value="theme">Follow theme</option><option value="round">Rounded</option><option value="bevel">Beveled</option><option value="miter">Sharp</option>
                      </select>
                    </label>
                  </div>
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
              </ChartInspectorSection>
            )}

            {/* Axes & Grid — cartesian charts only */}
            {caps.cartesian && (
            <ChartInspectorSection title="Axes & grid" open={!!visualSections.axes} onToggle={() => toggleVisualSection("axes")}>

              <ColorSwatchGroup
                label="Axis line color"
                value={chartVisualOverrides.axisLineColor ?? "theme"}
                onChange={(v) => updateOverride("axisLineColor", v === "theme" ? undefined : v)}
                options={AXIS_LINE_COLOR_SWATCHES}
              />
              <div>
                <label className="block text-2xs text-loom-muted mb-1">Axis line width</label>
                <input aria-label="Axis line width"
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
                value={chartVisualOverrides.gridStyle ?? inheritedStyle.gridStyle ?? "solid"}
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
                <input aria-label="Grid opacity"
                  type="range"
                  min={0}
                  max={1}
                  step={0.1}
                  value={chartVisualOverrides.gridOpacity ?? inheritedStyle.gridOpacity ?? 0.5}
                  onChange={(e) => updateOverride("gridOpacity", Number(e.target.value))}
                  className="w-full h-1.5 rounded-full appearance-none bg-loom-elevated accent-loom-accent"
                />
                <span className="text-2xs font-mono text-loom-muted ml-2">{((chartVisualOverrides.gridOpacity ?? inheritedStyle.gridOpacity ?? 0.5) * 100).toFixed(0)}%</span>
              </div>
              <div>
                <label className="block text-2xs text-loom-muted mb-1">Tick count</label>
                <input aria-label="Tick count"
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
                  checked={chartVisualOverrides.showGrid ?? (chartVisualOverrides.chartDetail !== "plain")}
                  onChange={(e) => updateOverride("showGrid", e.target.checked)}
                  className="rounded border-loom-border bg-loom-elevated accent-loom-accent"
                />
                Show grid
              </label>
            </ChartInspectorSection>
            )}

            {/* Layout */}
            <ChartInspectorSection title="Layout" open={!!visualSections.layout} onToggle={() => toggleVisualSection("layout")}>
              <div>
                <label htmlFor="chart-space-use" className="block text-2xs text-loom-muted mb-1">Space use</label>
                <select id="chart-space-use" className="loom-input w-full text-xs py-1.5" value={chartVisualOverrides.spaceUse ?? "auto"} onChange={(e) => updateOverride("spaceUse", e.target.value === "auto" ? undefined : e.target.value as "fill" | "roomy")}>
                  <option value="auto">Auto · use available room</option>
                  <option value="fill">Fill · larger plot</option>
                  <option value="roomy">Roomy · more breathing room</option>
                </select>
                <p className="text-2xs text-loom-muted mt-1">Keeps room for readable labels. Fixed aspect ratios, device previews, and manual sizing still apply.</p>
                {(chartVisualOverrides.canvasWidth != null || chartVisualOverrides.canvasHeight != null || chartVisualOverrides.plotWidth != null) && (
                  <button type="button" className="mt-1 text-xs text-loom-accent underline underline-offset-2" onClick={() => editChartVisualOverrides({ canvasWidth: undefined, canvasHeight: undefined, plotX: undefined, plotY: undefined, plotWidth: undefined, plotHeight: undefined })}>Restore automatic sizing</button>
                )}
              </div>
              <div>
                <label className="block text-2xs text-loom-muted mb-1">Chart padding (px)</label>
                <input aria-label="Chart padding (px)"
                  type="range"
                  min={16}
                  max={96}
                  value={chartSpacePadding(chartVisualOverrides.spaceUse, 800, chartVisualOverrides.chartPadding, chartVisualOverrides.chartFrame)}
                  aria-valuetext={chartVisualOverrides.chartPadding == null ? "Auto, adapts to available space" : `${chartVisualOverrides.chartPadding} pixels`}
                  onChange={(e) => updateOverride("chartPadding", Number(e.target.value))}
                  className="w-full h-1.5 rounded-full appearance-none bg-loom-elevated accent-loom-accent"
                />
                <span className="text-2xs tabular-nums text-loom-muted">{chartVisualOverrides.chartPadding ?? "Auto"}</span>
                {chartVisualOverrides.chartPadding != null && <button type="button" onClick={() => updateOverride("chartPadding", undefined)} className="ml-2 text-xs text-loom-accent underline underline-offset-2">Auto padding</button>}
              </div>
              <div
                id={chromeDomId("legend")}
                className={chartChromeFocus?.target === "legend" || chartChromeFocus?.target === "color" ? "rounded-md ring-2 ring-loom-accent/50 bg-loom-accent/10 p-1" : ""}
                onMouseEnter={() => focusChromeFromPanel("legend")}
                onMouseLeave={clearChromeFromPanel}
              >
                <label className="block text-2xs text-loom-muted mb-1 flex items-center gap-1">
                  Legend / key
                  <EncodingInfoTip
                    label="About legend"
                    text="Use the Arrange icon in the chart tools (beside Refresh), then drag the key (handles resize). Placement is saved in the share link. Or pick a corner here."
                  />
                </label>
                <select aria-label="Legend position"
                  value={chartVisualOverrides.legendPosition ?? "auto"}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "custom") {
                      editChartVisualOverrides({ legendPosition: "custom" });
                    } else {
                      editChartVisualOverrides({
                        legendPosition: v,
                        legendOffsetX: undefined,
                        legendOffsetY: undefined,
                        legendWidth: undefined,
                        legendHeight: undefined,
                      });
                    }
                  }}
                  className="loom-input w-full text-xs py-1.5"
                  disabled={!caps.legend}
                >
                  {(isHeat ? [["auto", "Show color scale"], ["none", "Hide color scale"]] : [
                    ["auto", "Auto (emptiest corner)"],
                    ["custom", "Custom (drag on chart)"],
                    ["top-right", "Top right"],
                    ["top-left", "Top left"],
                    ["bottom-right", "Bottom right"],
                    ["bottom-left", "Bottom left"],
                    ["none", "None"],
                  ]).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                {caps.legend && (chartVisualOverrides.legendPosition ?? "auto") === "custom" && (
                  <button
                    type="button"
                    className="text-2xs text-loom-muted hover:text-loom-text mt-1"
                    onClick={() => {
                      editChartVisualOverrides({
                        legendPosition: "auto",
                        legendOffsetX: undefined,
                        legendOffsetY: undefined,
                        legendWidth: undefined,
                        legendHeight: undefined,
                      });
                    }}
                  >
                    Reset to auto
                  </button>
                )}
                {!caps.legend && (
                  <p className="text-2xs text-loom-muted mt-0.5">Legend isn’t used for this chart type.</p>
                )}
              </div>
              {caps.dataLabels && (
                <label className="flex items-center gap-2 text-2xs text-loom-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={chartVisualOverrides.showDataLabels ?? (chartVisualOverrides.chartDetail === "deep")}
                    onChange={(e) => updateOverride("showDataLabels", e.target.checked)}
                    className="rounded border-loom-border bg-loom-elevated accent-loom-accent"
                  />
                  Data labels
                </label>
              )}
            </ChartInspectorSection>

            {/* Atmosphere */}
            <ChartInspectorSection title="Atmosphere" open={!!visualSections.atmosphere} onToggle={() => toggleVisualSection("atmosphere")}>

              <div>
                <label className="block text-2xs text-loom-muted mb-1">Background</label>
                <select aria-label="Background"
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
              {(activeChart.kind === "scatter" || activeChart.kind === "bubble") && <div>
                <label className="block text-2xs text-loom-muted mb-1">Blend mode</label>
                <select aria-label="Blend mode"
                  value={chartVisualOverrides.blendMode ?? "source-over"}
                  onChange={(e) => updateOverride("blendMode", e.target.value as GlobalCompositeOperation)}
                  className="loom-input w-full text-xs py-1.5"
                >
                  {BLEND_MODE_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>}
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
                      <input aria-label="Glow intensity"
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

              <div>
                <label className="block text-2xs text-loom-muted mb-1">Opacity</label>
                <input aria-label="Opacity"
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
            </ChartInspectorSection>

            {/* Annotations */}
            {activeChart && (
              <ChartInspectorSection title="Annotations" open={!!visualSections.notes} onToggle={() => toggleVisualSection("notes")}>

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
              </ChartInspectorSection>
            )}


          </div>
      </div>
        </div>
      )}
      </div>
    </div>
  );
}
