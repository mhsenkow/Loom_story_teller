// =================================================================
// Sunburst canvas renderer (extracted from ChartView — LOOM-142 / LOOM-118)
// =================================================================

import { contrastingInk, fitTextEllipsis, blendToward, isLightHex } from "../chartLayout";
import { formatDataValue } from "../chartAxes";
import { formatTooltipNumber } from "../chartTooltip";
import type { YAggregateOption } from "../recommendations";
import { clampTopN } from "../chartFacets";
import type { ChartRenderOpts } from "../chartRenderTypes";
import { aggregateValues, fieldLabel, pushHit, setLegend, valueTitle } from "./plumbing";
import { chartFont, chartTypeRamp } from "../chartType";

const DEFAULT_COLORS = [
  "#6c5ce7", "#00d68f", "#ff6b6b", "#ffd93d", "#00b4d8", "#e67e5a", "#a29bfe", "#74b9ff",
];

export function renderFullSunburst(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  xi: number,
  yi: number,
  ci: number,
  w: number,
  h: number,
  pad: number,
  opts?: ChartRenderOpts,
) {
  const palette = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.85;
  const fontFamily = opts?.fontFamily ?? "Inter";
  const agg: YAggregateOption = yi < 0 ? "count" : (opts?.yAggregate ?? "sum");

  type InnerNode = { vals: number[] };
  const outerGroups = new Map<string, Map<string, InnerNode>>();
  for (const r of rows) {
    const outer = String(r[xi]);
    const inner = ci >= 0 ? String(r[ci]) : "__all__";
    if (!outerGroups.has(outer)) outerGroups.set(outer, new Map());
    const innerMap = outerGroups.get(outer)!;
    if (!innerMap.has(inner)) innerMap.set(inner, { vals: [] });
    const node = innerMap.get(inner)!;
    if (yi < 0) node.vals.push(1);
    else {
      const v = Number(r[yi]);
      if (!isNaN(v)) node.vals.push(v);
    }
  }

  const outerEntries = [...outerGroups.entries()]
    .map(([label, innerMap]) => {
      const outerVals = [...innerMap.values()].flatMap((n) => n.vals);
      const children = [...innerMap.entries()]
        .map(([k, n]) => ({
          label: k,
          value: Math.abs(aggregateValues(n.vals, agg)),
        }))
        .filter((c) => c.value > 0 && (ci >= 0 ? c.label !== "__all__" : true));
      return {
        label,
        total: Math.abs(aggregateValues(outerVals, agg)),
        children,
      };
    })
    .filter((e) => e.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, opts?.topN != null ? clampTopN(opts.topN) : 20);
  if (outerEntries.length === 0) return;

  const grandTotal = outerEntries.reduce((s, e) => s + e.total, 0);
  const cx = w / 2;
  const cy = pad + (h - 2 * pad) / 2;
  const outerR = Math.max(24, Math.min(w - 2 * pad, h - 2 * pad) / 2 - 4);
  const innerR = outerR * 0.36;
  const hasInner = ci >= 0 && outerEntries.some((e) => e.children.length > 1);
  const midR = hasInner ? outerR * 0.68 : outerR;
  const xName = fieldLabel(opts, xi);
  const cName = fieldLabel(opts, ci);
  const vTitle = valueTitle(opts, yi);
  const share = (v: number) => `${((v / grandTotal) * 100).toFixed(1)}%`;

  const wedgeLabel = (text: string, a0: number, sweep: number, r0: number, r1: number, fill: string) => {
    const rm = (r0 + r1) / 2;
    const arcLen = sweep * rm;
    const depth = r1 - r0;
    const fs = Math.max(chartTypeRamp(opts?.axisFontSize).mark, Math.min(13, depth * 0.34));
    if (arcLen < fs * 2.2 || depth < fs + 6) return;
    ctx.font = chartFont(fs, fontFamily);
    const maxW = Math.min(depth - 6, arcLen * 1.2);
    const t = fitTextEllipsis(ctx, text, Math.max(maxW, arcLen - 6));
    if (t === "…") return;
    const mid = a0 + sweep / 2;
    ctx.fillStyle = contrastingInk(fill);
    ctx.globalAlpha = 0.95;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(t, cx + Math.cos(mid) * rm, cy + Math.sin(mid) * rm);
    ctx.globalAlpha = 1;
  };

  let angle = -Math.PI / 2;
  outerEntries.forEach((entry, ei) => {
    const sweep = (entry.total / grandTotal) * Math.PI * 2;
    const fill = palette[ei % palette.length]!;
    ctx.fillStyle = fill;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(cx, cy, midR, angle, angle + sweep);
    ctx.arc(cx, cy, innerR, angle + sweep, angle, true);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = opts?.themeBg ?? "#0e0e12";
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 1;
    ctx.stroke();
    wedgeLabel(entry.label, angle, sweep, innerR, midR, fill);
    pushHit(opts, {
      shape: "arc",
      cx,
      cy,
      r0: innerR,
      r1: midR,
      a0: angle,
      a1: angle + sweep,
      match: [[xi, entry.label]],
      summary: { columns: [xName, vTitle, "Share"], row: [entry.label, formatTooltipNumber(entry.total), share(entry.total)] },
    });

    if (hasInner) {
      let childAngle = angle;
      entry.children.sort((a, b) => b.value - a.value);
      for (const child of entry.children) {
        const childSweep = (child.value / entry.total) * sweep;
        ctx.fillStyle = fill;
        ctx.globalAlpha = alpha * 0.6;
        ctx.beginPath();
        ctx.arc(cx, cy, outerR, childAngle, childAngle + childSweep);
        ctx.arc(cx, cy, midR, childAngle + childSweep, childAngle, true);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = opts?.themeBg ?? "#0e0e12";
        ctx.lineWidth = 1;
        ctx.globalAlpha = 1;
        ctx.stroke();
        wedgeLabel(
          child.label,
          childAngle,
          childSweep,
          midR,
          outerR,
          blendToward(fill, 0.25, isLightHex(opts?.themeBg ?? "#000000") ? "white" : "black"),
        );
        pushHit(opts, {
          shape: "arc",
          cx,
          cy,
          r0: midR,
          r1: outerR,
          a0: childAngle,
          a1: childAngle + childSweep,
          match: [
            [xi, entry.label],
            [ci, child.label],
          ],
          summary: {
            columns: [xName, cName, vTitle, "Share"],
            row: [entry.label, child.label, formatTooltipNumber(child.value), share(child.value)],
          },
        });
        childAngle += childSweep;
      }
    }

    angle += sweep;
  });

  ctx.globalAlpha = 1;
  ctx.fillStyle = opts?.themeText ?? "#e8e8ec";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = chartFont(Math.max(chartTypeRamp(opts?.axisFontSize).titleCompact, Math.min(20, innerR * 0.36)), fontFamily, 600);
  ctx.fillText(formatDataValue(grandTotal), cx, cy - innerR * 0.08);
  ctx.fillStyle = opts?.axisLabelColor ?? "#6b6b78";
  ctx.font = chartFont(chartTypeRamp(opts?.axisFontSize).mark, fontFamily);
  ctx.fillText("total", cx, cy + innerR * 0.3);
  ctx.textBaseline = "alphabetic";
  setLegend(opts, []);
}
