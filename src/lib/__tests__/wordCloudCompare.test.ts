import { describe, expect, it } from "vitest";
import { decodeChartLink, encodeChartLink, type ChartLink } from "../chartLink";
import { rowForHitTarget, type HitTarget } from "../chartTooltip";
import { renderOddChart } from "../oddCharts";
import {
  wordCloudCompareColumn,
  splitWordCloudHalves,
  wordTotalsByGroup,
  wordsForCloudGroup,
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
  it("splits a one-value-per-word statistic into a higher cloud and a lower cloud", () => {
    const byWord = new Map<string, Map<string, number>>([
      ["Bitcoin", new Map([["1600", 1600]])],
      ["Ethereum", new Map([["400", 400]])],
      ["Solana", new Map([["80", 80]])],
      ["Dogecoin", new Map([["20", 20]])],
    ]);
    const halves = splitWordCloudHalves(byWord);
    expect(halves.higher.map(([w]) => w)).toEqual(["Bitcoin", "Ethereum"]);
    expect(halves.lower.map(([w]) => w)).toEqual(["Solana", "Dogecoin"]);
  });

  it("keeps each group's own totals so a word can sit in both clouds", () => {
    const byWord = new Map<string, Map<string, number>>([
      ["alpha", new Map([["East", 5], ["West", 1]])],
      ["beta", new Map([["West", 9]])],
      ["same", new Map([["East", 3], ["West", 3]])],
    ]);
    expect(wordsForCloudGroup(byWord, "East")).toEqual([["alpha", 5], ["same", 3]]);
    expect(wordsForCloudGroup(byWord, "West")).toEqual([["beta", 9], ["same", 3], ["alpha", 1]]);
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
    for (const word of ["alpha", "beta", "gamma"]) {
      rows.push([word, "East", word === "alpha" ? 20 : 8]);
      rows.push([word, "West", word === "beta" ? 20 : 6]);
    }
    const theme = { colors: ["#3366cc", "#dc3912", "#ff9900"], fontFamily: "Lora", axisFontSize: 16 };
    const compare = mockCtx();
    renderOddChart("wordCloud", compare.ctx, rows, columns, 0, 2, 1, -1, 640, 420, 48, { ...theme, wordCloudMode: "compare" }, false);
    expect(compare.texts).toEqual(expect.arrayContaining(["East", "West", "alpha"]));
    expect(compare.texts.filter((t) => t === "alpha").length).toBeGreaterThan(1);

    const coins: unknown[][] = ["Bitcoin", "Ethereum", "Solana", "Dogecoin", "Cardano", "Tron"].map((name, i) => [
      name,
      String(1000 - i * 100),
      1000 - i * 100,
    ]);
    const stat = mockCtx();
    renderOddChart("wordCloud", stat.ctx, coins, columns, 0, 2, 1, -1, 640, 420, 48, { ...theme, wordCloudMode: "compare" }, false);
    expect(stat.texts).toEqual(expect.arrayContaining(["Higher side", "Lower side", "Bitcoin", "Dogecoin"]));
    expect(stat.texts.join(" ")).not.toMatch(/1000/);

    const hits: HitTarget[] = [];
    renderOddChart("wordCloud", mockCtx().ctx, coins, columns, 0, 2, 1, -1, 640, 420, 48, { ...theme, wordCloudMode: "compare", hits }, false);
    const bitcoin = hits.find((h) => h.summary?.row[0] === "Bitcoin");
    expect(bitcoin).toBeTruthy();
    expect(rowForHitTarget(bitcoin!, coins as (string | number | boolean | null)[][])).toBe(0);
    const cloudHits: HitTarget[] = [];
    renderOddChart("wordCloud", mockCtx().ctx, coins, columns, 0, 2, 1, -1, 640, 420, 48, { ...theme, hits: cloudHits }, false);
    const named = cloudHits.find((h) => h.summary?.row[0] === "Bitcoin");
    expect(rowForHitTarget(named!, coins as (string | number | boolean | null)[][])).toBe(0);

    const gridRows = rows.map((r, i) => [r[0], ["East", "West", "North"][i % 3], r[2]]);
    const grid = mockCtx();
    renderOddChart("wordCloud", grid.ctx, gridRows, columns, 0, 2, 1, -1, 640, 420, 48, { ...theme, wordCloudMode: "grid" }, false);
    expect(grid.texts).toEqual(expect.arrayContaining(["East", "West", "North"]));
    expect(grid.texts.filter((t) => t === "alpha").length).toBeGreaterThan(0);

    const missing = mockCtx();
    renderOddChart("wordCloud", missing.ctx, rows, columns, 0, 2, -1, -1, 640, 420, 48, { ...theme, wordCloudMode: "compare" }, false);
    expect(missing.texts.join(" ")).toMatch(/Compare by/);
  });

  it("rows, columns, size, and word font change the cloud", () => {
    const coins: unknown[][] = ["Bitcoin", "Ethereum", "Solana", "Dogecoin", "Cardano", "Tron"].map((name, i) => [
      name,
      "spot",
      1000 - i * 100,
    ]);
    const theme = { colors: ["#3366cc", "#dc3912"], fontFamily: "Lora", axisFontSize: 12 };
    const place = (extra: Record<string, unknown>) => {
      const hits: HitTarget[] = [];
      const fonts: string[] = [];
      const state: Record<string, unknown> = { font: "10px sans-serif" };
      const ctx = new Proxy({}, {
        get(_t, prop: string) {
          if (prop === "measureText") return (s: string) => ({ width: String(s).length * 6 });
          if (prop === "fillText") return () => {};
          if (prop in state) return state[prop];
          return () => {};
        },
        set(_t, prop: string, value) {
          if (prop === "font") fonts.push(String(value));
          state[prop] = value;
          return true;
        },
      }) as CanvasRenderingContext2D;
      renderOddChart("wordCloud", ctx, coins, columns, 0, 2, -1, -1, 640, 420, 48, { ...theme, hits, ...extra }, false);
      const boxes = hits.filter((h): h is Extract<HitTarget, { shape: "rect" }> => h.shape === "rect" && !!h.summary?.row[0]);
      return { boxes, fonts };
    };
    const spiral = place({});
    const rows = place({ wordCloudArrange: "rows" });
    expect(rows.boxes.length).toBeGreaterThan(1);
    expect(Math.abs(rows.boxes[0]!.y - rows.boxes[1]!.y)).toBeLessThan(2);
    expect(rows.boxes[1]!.x).toBeGreaterThan(rows.boxes[0]!.x);
    expect(Math.abs(spiral.boxes[0]!.y - spiral.boxes[1]!.y)).toBeGreaterThan(4);

    const stacked = place({ wordCloudArrange: "columns" });
    expect(stacked.boxes[1]!.y).toBeGreaterThan(stacked.boxes[0]!.y + 4);

    const small = place({ wordCloudScale: 0.6 });
    const large = place({ wordCloudScale: 1.6 });
    expect(large.boxes[0]!.h).toBeGreaterThan(small.boxes[0]!.h);

    const faced = place({ wordCloudFont: "Georgia" });
    expect(faced.fonts.some((font) => font.includes("Georgia"))).toBe(true);
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
