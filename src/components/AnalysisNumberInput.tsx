// Preserve partial keyboard edits; commit a bounded value on blur or Enter.
"use client";
import { useState } from "react";
export default function AnalysisNumberInput({ label, value, min, max, step = 1, onCommit }: {
  label: string; value: number; min: number; max: number; step?: number; onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft == null) return;
    const n = draft.trim() ? Number(draft) : NaN;
    onCommit(Number.isFinite(n) ? Math.min(max, Math.max(min, step === 1 ? Math.round(n) : n)) : value);
    setDraft(null);
  };
  return <input aria-label={label} className="loom-input w-full mt-1" type="number" inputMode={step === 1 ? "numeric" : "decimal"} enterKeyHint="done"
    min={min} max={max} step={step} value={draft ?? value}
    onChange={e => setDraft(e.target.value)} onBlur={commit}
    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } if (e.key === "Escape") { setDraft(null); } }} />;
}
