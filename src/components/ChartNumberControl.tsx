"use client";
// Inspector sliders share the same bounds/default contract as chart regression cases.
import type { ChartNumberControl as ControlDefinition } from "@/lib/chartDefinitions/controls";
export function ChartNumberControl({ control, value, onChange }: { control: ControlDefinition; value?: number; onChange: (value: number) => void }) {
  const current = value ?? control.defaultValue;
  return <div className="loom-slider-row">
    <span className="truncate text-2xs text-loom-muted">{control.label}</span>
    <input aria-label={control.label} type="range" min={control.min} max={control.max} step={control.step} value={current} onChange={e => onChange(Number(e.target.value))} />
    <span className="loom-slider-value">{control.display === "percent" ? `${(current * 100).toFixed(0)}%` : current}</span>
  </div>;
}
