/**
 * LOOM-543 — every ChartKind declares how its portable Vega-Lite spec relates
 * to the Canvas/WebGPU output, and the declaration matches createChartRec.
 */
import { describe, expect, it } from "vitest";
import { CHART_KIND_OPTIONS, createChartRec, type ChartKind } from "../recommendations";
import { CHART_SPEC_PARITY, chartSpecParity, isNativeVegaKind } from "../chartSpecParity";
import { svgExportMode } from "../chartSupport";
import type { ColumnInfo } from "../store";

const cols: ColumnInfo[] = [
  { name: "region", data_type: "VARCHAR", null_count: 0, distinct_count: 5, min_value: null, max_value: null },
  { name: "cat2", data_type: "VARCHAR", null_count: 0, distinct_count: 4, min_value: null, max_value: null },
  { name: "day", data_type: "DATE", null_count: 0, distinct_count: 30, min_value: "2024-01-01", max_value: "2024-01-30" },
  { name: "sales", data_type: "DOUBLE", null_count: 0, distinct_count: 40, min_value: "1", max_value: "90" },
  { name: "units", data_type: "DOUBLE", null_count: 0, distinct_count: 40, min_value: "1", max_value: "50" },
  { name: "lat", data_type: "DOUBLE", null_count: 0, distinct_count: 40, min_value: "-60", max_value: "60" },
  { name: "lon", data_type: "DOUBLE", null_count: 0, distinct_count: 40, min_value: "-120", max_value: "120" },
];

const KINDS = CHART_KIND_OPTIONS.map((o) => o.value);

function buildRec(kind: ChartKind) {
  return (
    createChartRec(kind, cols, "region", "sales", "cat2", "t.csv") ??
    createChartRec(kind, cols, "units", "sales", "region", "t.csv")
  );
}

function markType(spec: Record<string, unknown>): string | null {
  const m = spec.mark;
  if (typeof m === "string") return m;
  if (m && typeof m === "object" && typeof (m as { type?: unknown }).type === "string") {
    return (m as { type: string }).type;
  }
  return null;
}

describe("chart spec parity registry", () => {
  it("has exactly one entry per selectable ChartKind", () => {
    expect(Object.keys(CHART_SPEC_PARITY).sort()).toEqual([...new Set(KINDS)].sort());
  });

  it("requires a limitation for every non-native kind", () => {
    for (const kind of KINDS) {
      const p = chartSpecParity(kind);
      if (p.portable === "native") {
        expect(p.limitation, kind).toBeNull();
        expect(p.vegaMark, kind).toBeTruthy();
      } else {
        expect(p.limitation?.length ?? 0, `${kind} needs a limitation`).toBeGreaterThan(15);
      }
    }
  });

  it.each(KINDS)("%s: registry matches the spec createChartRec builds", (kind) => {
    const rec = buildRec(kind);
    expect(rec, `createChartRec(${kind}) returned null on the reference schema`).not.toBeNull();
    const spec = rec!.spec as Record<string, unknown>;
    const parity = chartSpecParity(kind);

    if (parity.portable === "none") {
      expect(Object.keys(spec)).toEqual([]);
      expect(svgExportMode(spec)).toBe("off");
      return;
    }

    expect(markType(spec), `${kind} mark`).toBe(parity.vegaMark);
    expect(spec.encoding && typeof spec.encoding === "object").toBe(true);
    expect(svgExportMode(spec)).toBe("approx");
    expect(String(spec.$schema)).toContain("vega-lite");
  });

  it("native kinds keep their x/y (or theta) encodings round-trippable", () => {
    for (const kind of KINDS.filter(isNativeVegaKind)) {
      const spec = buildRec(kind)!.spec as { encoding: Record<string, { field?: string }> };
      const enc = spec.encoding;
      const hasPosition = Boolean(enc.x || enc.y || enc.theta);
      expect(hasPosition, `${kind} encoding channels: ${Object.keys(enc).join(",")}`).toBe(true);
    }
  });
});
