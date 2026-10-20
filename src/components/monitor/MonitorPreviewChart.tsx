"use client";

// The monitor's number over the feed's recent history, with the rule on top:
// drag a limit line (or a range edge) to set it; the "normal" band for unusual-
// for-now; red dots where it would have fired, grey where expected windows held it.

import { useRef, useState } from "react";
import type { CheckRecord, MonitorRule } from "@/lib/monitoring/types";
import type { BackfillPoint } from "@/lib/monitoring/backfill";
import { fmtValue } from "@/lib/monitoring/engine";

const W = 560;
const PAD = { l: 44, r: 10, t: 10, b: 22 };

type DragKey = "above" | "below" | "low" | "high";

function nice(v: number): number {
  if (!Number.isFinite(v) || v === 0) return 0;
  const p = Math.pow(10, Math.floor(Math.log10(Math.abs(v))) - 2);
  return Math.round(v / p) * p;
}

function ticks(lo: number, hi: number, n = 4): number[] {
  const raw = (hi - lo) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toPrecision(10));
  return out;
}

function timeLabel(t: number, span: number): string {
  const d = new Date(t);
  if (span > 2 * 86_400_000) return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (span > 12 * 3_600_000) return d.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function MonitorPreviewChart({
  series,
  records,
  rule,
  unit,
  height = 180,
  onRuleChange,
  liveValue,
}: {
  series: BackfillPoint[];
  records: CheckRecord[];
  rule: MonitorRule;
  unit?: string;
  height?: number;
  onRuleChange?: (rule: MonitorRule) => void;
  /** Current value when the feed has no time column (no history to draw). */
  liveValue?: number | null;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<DragKey | null>(null);
  const H = height;

  const lines: { key: DragKey; v: number }[] = [];
  if (rule.kind === "threshold") {
    if (rule.above != null) lines.push({ key: "above", v: rule.above });
    if (rule.below != null) lines.push({ key: "below", v: rule.below });
  }
  if (rule.kind === "range") lines.push({ key: "low", v: rule.low }, { key: "high", v: rule.high });

  const vals = series.map((p) => p.value);
  if (!vals.length && liveValue != null) vals.push(liveValue);
  const band = records
    .map((r) => (r.baseline != null && r.spread != null && rule.kind === "anomaly" ? { at: r.at, lo: r.baseline - (rule.sensitivity * r.spread) / 0.67448975, hi: r.baseline + (rule.sensitivity * r.spread) / 0.67448975 } : null))
    .filter((b): b is { at: number; lo: number; hi: number } => b != null && Number.isFinite(b.lo) && Number.isFinite(b.hi));
  const all = [...vals, ...lines.map((l) => l.v), ...band.flatMap((b) => [b.lo, b.hi])];
  if (!all.length) {
    return (
      <div className="h-24 flex items-center justify-center text-xs text-loom-muted border border-dashed border-loom-border rounded-md">
        No rows to preview yet. Use “Test against live data” once the feed has loaded.
      </div>
    );
  }
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  const padY = (hi - lo || Math.abs(hi) || 1) * 0.12;
  lo -= padY;
  hi += padY;
  const t0 = series[0]?.at ?? 0;
  const t1 = series[series.length - 1]?.at ?? 1;
  const x = (t: number) => PAD.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const yInv = (py: number) => lo + (1 - (py - PAD.t) / (H - PAD.t - PAD.b)) * (hi - lo);

  const onMove = (e: React.PointerEvent) => {
    if (!drag || !onRuleChange || !svgRef.current) return;
    // Map through the SVG's own transform: the viewBox is letterboxed when the panel is narrower than W.
    const svg = svgRef.current;
    const ctm = svg.getScreenCTM();
    let py: number;
    if (ctm) {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      py = pt.matrixTransform(ctm.inverse()).y;
    } else {
      const r = svg.getBoundingClientRect();
      py = ((e.clientY - r.top) / r.height) * H;
    }
    const v = nice(yInv(py));
    if (rule.kind === "threshold") onRuleChange({ ...rule, [drag]: v });
    if (rule.kind === "range") {
      if (drag === "low") onRuleChange({ ...rule, low: Math.min(v, rule.high) });
      if (drag === "high") onRuleChange({ ...rule, high: Math.max(v, rule.low) });
    }
  };

  const path = series.map((p, i) => `${i ? "L" : "M"}${x(p.at).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  const bandPath = band.length > 1
    ? `M${band.map((b) => `${x(b.at).toFixed(1)},${y(b.hi).toFixed(1)}`).join("L")}L${[...band].reverse().map((b) => `${x(b.at).toFixed(1)},${y(b.lo).toFixed(1)}`).join("L")}Z`
    : "";
  const byAt = new Map(records.map((r) => [r.at, r]));
  const span = t1 - t0;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className={`w-full select-none ${drag ? "cursor-ns-resize touch-none" : ""}`}
      style={{ height: H }}
      role="img"
      aria-label={`Preview of the monitored value over the loaded history${lines.length ? `, limits at ${lines.map((l) => fmtValue(l.v, unit)).join(" and ")}` : ""}`}
      onPointerMove={onMove}
      onPointerUp={() => setDrag(null)}
      onPointerLeave={() => setDrag(null)}
    >
      {ticks(lo, hi).map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--loom-border)" strokeWidth={0.5} />
          <text x={PAD.l - 4} y={y(t) + 3} textAnchor="end" fontSize={9} fill="var(--loom-muted)">{fmtValue(t)}</text>
        </g>
      ))}
      {series.length > 1 && (
        <>
          <text x={PAD.l} y={H - 6} fontSize={9} fill="var(--loom-muted)">{timeLabel(t0, span)}</text>
          <text x={W - PAD.r} y={H - 6} fontSize={9} textAnchor="end" fill="var(--loom-muted)">{timeLabel(t1, span)}</text>
        </>
      )}
      {rule.kind === "range" && (
        <rect x={PAD.l} width={W - PAD.l - PAD.r} y={y(rule.high)} height={Math.max(0, y(rule.low) - y(rule.high))} fill="var(--loom-success)" opacity={0.08} />
      )}
      {bandPath && <path d={bandPath} fill="var(--loom-accent)" opacity={0.12} />}
      {path && <path d={path} fill="none" stroke="var(--loom-accent)" strokeWidth={1.75} strokeLinejoin="round" />}
      {!series.length && liveValue != null && (
        <circle cx={(PAD.l + W - PAD.r) / 2} cy={y(liveValue)} r={4} fill="var(--loom-accent)" />
      )}
      {series.map((p) => {
        const r = byAt.get(p.at);
        if (!r) return null;
        if (r.status === "firing") return <circle key={p.at} cx={x(p.at)} cy={y(p.value)} r={3.5} fill="var(--loom-error)" />;
        if (r.status === "breach") return <circle key={p.at} cx={x(p.at)} cy={y(p.value)} r={3} fill="var(--loom-warning)" />;
        if (r.status === "expected" && /expected:/.test(r.reason)) return <circle key={p.at} cx={x(p.at)} cy={y(p.value)} r={3} fill="var(--loom-muted)" />;
        return null;
      })}
      {lines.map((l) => (
        <g key={l.key}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(l.v)} y2={y(l.v)} stroke="var(--loom-warning)" strokeWidth={1.5} strokeDasharray="5 4" />
          {onRuleChange && (
            <rect
              x={PAD.l}
              width={W - PAD.l - PAD.r}
              y={y(l.v) - 7}
              height={14}
              fill="transparent"
              className="cursor-ns-resize touch-none"
              role="slider"
              tabIndex={0}
              aria-label={`${l.key} limit`}
              aria-valuenow={l.v}
              onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); setDrag(l.key); }}
              onKeyDown={(e) => {
                if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                e.preventDefault();
                const step = (hi - lo) / 50;
                const v = nice(l.v + (e.key === "ArrowUp" ? step : -step));
                if (rule.kind === "threshold") onRuleChange({ ...rule, [l.key]: v });
                if (rule.kind === "range") onRuleChange({ ...rule, [l.key]: v });
              }}
            />
          )}
          <text x={W - PAD.r - 2} y={y(l.v) - 4} textAnchor="end" fontSize={10} fontWeight={600} fill="var(--loom-warning)">
            {l.key === "above" || l.key === "high" ? "▲ " : "▼ "}{fmtValue(l.v, unit)}{onRuleChange ? "  ⇕ drag" : ""}
          </text>
        </g>
      ))}
    </svg>
  );
}
