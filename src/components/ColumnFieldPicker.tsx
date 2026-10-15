"use client";

// =================================================================
// Loom — Searchable column field picker (Encoding slots)
// =================================================================
// Type-ahead filter + type chips (All / # / Abc / Time). ↑/↓ Enter Esc.
// Disabled options stay visible but aren’t selectable.
// =================================================================

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { placeColumnPicker } from "@/lib/columnPickerPlacement";
import {
  columnOptionKind,
  filterColumnFieldOptions,
  type ColumnFieldSearchOption,
  type ColumnTypeFilter,
} from "@/lib/columnFieldSearch";

export type ColumnFieldOption = ColumnFieldSearchOption;

function shortType(t: string): string {
  return t.replace(
    /^(VARCHAR|DOUBLE|INTEGER|BIGINT|BOOLEAN|TIMESTAMP|FLOAT|DECIMAL|REAL)/i,
    (m) => m.slice(0, 3).toUpperCase(),
  );
}

export function ColumnFieldPicker({
  value,
  options,
  onChange,
  allowEmpty,
  emptyLabel = "None",
  labelledBy,
  describedBy,
  ariaLabel,
  typeBadge,
  typeBadgeTitle,
}: {
  value: string;
  options: ColumnFieldOption[];
  onChange: (value: string) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
  labelledBy?: string;
  describedBy?: string;
  ariaLabel?: string;
  /** Short type chip (# / Abc / Time) shown inside the trigger. */
  typeBadge?: string;
  typeBadgeTitle?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<ColumnTypeFilter>("all");
  const [active, setActive] = useState(0);
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const catalog = useMemo(() => {
    const base = allowEmpty
      ? [{ value: "", label: emptyLabel }, ...options]
      : options;
    // Keep current value visible even if filtered out of `options` somehow
    if (value && !base.some((o) => o.value === value)) {
      return [...base, { value, label: value }];
    }
    return base;
  }, [options, allowEmpty, emptyLabel, value]);

  const filtered = useMemo(
    () => filterColumnFieldOptions(catalog, query, typeFilter),
    [catalog, query, typeFilter],
  );

  const selectable = (i: number) => {
    const o = filtered[i];
    return !!o && !o.disabled;
  };

  const current = catalog.find((o) => o.value === value);
  const displayLabel = current
    ? current.value === ""
      ? emptyLabel
      : current.label.replace(/\s·\s*skip$/i, "")
    : value || emptyLabel;

  const openPicker = (seed = "") => {
    setPortalHost(
      rootRef.current?.closest<HTMLElement>('[role="dialog"]') ?? document.body,
    );
    setQuery(seed);
    setOpen(true);
  };

  const close = (refocus = true) => {
    setOpen(false);
    setQuery("");
    setTypeFilter("all");
    if (refocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const cur = filtered.findIndex((o) => o.value === value);
    let i = cur >= 0 ? cur : 0;
    if (!filtered[i] || filtered[i].disabled)
      i = filtered.findIndex((o) => !o.disabled);
    setActive(i);
  }, [open, filtered, value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      const target = e.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !popupRef.current?.contains(target)
      ) {
        setOpen(false);
        setQuery("");
        setTypeFilter("all");
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("focusin", onDown);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("focusin", onDown);
    };
  }, [open]);

  const [pos, setPos] = useState<ReturnType<typeof placeColumnPicker> | null>(
    null,
  );
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = rootRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vv = window.visualViewport;
      setPos(
        placeColumnPicker(r, {
          left: vv?.offsetLeft ?? 0,
          top: vv?.offsetTop ?? 0,
          width: vv?.width ?? window.innerWidth,
          height: vv?.height ?? window.innerHeight,
        }),
      );
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", place);
    vv?.addEventListener("scroll", place);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      vv?.removeEventListener("resize", place);
      vv?.removeEventListener("scroll", place);
    };
  }, [open]);

  const positioned = pos !== null;
  useEffect(() => {
    if (open && positioned) inputRef.current?.focus();
  }, [open, positioned]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const pick = (i: number) => {
    const entry = filtered[i];
    if (!entry || entry.disabled) return;
    close();
    if (entry.value !== value) onChange(entry.value);
  };

  const move = (dir: 1 | -1) => {
    if (!filtered.length) return;
    let i = active;
    for (let n = 0; n < filtered.length; n++) {
      i = (i + dir + filtered.length) % filtered.length;
      if (selectable(i)) break;
    }
    setActive(i);
  };

  const onInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(active);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const indices = filtered.flatMap((o, i) => (o.disabled ? [] : [i]));
      setActive((e.key === "Home" ? indices[0] : indices.at(-1)) ?? -1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openPicker();
    } else if (
      e.key.length === 1 &&
      /\S/.test(e.key) &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey
    ) {
      e.preventDefault();
      openPicker(e.key);
    }
  };

  const typeChips: { id: ColumnTypeFilter; label: string; title: string }[] = [
    { id: "all", label: "All", title: "All column types" },
    { id: "quantitative", label: "#", title: "Numeric only" },
    { id: "nominal", label: "Abc", title: "Text / category only" },
    { id: "temporal", label: "Time", title: "Temporal only" },
  ];

  return (
    <div ref={rootRef} className="relative flex-1 min-w-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-label={ariaLabel}
        onClick={() => (open ? close() : openPicker())}
        onKeyDown={onTriggerKey}
        className="loom-input w-full border-0 rounded-none bg-transparent text-xs py-2 px-2 font-mono text-left flex items-center gap-1 min-h-9 focus:ring-2 focus:ring-inset focus:ring-loom-accent/40"
        title="Type to search columns"
      >
        <span className="flex-1 min-w-0 truncate text-loom-text">
          {displayLabel || "—"}
        </span>
        {typeBadge ? (
          <span
            className="shrink-0 text-2xs font-mono text-loom-muted"
            title={typeBadgeTitle || typeBadge}
          >
            {typeBadge}
          </span>
        ) : null}
        <span className="shrink-0 text-loom-muted" aria-hidden>
          ▾
        </span>
      </button>

      {open &&
        portalHost &&
        createPortal(
          <div
            ref={popupRef}
            data-loom-field-picker
            className="fixed z-[120] loom-menu loom-card overflow-hidden shadow-loom-lg flex flex-col"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                close();
              }
            }}
            style={
              pos
                ? {
                    left: pos.left,
                    top: pos.upwards ? undefined : pos.top,
                    bottom: pos.upwards
                      ? window.innerHeight - pos.top - pos.maxH
                      : undefined,
                    width: pos.width,
                    maxHeight: pos.maxH,
                  }
                : { visibility: "hidden" }
            }
          >
            <div className="p-2 border-b border-loom-border space-y-1.5">
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                aria-expanded
                aria-controls={listId}
                aria-label={
                  ariaLabel ? `Search ${ariaLabel} columns` : "Search columns"
                }
                aria-activedescendant={
                  filtered[active] && !filtered[active].disabled
                    ? `${listId}-option-${active}`
                    : undefined
                }
                aria-autocomplete="list"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKey}
                placeholder="Search columns…"
                className="loom-input w-full text-xs py-1.5 min-h-8"
                spellCheck={false}
                autoComplete="off"
              />
              <div
                className="flex items-center gap-1 flex-wrap"
                role="group"
                aria-label="Column type filter"
              >
                {typeChips.map((c) => {
                  const on = typeFilter === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      title={c.title}
                      aria-pressed={on}
                      onClick={() => {
                        setTypeFilter(c.id);
                        inputRef.current?.focus();
                      }}
                      className={`min-h-7 px-2 text-2xs rounded border ${
                        on
                          ? "border-loom-accent bg-loom-accent/15 text-loom-text"
                          : "border-loom-border text-loom-muted hover:border-loom-accent/40"
                      }`}
                    >
                      {c.label}
                    </button>
                  );
                })}
                <span className="ml-auto text-2xs text-loom-muted tabular-nums">
                  {filtered.length}/{catalog.length}
                </span>
              </div>
            </div>

            <div
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label="Columns"
              className="overflow-y-auto py-1 min-h-0"
              style={{ maxHeight: 280 }}
            >
              {filtered.length === 0 && (
                <p className="px-3 py-4 text-2xs text-loom-muted text-center">
                  No columns match{query.trim() ? ` “${query.trim()}”` : ""}.
                </p>
              )}
              {filtered.map((entry, i) => {
                const isActive = i === active;
                const isCurrent = entry.value === value;
                const disabled = !!entry.disabled;
                const kind =
                  entry.value === "" ? null : columnOptionKind(entry);
                const cleanLabel = entry.label.replace(/\s·\s*skip$/i, "");
                return (
                  <div
                    key={`${entry.value || "empty"}-${i}`}
                    id={`${listId}-option-${i}`}
                    role="option"
                    data-idx={i}
                    aria-selected={isCurrent}
                    aria-disabled={disabled}
                    title={
                      disabled ? "Not suitable for this channel" : entry.type
                    }
                    onMouseMove={() =>
                      !disabled && active !== i && setActive(i)
                    }
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(i)}
                    className={`mx-1 px-2 py-1.5 rounded flex items-center gap-2 text-xs font-mono ${
                      disabled
                        ? "cursor-not-allowed opacity-45"
                        : "cursor-pointer"
                    } ${isActive && !disabled ? "bg-loom-elevated text-loom-text" : "text-loom-text"}`}
                  >
                    <span
                      className={`w-3 shrink-0 text-loom-accent ${isCurrent ? "" : "invisible"}`}
                      aria-hidden
                    >
                      ✓
                    </span>
                    <span className="flex-1 min-w-0 truncate">
                      {cleanLabel}
                    </span>
                    {entry.type ? (
                      <span className="shrink-0 text-2xs text-loom-muted">
                        {shortType(entry.type)}
                      </span>
                    ) : kind ? (
                      <span className="shrink-0 text-2xs text-loom-muted">
                        {kind === "quantitative"
                          ? "#"
                          : kind === "temporal"
                            ? "time"
                            : "abc"}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>,
          portalHost,
        )}
    </div>
  );
}
