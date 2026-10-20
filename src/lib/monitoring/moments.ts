// =================================================================
// Loom — Moments: what an alert looked like when it happened
// =================================================================
// When a monitor fires, Loom keeps a "moment": the number, the rule,
// the recent history that led up to it, and the chart it came from.
// `momentSvg` draws it as a self-contained card (no DOM, no CSS vars
// unless asked) so the app, published story pages, the Worker status
// page and RSS all show the same picture.
// =================================================================

import { describeRule, fmtValue } from "./engine";
import type { Monitor, MonitorRule, MonitorSeverity } from "./types";

export interface MomentPoint { at: number; value: number }

export interface Moment {
  id: string;
  monitorId: string;
  at: number;
  value: number | null;
  reason: string;
  severity: MonitorSeverity;
  monitorName: string;
  decision: string;
  feedLabel: string;
  unit?: string;
  rule: MonitorRule;
  /** Up to 72 points ending at the moment (oldest → newest). */
  series: MomentPoint[];
  /** `chart=…` link of the chart the monitor came from. */
  chartLink?: string;
  /** Published story page, once shared. */
  storyUrl?: string;
  /** Evaluated by the Worker cron rather than this device. */
  cloud?: boolean;
}

export const MAX_MOMENTS = 100;
export const MAX_MOMENT_POINTS = 72;

export function momentFrom(m: Monitor, args: { id: string; at: number; value: number | null; reason: string; feedLabel: string; series: MomentPoint[]; cloud?: boolean }): Moment {
  const series = args.series.filter((p) => p.at <= args.at).slice(-MAX_MOMENT_POINTS);
  if (args.value != null && (!series.length || series[series.length - 1]!.at < args.at)) series.push({ at: args.at, value: args.value });
  return {
    id: args.id,
    monitorId: m.id,
    at: args.at,
    value: args.value,
    reason: args.reason,
    severity: m.severity,
    monitorName: m.name,
    decision: m.decision,
    feedLabel: args.feedLabel,
    unit: m.metric.unit,
    rule: m.rule,
    series,
    chartLink: m.chart?.link,
    cloud: args.cloud,
  };
}

export interface MomentPalette {
  bg: string;
  text: string;
  muted: string;
  grid: string;
  line: string;
  limit: string;
  alert: string;
  band: string;
}

/** Standalone colours for published pages / Worker HTML (no CSS variables there). */
export const MOMENT_DARK: MomentPalette = {
  bg: "#0d0d12", text: "#ececf1", muted: "#9a9aa8", grid: "#26262f", line: "#8b7cf6", limit: "#f5a524", alert: "#f2555a", band: "#3fbf7f",
};

/** In-app colours follow the theme tokens. */
export const MOMENT_THEME: MomentPalette = {
  bg: "var(--loom-surface)", text: "var(--loom-text)", muted: "var(--loom-muted)", grid: "var(--loom-border)",
  line: "var(--loom-accent)", limit: "var(--loom-warning)", alert: "var(--loom-error)", band: "var(--loom-success)",
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function when(at: number): string {
  try {
    return new Date(at).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return new Date(at).toISOString().slice(0, 16).replace("T", " ");
  }
}

/**
 * A 1200×627 card (link-preview size): headline, the value in big type,
 * the series with the limit drawn on it, and the moment marked.
 * `compact` drops the headline block for small in-app thumbnails.
 */
export function momentSvg(mo: Moment, opts?: { palette?: MomentPalette; compact?: boolean; width?: number; height?: number }): string {
  const p = opts?.palette ?? MOMENT_DARK;
  const W = opts?.width ?? (opts?.compact ? 600 : 1200);
  const H = opts?.height ?? (opts?.compact ? 220 : 627);
  const head = opts?.compact ? 0 : 230;
  const pad = { l: opts?.compact ? 40 : 90, r: opts?.compact ? 16 : 60, t: head + (opts?.compact ? 14 : 20), b: opts?.compact ? 26 : 60 };
  const fs = opts?.compact ? 0.5 : 1;

  const limits: number[] = [];
  const r = mo.rule;
  if (r.kind === "threshold") { if (r.above != null) limits.push(r.above); if (r.below != null) limits.push(r.below); }
  if (r.kind === "range") limits.push(r.low, r.high);

  const pts = mo.series.length ? mo.series : mo.value != null ? [{ at: mo.at, value: mo.value }] : [];
  const vals = [...pts.map((q) => q.value), ...limits];
  let lo = vals.length ? Math.min(...vals) : 0;
  let hi = vals.length ? Math.max(...vals) : 1;
  const padY = (hi - lo || Math.abs(hi) || 1) * 0.15;
  lo -= padY;
  hi += padY;
  const t0 = pts[0]?.at ?? mo.at - 1;
  const t1 = Math.max(mo.at, pts[pts.length - 1]?.at ?? mo.at);
  const x = (t: number) => pad.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);

  const path = pts.map((q, i) => `${i ? "L" : "M"}${x(q.at).toFixed(1)},${y(q.value).toFixed(1)}`).join("");
  const area = pts.length > 1 ? `${path}L${x(pts[pts.length - 1]!.at).toFixed(1)},${(H - pad.b).toFixed(1)}L${x(pts[0]!.at).toFixed(1)},${(H - pad.b).toFixed(1)}Z` : "";
  const parts: string[] = [];
  parts.push(`<rect width="${W}" height="${H}" fill="${p.bg}"/>`);
  if (!opts?.compact) {
    const sevColor = mo.severity === "critical" ? p.alert : mo.severity === "warning" ? p.limit : p.line;
    parts.push(`<circle cx="${pad.l + 8}" cy="66" r="8" fill="${sevColor}"/>`);
    parts.push(`<text x="${pad.l + 26}" y="74" font-size="26" fill="${p.muted}" font-family="system-ui, sans-serif">${esc(mo.feedLabel)} · ${esc(when(mo.at))}</text>`);
    parts.push(`<text x="${pad.l}" y="128" font-size="44" font-weight="700" fill="${p.text}" font-family="system-ui, sans-serif">${esc(mo.monitorName.slice(0, 48))}</text>`);
    parts.push(`<text x="${pad.l}" y="178" font-size="28" fill="${p.text}" opacity="0.85" font-family="system-ui, sans-serif">${esc(mo.reason.slice(0, 80))}</text>`);
    parts.push(`<text x="${W - pad.r}" y="128" text-anchor="end" font-size="64" font-weight="700" fill="${p.alert}" font-family="ui-monospace, monospace">${esc(fmtValue(mo.value, mo.unit))}</text>`);
    parts.push(`<text x="${W - pad.r}" y="178" text-anchor="end" font-size="22" fill="${p.muted}" font-family="system-ui, sans-serif">${esc(describeRule(mo.rule, mo.unit).slice(0, 60))}</text>`);
  }
  for (let i = 0; i <= 3; i++) {
    const v = lo + ((hi - lo) * i) / 3;
    parts.push(`<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${p.grid}" stroke-width="1"/>`);
    parts.push(`<text x="${pad.l - 8}" y="${(y(v) + 5 * fs + 2).toFixed(1)}" text-anchor="end" font-size="${Math.round(18 * fs + 4)}" fill="${p.muted}" font-family="system-ui, sans-serif">${esc(fmtValue(v))}</text>`);
  }
  if (r.kind === "range") {
    parts.push(`<rect x="${pad.l}" y="${y(r.high).toFixed(1)}" width="${W - pad.l - pad.r}" height="${Math.max(0, y(r.low) - y(r.high)).toFixed(1)}" fill="${p.band}" opacity="0.1"/>`);
  }
  if (area) parts.push(`<path d="${area}" fill="${p.line}" opacity="0.12"/>`);
  if (path) parts.push(`<path d="${path}" fill="none" stroke="${p.line}" stroke-width="${opts?.compact ? 2 : 4}" stroke-linejoin="round" stroke-linecap="round"/>`);
  for (const v of limits) {
    parts.push(`<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${p.limit}" stroke-width="${opts?.compact ? 1.5 : 3}" stroke-dasharray="${opts?.compact ? "5 4" : "12 8"}"/>`);
  }
  if (mo.value != null) {
    const cx = x(mo.at);
    const cy = y(mo.value);
    parts.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${opts?.compact ? 9 : 22}" fill="${p.alert}" opacity="0.25"/>`);
    parts.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${opts?.compact ? 4.5 : 10}" fill="${p.alert}"/>`);
  }
  if (!opts?.compact) {
    parts.push(`<text x="${W - pad.r}" y="${H - 20}" text-anchor="end" font-size="20" fill="${p.muted}" font-family="system-ui, sans-serif">Loom · loom.ibm.io</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(`${mo.monitorName}: ${mo.reason}`)}">${parts.join("")}</svg>`;
}

/** One-line text for posts, notifications, and feeds. */
export function momentText(mo: Moment): string {
  return `${mo.monitorName}: ${mo.reason} (${mo.feedLabel}, ${when(mo.at)})`;
}
