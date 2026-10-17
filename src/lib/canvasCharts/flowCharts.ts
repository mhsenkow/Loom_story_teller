// =================================================================
// Canvas 2D treemap, force bubble, sankey, network and arc-diagram renderers.
// (extracted from ChartView.tsx — LOOM-141 / LOOM-142)
// =================================================================

import { aggregateValues, fieldLabel, pushHit, setLegend, valueTitle } from "./plumbing";
import { formatDataValue } from "../chartAxes";
import { clampTopN } from "../chartFacets";
import { contrastingInk, fitTextEllipsis } from "../chartLayout";
import { sampleContinuous } from "../chartPalettes";
import { type ChartRenderOpts } from "../chartRenderTypes";
import { formatTooltipNumber } from "../chartTooltip";
import { buildFlowGraph, layoutArcDiagram, layoutForceNetwork, strokeArcLink } from "../flowGraphs";
import { type YAggregateOption } from "../recommendations";
import { axisFont, widestText } from "./axisHelpers";
import { DEFAULT_COLORS } from "./shared";
import { chartFont, chartTypeRamp } from "../chartType";

export type TreemapItem = { label: string; value: number; cat: string };
export type TreemapRect = TreemapItem & { x: number; y: number; w: number; h: number };

/** Squarified treemap (Bruls et al.) — tiles stay close to square so labels fit. */
export function squarify(items: TreemapItem[], x: number, y: number, w: number, h: number): TreemapRect[] {
  const out: TreemapRect[] = [];
  const total = items.reduce((s, e) => s + e.value, 0);
  if (total <= 0 || w <= 0 || h <= 0) return out;
  const scale = (w * h) / total;
  const queue = items.map((e) => ({ ...e, area: e.value * scale }));
  let rx = x, ry = y, rw = w, rh = h;
  const worst = (row: { area: number }[], side: number) => {
    const s = row.reduce((a, r) => a + r.area, 0);
    let mx = 0;
    for (const r of row) {
      const ratio = Math.max((side * side * r.area) / (s * s), (s * s) / (side * side * r.area));
      mx = Math.max(mx, ratio);
    }
    return mx;
  };
  while (queue.length) {
    const side = Math.min(rw, rh);
    const row = [queue.shift()!];
    while (queue.length && worst([...row, queue[0]!], side) <= worst(row, side)) row.push(queue.shift()!);
    const rowArea = row.reduce((a, r) => a + r.area, 0);
    const thick = rowArea / side;
    let off = 0;
    for (const r of row) {
      const len = r.area / thick;
      if (rw >= rh) out.push({ label: r.label, value: r.value, cat: r.cat, x: rx, y: ry + off, w: thick, h: len });
      else out.push({ label: r.label, value: r.value, cat: r.cat, x: rx + off, y: ry, w: len, h: thick });
      off += len;
    }
    if (rw >= rh) { rx += thick; rw -= thick; } else { ry += thick; rh -= thick; }
  }
  return out;
}

export function renderFullTreemap(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, ci: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  const palette = opts?.colors ?? DEFAULT_COLORS;
  const ramp = opts?.continuousStops;
  const alpha = opts?.opacity ?? 0.85;
  const fontFamily = opts?.fontFamily ?? "Inter";
  const agg: YAggregateOption = yi < 0 ? "count" : (opts?.yAggregate ?? "sum");

  const groups = new Map<string, { vals: number[]; cat: string }>();
  for (const r of rows) {
    const k = String(r[xi]);
    if (!groups.has(k)) groups.set(k, { vals: [], cat: ci >= 0 ? String(r[ci]) : "" });
    const v = yi >= 0 ? Number(r[yi]) : 1;
    if (!isNaN(v)) groups.get(k)!.vals.push(v);
  }
  const entries = [...groups.entries()]
    .map(([label, g]) => ({ label, value: Math.abs(aggregateValues(g.vals, agg)), cat: g.cat }))
    .filter(e => e.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, opts?.topN != null ? clampTopN(opts.topN) : 40);
  if (entries.length === 0) return;

  const catMap = new Map<string, number>();
  if (ci >= 0 && ci !== xi) for (const e of entries) if (!catMap.has(e.cat)) catMap.set(e.cat, catMap.size);
  // Continuous palette: ramp by nest/color when numeric, else by the measure (views).
  const nestNumeric =
    catMap.size > 0 &&
    entries.every((e) => Number.isFinite(Number(e.cat)));
  const rampByNest = !!ramp && ramp.length >= 2 && nestNumeric;
  const rampByValue = !!ramp && ramp.length >= 2 && catMap.size === 0;
  const rampVals = rampByNest
    ? entries.map((e) => Number(e.cat))
    : rampByValue
      ? entries.map((e) => e.value)
      : [];
  const vMin = rampVals.length ? Math.min(...rampVals) : 0;
  const vMax = rampVals.length ? Math.max(...rampVals) : 1;
  const total = entries.reduce((s, e) => s + e.value, 0);
  const rects = squarify(entries, pad, pad, w - 2 * pad, h - 2 * pad);
  const xName = fieldLabel(opts, xi);
  const vTitle = valueTitle(opts, yi);

  for (const rect of rects) {
    let fill: string;
    if (rampByNest || rampByValue) {
      const raw = rampByNest ? Number(rect.cat) : rect.value;
      const t = vMax > vMin ? (raw - vMin) / (vMax - vMin) : 0.5;
      fill = sampleContinuous(ramp!, t);
    } else if (catMap.size) {
      fill = palette[(catMap.get(rect.cat) ?? 0) % palette.length]!;
    } else {
      fill = palette[0]!;
    }
    ctx.fillStyle = fill;
    ctx.globalAlpha = alpha;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeStyle = opts?.themeBg ?? "#0e0e12";
    ctx.lineWidth = 2;
    ctx.globalAlpha = 1;
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

    if (rect.w > 34 && rect.h > 18) {
      const ink = contrastingInk(fill);
      const fontSize = Math.max(chartTypeRamp(opts?.axisFontSize).mark, Math.min(14, Math.min(rect.w / 5.5, rect.h / 2.2)));
      ctx.fillStyle = ink;
      ctx.font = chartFont(fontSize, fontFamily, 600);
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(fitTextEllipsis(ctx, rect.label, rect.w - 10), rect.x + 5, rect.y + 5);
      if (rect.h > fontSize * 2 + 14) {
        ctx.globalAlpha = 0.85;
        ctx.font = chartFont(Math.max(chartTypeRamp(opts?.axisFontSize).mark, fontSize - 2), fontFamily);
        ctx.fillText(fitTextEllipsis(ctx, formatDataValue(rect.value), rect.w - 10), rect.x + 5, rect.y + 8 + fontSize);
        ctx.globalAlpha = 1;
      }
    }
    pushHit(opts, {
      shape: "rect", x: rect.x, y: rect.y, w: rect.w, h: rect.h,
      match: [[xi, rect.label]],
      summary: { columns: [xName, vTitle, "Share"], row: [rect.label, formatTooltipNumber(rect.value), `${((rect.value / total) * 100).toFixed(1)}%`] },
    });
  }
  ctx.textBaseline = "alphabetic";
  ctx.globalAlpha = 1;
  setLegend(opts, [...catMap.entries()].map(([label, i]) => ({ label, color: palette[i % palette.length]! })));
}

// --- Force Bubble (packed circles) ---

export function renderFullForceBubble(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, ci: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  const palette = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.8;
  const fontFamily = opts?.fontFamily ?? "Inter";
  const agg: YAggregateOption = yi < 0 ? "count" : (opts?.yAggregate ?? "sum");

  const groups = new Map<string, { vals: number[]; cat: string }>();
  for (const r of rows) {
    const k = String(r[xi]);
    if (!groups.has(k)) groups.set(k, { vals: [], cat: ci >= 0 ? String(r[ci]) : "" });
    const v = yi >= 0 ? Number(r[yi]) : 1;
    if (!isNaN(v)) groups.get(k)!.vals.push(v);
  }

  const entries = [...groups.entries()]
    .map(([label, g]) => ({ label, value: Math.abs(aggregateValues(g.vals, agg)), cat: g.cat }))
    .filter(e => e.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, opts?.topN != null ? clampTopN(opts.topN) : 50);
  if (entries.length === 0) return;

  const catMap = new Map<string, number>();
  if (ci >= 0 && ci !== xi) for (const e of entries) if (!catMap.has(e.cat)) catMap.set(e.cat, catMap.size);

  // Area-true radii scaled so the pack fills ~55% of the plot
  const plotCx = w / 2;
  const plotCy = pad + (h - 2 * pad) / 2;
  const plotArea = Math.max(1, (w - 2 * pad) * (h - 2 * pad));
  const total = entries.reduce((s, e) => s + e.value, 0);
  const k = Math.sqrt((plotArea * 0.55) / (Math.PI * total));

  type Circle = { x: number; y: number; r: number; label: string; cat: string; value: number };
  // Deterministic golden-angle seed so the layout doesn't jump between redraws
  const circles: Circle[] = entries.map((e, i) => {
    const a = i * 2.39996;
    const d = Math.sqrt(i) * 6;
    return { x: plotCx + Math.cos(a) * d, y: plotCy + Math.sin(a) * d, r: Math.max(4, Math.sqrt(e.value) * k), label: e.label, cat: e.cat, value: e.value };
  });

  for (let iter = 0; iter < 160; iter++) {
    for (let i = 0; i < circles.length; i++) {
      const a = circles[i]!;
      a.x += (plotCx - a.x) * 0.02;
      a.y += (plotCy - a.y) * 0.02;
      for (let j = i + 1; j < circles.length; j++) {
        const b = circles[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const minDist = a.r + b.r + 2;
        if (dist < minDist) {
          const overlap = (minDist - dist) / 2;
          const nx = dx / dist;
          const ny = dy / dist;
          a.x -= nx * overlap;
          a.y -= ny * overlap;
          b.x += nx * overlap;
          b.y += ny * overlap;
        }
      }
      a.x = Math.min(w - pad - a.r, Math.max(pad + a.r, a.x));
      a.y = Math.min(h - pad - a.r, Math.max(pad + a.r, a.y));
    }
  }

  const xName = fieldLabel(opts, xi);
  const vTitle = valueTitle(opts, yi);
  for (const c of circles) {
    const fill = catMap.size ? palette[(catMap.get(c.cat) ?? 0) % palette.length]! : palette[0]!;
    ctx.fillStyle = fill;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = opts?.themeBg ?? "#0e0e12";
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (c.r > 16) {
      const fs = Math.max(chartTypeRamp(opts?.axisFontSize).mark, Math.min(14, c.r * 0.36));
      ctx.fillStyle = contrastingInk(fill);
      ctx.font = chartFont(fs, fontFamily, 600);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const showValue = c.r > fs * 2.4;
      ctx.fillText(fitTextEllipsis(ctx, c.label, c.r * 1.7), c.x, showValue ? c.y - fs * 0.55 : c.y);
      if (showValue) {
        ctx.globalAlpha = 0.85;
        ctx.font = chartFont(Math.max(chartTypeRamp(opts?.axisFontSize).mark, fs - 2), fontFamily);
        ctx.fillText(formatDataValue(c.value), c.x, c.y + fs * 0.65);
        ctx.globalAlpha = 1;
      }
    }
    pushHit(opts, {
      shape: "circle", cx: c.x, cy: c.y, r: c.r,
      match: [[xi, c.label]],
      summary: { columns: [xName, vTitle], row: [c.label, formatTooltipNumber(c.value)] },
    });
  }
  ctx.textBaseline = "alphabetic";
  ctx.globalAlpha = 1;
  setLegend(opts, [...catMap.entries()].map(([label, i]) => ({ label, color: palette[i % palette.length]! })));
}

// --- Sankey ---

export function renderFullSankey(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, ci: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  const palette = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.4;

  const targetIdx = ci >= 0 ? ci : yi;
  if (targetIdx < 0) return;

  const flows = new Map<string, number>();
  const sourceTotals = new Map<string, number>();
  const targetTotals = new Map<string, number>();
  for (const r of rows) {
    const src = String(r[xi]);
    const tgt = String(r[targetIdx]);
    const v = yi >= 0 && targetIdx !== yi ? Number(r[yi]) : 1;
    const val = isNaN(v) ? 1 : Math.abs(v);
    const key = `${src}\0${tgt}`;
    flows.set(key, (flows.get(key) ?? 0) + val);
    sourceTotals.set(src, (sourceTotals.get(src) ?? 0) + val);
    targetTotals.set(tgt, (targetTotals.get(tgt) ?? 0) + val);
  }
  // Largest 15 nodes per side; everything else is dropped from both ends
  const sortedSources = [...sourceTotals.keys()].sort((a, b) => sourceTotals.get(b)! - sourceTotals.get(a)!).slice(0, 15);
  const sortedTargets = [...targetTotals.keys()].sort((a, b) => targetTotals.get(b)! - targetTotals.get(a)!).slice(0, 15);
  if (sortedSources.length === 0 || sortedTargets.length === 0) return;
  const srcSet = new Set(sortedSources);
  const tgtSet = new Set(sortedTargets);
  const shownFlows = [...flows.entries()].filter(([k]) => {
    const [s, t] = k.split("\0");
    return srcSet.has(s!) && tgtSet.has(t!);
  });
  const srcShown = new Map<string, number>();
  const tgtShown = new Map<string, number>();
  for (const [k, v] of shownFlows) {
    const [s, t] = k.split("\0");
    srcShown.set(s!, (srcShown.get(s!) ?? 0) + v);
    tgtShown.set(t!, (tgtShown.get(t!) ?? 0) + v);
  }
  const grandTotal = [...srcShown.values()].reduce((s, v) => s + v, 0) || 1;

  const labelFont = axisFont(opts);
  const nodeW = 12;
  const gutterL = Math.min((w - 2 * pad) * 0.24, widestText(ctx, sortedSources, labelFont) + 10);
  const gutterR = Math.min((w - 2 * pad) * 0.24, widestText(ctx, sortedTargets, labelFont) + 10);
  const leftX = pad + gutterL;
  const rightX = w - pad - gutterR - nodeW;
  const top = pad + 4;
  const plotH = Math.max(40, h - 2 * pad - 8);
  const nodeGap = Math.min(6, plotH * 0.02);

  const layout = (keys: string[], totals: Map<string, number>) => {
    const gaps = nodeGap * (keys.length - 1);
    const scale = (plotH - gaps) / grandTotal;
    const out = new Map<string, { y: number; h: number }>();
    let cursor = top;
    for (const k of keys) {
      const nh = Math.max(2, (totals.get(k) ?? 0) * scale);
      out.set(k, { y: cursor, h: nh });
      cursor += nh + nodeGap;
    }
    return { out, scale };
  };
  const { out: sourceY, scale: srcScale } = layout(sortedSources, srcShown);
  const { out: targetY, scale: tgtScale } = layout(sortedTargets, tgtShown);

  const srcOffsets = new Map<string, number>();
  const tgtOffsets = new Map<string, number>();
  const srcColor = (s: string) => palette[sortedSources.indexOf(s) % palette.length]!;

  for (const [key, val] of shownFlows.sort((a, b) => b[1] - a[1])) {
    const [src, tgt] = key.split("\0");
    const sRect = sourceY.get(src!);
    const tRect = targetY.get(tgt!);
    if (!sRect || !tRect) continue;
    const sOff = srcOffsets.get(src!) ?? 0;
    const tOff = tgtOffsets.get(tgt!) ?? 0;
    const bandH = Math.max(1, val * srcScale);
    const bandHT = Math.max(1, val * tgtScale);
    ctx.fillStyle = srcColor(src!);
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    const sy1 = sRect.y + sOff;
    const sy2 = sy1 + bandH;
    const ty1 = tRect.y + tOff;
    const ty2 = ty1 + bandHT;
    const mx = (leftX + nodeW + rightX) / 2;
    ctx.moveTo(leftX + nodeW, sy1);
    ctx.bezierCurveTo(mx, sy1, mx, ty1, rightX, ty1);
    ctx.lineTo(rightX, ty2);
    ctx.bezierCurveTo(mx, ty2, mx, sy2, leftX + nodeW, sy2);
    ctx.closePath();
    ctx.fill();
    srcOffsets.set(src!, sOff + bandH);
    tgtOffsets.set(tgt!, tOff + bandHT);
  }

  const sName = fieldLabel(opts, xi, "source");
  const tName = fieldLabel(opts, targetIdx, "target");
  ctx.globalAlpha = 1;
  ctx.font = labelFont;
  ctx.textBaseline = "middle";
  for (const s of sortedSources) {
    const r = sourceY.get(s)!;
    ctx.fillStyle = srcColor(s);
    ctx.fillRect(leftX, r.y, nodeW, r.h);
    ctx.fillStyle = opts?.themeText ?? opts?.axisLabelColor ?? "#8b8b98";
    ctx.textAlign = "right";
    ctx.fillText(fitTextEllipsis(ctx, s, gutterL - 8), leftX - 5, r.y + r.h / 2);
    pushHit(opts, {
      shape: "rect", x: leftX, y: r.y, w: nodeW, h: Math.max(4, r.h),
      match: [[xi, s]],
      summary: { columns: [sName, "Total"], row: [s, formatTooltipNumber(srcShown.get(s) ?? 0)] },
    });
  }
  for (const t of sortedTargets) {
    const r = targetY.get(t)!;
    ctx.fillStyle = opts?.axisLabelColor ?? "#6b6b78";
    ctx.fillRect(rightX, r.y, nodeW, r.h);
    ctx.fillStyle = opts?.themeText ?? opts?.axisLabelColor ?? "#8b8b98";
    ctx.textAlign = "left";
    ctx.fillText(fitTextEllipsis(ctx, t, gutterR - 8), rightX + nodeW + 5, r.y + r.h / 2);
    pushHit(opts, {
      shape: "rect", x: rightX, y: r.y, w: nodeW, h: Math.max(4, r.h),
      match: [[targetIdx, t]],
      summary: { columns: [tName, "Total"], row: [t, formatTooltipNumber(tgtShown.get(t) ?? 0)] },
    });
  }
  ctx.textBaseline = "alphabetic";
  setLegend(opts, []);
}

// --- Network (force-directed node-link) ---

export function renderFullNetwork(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, ci: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  const palette = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.85;
  const fontFamily = opts?.fontFamily ?? "Inter";
  const targetIdx = ci >= 0 ? ci : -1;
  if (targetIdx < 0) return;
  const weightIdx = yi >= 0 && yi !== targetIdx ? yi : -1;
  const graph = buildFlowGraph(rows, xi, targetIdx, weightIdx);
  if (!graph) return;
  const { nodes, edges } = layoutForceNetwork(graph, w, h, pad);

  const nodeColor = new Map<string, string>();
  let colorI = 0;
  for (const n of nodes) {
    if (!nodeColor.has(n.id)) nodeColor.set(n.id, palette[colorI++ % palette.length]!);
  }

  // Edges under nodes
  for (const e of edges) {
    const col = nodeColor.get(e.source) ?? palette[0]!;
    ctx.strokeStyle = col;
    ctx.globalAlpha = Math.min(0.55, alpha * 0.55);
    ctx.lineWidth = e.width;
    ctx.lineCap = opts?.lineCap ?? "round";
    ctx.beginPath();
    ctx.moveTo(e.x1, e.y1);
    ctx.lineTo(e.x2, e.y2);
    ctx.stroke();
  }

  const sName = fieldLabel(opts, xi, "source");
  const tName = fieldLabel(opts, targetIdx, "target");
  const wTitle = weightIdx >= 0 ? fieldLabel(opts, weightIdx, "weight") : "Links";
  ctx.globalAlpha = 1;
  for (const n of nodes) {
    const fill = nodeColor.get(n.id) ?? palette[0]!;
    ctx.fillStyle = fill;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = opts?.themeBg ?? "#0e0e12";
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (n.r > 10) {
      const fs = Math.max(chartTypeRamp(opts?.axisFontSize).mark, Math.min(12, n.r * 0.45));
      ctx.fillStyle = contrastingInk(fill);
      ctx.font = chartFont(fs, fontFamily, 600);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(fitTextEllipsis(ctx, n.id, n.r * 1.8), n.x, n.y);
    } else {
      ctx.fillStyle = opts?.themeMuted ?? "#8b8b98";
      ctx.font = chartFont(chartTypeRamp(opts?.axisFontSize).mark, fontFamily, 500);
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(fitTextEllipsis(ctx, n.id, 72), n.x + n.r + 4, n.y);
    }

    pushHit(opts, {
      shape: "circle", cx: n.x, cy: n.y, r: Math.max(6, n.r),
      match: [[xi, n.id]],
      summary: {
        columns: [sName === tName ? "Node" : `${sName} / ${tName}`, wTitle],
        row: [n.id, formatTooltipNumber(n.weight)],
      },
    });
  }
  ctx.textBaseline = "alphabetic";
  ctx.globalAlpha = 1;
  setLegend(opts, nodes.slice(0, 8).map((n) => ({ label: n.id, color: nodeColor.get(n.id) ?? palette[0]! })));
}

// --- Arc diagram ---

export function renderFullArcDiagram(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, ci: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  const palette = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.75;
  const fontFamily = opts?.fontFamily ?? "Inter";
  const targetIdx = ci >= 0 ? ci : -1;
  if (targetIdx < 0) return;
  const weightIdx = yi >= 0 && yi !== targetIdx ? yi : -1;
  const graph = buildFlowGraph(rows, xi, targetIdx, weightIdx, { maxNodes: 28, maxEdges: 60 });
  if (!graph) return;
  const { nodes, edges } = layoutArcDiagram(graph, w, h, pad);

  const nodeColor = new Map<string, string>();
  let colorI = 0;
  for (const n of nodes) {
    if (!nodeColor.has(n.id)) nodeColor.set(n.id, palette[colorI++ % palette.length]!);
  }

  for (const e of edges) {
    ctx.strokeStyle = nodeColor.get(e.source) ?? palette[0]!;
    ctx.globalAlpha = Math.min(0.5, alpha * 0.6);
    ctx.lineWidth = e.width;
    ctx.lineCap = opts?.lineCap ?? "round";
    strokeArcLink(ctx, e.x1, e.y1, e.x2, e.y2);
  }

  const sName = fieldLabel(opts, xi, "source");
  const tName = fieldLabel(opts, targetIdx, "target");
  const wTitle = weightIdx >= 0 ? fieldLabel(opts, weightIdx, "weight") : "Links";
  ctx.globalAlpha = 1;
  for (const n of nodes) {
    const fill = nodeColor.get(n.id) ?? palette[0]!;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = opts?.themeBg ?? "#0e0e12";
    ctx.lineWidth = 1.25;
    ctx.stroke();

    ctx.save();
    ctx.translate(n.x, n.y + n.r + 3);
    ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = opts?.themeMuted ?? "#8b8b98";
    ctx.font = chartFont(chartTypeRamp(opts?.axisFontSize).mark, fontFamily, 500);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(fitTextEllipsis(ctx, n.id, 56), 0, 0);
    ctx.restore();

    pushHit(opts, {
      shape: "circle", cx: n.x, cy: n.y, r: Math.max(6, n.r + 2),
      match: [[xi, n.id]],
      summary: {
        columns: [sName === tName ? "Node" : `${sName} / ${tName}`, wTitle],
        row: [n.id, formatTooltipNumber(n.weight)],
      },
    });
  }
  ctx.textBaseline = "alphabetic";
  setLegend(opts, nodes.slice(0, 8).map((n) => ({ label: n.id, color: nodeColor.get(n.id) ?? palette[0]! })));
}

// --- Pareto (ranked bars + cumulative %) ---
