"use client";

// =================================================================
// Loom — Searchable chart type picker
// =================================================================
// Replaces the native <select> in Encoding: type to filter 60+ chart
// kinds by name / id / synonym ("3d", "cube", "map"). ↑/↓ + Enter to
// pick, Esc to close. Kinds the table can't support stay visible but
// dimmed with the reason (or hidden via "Fits this table").
// =================================================================

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { ChartKind } from "@/lib/recommendations";
import {
  CHART_KIND_CATALOG,
  CHART_KIND_GROUP_ORDER,
  searchChartKinds,
  type ChartKindEntry,
} from "@/lib/chartKindSearch";

interface Support {
  ok: boolean;
  reason: string;
}

export function ChartKindPicker({
  value,
  onChange,
  support,
}: {
  value: ChartKind;
  onChange: (kind: ChartKind) => void;
  support: (kind: ChartKind) => Support;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [fitsOnly, setFitsOnly] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const current = CHART_KIND_CATALOG.find((e) => e.value === value);

  const supportMap = useMemo(() => {
    const m = new Map<string, Support>();
    for (const e of CHART_KIND_CATALOG) m.set(e.value, support(e.value));
    return m;
  }, [support]);

  const results = useMemo(() => {
    const found = searchChartKinds(query);
    return fitsOnly ? found.filter((e) => supportMap.get(e.value)?.ok) : found;
  }, [query, fitsOnly, supportMap]);

  const searching = query.trim().length > 0;
  /** Display order — grouped when browsing, ranked when searching. */
  const ordered = useMemo<ChartKindEntry[]>(() => {
    if (searching) return results;
    return CHART_KIND_GROUP_ORDER.flatMap((g) => results.filter((e) => e.group === g));
  }, [results, searching]);

  const selectable = (i: number) => !!ordered[i] && !!supportMap.get(ordered[i]!.value)?.ok;

  const openPicker = (seed = "") => {
    setQuery(seed);
    setOpen(true);
  };

  const close = (refocus = true) => {
    setOpen(false);
    setQuery("");
    if (refocus) triggerRef.current?.focus();
  };

  // Focus search on open; start on the current kind (browsing) or best match (searching).
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const cur = searching ? -1 : ordered.findIndex((e) => e.value === value);
    let i = cur >= 0 ? cur : 0;
    while (i < ordered.length && !selectable(i)) i++;
    setActive(i < ordered.length ? i : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ordered]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Fixed-position popover: escapes the card's overflow-hidden and spans the whole
  // control row (picker + shuffle buttons), never narrower than 260px or off-screen.
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxH: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const row = rootRef.current?.parentElement?.parentElement ?? rootRef.current;
      if (!row) return;
      const r = row.getBoundingClientRect();
      const width = Math.min(Math.max(r.width, 260), window.innerWidth - 16);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const top = r.bottom + 4;
      setPos({ left, top, width, maxH: Math.max(160, window.innerHeight - top - 110) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const pick = (i: number) => {
    const entry = ordered[i];
    if (!entry || !selectable(i)) return;
    close();
    if (entry.value !== value) onChange(entry.value);
  };

  const move = (dir: 1 | -1) => {
    if (!ordered.length) return;
    let i = active;
    for (let n = 0; n < ordered.length; n++) {
      i = (i + dir + ordered.length) % ordered.length;
      if (selectable(i)) break;
    }
    setActive(i);
  };

  const onInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter") { e.preventDefault(); pick(active); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "Tab") close(false);
  };

  const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openPicker();
    } else if (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // Type-to-search straight from the closed picker.
      e.preventDefault();
      openPicker(e.key);
    }
  };

  const fitCount = CHART_KIND_CATALOG.filter((e) => supportMap.get(e.value)?.ok).length;

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        id="loom-chart-kind"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Chart type: ${current?.label ?? value}`}
        onClick={() => (open ? close() : openPicker())}
        onKeyDown={onTriggerKey}
        className="loom-input w-full text-xs py-2 min-h-9 flex items-center gap-2 text-left"
        title="Search chart types — type to filter"
      >
        <span className="flex-1 min-w-0 truncate text-loom-text">{current?.label ?? value}</span>
        {current && <span className="shrink-0 text-2xs text-loom-muted">{current.group}</span>}
        <span className="shrink-0 text-loom-muted" aria-hidden>▾</span>
      </button>

      {open && (
        <div
          className="fixed z-[120] loom-card border border-loom-border shadow-lg overflow-hidden bg-loom-surface"
          style={pos ? { left: pos.left, top: pos.top, width: pos.width } : { visibility: "hidden" }}
        >
          <div className="p-2 border-b border-loom-border space-y-1.5">
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={ordered[active] ? `${listId}-${ordered[active]!.value}` : undefined}
              aria-autocomplete="list"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKey}
              placeholder="Search chart types… (e.g. cube, map, 3d)"
              className="loom-input w-full text-xs py-1.5 min-h-8"
              spellCheck={false}
              autoComplete="off"
            />
            <div className="flex items-center justify-between text-2xs text-loom-muted">
              <span>
                {ordered.length === CHART_KIND_CATALOG.length ? `${ordered.length} types` : `${ordered.length} of ${CHART_KIND_CATALOG.length}`}
              </span>
              <label className="flex items-center gap-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={fitsOnly}
                  onChange={(e) => setFitsOnly(e.target.checked)}
                  className="accent-[var(--loom-accent)]"
                />
                Fits this table ({fitCount})
              </label>
            </div>
          </div>

          <div ref={listRef} id={listId} role="listbox" aria-label="Chart types" className="overflow-y-auto py-1" style={{ maxHeight: pos ? Math.min(360, pos.maxH) : 288 }}>
            {ordered.length === 0 && (
              <p className="px-3 py-4 text-2xs text-loom-muted text-center">No chart types match “{query}”.</p>
            )}
            {ordered.map((entry, i) => {
              const sup = supportMap.get(entry.value) ?? { ok: true, reason: "" };
              const header = !searching && (i === 0 || ordered[i - 1]!.group !== entry.group);
              const isActive = i === active;
              const isCurrent = entry.value === value;
              return (
                <div key={entry.value}>
                  {header && (
                    <div className="px-3 pt-2 pb-1 text-2xs uppercase tracking-wide text-loom-muted">{entry.group}</div>
                  )}
                  <div
                    id={`${listId}-${entry.value}`}
                    role="option"
                    data-idx={i}
                    aria-selected={isCurrent}
                    aria-disabled={!sup.ok}
                    title={sup.ok ? undefined : sup.reason}
                    onMouseMove={() => sup.ok && active !== i && setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(i)}
                    className={`mx-1 px-2 py-1.5 rounded flex items-center gap-2 text-xs ${
                      sup.ok ? "cursor-pointer" : "cursor-not-allowed opacity-45"
                    } ${isActive && sup.ok ? "bg-loom-elevated text-loom-text" : "text-loom-text"}`}
                  >
                    <span className={`w-3 shrink-0 text-loom-accent ${isCurrent ? "" : "invisible"}`} aria-hidden>✓</span>
                    <span className="flex-1 min-w-0 truncate">{entry.label}</span>
                    {!sup.ok ? (
                      <span className="shrink-0 max-w-[55%] truncate text-2xs text-loom-muted">{sup.reason}</span>
                    ) : searching ? (
                      <span className="shrink-0 text-2xs text-loom-muted">{entry.group}</span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
