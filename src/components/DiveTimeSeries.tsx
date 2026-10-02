"use client";

// =================================================================
// Loom — Dive time series (SVG)
// =================================================================
// One line per top group; one panel per metric (small multiples share
// the time axis and crosshair). Dashed ghost lines = comparison period.
// Hover = crosshair + values, nearest line highlighted; click pins the
// crosshair; drag across the plot to zoom the window (double-click to
// zoom back out). Legend chips toggle series. Colors: --chart-1…8.
// =================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { formatBucket, formatDiveNumber, type DiveFill, type DiveSeries } from "@/lib/dive";

const color = (i: number) => `var(--chart-${(i % 8) + 1})`;

function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  if (max === min) max = min + 1;
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

// ── Calendar-aware time ticks ──────────────────────────────────────
// Ticks land on round wall-clock boundaries (:00, midnight, the 1st,
// Jan 1) and the label grows context at a boundary ("Sep 3" at
// midnight on an hourly axis, the year at January).

type TickUnit = "second" | "minute" | "hour" | "day" | "month" | "year";
const INTERVALS: { unit: TickUnit; step: number; ms: number }[] = [
  ...[1, 5, 10, 15, 30].map((step) => ({ unit: "second" as const, step, ms: step * 1000 })),
  ...[1, 2, 5, 10, 15, 30].map((step) => ({ unit: "minute" as const, step, ms: step * 60_000 })),
  ...[1, 2, 3, 6, 12].map((step) => ({ unit: "hour" as const, step, ms: step * 3_600_000 })),
  ...[1, 2, 7, 14].map((step) => ({ unit: "day" as const, step, ms: step * 86_400_000 })),
  ...[1, 3, 6].map((step) => ({ unit: "month" as const, step, ms: step * 2_629_800_000 })),
  ...[1, 2, 5, 10, 25, 50].map((step) => ({ unit: "year" as const, step, ms: step * 31_557_600_000 })),
];

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const p2 = (n: number) => String(n).padStart(2, "0");

export function timeTicks(start: number, end: number, maxTicks: number): { ticks: number[]; unit: TickUnit } {
  const span = Math.max(1, end - start);
  const iv = INTERVALS.find((i) => span / i.ms <= maxTicks) ?? INTERVALS[INTERVALS.length - 1]!;
  const ticks: number[] = [];
  const d = new Date(start);
  let cur: Date;
  switch (iv.unit) {
    case "second":
      cur = new Date(Math.ceil(start / iv.ms) * iv.ms);
      break;
    case "minute":
      cur = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), Math.ceil(d.getMinutes() / iv.step) * iv.step);
      break;
    case "hour":
      cur = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.ceil((d.getHours() + (d.getMinutes() || d.getSeconds() ? 1 : 0)) / iv.step) * iv.step);
      break;
    case "day": {
      const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (d.getHours() || d.getMinutes() ? 1 : 0));
      // Weekly steps start on Mondays.
      if (iv.step === 7 || iv.step === 14) day.setDate(day.getDate() + ((8 - day.getDay()) % 7));
      cur = day;
      break;
    }
    case "month": {
      const m = d.getMonth() + (d.getDate() > 1 || d.getHours() ? 1 : 0);
      cur = new Date(d.getFullYear(), Math.ceil(m / iv.step) * iv.step, 1);
      break;
    }
    default:
      cur = new Date(Math.ceil((d.getFullYear() + (d.getMonth() || d.getDate() > 1 ? 1 : 0)) / iv.step) * iv.step, 0, 1);
  }
  for (let guard = 0; cur.getTime() <= end && guard < 500; guard++) {
    if (cur.getTime() >= start) ticks.push(cur.getTime());
    cur = new Date(cur);
    if (iv.unit === "second") cur.setTime(cur.getTime() + iv.ms);
    else if (iv.unit === "minute") cur.setMinutes(cur.getMinutes() + iv.step);
    else if (iv.unit === "hour") cur.setHours(cur.getHours() + iv.step);
    else if (iv.unit === "day") cur.setDate(cur.getDate() + iv.step);
    else if (iv.unit === "month") cur.setMonth(cur.getMonth() + iv.step);
    else cur.setFullYear(cur.getFullYear() + iv.step);
  }
  return { ticks, unit: iv.unit };
}

export function formatTick(t: number, unit: TickUnit): string {
  const d = new Date(t);
  const midnight = d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
  switch (unit) {
    case "year":
      return String(d.getFullYear());
    case "month":
      return d.getMonth() === 0 ? String(d.getFullYear()) : MON[d.getMonth()]!;
    case "day":
      return d.getDate() === 1 ? `${MON[d.getMonth()]} ${d.getMonth() === 0 ? d.getFullYear() : ""}`.trim() : `${MON[d.getMonth()]} ${d.getDate()}`;
    case "hour":
    case "minute":
      return midnight ? `${MON[d.getMonth()]} ${d.getDate()}` : `${p2(d.getHours())}:${p2(d.getMinutes())}`;
    default:
      return d.getSeconds() === 0 ? `${p2(d.getHours())}:${p2(d.getMinutes())}` : `:${p2(d.getSeconds())}`;
  }
}

function formatTimeValue(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const d = new Date(ms);
  return `${MON[d.getMonth()]} ${d.getDate()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

const M = { l: 56, r: 14, t: 8, b: 6 };
const AXIS_H = 22;

export function DiveTimeSeries({
  buckets,
  bucketMs,
  series,
  metricLabels,
  metricKinds,
  rankIndex,
  compareLabel,
  fill,
  onZoom,
  onZoomOut,
}: {
  buckets: number[];
  bucketMs: number;
  series: DiveSeries[];
  metricLabels: string[];
  metricKinds: ("number" | "time")[];
  /** Metric that ranks groups — drawn first when there are several. */
  rankIndex: number;
  compareLabel: string | null;
  fill: DiveFill;
  onZoom?: (startMs: number, endMs: number) => void;
  onZoomOut?: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 320 });
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<{ i: number; x: number; y: number; panel: number } | null>(null);
  const [pinned, setPinned] = useState(false);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [brush, setBrush] = useState<{ x0: number; x1: number } | null>(null);
  const dragRef = useRef<{ x0: number; x1: number; moved: boolean } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setSize({ w: Math.max(240, e.contentRect.width), h: Math.max(180, e.contentRect.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // New query: drop hidden keys that no longer exist and release the pin.
  useEffect(() => {
    setHidden((h) => new Set([...h].filter((k) => series.some((s) => s.key === k))));
    setPinned(false);
    setHover(null);
  }, [series]);

  const visible = series.map((s, i) => ({ s, i })).filter(({ s }) => !hidden.has(s.key));
  const n = buckets.length;
  const t0 = buckets[0] ?? 0;
  const t1 = buckets[n - 1] ?? t0 + 1;
  const pw = size.w - M.l - M.r;

  // Panels: ranking metric first, then the rest in query order.
  const order = useMemo(() => {
    const rest = metricLabels.map((_, i) => i).filter((i) => i !== rankIndex);
    return [rankIndex, ...rest].filter((i) => i < metricLabels.length);
  }, [metricLabels, rankIndex]);
  const nP = Math.max(1, order.length);
  const panelGap = nP > 1 ? 18 : 0;
  const panelH = Math.max(110, (size.h - AXIS_H - panelGap * (nP - 1)) / nP);
  const totalH = panelH * nP + panelGap * (nP - 1) + AXIS_H;
  const panelTop = (p: number) => p * (panelH + panelGap);
  const ph = panelH - M.t - M.b;

  const scales = useMemo(
    () =>
      order.map((mi) => {
        let lo = metricKinds[mi] === "time" ? Infinity : 0;
        let hi = -Infinity;
        for (const { s } of visible) {
          for (const arr of [s.byMetric[mi] ?? [], s.compareByMetric?.[mi] ?? []]) {
            for (const v of arr) {
              if (v == null) continue;
              if (v > hi) hi = v;
              if (v < lo) lo = v;
            }
          }
        }
        if (!Number.isFinite(hi)) hi = 1;
        if (!Number.isFinite(lo)) lo = 0;
        if (metricKinds[mi] === "time") {
          const pad = Math.max(60_000, (hi - lo) * 0.05);
          return { yMin: lo - pad, yMax: hi + pad, ticks: [lo, (lo + hi) / 2, hi] };
        }
        const t = niceTicks(lo, hi, Math.max(2, Math.min(5, Math.floor(ph / 32))));
        return { yMin: Math.min(lo, t[0]!), yMax: Math.max(hi, t[t.length - 1]!), ticks: t };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, hidden, order, metricKinds, ph],
  );

  const x = (t: number) => M.l + (n <= 1 ? pw / 2 : ((t - t0) / (t1 - t0 || 1)) * pw);
  const xi = (i: number) => x(buckets[i] ?? t0);
  const y = (p: number, v: number) => {
    const sc = scales[p]!;
    return panelTop(p) + M.t + ph - ((v - sc.yMin) / (sc.yMax - sc.yMin || 1)) * ph;
  };

  const path = (p: number, pts: (number | null)[]) => {
    let d = "";
    let pen = false;
    pts.forEach((v, i) => {
      if (v == null) {
        if (fill !== "connect") pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${xi(i).toFixed(1)},${y(p, v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  const xTicks = useMemo(() => timeTicks(t0, t1, Math.max(2, Math.floor(pw / 80))), [t0, t1, pw]);

  const locate = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const frac = (px - M.l) / (pw || 1);
    const i = n <= 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1))));
    const panel = Math.max(0, Math.min(nP - 1, Math.floor(py / (panelH + panelGap))));
    return { px, py, i, panel, inPlot: px >= M.l - 8 && px <= size.w - M.r + 8 && n > 0 };
  };

  const nearestKey = (i: number, panel: number, py: number): string | null => {
    const mi = order[panel]!;
    let best: string | null = null;
    let bestD = 24;
    for (const { s } of visible) {
      const v = s.byMetric[mi]?.[i];
      if (v == null) continue;
      const d = Math.abs(y(panel, v) - py);
      if (d < bestD) {
        bestD = d;
        best = s.key;
      }
    }
    return best;
  };

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const l = locate(e);
    const drag = dragRef.current;
    if (drag) {
      drag.x1 = Math.max(M.l, Math.min(size.w - M.r, l.px));
      if (Math.abs(l.px - drag.x0) > 6) drag.moved = true;
      if (drag.moved) setBrush({ x0: drag.x0, x1: drag.x1 });
    }
    if (pinned && e.pointerType === "mouse") return;
    if (!l.inPlot) {
      setHover(null);
      setFocusKey(null);
      return;
    }
    setHover({ i: l.i, x: l.px, y: l.py, panel: l.panel });
    if (series.length > 1) setFocusKey(nearestKey(l.i, l.panel, l.py));
  };

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === "mouse" && e.button === 0 && onZoom) {
      const x0 = Math.max(M.l, locate(e).px);
      dragRef.current = { x0, x1: x0, moved: false };
      e.currentTarget.setPointerCapture(e.pointerId);
    } else {
      onMove(e);
    }
  };

  const onUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    // Read the drag from the ref, not `brush` state — pointerup can land before a re-render.
    if (drag.moved && onZoom && n > 1) {
      const toT = (px: number) => t0 + ((px - M.l) / (pw || 1)) * (t1 - t0);
      const a = toT(Math.min(drag.x0, drag.x1));
      const b = toT(Math.max(drag.x0, drag.x1)) + bucketMs;
      setBrush(null);
      if (b - a >= Math.min(bucketMs, 1000)) onZoom(Math.round(a), Math.round(b));
      return;
    }
    setBrush(null);
    // Plain click toggles a pinned crosshair.
    if (pinned) {
      setPinned(false);
      onMove(e);
    } else if (hover) setPinned(true);
  };

  const hoverRows = (mi: number) =>
    hover
      ? visible
          .map(({ s, i }) => ({ s, i, v: s.byMetric[mi]?.[hover.i] ?? null, c: s.compareByMetric?.[mi]?.[hover.i] ?? null }))
          .sort((a, b) => (b.v ?? -Infinity) - (a.v ?? -Infinity))
      : [];
  const fmt = (mi: number, v: number | null | undefined) => (metricKinds[mi] === "time" ? formatTimeValue(v) : formatDiveNumber(v));
  const tipMetric = hover ? order[hover.panel]! : rankIndex;
  const tipRows = hoverRows(tipMetric);

  return (
    <div className="flex flex-col h-full min-h-0 gap-2">
      <div className="flex flex-wrap gap-1 items-center">
        {series.map((s, i) => {
          const off = hidden.has(s.key);
          return (
            <button
              key={s.key}
              type="button"
              onClick={() =>
                setHidden((h) => {
                  const next = new Set(h);
                  if (next.has(s.key)) next.delete(s.key);
                  else next.add(s.key);
                  return next;
                })
              }
              onPointerEnter={() => !off && setFocusKey(s.key)}
              onPointerLeave={() => setFocusKey(null)}
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded border text-2xs max-w-[14rem] ${
                off ? "border-loom-border text-loom-muted opacity-50" : focusKey === s.key ? "border-loom-accent/60 text-loom-text bg-loom-elevated" : "border-loom-border text-loom-text"
              }`}
              title={off ? "Show series" : "Hide series"}
            >
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: color(i) }} />
              <span className="truncate">{s.label}</span>
              {pinned && hover && !off && (
                <span className="text-loom-muted font-mono">{fmt(tipMetric, s.byMetric[tipMetric]?.[hover.i])}</span>
              )}
            </button>
          );
        })}
        {compareLabel && (
          <span className="flex items-center gap-1.5 text-2xs text-loom-muted ml-1">
            <svg width="18" height="6" aria-hidden>
              <line x1="0" y1="3" x2="18" y2="3" stroke="currentColor" strokeDasharray="3 3" />
            </svg>
            {compareLabel}
          </span>
        )}
        {onZoom && (
          <span className="hidden sm:inline text-2xs text-loom-muted ml-auto">
            {pinned ? "Pinned — click to release" : "Drag to zoom · click to pin"}
          </span>
        )}
      </div>

      <div ref={wrapRef} className="relative flex-1 min-h-[180px] overflow-y-auto overflow-x-hidden">
        <svg
          width={size.w}
          height={Math.max(totalH, size.h)}
          className="absolute inset-x-0 top-0 select-none"
          onPointerMove={onMove}
          onPointerDown={onDown}
          onPointerUp={onUp}
          onDoubleClick={() => onZoomOut?.()}
          onPointerLeave={(e) => {
            if (e.pointerType !== "touch" && !pinned && !dragRef.current) {
              setHover(null);
              setFocusKey(null);
            }
          }}
          // Horizontal finger drags scrub the series; vertical drags still scroll the page.
          style={{ touchAction: "pan-y", cursor: onZoom ? "crosshair" : undefined }}
          role="img"
          aria-label={`${metricLabels.join(", ")} over time`}
        >
          {order.map((mi, p) => {
            const sc = scales[p]!;
            const top = panelTop(p);
            return (
              <g key={mi}>
                {nP > 1 && (
                  <text x={M.l} y={top + 2} dominantBaseline="hanging" fontSize={10} fontWeight={600} fill="var(--loom-text)">
                    {metricLabels[mi]}
                  </text>
                )}
                {sc.ticks.map((t) => (
                  <g key={t}>
                    <line x1={M.l} x2={size.w - M.r} y1={y(p, t)} y2={y(p, t)} stroke="var(--loom-border)" strokeOpacity={0.6} />
                    <text x={M.l - 6} y={y(p, t)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="var(--loom-muted)">
                      {metricKinds[mi] === "time" ? formatBucket(t, Math.max(bucketMs, 60_000)) : formatDiveNumber(t)}
                    </text>
                  </g>
                ))}
                {xTicks.ticks.map((t) => (
                  <line key={t} x1={x(t)} x2={x(t)} y1={top + M.t} y2={top + M.t + ph} stroke="var(--loom-border)" strokeOpacity={0.3} />
                ))}
                {visible.map(({ s, i }) =>
                  s.compareByMetric?.[mi] ? (
                    <path key={`c-${s.key}`} d={path(p, s.compareByMetric[mi]!)} fill="none" stroke={color(i)} strokeWidth={1.25} strokeDasharray="4 3" strokeOpacity={focusKey && focusKey !== s.key ? 0.15 : 0.5} />
                  ) : null,
                )}
                {visible.map(({ s, i }) => {
                  const dim = focusKey != null && focusKey !== s.key;
                  const pts = s.byMetric[mi] ?? [];
                  return (
                    <g key={s.key} opacity={dim ? 0.25 : 1}>
                      <path d={path(p, pts)} fill="none" stroke={color(i)} strokeWidth={focusKey === s.key ? 2.5 : 1.75} strokeLinejoin="round" strokeLinecap="round" />
                      {(n <= 2 || pts.filter((v) => v != null).length === 1) &&
                        pts.map((v, j) => (v == null ? null : <circle key={j} cx={xi(j)} cy={y(p, v)} r={3} fill={color(i)} />))}
                    </g>
                  );
                })}
                {hover && (
                  <g pointerEvents="none">
                    <line x1={xi(hover.i)} x2={xi(hover.i)} y1={top + M.t} y2={top + M.t + ph} stroke="var(--loom-text)" strokeOpacity={pinned ? 0.6 : 0.35} strokeDasharray={pinned ? "3 2" : undefined} />
                    {hoverRows(mi).map(({ v, i, s }) =>
                      v == null ? null : <circle key={i} cx={xi(hover.i)} cy={y(p, v)} r={focusKey === s.key ? 4 : 3} fill={color(i)} stroke="var(--loom-bg)" />,
                    )}
                  </g>
                )}
              </g>
            );
          })}
          {xTicks.ticks.map((t) => (
            <text key={t} x={x(t)} y={panelTop(nP - 1) + panelH + AXIS_H - 8} textAnchor="middle" fontSize={10} fill="var(--loom-muted)">
              {formatTick(t, xTicks.unit)}
            </text>
          ))}
          {brush && (
            <rect
              x={Math.min(brush.x0, brush.x1)}
              y={0}
              width={Math.abs(brush.x1 - brush.x0)}
              height={panelTop(nP - 1) + panelH}
              fill="var(--loom-accent)"
              fillOpacity={0.12}
              stroke="var(--loom-accent)"
              strokeOpacity={0.5}
              pointerEvents="none"
            />
          )}
        </svg>
        {hover && !brush && tipRows.length > 0 && (
          <div
            className="absolute z-10 pointer-events-none px-2 py-1.5 rounded border border-loom-border bg-loom-surface/95 shadow-lg text-2xs font-mono max-w-[260px]"
            style={{ left: Math.max(4, Math.min(hover.x + 14, size.w - 250)), top: Math.max(4, hover.y - 10) }}
          >
            <div className="text-loom-muted mb-1">
              {formatBucket(buckets[hover.i]!, bucketMs)}
              {nP > 1 && <> · {metricLabels[tipMetric]}</>}
            </div>
            {tipRows.slice(0, 10).map(({ s, i, v, c }) => (
              <div key={s.key} className={`flex items-center gap-1.5 ${focusKey && focusKey !== s.key ? "opacity-60" : ""}`}>
                <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: color(i) }} />
                <span className={`truncate flex-1 ${focusKey === s.key ? "text-loom-accent" : "text-loom-text"}`}>{s.label}</span>
                <span className="text-loom-text">{fmt(tipMetric, v)}</span>
                {c != null && <span className="text-loom-muted">/ {fmt(tipMetric, c)}</span>}
              </div>
            ))}
            {tipRows.length > 10 && <div className="text-loom-muted">+{tipRows.length - 10} more</div>}
          </div>
        )}
      </div>
    </div>
  );
}
