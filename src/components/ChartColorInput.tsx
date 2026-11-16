"use client";

// Native color well plus keyboard-friendly hex entry, shared by chart ink controls.
import { useState } from "react";
import { normalizeChartHex } from "@/lib/chartCustomColors";

export function ChartColorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <input
        type="color"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-10 h-9 shrink-0 cursor-pointer rounded border border-loom-border bg-loom-elevated p-1"
      />
      <HexField key={value} label={label} value={value} onChange={onChange} />
    </div>
  );
}

function HexField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const commit = () => {
    const color = normalizeChartHex(draft);
    setInvalid(!color);
    if (color) {
      setDraft(color);
      if (color !== value) onChange(color);
    }
  };
  return (
    <>
      <input
        aria-label={`${label} hex`}
        aria-invalid={invalid}
        value={draft}
        maxLength={7}
        spellCheck={false}
        onChange={(e) => {
          setDraft(e.target.value);
          setInvalid(false);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(value);
            setInvalid(false);
          }
        }}
        className="loom-input min-w-0 w-full min-h-9 text-xs font-mono px-2"
      />
      {invalid && (
        <span className="text-2xs text-loom-muted" role="status">
          Use #RGB or #RRGGBB
        </span>
      )}
    </>
  );
}
