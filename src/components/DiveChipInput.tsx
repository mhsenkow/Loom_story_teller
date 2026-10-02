"use client";

// =================================================================
// Loom — Dive chip input (multi-value filter field)
// =================================================================
// Values become chips; suggestions come from the data as you type
// (most common first). Enter / Tab adds the highlighted suggestion or
// the typed text, Backspace on empty removes the last chip, pasting a
// comma- or newline-separated list adds one chip per item, ⧉ copies.
// =================================================================

import { useEffect, useId, useMemo, useRef, useState } from "react";

export function DiveChipInput({
  values,
  onChange,
  suggest,
  placeholder = "value",
  ariaLabel,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  /** Suggestions for the typed text (already excluding nothing — chips are filtered here). */
  suggest?: (typed: string) => string[];
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const { options, literal } = useMemo(() => {
    if (!open || !suggest) return { options: [] as string[], literal: null as string | null };
    const taken = new Set(values);
    const typed = text.trim();
    const out = suggest(typed).filter((v) => !taken.has(v)).slice(0, 20);
    // Let the literal text be picked even when it isn't a known value.
    const lit = typed && !out.includes(typed) && !taken.has(typed) ? typed : null;
    if (lit) out.splice(Math.min(1, out.length), 0, lit);
    return { options: out, literal: lit };
  }, [open, suggest, text, values]);

  useEffect(() => setHi(0), [text, open]);

  const add = (raw: string | string[]) => {
    const items = (Array.isArray(raw) ? raw : [raw]).map((v) => v.trim()).filter(Boolean);
    if (!items.length) return;
    const next = [...values];
    for (const v of items) if (!next.includes(v)) next.push(v);
    onChange(next);
    setText("");
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && options.length) {
      e.preventDefault();
      setOpen(true);
      setHi((h) => Math.min(h + 1, options.length - 1));
    } else if (e.key === "ArrowUp" && options.length) {
      e.preventDefault();
      setHi((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" || (e.key === "Tab" && text.trim())) {
      const pick = open && options.length ? options[hi] : undefined;
      if (pick || text.trim()) {
        e.preventDefault();
        add(pick ?? text);
      }
    } else if (e.key === "Backspace" && text === "" && values.length) {
      onChange(values.slice(0, -1));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const t = e.clipboardData.getData("text");
    if (!/[,\n\t]/.test(t)) return;
    e.preventDefault();
    add(t.split(/[,\n\t]/));
  };

  return (
    <div className="relative flex-1 min-w-0">
      <div
        className="loom-input flex flex-wrap items-center gap-1 px-1 py-0.5 min-h-7 cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        {values.map((v, i) => (
          <span key={`${v}-${i}`} className="flex items-center gap-0.5 max-w-full pl-1.5 pr-0.5 rounded bg-loom-accent/15 border border-loom-accent/40 text-2xs text-loom-text">
            <span className="truncate">{v}</span>
            <button
              type="button"
              className="px-0.5 text-loom-muted hover:text-loom-text"
              onClick={(e) => {
                e.stopPropagation();
                onChange(values.filter((_, j) => j !== i));
              }}
              aria-label={`Remove ${v}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            // Typed-but-not-entered text still counts.
            if (text.trim()) add(text);
          }}
          onKeyDown={onKey}
          onPaste={onPaste}
          placeholder={values.length ? "" : placeholder}
          aria-label={ariaLabel}
          role="combobox"
          aria-expanded={open && options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          className="flex-1 min-w-[4rem] bg-transparent text-xs text-loom-text placeholder:text-loom-muted outline-none py-0.5"
        />
        {values.length > 1 && (
          <button
            type="button"
            className="text-2xs text-loom-muted hover:text-loom-text px-0.5"
            onClick={(e) => {
              e.stopPropagation();
              void navigator.clipboard?.writeText(values.join(", "));
            }}
            title="Copy values"
            aria-label="Copy values"
          >
            ⧉
          </button>
        )}
      </div>
      {open && options.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 left-0 right-0 top-full mt-0.5 max-h-48 overflow-y-auto rounded-md border border-loom-border bg-loom-surface shadow-loom-lg py-0.5"
        >
          {options.map((o, i) => (
            <li
              key={o}
              role="option"
              aria-selected={i === hi}
              onPointerEnter={() => setHi(i)}
              onMouseDown={(e) => {
                // Keep focus in the input so several values can be picked in a row.
                e.preventDefault();
                add(o);
              }}
              className={`px-2 py-1 text-xs truncate cursor-pointer ${i === hi ? "bg-loom-accent/15 text-loom-text" : "text-loom-text"}`}
            >
              <Highlight text={o} match={text.trim()} />
              {o === literal && <span className="text-loom-muted"> — use as typed</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Highlight({ text, match }: { text: string; match: string }) {
  const i = match ? text.toLowerCase().indexOf(match.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <span className="underline decoration-loom-accent underline-offset-2">{text.slice(i, i + match.length)}</span>
      {text.slice(i + match.length)}
    </>
  );
}
