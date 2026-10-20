"use client";

// A number input that lets people type "4.", "-", or clear it on the way to a value:
// the text is local; the parent only hears parsed numbers (and the last good one on blur).

import { useEffect, useState } from "react";

export function NumberField({
  value,
  onChange,
  allowEmpty,
  className,
  ...rest
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  /** Empty commits `undefined` (e.g. an optional "below" limit). */
  allowEmpty?: boolean;
  className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [text, setText] = useState(value == null ? "" : String(value));
  // Follow outside changes (drag on the chart) unless the text already means that number.
  useEffect(() => {
    setText((t) => (t.trim() !== "" && Number(t) === value ? t : value == null ? "" : String(value)));
  }, [value]);
  return (
    <input
      {...rest}
      className={className}
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        if (t.trim() === "") { if (allowEmpty) onChange(undefined); return; }
        const n = Number(t);
        if (Number.isFinite(n) && !/[.\-]$/.test(t)) onChange(n);
      }}
      onBlur={(e) => {
        const n = Number(text);
        if (text.trim() === "") setText(allowEmpty || value == null ? "" : String(value));
        else if (Number.isFinite(n)) { onChange(n); setText(String(n)); }
        else setText(value == null ? "" : String(value));
        rest.onBlur?.(e);
      }}
    />
  );
}
