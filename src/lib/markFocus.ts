// =================================================================
// markFocus — hover / keyboard focus + pinned readouts for every chart
// =================================================================
// One system across all kinds, built on the HitTargets renderers already
// register while painting (chartTooltip.ts):
//   • MarkRef — a mark's identity by column *values* (not pixels or row
//     order), so a pin survives resize, live refreshes, export and share links.
//   • drawMarkFocus — emphasis drawn from the mark's own geometry, themed per
//     chart family (ring for points, outline + cap for bars, inset for cells,
//     lifted edge for wedges, soft wash for bands).
//   • drawPinnedCallout — the tooltip burned into a canvas layer, so a PNG /
//     share card shows exactly what was highlighted.
// Pure canvas + data; ChartView owns the layer and the state.
// =================================================================

import type { HitTarget } from "./chartTooltip";
import { fitTextEllipsis } from "./chartLayout";

/** A mark's identity: column → value pairs (sorted by column name). */
export interface MarkRef {
  fields: [string, string][];
}

export type MarkFocusStyle = "point" | "bar" | "band" | "cell" | "wedge";

const POINT_KINDS = new Set([
  "scatter", "bubble", "line", "radar", "network", "arcDiagram", "forceBubble", "firefly", "scatter3d",
  "hexbin", "beeswarm", "chernoff", "glyphStar", "flower", "isoScatter", "bump", "slope", "spiral",
  "voronoi", "contour", "bucketField", "geoPoints", "geoBubbles", "geoHex", "globe", "globeTrail", "arcMap",
  "trailRibbon", "quakeTerrain", "loomWeave", "waffle", "isotype", "stream", "horizon", "chord", "mosaic",
  "radialBar", "isoBars",
]);
const BAND_KINDS = new Set(["area", "box", "violin", "ridgeline", "dumbbell", "strip", "parallel"]);
const CELL_KINDS = new Set(["heatmap", "corrMatrix", "treemap", "choropleth", "sankey"]);

/** Theme the focus treatment to how the chart draws its marks. */
export function markFocusStyle(kind: string, hit: HitTarget): MarkFocusStyle {
  if (hit.shape === "arc") return "wedge";
  if (hit.shape === "circle") return "point";
  if (CELL_KINDS.has(kind)) return "cell";
  if (BAND_KINDS.has(kind)) return "band";
  if (POINT_KINDS.has(kind)) return "cell";
  return "bar";
}

function normalize(fields: [string, string][]): MarkRef {
  const seen = new Map<string, string>();
  for (const [k, v] of fields) if (k && !seen.has(k)) seen.set(k, v);
  return { fields: [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0])) };
}

/**
 * Identity for a hit: its `match` columns when the renderer set them, else the
 * aggregated summary label, else the identifying encoding values of its row.
 */
export function markRefForHit(
  hit: HitTarget,
  columns: string[],
  rows: unknown[][],
  identity: (string | null | undefined)[],
): MarkRef | null {
  if (hit.match.length) {
    return normalize(hit.match.flatMap(([ci, v]) => (columns[ci] ? [[columns[ci]!, String(v)] as [string, string]] : [])));
  }
  if (hit.summary && hit.summary.row.length) {
    return normalize([[`#${hit.summary.columns[0] ?? "label"}`, String(hit.summary.row[0])]]);
  }
  if (hit.rowIndex != null && hit.rowIndex >= 0) return markRefForRow(hit.rowIndex, columns, rows, identity);
  return null;
}

/** Identity for a single row (scatter-style marks): its encoded field values. */
export function markRefForRow(
  rowIndex: number,
  columns: string[],
  rows: unknown[][],
  identity: (string | null | undefined)[],
): MarkRef | null {
  const row = rows[rowIndex];
  if (!row) return null;
  const fields: [string, string][] = [];
  for (const f of identity) {
    if (!f) continue;
    const ci = columns.indexOf(f);
    if (ci >= 0) fields.push([f, String(row[ci] ?? "")]);
  }
  return fields.length ? normalize(fields) : null;
}

export function sameMark(a: MarkRef | null | undefined, b: MarkRef | null | undefined): boolean {
  if (!a || !b || a.fields.length !== b.fields.length) return false;
  return a.fields.every(([k, v], i) => b.fields[i]![0] === k && b.fields[i]![1] === v);
}

/** Re-find a pinned mark among freshly painted hits (topmost wins, like picking). */
export function findHitForMark(
  hits: HitTarget[],
  ref: MarkRef,
  columns: string[],
  rows: unknown[][],
  identity: (string | null | undefined)[],
): HitTarget | null {
  for (let i = hits.length - 1; i >= 0; i--) {
    if (sameMark(markRefForHit(hits[i]!, columns, rows, identity), ref)) return hits[i]!;
  }
  return null;
}

/** Where a callout's leader line meets the mark. */
export function markAnchor(hit: HitTarget): { x: number; y: number } {
  if (hit.shape === "rect") {
    const m = hit.mark ?? hit;
    // Horizontal bars: anchor at the value end; columns: at the top.
    return m.w > m.h ? { x: m.x + m.w, y: m.y + m.h / 2 } : { x: m.x + m.w / 2, y: m.y };
  }
  if (hit.shape === "circle") return { x: hit.cx, y: hit.cy };
  const mid = (hit.a0 + hit.a1) / 2;
  const r = (hit.r0 + hit.r1) / 2;
  return { x: hit.cx + Math.cos(mid) * r, y: hit.cy + Math.sin(mid) * r };
}

export interface MarkFocusInk {
  accent: string;
  bg: string;
  text: string;
  muted: string;
  border: string;
}

function alpha(color: string, a: number): string {
  if (color.startsWith("#") && (color.length === 7 || color.length === 4)) {
    const hex = color.length === 4 ? color.slice(1).split("").map((c) => c + c).join("") : color.slice(1);
    const n = parseInt(hex, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  const m = color.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const [r, g, b] = m[1]!.split(",").map((s) => s.trim());
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  return color;
}

/**
 * Emphasis for one mark. `strength` 1 = pinned / keyboard focus (solid),
 * 0.7 = hover (lighter) so a pinned mark stays the strongest thing on screen.
 */
export function drawMarkFocus(
  ctx: CanvasRenderingContext2D,
  hit: HitTarget,
  style: MarkFocusStyle,
  ink: MarkFocusInk,
  strength = 1,
): void {
  ctx.save();
  ctx.lineJoin = "round";
  const ring = alpha(ink.accent, 0.95 * strength);
  const halo = alpha(ink.accent, 0.22 * strength);
  const cut = alpha(ink.bg, 0.9);
  if (hit.shape === "circle") {
    const r = Math.max(4, hit.r);
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(hit.cx, hit.cy, r + 7, 0, Math.PI * 2);
    ctx.fill();
    // A background-colored cut keeps the ring legible over dense marks.
    ctx.strokeStyle = cut;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(hit.cx, hit.cy, r + 2.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = ring;
    ctx.lineWidth = 2;
    ctx.stroke();
  } else if (hit.shape === "arc") {
    const lift = 4;
    const mid = (hit.a0 + hit.a1) / 2;
    const ox = Math.cos(mid) * lift * strength;
    const oy = Math.sin(mid) * lift * strength;
    ctx.translate(ox, oy);
    ctx.beginPath();
    ctx.arc(hit.cx, hit.cy, hit.r1 + 1, hit.a0, hit.a1);
    if (hit.r0 > 0) ctx.arc(hit.cx, hit.cy, Math.max(0, hit.r0 - 1), hit.a1, hit.a0, true);
    else ctx.lineTo(hit.cx, hit.cy);
    ctx.closePath();
    ctx.fillStyle = halo;
    ctx.fill();
    ctx.strokeStyle = cut;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = ring;
    ctx.lineWidth = 2;
    ctx.stroke();
  } else {
    const { x, y, w, h } = style === "band" ? hit : (hit.mark ?? hit);
    if (style === "band") {
      // Bands (box / violin / area slices) are tall hit regions: wash the band,
      // edge it, and leave the marks inside readable.
      ctx.fillStyle = alpha(ink.accent, 0.1 * strength);
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = alpha(ink.accent, 0.6 * strength);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(x + 0.75, y + 0.75, Math.max(0, w - 1.5), Math.max(0, h - 1.5));
    } else if (style === "cell") {
      ctx.strokeStyle = cut;
      ctx.lineWidth = 4;
      ctx.strokeRect(x + 1.5, y + 1.5, Math.max(0, w - 3), Math.max(0, h - 3));
      ctx.strokeStyle = ring;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1.5, y + 1.5, Math.max(0, w - 3), Math.max(0, h - 3));
    } else {
      // Bars: halo, crisp outline, and an accent cap on the value end.
      ctx.fillStyle = halo;
      ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
      ctx.strokeStyle = cut;
      ctx.lineWidth = 4;
      ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
      ctx.strokeStyle = ring;
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
      ctx.fillStyle = ring;
      if (h >= w) ctx.fillRect(x - 1, y - 3, w + 2, 3);
      else ctx.fillRect(x + w, y - 1, 3, h + 2);
    }
  }
  ctx.restore();
}

export interface CalloutBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MAX_LINES = 6;

/** Readout lines for a pinned mark: “column  value”, trimmed to fit. */
export function calloutLines(columns: string[], row: (string | number | boolean | null)[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < columns.length && out.length < MAX_LINES; i++) {
    const v = row[i];
    if (v == null || v === "") continue;
    out.push([columns[i]!, typeof v === "number" ? (Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 3 })) : String(v)]);
  }
  return out;
}

/**
 * Place a callout near its anchor: prefer up-right, flip to stay inside the
 * frame, and step clear of callouts already placed.
 */
export function placeCallout(
  anchor: { x: number; y: number },
  size: { w: number; h: number },
  frame: { w: number; h: number },
  taken: CalloutBox[] = [],
  gap = 14,
): CalloutBox {
  const candidates = [
    { x: anchor.x + gap, y: anchor.y - size.h - gap },
    { x: anchor.x - size.w - gap, y: anchor.y - size.h - gap },
    { x: anchor.x + gap, y: anchor.y + gap },
    { x: anchor.x - size.w - gap, y: anchor.y + gap },
  ];
  const clamp = (b: { x: number; y: number }): CalloutBox => ({
    x: Math.max(6, Math.min(frame.w - size.w - 6, b.x)),
    y: Math.max(6, Math.min(frame.h - size.h - 6, b.y)),
    w: size.w,
    h: size.h,
  });
  const overlaps = (a: CalloutBox) =>
    taken.some((t) => a.x < t.x + t.w + 4 && a.x + a.w + 4 > t.x && a.y < t.y + t.h + 4 && a.y + a.h + 4 > t.y);
  const inFrame = (b: { x: number; y: number }) => b.x >= 6 && b.y >= 6 && b.x + size.w <= frame.w - 6 && b.y + size.h <= frame.h - 6;
  for (const c of candidates) if (inFrame(c) && !overlaps(clamp(c))) return clamp(c);
  for (const c of candidates) if (!overlaps(clamp(c))) return clamp(c);
  // Crowded: stack below the last callout.
  const last = taken[taken.length - 1];
  return clamp(last ? { x: last.x, y: last.y + last.h + 6 } : candidates[0]!);
}

/** Pinned readout burned into the canvas (exports and shares carry it). */
export function drawPinnedCallout(
  ctx: CanvasRenderingContext2D,
  hit: HitTarget,
  lines: [string, string][],
  frame: { w: number; h: number },
  ink: MarkFocusInk,
  opts: { fontFamily: string; fontSize: number; badge?: string; taken?: CalloutBox[] },
): CalloutBox | null {
  if (!lines.length) return null;
  const fs = Math.max(10, Math.min(15, opts.fontSize));
  const lineH = Math.round(fs * 1.45);
  const padX = 10;
  const padY = 8;
  const maxW = Math.min(280, frame.w * 0.6);
  ctx.save();
  ctx.font = `${fs}px ${opts.fontFamily}`;
  const keyW = Math.min(maxW * 0.45, Math.max(...lines.map(([k]) => ctx.measureText(k).width)));
  ctx.font = `600 ${fs}px ${opts.fontFamily}`;
  const valW = Math.min(maxW - keyW - 12 - padX * 2, Math.max(...lines.map(([, v]) => ctx.measureText(v).width)));
  const badgeW = opts.badge ? fs + 6 : 0;
  const w = Math.ceil(padX * 2 + keyW + 12 + valW + badgeW);
  const h = padY * 2 + lineH * lines.length;
  const anchor = markAnchor(hit);
  const box = placeCallout(anchor, { w, h }, frame, opts.taken);

  // Leader from the mark to the nearest card edge.
  const tx = Math.max(box.x, Math.min(box.x + box.w, anchor.x));
  const ty = Math.max(box.y, Math.min(box.y + box.h, anchor.y));
  ctx.strokeStyle = alpha(ink.accent, 0.85);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(anchor.x, anchor.y);
  ctx.lineTo(tx, ty);
  ctx.stroke();
  ctx.fillStyle = ink.accent;
  ctx.beginPath();
  ctx.arc(anchor.x, anchor.y, 2.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = alpha(ink.bg, 0.96);
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.w, box.h, 8);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = alpha(ink.accent, 0.7);
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textBaseline = "middle";
  let cx = box.x + padX;
  if (opts.badge) {
    ctx.fillStyle = ink.accent;
    ctx.beginPath();
    ctx.arc(cx + fs / 2, box.y + padY + lineH / 2, fs / 2 + 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ink.bg;
    ctx.font = `700 ${Math.round(fs * 0.8)}px ${opts.fontFamily}`;
    ctx.textAlign = "center";
    ctx.fillText(opts.badge, cx + fs / 2, box.y + padY + lineH / 2 + 0.5);
    ctx.textAlign = "left";
    cx += badgeW;
  }
  lines.forEach(([k, v], i) => {
    const y = box.y + padY + lineH * i + lineH / 2;
    ctx.font = `${fs}px ${opts.fontFamily}`;
    ctx.fillStyle = ink.muted;
    ctx.fillText(fitTextEllipsis(ctx, k, keyW), cx, y);
    ctx.font = `600 ${fs}px ${opts.fontFamily}`;
    ctx.fillStyle = ink.text;
    ctx.fillText(fitTextEllipsis(ctx, v, valW), cx + keyW + 12, y);
  });
  ctx.restore();
  return box;
}
