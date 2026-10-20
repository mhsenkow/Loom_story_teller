import { describe, expect, it } from "vitest";
import { monitorDraftFromChart } from "../monitoring/fromChart";
import type { ChartRecommendation } from "../recs/types";

const rec = (patch: Partial<ChartRecommendation> = {}) =>
  ({ id: "r1", kind: "line", title: "Moves · 7-day rolling", subtitle: "", xField: "as_of", yField: "change_pct", colorField: null, yAggregate: "mean", rollingWindow: 7, anomalyHighlight: true, ...patch }) as unknown as ChartRecommendation;

describe("monitorDraftFromChart", () => {
  it("maps a rolling FX line with anomaly rings to the same measure and rule", () => {
    const r = monitorDraftFromChart(rec(), "stream://fx", null);
    if ("error" in r) throw new Error(r.error);
    expect(r.draft.metric).toMatchObject({ source: "fx", agg: "avg", column: "change_pct", timeColumn: "as_of", lookbackMinutes: 7 * 1440 });
    expect(r.draft.rule).toMatchObject({ kind: "anomaly", sensitivity: 2.5 });
    expect(r.draft.name).toBe("Moves · 7-day rolling");
    expect(r.draft.decision).toBe("");
  });
  it("uses the size measure for maps instead of a coordinate", () => {
    const r = monitorDraftFromChart(rec({ kind: "map" as ChartRecommendation["kind"], xField: "longitude", yField: "latitude", sizeField: "magnitude", rollingWindow: null, anomalyHighlight: false } as Partial<ChartRecommendation>), "stream://usgs", null);
    if ("error" in r) throw new Error(r.error);
    expect(r.draft.metric).toMatchObject({ agg: "max", column: "magnitude", timeColumn: "ts", lookbackMinutes: 60 });
  });
  it("refuses non-feed charts and derived fields", () => {
    expect(monitorDraftFromChart(rec(), "/data/sales.csv", null)).toHaveProperty("error");
    expect(monitorDraftFromChart(rec({ yField: "made_up" }), "stream://fx", null)).toHaveProperty("error");
    expect(monitorDraftFromChart(null, "stream://fx", null)).toHaveProperty("error");
  });
});
