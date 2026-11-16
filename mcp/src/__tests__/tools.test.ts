import { describe, expect, it } from "vitest";
import { buildChartResult, recommendChartsResult } from "../tools";

const CSV = [
  "region,start,finish,units",
  "North,10,14,3",
  "South,8,12,5",
  "East,11,9,2",
  "West,7,15,6",
  "North,12,16,4",
  "South,9,11,1",
].join("\n");

type Chart = {
  xField: string;
  yField: string | null;
  sizeField: string | null;
  renderable: boolean;
  spec: { data?: { values: Record<string, unknown>[] } };
};

const chartOf = (r: ReturnType<typeof buildChartResult>) =>
  (r.structuredContent as { ok: boolean; chart: Chart }).chart;

const isErr = (r: ReturnType<typeof buildChartResult>) => (r as { isError?: boolean }).isError;

describe("mcp build_chart", () => {
  it("builds a dumbbell without sizeField by auto-picking the end column", () => {
    const r = buildChartResult({ csv: CSV, kind: "dumbbell", xField: "region", yField: "start" });
    expect(isErr(r)).toBeUndefined();
    expect((r.structuredContent as { ok: boolean }).ok).toBe(true);
    expect(chartOf(r).sizeField).not.toBeNull();
  });

  it("auto-picks bubble size when omitted and keeps an explicit null cleared", () => {
    const auto = buildChartResult({ csv: CSV, kind: "bubble", xField: "start", yField: "finish" });
    expect(chartOf(auto).sizeField).toBe("units");
    const cleared = buildChartResult({ csv: CSV, kind: "bubble", xField: "start", yField: "finish", sizeField: null });
    expect(chartOf(cleared).sizeField).toBeNull();
  });

  it("rejects unknown fields as a tool error listing the columns", () => {
    const r = buildChartResult({ csv: CSV, kind: "bar", xField: "regoin", yField: "units" });
    expect(isErr(r)).toBe(true);
    expect(r.content[0]!.text).toContain("regoin");
    expect(r.content[0]!.text).toContain("region, start, finish, units");
  });

  it("resolves a case-only mismatch to the real column name", () => {
    const r = buildChartResult({ csv: CSV, kind: "bar", xField: "Region", yField: "UNITS" });
    expect(isErr(r)).toBeUndefined();
    expect(chartOf(r).xField).toBe("region");
    expect(chartOf(r).yField).toBe("units");
  });

  it("flags unsupported kinds as tool errors", () => {
    const r = buildChartResult({ csv: "label\na\nb", kind: "scatter", xField: "label" });
    expect(isErr(r)).toBe(true);
  });

  it("returns a standalone spec with inline sample rows", () => {
    const chart = chartOf(buildChartResult({ csv: CSV, kind: "bar", xField: "region", yField: "units" }));
    expect(chart.renderable).toBe(true);
    expect(chart.spec.data?.values).toHaveLength(6);
    expect(chart.spec.data?.values[0]).toMatchObject({ region: "North", units: 3 });
  });

  it("marks schema-only builds as not renderable (no rows to inline)", () => {
    const chart = chartOf(
      buildChartResult({
        columns: [
          { name: "region", data_type: "VARCHAR" },
          { name: "units", data_type: "INTEGER" },
        ],
        kind: "bar",
        xField: "region",
        yField: "units",
      }),
    );
    expect(chart.renderable).toBe(false);
    expect(chart.spec.data).toBeUndefined();
  });

  it("keeps a __proto__ column as a plain data field", () => {
    const chart = chartOf(
      buildChartResult({ csv: "__proto__,units\na,1\nb,2", kind: "bar", xField: "__proto__", yField: "units" }),
    );
    const row = chart.spec.data!.values[0]!;
    expect(Object.prototype.hasOwnProperty.call(row, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
  });
});

describe("mcp recommend_charts", () => {
  it("returns encodings without Loom-internal specs", () => {
    const r = recommendChartsResult({ csv: CSV, limit: 4 }, "ui://test");
    const recs = (r.structuredContent as { recommendations: Record<string, unknown>[] }).recommendations;
    expect(recs.length).toBeGreaterThan(0);
    for (const rec of recs) {
      expect(rec).not.toHaveProperty("spec");
      expect(typeof rec.xField).toBe("string");
    }
  });
});
