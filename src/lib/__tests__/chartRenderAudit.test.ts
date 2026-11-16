/** Full catalog regression: real renderer geometry at phone, tablet and desktop sizes. */
import { beforeAll, describe, expect, it } from "vitest";
import { auditKinds, auditRows, drawAuditChart, prepareChartAudit } from "./fixtures/chartAudit";
import type { ChartRenderOpts } from "../chartRenderTypes";

beforeAll(async () => {
  if (!globalThis.Path2D) globalThis.Path2D = class {} as typeof Path2D;
  await prepareChartAudit();
});

function recordingContext() {
  let depth = 0;
  let paints = 0;
  const faults: string[] = [];
  const state: Record<string, unknown> = { font: "12px sans-serif" };
  const geometry = new Set(["moveTo", "lineTo", "arc", "ellipse", "arcTo", "rect", "roundRect", "fillRect", "strokeRect", "translate", "rotate", "scale", "bezierCurveTo", "quadraticCurveTo"]);
  const ctx = new Proxy(state, {
    get(t, key: string) {
      if (key in t) return t[key];
      if (key === "measureText") return (s: string) => ({ width: String(s).length * (Number(String(t.font).match(/([\d.]+)px/)?.[1]) || 12) * 0.55 });
      if (key === "createLinearGradient" || key === "createRadialGradient") return () => ({ addColorStop() {} });
      if (key === "save") return () => { depth++; };
      if (key === "restore") return () => { depth--; if (depth < 0) faults.push("unmatched restore"); };
      return (...args: unknown[]) => {
        if (geometry.has(key)) {
          if (args.some(v => typeof v === "number" && !Number.isFinite(v))) faults.push(`${key}(${args.join(",")})`);
          if ((key === "arc" || key === "ellipse") && Number(args[2]) < 0) faults.push(`negative radius: ${key}`);
          if (key === "ellipse" && Number(args[3]) < 0) faults.push("negative ellipse radius");
        }
        if (["fill", "stroke", "fillRect", "fillText"].includes(key)) paints++;
        if (key === "fillText" && /^(NaN|[+-]?Infinity)(%|$)/.test(String(args[0]))) faults.push(`invalid label: ${args[0]}`);
      };
    },
    set(t, key: string, value) {
      if (typeof value === "number" && !Number.isFinite(value)) faults.push(`invalid ${key}: ${value}`);
      t[key] = value; return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, faults, depth: () => depth, paints: () => paints };
}

const cases = {
  ordinary: auditRows,
  singleton: auditRows.slice(0, 1),
  zero: auditRows.map(r => r.map(v => typeof v === "number" ? 0 : v)),
  signed: auditRows.map((r, i) => r.map(v => typeof v === "number" && i % 2 ? -v : v)),
  missing: auditRows.map((r, i) => r.map(v => typeof v === "number" ? [null, "", true, Infinity, "bad", v][i % 6] : v)),
  empty: [],
};

describe.each([[320, 240], [640, 420], [1100, 680]])("chart catalog at %i × %i", (w, h) => {
  it.each(auditKinds)("$value has finite geometry and balanced canvas state", ({ value: kind }) => {
    for (const [name, rows] of Object.entries(cases)) {
      const rec = recordingContext();
      const opts = drawAuditChart(kind, rec.ctx, w, h, rows);
      expect(rec.faults, `${kind}: ${name}`).toEqual([]);
      expect(rec.depth(), `${kind}: ${name} canvas save/restore`).toBe(0);
      if (name === "ordinary") expect(rec.paints(), kind).toBeGreaterThan(0);
      for (const hit of opts.hits ?? []) {
        for (const [key, v] of Object.entries(hit)) {
          if (typeof v === "number") expect(Number.isFinite(v), `${kind}: ${name} hit.${key}`).toBe(true);
        }
        if (hit.shape === "rect") { expect(hit.w).toBeGreaterThanOrEqual(0); expect(hit.h).toBeGreaterThanOrEqual(0); }
      }
    }
  });
});

const presentations: { name: string; w: number; h: number; opts: Partial<ChartRenderOpts>; rows?: unknown[][] }[] = [
  { name: "dark theme", w: 390, h: 320, opts: { themeBg: "#15171c", themeText: "#f0f2f5", themeMuted: "#a4acba", themeBorder: "#424957", axisLabelColor: "#a4acba" } },
  { name: "large text", w: 320, h: 240, opts: { axisFontSize: 16, showDataLabels: true } },
  { name: "thumbnail", w: 180, h: 120, opts: { mini: true } },
  { name: "reversed layout", w: 390, h: 320, opts: { layoutDirection: "left" } },
  { name: "dense categories", w: 640, h: 420, opts: { topN: 30 }, rows: Array.from({ length: 240 }, (_, i) => auditRows[i % auditRows.length]!.map((v, c) => c === 0 ? `Category ${i}: a descriptive label with extra context` : c === 1 ? `Series ${i % 20}` : v)) },
];

describe.each(presentations)("catalog presentation: $name", ({ w, h, opts, rows }) => {
  it.each(auditKinds)("$value renders without corrupting canvas state", ({ value: kind }) => {
    const rec = recordingContext();
    drawAuditChart(kind, rec.ctx, w, h, rows ?? auditRows, opts);
    expect(rec.faults).toEqual([]);
    expect(rec.depth()).toBe(0);
    expect(rec.paints()).toBeGreaterThan(0);
  });
});
