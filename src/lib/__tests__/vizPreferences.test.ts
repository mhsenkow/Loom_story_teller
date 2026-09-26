/**
 * Unit tests for viz preference model (swipe feedback → score boost).
 */
import { describe, it, expect } from "vitest";
import {
  emptyVizPreferenceModel,
  extractVizFeatures,
  recordVizSwipe,
  preferenceBoost,
  applyPreferenceBoost,
  featureKeys,
  parseVizPreferenceModel,
} from "../vizPreferences";
import type { ChartRecommendation } from "../recommendations";

function makeRec(partial: Partial<ChartRecommendation> & Pick<ChartRecommendation, "kind" | "xField">): ChartRecommendation {
  return {
    id: partial.id ?? `${partial.kind}-${partial.xField}`,
    kind: partial.kind,
    title: partial.title ?? partial.xField,
    subtitle: partial.subtitle ?? "",
    score: partial.score ?? 70,
    spec: partial.spec ?? {},
    xField: partial.xField,
    yField: partial.yField ?? null,
    colorField: partial.colorField ?? null,
    yAggregate: partial.yAggregate ?? null,
  };
}

describe("vizPreferences", () => {
  it("extracts stable features from a recommendation", () => {
    const rec = makeRec({
      kind: "bar",
      xField: "region",
      yField: "unemployment_rate",
      yAggregate: "mean",
    });
    const f = extractVizFeatures(rec, [
      { name: "region", data_type: "VARCHAR" },
      { name: "unemployment_rate", data_type: "DOUBLE" },
    ]);
    expect(f.kind).toBe("bar");
    expect(f.rateLike).toBe(true);
    expect(f.yAggregate).toBe("mean");
    expect(featureKeys(f)).toContain("kind:bar");
    expect(featureKeys(f)).toContain("tag:rateLike");
  });

  it("boosts liked kinds and penalizes disliked ones", () => {
    let model = emptyVizPreferenceModel();
    const scatter = makeRec({ kind: "scatter", xField: "x", yField: "y", score: 70 });
    const pie = makeRec({ kind: "pie", xField: "category", score: 70 });

    for (let i = 0; i < 8; i++) {
      model = recordVizSwipe(model, "like", extractVizFeatures(scatter));
      model = recordVizSwipe(model, "dislike", extractVizFeatures(pie));
    }

    const scatterBoost = preferenceBoost(extractVizFeatures(scatter), model);
    const pieBoost = preferenceBoost(extractVizFeatures(pie), model);
    expect(scatterBoost).toBeGreaterThan(0);
    expect(pieBoost).toBeLessThan(0);

    const boostedScatter = applyPreferenceBoost(scatter, model);
    const boostedPie = applyPreferenceBoost(pie, model);
    expect(boostedScatter.score).toBeGreaterThan(scatter.score);
    expect(boostedPie.score).toBeLessThan(pie.score);
  });

  it("returns zero boost with empty model", () => {
    const rec = makeRec({ kind: "line", xField: "date", yField: "value" });
    expect(preferenceBoost(extractVizFeatures(rec), emptyVizPreferenceModel())).toBe(0);
    expect(preferenceBoost(extractVizFeatures(rec), null)).toBe(0);
  });

  it("parses persisted JSON and rebuilds counts", () => {
    let model = emptyVizPreferenceModel();
    const rec = makeRec({ kind: "heatmap", xField: "a", yField: "b" });
    model = recordVizSwipe(model, "like", extractVizFeatures(rec));
    const roundTrip = parseVizPreferenceModel(JSON.parse(JSON.stringify(model)));
    expect(roundTrip.events).toHaveLength(1);
    expect(roundTrip.counts["kind:heatmap"]?.likes).toBeGreaterThan(0);
  });
});
