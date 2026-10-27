// Ideas / suggestions rail UI (LOOM-141).
"use client";
import type { ReactNode } from "react";
import { ChartCard } from "@/components/ChartCard";
import type { ChartRecommendation } from "@/lib/recommendations";
import type { QueryResult } from "@/lib/store";

export type SuggestionRailHeaderProps = {
  isMobile: boolean;
  suggestionsExpanded: boolean;
  chartRecsCount: number;
  columnStatsLength: number;
  hasSampleRows: boolean;
  bestSuggestion: ChartRecommendation | null;
  topSuggestionsCount: number;
  topSuggestionsFirstTitle?: string;
  aiSuggesting: boolean;
  onToggleExpanded: () => void;
  onHideRail: () => void;
  onStartDeepScan: () => void;
  onOpenChartEditor: () => void;
  onSuggestChart: () => void;
  onTellStory: () => void;
  onSuggestWithAI: () => void;
};

export function SuggestionRailHeader(props: SuggestionRailHeaderProps): ReactNode {
  const {
    isMobile,
    suggestionsExpanded,
    chartRecsCount,
    columnStatsLength,
    hasSampleRows,
    bestSuggestion,
    topSuggestionsCount,
    topSuggestionsFirstTitle,
    aiSuggesting,
    onToggleExpanded,
    onHideRail,
    onStartDeepScan,
    onOpenChartEditor,
    onSuggestChart,
    onTellStory,
    onSuggestWithAI,
  } = props;

  const ideasCountLabel = chartRecsCount === 1 ? "1 idea" : `${chartRecsCount} ideas`;

  return (
    <div className={`flex flex-col border-b border-loom-border flex-shrink-0 ${isMobile && !suggestionsExpanded ? "gap-0 px-3 py-2" : "gap-2 px-2.5 py-2"}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-loom-text leading-tight">Ideas</p>
          <p className="text-2xs text-loom-muted/80 tabular-nums leading-snug mt-0.5">{ideasCountLabel}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isMobile && !suggestionsExpanded && (
            <>
              <button
                type="button"
                onClick={onStartDeepScan}
                disabled={columnStatsLength === 0 || !hasSampleRows}
                className="text-xs px-3 rounded-md border border-loom-border text-loom-text font-medium min-h-10 disabled:opacity-45"
                title="Swipe through more chart ideas · Keep / Skip"
              >
                ✦ Swipe ideas
              </button>
              <button
                type="button"
                onClick={onOpenChartEditor}
                className="text-xs px-3 rounded-md border border-loom-accent/50 bg-loom-accent/10 text-loom-accent font-medium min-h-10"
              >
                Edit
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onToggleExpanded}
            className={`
              loom-btn-ghost p-1.5 rounded border transition-colors min-h-10 min-w-10 md:min-h-9 md:min-w-9 flex items-center justify-center
              ${suggestionsExpanded
                ? "border-loom-accent bg-loom-accent/10 text-loom-accent"
                : "border-loom-border text-loom-muted hover:border-loom-accent hover:text-loom-accent hover:bg-loom-accent/10"}
            `}
            title={suggestionsExpanded ? "Back to chart" : "Browse all ideas"}
            aria-label={suggestionsExpanded ? "Back to chart" : "Browse all ideas"}
            aria-pressed={suggestionsExpanded}
          >
            {suggestionsExpanded ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M15 18l-6-6 6-6" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
              </svg>
            )}
          </button>
          <button
            type="button"
            onClick={onHideRail}
            className="loom-btn-ghost p-1.5 rounded border border-loom-border text-loom-muted hover:border-loom-accent hover:text-loom-accent hover:bg-loom-accent/10 transition-colors min-h-10 min-w-10 md:min-h-9 md:min-w-9 flex items-center justify-center"
            title="Hide ideas — more room for the chart"
            aria-label="Hide ideas"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        </div>
      </div>

      {(!isMobile || suggestionsExpanded) && (
        <div
          className={`
            gap-1.5
            ${suggestionsExpanded ? "flex flex-wrap items-center" : "grid grid-cols-1"}
          `}
        >
          {(bestSuggestion || topSuggestionsCount > 0) && (
            <button
              type="button"
              onClick={onSuggestChart}
              className={`
                text-2xs py-1.5 px-2 rounded border border-loom-accent/45 bg-loom-accent/10 text-loom-accent
                hover:bg-loom-accent/20 transition-colors font-medium text-center
                ${suggestionsExpanded ? "shrink-0" : "w-full"}
              `}
              title={
                topSuggestionsCount > 1
                  ? `Cycle ${topSuggestionsCount} top picks (score + variety). First: ${topSuggestionsFirstTitle ?? ""}`
                  : `Apply best by score: ${bestSuggestion?.title ?? ""}`
              }
            >
              Suggest chart
              {topSuggestionsCount > 1 ? (
                <span className="opacity-70 font-mono ml-1">{topSuggestionsCount}</span>
              ) : null}
            </button>
          )}
          <button
            type="button"
            onClick={onStartDeepScan}
            disabled={columnStatsLength === 0 || !hasSampleRows}
            className={`
              text-2xs py-1.5 px-2 rounded border border-loom-accent/40 bg-loom-accent/10 text-loom-accent
              hover:bg-loom-accent/20 transition-colors font-medium text-center
              disabled:opacity-45 disabled:cursor-not-allowed
              ${suggestionsExpanded ? "shrink-0" : "w-full"}
            `}
            title="Deep scan · swipe Keep / Skip to train ideas"
          >
            Deep scan
          </button>
          <div
            className={`
              gap-1.5
              ${suggestionsExpanded ? "flex flex-wrap" : "grid grid-cols-2"}
            `}
          >
            <button
              type="button"
              onClick={() => void onTellStory()}
              disabled={!hasSampleRows || chartRecsCount === 0}
              className="text-2xs py-1.5 px-1.5 rounded border border-loom-border text-loom-muted hover:border-loom-accent hover:text-loom-accent transition-colors font-medium text-center disabled:opacity-45 disabled:cursor-not-allowed"
              title="Build a multi-chart dashboard story (trend → breakdown → distribution → relationship)"
            >
              Tell a story
            </button>
            <button
              type="button"
              onClick={() => void onSuggestWithAI()}
              disabled={aiSuggesting || columnStatsLength === 0}
              className="text-2xs py-1.5 px-1.5 rounded border border-loom-border text-loom-muted hover:border-loom-accent hover:text-loom-text hover:bg-loom-accent/10 transition-colors font-medium text-center disabled:opacity-45 disabled:cursor-not-allowed"
              title="Local Ollama chart idea (requires ollama serve)"
            >
              {aiSuggesting ? "Asking…" : "Ask AI"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export type SuggestionsRestoreTabProps = {
  isMobile: boolean;
  chartRecsCount: number;
  onShowRail: () => void;
  onOpenChartEditor: () => void;
};

export function SuggestionsRestoreTab(props: SuggestionsRestoreTabProps): ReactNode {
  const { isMobile, chartRecsCount, onShowRail, onOpenChartEditor } = props;
  return (
    <div className={isMobile ? "loom-ideas-restore order-2 flex w-full shrink-0 items-center border-t border-loom-border bg-loom-surface pr-20" : "contents"}>
      <button
        type="button"
        onClick={onShowRail}
        className={`
        loom-ideas-restore shrink-0 flex items-center justify-center gap-1 border-loom-border bg-loom-surface
        text-loom-muted hover:text-loom-accent hover:bg-loom-accent/10 transition-colors
        ${isMobile ? "flex-1 min-h-10 px-3 text-xs font-medium" : "w-9 border-r flex-col py-3 gap-2"}
      `}
        title="Show ideas"
        aria-label="Show ideas"
      >
        {isMobile ? (
          <>Ideas · {chartRecsCount}</>
        ) : (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M9 18l6-6-6-6" />
            </svg>
            <span className="text-2xs font-medium tracking-wide" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
              Ideas
            </span>
          </>
        )}
      </button>
      {isMobile && (
        <button type="button" onClick={onOpenChartEditor} className="min-h-10 px-4 text-xs font-medium text-loom-accent border-l border-loom-border">
          Edit chart
        </button>
      )}
    </div>
  );
}

export type SuggestionsEmptyRailProps = {
  suggestionsRailOpen: boolean;
  restoreTab: ReactNode;
  header: ReactNode;
};

export function SuggestionsEmptyRail({ suggestionsRailOpen, restoreTab, header }: SuggestionsEmptyRailProps): ReactNode {
  if (suggestionsRailOpen) {
    return (
      <div className="loom-ideas-rail hidden md:flex w-[220px] flex-shrink-0 border-r border-loom-border bg-loom-surface flex-col overflow-hidden">
        {header}
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center">
            <p className="text-sm text-loom-muted">No ideas yet</p>
            <p className="text-xs text-loom-muted mt-1">Needs at least 1 numeric or temporal column</p>
          </div>
        </div>
      </div>
    );
  }
  return <div className="hidden md:flex">{restoreTab}</div>;
}

export type SuggestionRailPanelProps = {
  suggestionsExpanded: boolean;
  mobileRail: boolean;
  chartRecs: ChartRecommendation[];
  sampleRows: QueryResult | null | undefined;
  activeChartId: string | undefined;
  header: ReactNode;
  onSelectRec: (rec: ChartRecommendation) => void;
};

export function SuggestionRailPanel(props: SuggestionRailPanelProps): ReactNode {
  const { suggestionsExpanded, mobileRail, chartRecs, sampleRows, activeChartId, header, onSelectRec } = props;
  return (
    <div
      className={`
          loom-ideas-rail bg-loom-surface overflow-hidden transition-[width,height] duration-200 ease-out
          ${suggestionsExpanded
          ? "order-1 w-full flex-1 flex flex-col min-h-0 border-b border-loom-border"
          : mobileRail
            ? "order-2 shrink-0 border-t border-loom-border flex flex-col max-h-[min(32%,11.5rem)] pb-[env(safe-area-inset-bottom,0px)]"
            : "w-[220px] flex-shrink-0 overflow-y-auto border-r border-loom-border"}
        `}
    >
      {header}
      <div
        className={`
            loom-stagger flex-1 min-h-0
            ${suggestionsExpanded
            ? "overflow-y-auto p-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 content-start"
            : mobileRail
              ? "overflow-x-auto overflow-y-hidden overscroll-x-contain flex flex-row gap-3 px-3 pt-1.5 pb-2.5 scrollbar-none snap-x snap-mandatory touch-pan-x"
              : "overflow-y-auto p-2 grid grid-cols-1 gap-2"}
          `}
      >
        {chartRecs.map((rec) => (
          <ChartCard
            key={rec.id}
            rec={rec}
            data={sampleRows ?? null}
            isActive={activeChartId === rec.id}
            compact={mobileRail}
            micro={!mobileRail && !suggestionsExpanded}
            onClick={() => onSelectRec(rec)}
          />
        ))}
      </div>
    </div>
  );
}
