"use client";

// Searchable, keyboard-operated specimens shared by chart, cloud, and app settings.
import { useEffect, useId, useRef, useState } from "react";
import {
  FONT_CHOICES,
  FONT_GROUPS,
  chartFontStack,
  ensureChartFontLoaded,
  fontChoiceForFamily,
} from "@/lib/fontCatalog";

export function FontPicker({
  label,
  value,
  inheritedFamily,
  inheritLabel = "Same as chart",
  onChange,
}: {
  label: string;
  value?: string;
  inheritedFamily?: string;
  inheritLabel?: string;
  onChange: (family: string | undefined) => void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [retry, setRetry] = useState(0);
  const family =
    value && value !== "inherit" ? value : (inheritedFamily ?? "Inter");
  const choice = fontChoiceForFamily(family);
  const allOptions = [
    ...(inheritedFamily
      ? [
          {
            family: "",
            name: inheritLabel,
            group: "Follow",
            description: inheritedFamily,
          },
        ]
      : []),
    ...(value && value !== "inherit" && !fontChoiceForFamily(value)
      ? [
          {
            family: value,
            name: value,
            group: "Custom",
            description: "Installed on this device",
          },
        ]
      : []),
    ...FONT_GROUPS.flatMap((group) =>
      group.fonts.map((font) => ({
        family: FONT_CHOICES[font].family,
        name: FONT_CHOICES[font].family,
        group: group.label,
        description: FONT_CHOICES[font].description,
      })),
    ),
  ];
  const options = allOptions.filter((option) =>
    `${option.name} ${option.group} ${option.description}`
      .toLowerCase()
      .includes(query.toLowerCase().trim()),
  );

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    void ensureChartFontLoaded(family).then((ok) => {
      if (!cancelled) setStatus(ok ? "ready" : "error");
    });
    return () => {
      cancelled = true;
    };
  }, [family, retry]);

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const showBrowser = () => {
    setQuery("");
    setActive(
      Math.max(
        0,
        allOptions.findIndex(
          (option) =>
            option.family === (value === "inherit" ? "" : (value ?? "")),
        ),
      ),
    );
    setOpen(true);
  };
  useEffect(() => {
    if (open)
      document
        .getElementById(`${id}-option-${active}`)
        ?.scrollIntoView?.({ block: "nearest" });
  }, [open, active, id]);

  const choose = (next: string) => {
    onChange(next || undefined);
    setOpen(false);
    trigger.current?.focus();
  };
  const current = options[Math.min(active, options.length - 1)];
  return (
    <div
      ref={root}
      className="loom-font-picker"
      role="group"
      aria-label={`${label} picker`}
      onBlur={(event) => {
        if (
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget as Node)
        )
          setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <label
        id={`${id}-label`}
        htmlFor={`${id}-trigger`}
        className="loom-control-label"
      >
        {label}
      </label>
      <button
        ref={trigger}
        id={`${id}-trigger`}
        type="button"
        role="combobox"
        aria-labelledby={`${id}-label`}
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-haspopup="listbox"
        className="loom-font-trigger"
        onClick={() => {
          if (open) setOpen(false);
          else showBrowser();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            showBrowser();
          }
        }}
      >
        <span className="loom-font-trigger-copy">
          <span>{!value || value === "inherit" ? inheritLabel : family}</span>
          <small>
            {!value || value === "inherit"
              ? family
              : choice
                ? "Included with Loom"
                : "Device font"}
          </small>
        </span>
        <span
          aria-hidden
          className="loom-font-specimen"
          style={{ fontFamily: chartFontStack(family) }}
        >
          Ag
        </span>
        <span aria-hidden>⌄</span>
      </button>
      {open && (
        <div className="loom-font-browser">
          <input
            ref={search}
            type="search"
            className="loom-input"
            placeholder="Search fonts or styles…"
            aria-label={`Search ${label.toLowerCase()}`}
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            aria-activedescendant={
              current
                ? `${id}-option-${Math.min(active, options.length - 1)}`
                : undefined
            }
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              let next = Math.min(active, options.length - 1);
              if (event.key === "ArrowDown") next = (next + 1) % options.length;
              else if (event.key === "ArrowUp")
                next = (next - 1 + options.length) % options.length;
              else if (event.key === "Enter" && current) {
                event.preventDefault();
                choose(current.family);
                return;
              } else return;
              event.preventDefault();
              if (!options.length) return;
              setActive(next);
              document
                .getElementById(`${id}-option-${next}`)
                ?.scrollIntoView?.({ block: "nearest" });
            }}
          />
          <div
            id={`${id}-list`}
            role="listbox"
            aria-label={label}
            className="loom-font-list"
          >
            {options.map((option, index) => (
              <button
                type="button"
                role="option"
                key={option.family}
                id={`${id}-option-${index}`}
                tabIndex={-1}
                aria-selected={
                  option.family === (value === "inherit" ? "" : (value ?? ""))
                }
                data-focused={index === active}
                className="loom-font-option"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option.family)}
              >
                <span
                  className="loom-font-option-name"
                  style={{
                    fontFamily: chartFontStack(option.family || family),
                  }}
                >
                  {option.name}
                  <span aria-hidden>
                    {option.family === (value ?? "") ? " ✓" : ""}
                  </span>
                </span>
                <small>
                  {option.group}
                  {option.family ? " · Aa 012345" : ` · ${inheritedFamily}`}
                </small>
              </button>
            ))}
            {!options.length && (
              <p className="p-3 text-xs text-loom-muted">
                No matching fonts. Try “serif” or “readable”.
              </p>
            )}
          </div>
        </div>
      )}
      <p className="loom-control-hint" role="status">
        {status === "loading" ? (
          `Loading ${family}…`
        ) : status === "error" ? (
          <>
            Using a fallback.{" "}
            <button
              type="button"
              className="underline text-loom-accent"
              onClick={() => setRetry((n) => n + 1)}
            >
              Retry font
            </button>
          </>
        ) : (
          (choice?.description ??
          "This face must be installed on the viewing device.")
        )}
      </p>
    </div>
  );
}
