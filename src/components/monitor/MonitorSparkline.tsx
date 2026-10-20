"use client";

import type { CheckRecord, MonitorRule } from "@/lib/monitoring/types";

const W = 240;
const H = 48;
const PAD = 4;

const STATUS_FILL: Record<string, string> = {
  firing: "var(--loom-error)",
  breach: "var(--loom-warning)",
  expected: "var(--loom-muted)",
};

/** Last checks as a line, with the rule's limits as a band and breaches as dots. */
export function MonitorSparkline({ checks, rule, unit }: { checks: CheckRecord[]; rule: MonitorRule; unit?: string }) {
  const pts = checks.filter((c) => c.value != null).slice(-80);
  if (pts.length < 2) {
    return <div className="h-12 flex items-center text-2xs text-loom-muted">{pts.length ? "One check so far" : "No checks yet"}</div>;
  }
  const lines: number[] = [];
  if (rule.kind === "threshold") {
    if (rule.above != null) lines.push(rule.above);
    if (rule.below != null) lines.push(rule.below);
  }
  if (rule.kind === "range") lines.push(rule.low, rule.high);
  const vals = pts.map((p) => p.value as number);
  const base = pts.map((p) => p.baseline).filter((b): b is number => b != null);
  let lo = Math.min(...vals, ...lines, ...base);
  let hi = Math.max(...vals, ...lines, ...base);
  if (lo === hi) { lo -= 1; hi += 1; }
  const t0 = pts[0]!.at;
  const t1 = pts[pts.length - 1]!.at;
  const x = (t: number) => PAD + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - ((v - lo) / (hi - lo)) * (H - PAD * 2);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(p.at).toFixed(1)},${y(p.value as number).toFixed(1)}`).join("");
  const basePts = pts.filter((p) => p.baseline != null);
  const basePath = basePts.map((p, i) => `${i ? "L" : "M"}${x(p.at).toFixed(1)},${y(p.baseline!).toFixed(1)}`).join("");
  const last = pts[pts.length - 1]!;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-12" role="img" aria-label={`Last ${pts.length} checks, latest ${last.value}${unit ? ` ${unit}` : ""}`}>
      {rule.kind === "range" && (
        <rect x={PAD} width={W - PAD * 2} y={y(rule.high)} height={Math.max(0, y(rule.low) - y(rule.high))} fill="var(--loom-success)" opacity={0.1} />
      )}
      {lines.map((v, i) => (
        <line key={i} x1={PAD} x2={W - PAD} y1={y(v)} y2={y(v)} stroke="var(--loom-warning)" strokeDasharray="3 3" strokeWidth={1} opacity={0.8} />
      ))}
      {basePath && <path d={basePath} fill="none" stroke="var(--loom-muted)" strokeWidth={1} strokeDasharray="2 2" />}
      <path d={path} fill="none" stroke="var(--loom-accent)" strokeWidth={1.5} strokeLinejoin="round" />
      {pts.map((p) =>
        STATUS_FILL[p.status] ? <circle key={p.at} cx={x(p.at)} cy={y(p.value as number)} r={2.5} fill={STATUS_FILL[p.status]} /> : null,
      )}
    </svg>
  );
}
