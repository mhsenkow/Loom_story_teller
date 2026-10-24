"use client";

// =================================================================
// Loom — Chart type gallery (desktop)
// =================================================================
// Opened from ChartKindPicker on wide, fine-pointer screens. Every
// kind as a tile grouped by what it answers (compare, over time,
// spread, …), each with a live mini preview of the current table
// using the encoding a click would apply. Kinds the table can't
// support stay visible, dimmed, with the reason. ←↑→↓ + Enter, Esc.
// =================================================================

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { ChartKind, ChartRecommendation } from "@/lib/recommendations";
import type { QueryResult } from "@/lib/queryTypes";
import { Dialog } from "@/components/ui/Dialog";
import { ChartCard } from "@/components/ChartCard";
import { CHART_KIND_CATALOG, searchChartKinds, type ChartKindEntry } from "@/lib/chartKindSearch";
import { galleryFamilyOf, gridMove, groupChartKindsByFamily, GALLERY_FAMILY_ORDER } from "@/lib/chartKindGallery";
import { DISCOVER_FAMILIES, type DiscoverFamily } from "@/lib/discoverChartCatalog";
import { encodingKindBlurb } from "@/lib/chartSupport";

interface Support {
  ok: boolean;
  reason: string;
}

/** Mounts its preview only once scrolled near view (70 canvases at once would stall the open). */
function LazyPreview({ rec, data }: { rec: ChartRecommendation | null; data: QueryResult | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver((list) => {
      if (list.some((e) => e.isIntersecting)) {
        setSeen(true);
        io.disconnect();
      }
    }, { rootMargin: "240px" });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return (
    <div ref={ref} className="chart-gallery-preview">
      {seen && rec && data ? (
        <ChartCard rec={rec} data={data} isActive={false} onClick={() => {}} previewOnly />
      ) : (
        <div className="h-28 sm:h-36 loom-plot-surface" aria-hidden />
      )}
    </div>
  );
}

export function ChartKindGallery({
  open,
  onClose,
  value,
  onPick,
  support,
  previewFor,
  data,
  initialQuery = "",
}: {
  open: boolean;
  onClose: () => void;
  value: ChartKind;
  /** `previewed` is the chart the tile showed, so the pick matches the preview. */
  onPick: (kind: ChartKind, previewed?: ChartRecommendation | null) => void;
  support: (kind: ChartKind) => Support;
  /** Encoding a click would apply, for the tile preview (null → no preview). */
  previewFor?: (kind: ChartKind) => ChartRecommendation | null;
  data: QueryResult | null;
  initialQuery?: string;
}) {
  const titleId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [fitsOnly, setFitsOnly] = useState(false);
  const [family, setFamily] = useState<DiscoverFamily | "all">("all");
  const [active, setActive] = useState(0);
  const [cols, setCols] = useState(4);
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery(initialQuery);
      setFamily("all");
    }
  }, [open, initialQuery]);

  const supportMap = useMemo(() => {
    const m = new Map<string, Support>();
    if (open) for (const e of CHART_KIND_CATALOG) m.set(e.value, support(e.value));
    return m;
  }, [open, support]);

  const previews = useMemo(() => {
    const m = new Map<string, ChartRecommendation | null>();
    if (!open || !previewFor) return m;
    for (const e of CHART_KIND_CATALOG) {
      if (!supportMap.get(e.value)?.ok) continue;
      try {
        m.set(e.value, previewFor(e.value));
      } catch {
        m.set(e.value, null);
      }
    }
    return m;
  }, [open, previewFor, supportMap]);

  const searching = query.trim().length > 0;
  const families = useMemo(() => {
    let found: ChartKindEntry[] = searchChartKinds(query);
    if (fitsOnly) found = found.filter((e) => supportMap.get(e.value)?.ok);
    if (family !== "all") found = found.filter((e) => galleryFamilyOf(e.value) === family);
    // Browsing: kinds that fit this table lead each family.
    if (!searching) found = [...found].sort((a, b) => Number(!!supportMap.get(b.value)?.ok) - Number(!!supportMap.get(a.value)?.ok));
    return groupChartKindsByFamily(found);
  }, [query, fitsOnly, family, supportMap, searching]);
  const flat = useMemo(() => families.flatMap((f) => f.entries), [families]);
  const familyCounts = useMemo(() => {
    const m = new Map<DiscoverFamily, number>();
    for (const e of CHART_KIND_CATALOG) {
      if (fitsOnly && !supportMap.get(e.value)?.ok) continue;
      const f = galleryFamilyOf(e.value);
      m.set(f, (m.get(f) ?? 0) + 1);
    }
    return m;
  }, [fitsOnly, supportMap]);

  // Start on the current kind when browsing, the best match when searching.
  useEffect(() => {
    if (!open) return;
    const cur = searching ? -1 : flat.findIndex((e) => e.value === value);
    setActive(cur >= 0 ? cur : Math.max(0, flat.findIndex((e) => supportMap.get(e.value)?.ok)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, flat]);

  // Column count follows the CSS grid so ↑/↓ land on the tile visually above / below.
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const grid = gridRef.current?.querySelector<HTMLElement>(".chart-gallery-grid");
      if (!grid) return;
      const n = getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length;
      if (n > 0) setCols(n);
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (gridRef.current) ro?.observe(gridRef.current);
    return () => ro?.disconnect();
  }, [open, families.length]);

  useEffect(() => {
    if (!open) return;
    gridRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const pick = (kind: ChartKind) => {
    if (!supportMap.get(kind)?.ok) return;
    onClose();
    if (kind !== value) onPick(kind, previews.get(kind) ?? null);
  };

  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
      // With text in the search box, ←/→ move its caret; ↑/↓ (and ←/→ when empty) drive the grid.
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && e.target === searchRef.current && query) return;
      e.preventDefault();
      setActive((i) => gridMove(families, i, cols, e.key as "ArrowLeft"));
    } else if (e.key === "Enter") {
      const entry = flat[active];
      if (entry) {
        e.preventDefault();
        pick(entry.value);
      }
    }
  };

  const hovered = flat[active];
  const hoveredSupport = hovered ? supportMap.get(hovered.value) : undefined;
  const hoveredBlurb = hovered
    ? hoveredSupport && !hoveredSupport.ok
      ? hoveredSupport.reason
      : encodingKindBlurb(hovered.value) ?? previews.get(hovered.value)?.subtitle ?? ""
    : "";
  const fitCount = CHART_KIND_CATALOG.filter((e) => supportMap.get(e.value)?.ok).length;
  let flatIdx = -1;

  return (
    <Dialog open={open} onClose={onClose} labelledBy={titleId} initialFocusRef={searchRef} sheetOnMobile={false} panelClassName="chart-gallery-panel">
      <div className="flex h-full min-h-0 flex-col" onKeyDown={onKey}>
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-loom-border px-4 py-3">
          <h2 id={titleId} className="text-sm font-semibold text-loom-text">Chart types</h2>
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search… (map, 3d, cumulative, flow)"
            aria-label="Search chart types"
            className="loom-input loom-panel-select w-64 max-w-full"
            spellCheck={false}
            autoComplete="off"
          />
          <label className="flex cursor-pointer select-none items-center gap-1.5 text-2xs text-loom-muted">
            <input type="checkbox" checked={fitsOnly} onChange={(e) => setFitsOnly(e.target.checked)} className="accent-[var(--loom-accent)]" />
            Fits this table ({fitCount})
          </label>
          <button type="button" onClick={onClose} className="loom-btn-ghost ml-auto h-8 w-8 p-0" aria-label="Close chart types">
            <span aria-hidden>✕</span>
          </button>
          <div className="loom-seg w-full overflow-x-auto" role="group" aria-label="Filter by what the chart shows">
            {(["all", ...GALLERY_FAMILY_ORDER] as const).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={family === f}
                onClick={() => setFamily(f)}
                className="loom-seg-item loom-seg-btn whitespace-nowrap"
              >
                {f === "all" ? "All" : DISCOVER_FAMILIES[f].label}
                <span className="tabular-nums opacity-60">
                  {f === "all" ? (fitsOnly ? fitCount : CHART_KIND_CATALOG.length) : familyCounts.get(f) ?? 0}
                </span>
              </button>
            ))}
          </div>
        </header>

        <div ref={gridRef} className="min-h-0 flex-1 overflow-y-auto px-4 pb-4" role="listbox" aria-label="Chart types">
          {families.length === 0 && (
            <p className="py-10 text-center text-xs text-loom-muted">No chart types match “{query}”.</p>
          )}
          {families.map((fam) => (
            <section key={fam.id} aria-label={fam.label} className="pt-4">
              <div className="mb-2 flex items-baseline gap-2">
                <h3 className="text-xs font-semibold text-loom-text">{fam.label}</h3>
                <span className="text-2xs text-loom-muted">{fam.prompt}</span>
              </div>
              <div className="chart-gallery-grid">
                {fam.entries.map((entry) => {
                  flatIdx++;
                  const idx = flatIdx;
                  const sup = supportMap.get(entry.value) ?? { ok: true, reason: "" };
                  const isCurrent = entry.value === value;
                  return (
                    <div
                      key={entry.value}
                      role="option"
                      data-idx={idx}
                      aria-selected={isCurrent}
                      aria-disabled={!sup.ok}
                      tabIndex={-1}
                      title={sup.ok ? entry.label : `${entry.label} — ${sup.reason}`}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => pick(entry.value)}
                      className="chart-gallery-tile"
                      data-active={idx === active || undefined}
                      data-current={isCurrent || undefined}
                      data-unsupported={!sup.ok || undefined}
                    >
                      {sup.ok ? (
                        <LazyPreview rec={previews.get(entry.value) ?? null} data={data} />
                      ) : (
                        <div className="chart-gallery-preview flex h-28 items-center justify-center px-3 text-center text-2xs text-loom-muted sm:h-36">
                          {sup.reason}
                        </div>
                      )}
                      <div className="flex items-center gap-1.5 px-2 py-1.5">
                        <span className="min-w-0 flex-1 truncate text-xs text-loom-text">{entry.label}</span>
                        {isCurrent ? (
                          <span className="shrink-0 text-2xs font-medium text-loom-accent">Current</span>
                        ) : entry.group !== "Classic" ? (
                          <span className="shrink-0 text-2xs text-loom-muted">{entry.group}</span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <footer className="flex min-h-10 items-center gap-2 border-t border-loom-border px-4 py-2 text-2xs text-loom-muted">
          {hovered && <span className="shrink-0 font-medium text-loom-text">{hovered.label}</span>}
          <span className="min-w-0 flex-1 truncate">{hoveredBlurb}</span>
          <span className="hidden shrink-0 sm:inline">←↑→↓ move · Enter choose · Esc close</span>
        </footer>
      </div>
    </Dialog>
  );
}
