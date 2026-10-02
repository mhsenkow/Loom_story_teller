"use client";

// =================================================================
// Loom — Dive time series (SVG)
// =================================================================
// One line per top group for the ranking metric; dashed ghost lines
// for the comparison period. Hover = crosshair + values at bucket;
// click a legend chip to hide/show a series. Colors come from the
// theme's --chart-1…8 tokens.
// =================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { formatBucket, formatDiveNumber, type DiveSeries } from "@/lib/dive";

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

export function DiveTimeSeries({
  buckets,
  bucketMs,
  series,
  metricLabel,
  compareLabel,
}: {
  buckets: number[];
  bucketMs: number;
  series: DiveSeries[];
  metricLabel: string;
  compareLabel: string | null;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 320 });
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setSize({ w: Math.max(240, e.contentRect.width), h: Math.max(180, e.contentRect.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Drop hidden keys that no longer exist (new query).
  useEffect(() => {
    setHidden((h) => new Set([...h].filter((k) => series.some((s) => s.key === k))));
  }, [series]);

  const visible = series.map((s, i) => ({ s, i })).filter(({ s }) => !hidden.has(s.key));
  const m = { l: 56, r: 14, t: 10, b: 26 };
  const pw = size.w - m.l - m.r;
  const ph = size.h - m.t - m.b;
  const n = buckets.length;

  const { yMin, yMax, ticks } = useMemo(() => {
    let lo = 0;
    let hi = -Infinity;
    for (const { s } of visible) {
      for (const arr of [s.points, s.compare ?? []]) {
        for (const v of arr) {
          if (v == null) continue;
          if (v > hi) hi = v;
          if (v < lo) lo = v;
        }
      }
    }
    if (!Number.isFinite(hi)) hi = 1;
    const t = niceTicks(lo, hi);
    return { yMin: Math.min(lo, t[0]!), yMax: Math.max(hi, t[t.length - 1]!), ticks: t };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, hidden]);

  const x = (i: number) => m.l + (n <= 1 ? pw / 2 : (i / (n - 1)) * pw);
  const y = (v: number) => m.t + ph - ((v - yMin) / (yMax - yMin || 1)) * ph;

  const path = (pts: (number | null)[]) => {
    let d = "";
    let pen = false;
    pts.forEach((v, i) => {
      if (v == null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  const xTickIdx = useMemo(() => {
    const want = Math.max(2, Math.floor(pw / 110));
    const step = Math.max(1, Math.ceil(n / want));
    const out: number[] = [];
    for (let i = 0; i < n; i += step) out.push(i);
    return out;
  }, [n, pw]);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    if (px < m.l - 8 || px > size.w - m.r + 8 || n === 0) return setHover(null);
    const i = n <= 1 ? 0 : Math.round(((px - m.l) / pw) * (n - 1));
    setHover({ i: Math.max(0, Math.min(n - 1, i)), x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const hoverRows = hover
    ? visible
        .map(({ s, i }) => ({ s, i, v: s.points[hover.i] ?? null, c: s.compare?.[hover.i] ?? null }))
        .sort((a, b) => (b.v ?? -Infinity) - (a.v ?? -Infinity))
    : [];

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
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded border text-2xs max-w-[14rem] ${
                off ? "border-loom-border text-loom-muted opacity-50" : "border-loom-border text-loom-text"
              }`}
              title={off ? "Show series" : "Hide series"}
            >
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: color(i) }} />
              <span className="truncate">{s.label}</span>
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
      </div>

      <div ref={wrapRef} className="relative flex-1 min-h-[180px]">
        <svg
          width={size.w}
          height={size.h}
          className="absolute inset-0"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={(e) => {
            if (e.pointerType !== "touch") setHover(null);
          }}
          // Horizontal finger drags scrub the series; vertical drags still scroll the page.
          style={{ touchAction: "pan-y" }}
          role="img"
          aria-label={`${metricLabel} over time`}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.l} x2={size.w - m.r} y1={y(t)} y2={y(t)} stroke="var(--loom-border)" strokeOpacity={0.6} />
              <text x={m.l - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="var(--loom-muted)">
                {formatDiveNumber(t)}
              </text>
            </g>
          ))}
          {xTickIdx.map((i) => (
            <text key={i} x={x(i)} y={size.h - 8} textAnchor="middle" fontSize={10} fill="var(--loom-muted)">
              {formatBucket(buckets[i]!, bucketMs)}
            </text>
          ))}
          {visible.map(({ s, i }) =>
            s.compare ? (
              <path key={`c-${s.key}`} d={path(s.compare)} fill="none" stroke={color(i)} strokeWidth={1.25} strokeDasharray="4 3" strokeOpacity={0.5} />
            ) : null,
          )}
          {visible.map(({ s, i }) => (
            <g key={s.key}>
              <path d={path(s.points)} fill="none" stroke={color(i)} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
              {n <= 2 &&
                s.points.map((v, j) => (v == null ? null : <circle key={j} cx={x(j)} cy={y(v)} r={3} fill={color(i)} />))}
            </g>
          ))}
          {hover && (
            <g pointerEvents="none">
              <line x1={x(hover.i)} x2={x(hover.i)} y1={m.t} y2={m.t + ph} stroke="var(--loom-text)" strokeOpacity={0.35} />
              {hoverRows.map(({ v, i }) => (v == null ? null : <circle key={i} cx={x(hover.i)} cy={y(v)} r={3} fill={color(i)} stroke="var(--loom-bg)" />))}
            </g>
          )}
        </svg>
        {hover && hoverRows.length > 0 && (
          <div
            className="absolute z-10 pointer-events-none px-2 py-1.5 rounded border border-loom-border bg-loom-surface/95 shadow-lg text-2xs font-mono max-w-[260px]"
            style={{ left: Math.min(hover.x + 14, size.w - 250), top: Math.max(4, hover.y - 10) }}
          >
            <div className="text-loom-muted mb-1">{formatBucket(buckets[hover.i]!, bucketMs)}</div>
            {hoverRows.slice(0, 10).map(({ s, i, v, c }) => (
              <div key={s.key} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: color(i) }} />
                <span className="truncate flex-1 text-loom-text">{s.label}</span>
                <span className="text-loom-text">{formatDiveNumber(v)}</span>
                {c != null && <span className="text-loom-muted">/ {formatDiveNumber(c)}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
