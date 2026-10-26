import { describe, expect, it } from "vitest";
import { categoryIndex } from "../chartInk";
import { clampGroupInto, groupChartChannels, groupLabelMap } from "../channelGroups";
import type { ChartRecommendation } from "../recommendations";

function chart(partial: Partial<ChartRecommendation>): ChartRecommendation {
  return {
    id: "t",
    kind: "beeswarm",
    title: "",
    subtitle: "",
    score: 1,
    spec: {},
    xField: "group",
    yField: "protein",
    colorField: "kcal",
    ...partial,
  };
}

describe("groupLabelMap", () => {
  it("chunks a hundred numbers into ten contiguous ranges", () => {
    const values = Array.from({ length: 100 }, (_, i) => i);
    const labels = groupLabelMap(values, 10)!;
    const bands = [...new Set(values.map((v) => labels.get(String(v))))];
    expect(bands).toEqual([
      "0–9", "10–19", "20–29", "30–39", "40–49",
      "50–59", "60–69", "70–79", "80–89", "90–99",
    ]);
    expect(labels.get("0")).toBe("0–9");
    expect(labels.get("99")).toBe("90–99");
  });

  it("leaves a short column alone", () => {
    expect(groupLabelMap([1, 2, 3], 10)).toBeNull();
    expect(clampGroupInto(1)).toBeNull();
    expect(clampGroupInto(10.2)).toBe(10);
  });

  it("keeps the largest categories and rolls the rest into Other", () => {
    const values = ["a", "a", "a", "b", "b", "c", "d", "e"];
    const labels = groupLabelMap(values, 3)!;
    expect(labels.get("a")).toBe("a");
    expect(labels.get("b")).toBe("b");
    expect(labels.get("c")).toBe("Other");
    expect(labels.get("e")).toBe("Other");
  });
});

describe("groupChartChannels", () => {
  it("rewrites color and leaves the measure column alone", () => {
    const rows = [
      ["A", 1, 0],
      ["B", 2, 50],
      ["A", 3, 99],
    ];
    const grouped = groupChartChannels(rows, ["group", "protein", "kcal"], chart({ groupInto: 2 }));
    expect(grouped.columns).toEqual(["group", "protein", "kcal"]);
    expect(grouped.rows.map((r) => r[1])).toEqual([1, 2, 3]);
    expect(grouped.rows.map((r) => r[2])).toEqual(["0–50", "0–50", "99"]);
    expect(grouped.colorField).toBe("kcal");
    expect(rows[0]![2]).toBe(0);
  });

  it("keeps a shared axis raw and appends the groups", () => {
    const rows = [[0], [50], [99]];
    const grouped = groupChartChannels(
      rows,
      ["kcal"],
      chart({ xField: "kcal", yField: null, colorField: "kcal", groupInto: 2 }),
    );
    expect(grouped.rows.map((r) => r[0])).toEqual([0, 50, 99]);
    expect(grouped.colorField?.includes("\u0000")).toBe(true);
    expect(grouped.rows.map((r) => r[1])).toEqual(["0–50", "0–50", "99"]);
  });

  it("does not bin a heat ramp", () => {
    const rows = [[1], [2], [3], [4]];
    const grouped = groupChartChannels(rows, ["kcal"], chart({ kind: "heatmap", xField: "kcal", colorField: "kcal", groupInto: 2 }));
    expect(grouped.rows).toBe(rows);
    expect(grouped.colorField).toBe("kcal");
  });
});

describe("categoryIndex bin order", () => {
  it("orders range labels from low to high", () => {
    const rows = [["90–99"], ["0–9"], ["40–49"]];
    const idx = categoryIndex(rows, 0);
    expect([...idx.keys()]).toEqual(["0–9", "40–49", "90–99"]);
    expect(idx.get("0–9")).toBe(0);
  });
});
