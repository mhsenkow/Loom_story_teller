import { describe, expect, it } from "vitest";
import { decodeChartLink, encodeChartLink, type ChartLink } from "../chartLink";
import { renderOddChart } from "../oddCharts";
import {
  assignWordCloudCompare,
  wordCloudCompareColumn,
  wordTotalsByGroup,
} from "../oddChartsRec";
import type { ColumnInfo } from "../queryTypes";
function mockCtx(): { ctx: CanvasRenderingContext2D; texts: string[] } {
  const texts: string[] = [];
  const state: Record<string, unknown> = { font: "10px sans-serif" };
  const handler: ProxyHandler<object> = {
    get(_t, prop: string) {
      if (prop === "measureText") return (s: string) => ({ width: String(s).length * 6 });
      if (prop === "fillText") return (s: string) => { texts.push(String(s)); };
      if (prop in state) return state[prop];
      return () => {};
    },
    set(_t, prop: string, value) {
      state[prop] = value;
      return true;
    },
  };
  return { ctx: new Proxy({}, handler) as CanvasRenderingContext2D, texts };
}

const columns = ["word", "side", "value"];

describe("word cloud comparison", () => {
  it("leans a word toward the group with the larger total and centers ties", () => {
    const byWord = new Map<string, Map<string, number>>([
      ["alpha", new Map([["East", 5], ["West", 1]])],
      ["beta", new Map([["East", 1], ["West", 9]])],
      ["same", new Map([["East", 3], ["West", 3]])],
    ]);
    const placed = assignWordCloudCompare(byWord, "East", "West");
    expect(placed.find((w) => w.word === "alpha")).toMatchObject({ side: "left", value: 5, group: "East" });
    expect(placed.find((w) => w.word === "beta")).toMatchObject({ side: "right", value: 9, group: "West" });
    expect(placed.find((w) => w.word === "same")).toMatchObject({ side: "center", value: 3, group: "tie" });
    expect(placed.map((w) => w.value)).toEqual([9, 5, 3]);
  });

  it("aggregates word totals per group from rows", () => {
    const rows = [
      ["alpha", "East", 2],
      ["alpha", "East", 3],
      ["alpha", "West", 1],
      ["beta", "West", 4],
    ];
    const { byWord, groupWeight } = wordTotalsByGroup(rows, 0, 2, 1, "sum");
    expect(byWord.get("alpha")?.get("East")).toBe(5);
    expect(byWord.get("alpha")?.get("West")).toBe(1);
    expect(groupWeight.get("East")).toBe(5);
    expect(groupWeight.get("West")).toBe(5);
  });

  it("picks Compare for two groups and Grid for three to eight", () => {
    const col = (name: string, distinct: number): ColumnInfo => ({
      name, data_type: "VARCHAR", null_count: 0, distinct_count: distinct, min_value: null, max_value: null,
    });
    expect(wordCloudCompareColumn([col("word", 20), col("side", 2)], "word")).toEqual({ name: "side", mode: "compare" });
    expect(wordCloudCompareColumn([col("word", 20), col("side", 4)], "word")).toEqual({ name: "side", mode: "grid" });
    expect(wordCloudCompareColumn([col("word", 20), col("side", 40)], "word")).toBeNull();
  });

  it("draws a two-sided cloud and a grid, and asks for Compare by when it is missing", () => {
    const rows: unknown[][] = [];
    for (let i = 0; i < 24; i++) {
      const word = ["alpha", "beta", "gamma", "delta"][i % 4]!;
      const side = i % 2 === 0 ? "East" : "West";
      rows.push([word, side, 4 + (i % 5)]);
    }
    const theme = { colors: ["#3366cc", "#dc3912", "#ff9900"], fontFamily: "Lora", axisFontSize: 16 };
    const compare = mockCtx();
    renderOddChart("wordCloud", compare.ctx, rows, columns, 0, 2, 1, -1, 640, 420, 48, { ...theme, wordCloudMode: "compare" }, false);
    expect(compare.texts).toEqual(expect.arrayContaining(["East", "West", "alpha"]));

    const gridRows = rows.map((r, i) => [r[0], ["East", "West", "North"][i % 3], r[2]]);
    const grid = mockCtx();
    renderOddChart("wordCloud", grid.ctx, gridRows, columns, 0, 2, 1, -1, 640, 420, 48, { ...theme, wordCloudMode: "grid" }, false);
    expect(grid.texts).toEqual(expect.arrayContaining(["East", "West", "North"]));
    expect(grid.texts.filter((t) => t === "alpha").length).toBeGreaterThan(0);

    const missing = mockCtx();
    renderOddChart("wordCloud", missing.ctx, rows, columns, 0, 2, -1, -1, 640, 420, 48, { ...theme, wordCloudMode: "compare" }, false);
    expect(missing.texts.join(" ")).toMatch(/Compare by/);
  });

  it("keeps Compare mode in a shared chart link", () => {
    const link: ChartLink = {
      src: "mock://words.csv",
      chart: { kind: "wordCloud", xField: "word", yField: "value", colorField: "side", wordCloudMode: "compare" },
    };
    const back = decodeChartLink(`#${encodeChartLink(link)}`);
    expect(back?.chart.wordCloudMode).toBe("compare");
    expect(back?.chart.colorField).toBe("side");
  });
});
