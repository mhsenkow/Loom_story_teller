// =================================================================
// chartTooltip — field projection + merge with structural summaries
// =================================================================

import { describe, expect, it } from "vitest";
import {
  mergeChartTooltip,
  projectRowForTooltip,
  resolveTooltipFieldNames,
} from "../chartTooltip";
import type { ChartRecommendation } from "../recommendations";

const cols = ["name", "developer", "peak_players", "negative", "owners_min"];
const row = ["Counter-Strike", "Valve", 900_000, 50_000, 50_000_000] as (string | number)[];

function chart(partial: Partial<ChartRecommendation>): ChartRecommendation {
  return {
    id: "t",
    kind: "bar",
    title: "t",
    subtitle: "",
    score: 1,
    xField: "owners_min",
    yField: "negative",
    ...partial,
  } as ChartRecommendation;
}

describe("chartTooltip fields", () => {
  it("resolveTooltipFieldNames prefers Encoding Tooltip chips", () => {
    expect(
      resolveTooltipFieldNames(
        chart({ tooltipFields: ["name", "developer", "missing"] }),
        cols,
      ),
    ).toEqual(["name", "developer"]);
  });

  it("resolveTooltipFieldNames includes zField in defaults", () => {
    expect(
      resolveTooltipFieldNames(chart({ zField: "peak_players", tooltipFields: null }), cols),
    ).toContain("peak_players");
  });

  it("mergeChartTooltip keeps cube/bar summary then appends panel fields", () => {
    const structural = {
      columns: ["owners_min", "peak_players", "positive", "Sum of negative", "Rows"],
      row: ["20M", "0 - 126.7K", "288 - 535.5K", "1.8M", 27] as (string | number)[],
    };
    const merged = mergeChartTooltip(structural, cols, row, [
      "name",
      "developer",
      "peak_players",
      "negative",
      "owners_min",
    ]);
    expect(merged.columns[0]).toBe("owners_min");
    expect(merged.columns).toContain("name");
    expect(merged.columns).toContain("developer");
    // Already covered by structural labels — no duplicate axis / measure
    expect(merged.columns.filter((c) => c === "peak_players")).toHaveLength(1);
    expect(merged.columns).not.toContain("negative");
    expect(merged.row[merged.columns.indexOf("name")]).toBe("Counter-Strike");
  });

  it("mergeChartTooltip falls back to raw projection without a summary", () => {
    const merged = mergeChartTooltip(null, cols, row, ["name", "developer"]);
    expect(merged).toEqual(projectRowForTooltip(cols, row, ["name", "developer"]));
  });
});
