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

describe("word cloud typography and coverage", () => {
  function draw(options: Record<string, unknown>, rows: unknown[][], width = 640, height = 420) {
    const state: Record<string, unknown> = { font: "12px sans-serif" };
    const painted: { text: string; font: string }[] = [];
    const ctx = new Proxy({}, {
      get: (_, key: string) => key === "measureText" ? (text: string) => {
        const size = Number(String(state.font).match(/([\d.]+)px/)?.[1] ?? 12);
        return { width: text.length * size * .48, actualBoundingBoxAscent: size * .8, actualBoundingBoxDescent: size * .25 };
      } : key === "fillText" ? (text: string) => painted.push({ text, font: String(state.font) }) : key in state ? state[key] : () => {},
      set: (_, key: string, value) => { state[key] = value; return true; },
    }) as CanvasRenderingContext2D;
    const hits: HitTarget[] = [];
    renderOddChart("wordCloud", ctx, rows, columns, 0, 2, 1, -1, width, height, 48, { colors: ["#3366cc", "#dc3912"], fontFamily: "Inter", ...options, hits }, false);
    return { hits, painted };
  }

  it("keeps equal values the same font size across unequal word lengths and comparison groups", () => {
    const result = draw({ wordCloudMode: "compare", wordCloudWeight: "even", wordCloudScale: .6 }, [["A", "East", 100], ["Longer", "West", 100]], 900);
    const words = result.painted.filter((p) => ["A", "Longer"].includes(p.text));
    expect(words).toHaveLength(2);
    expect(words[0].font).toBe(words[1].font);
    expect(result.painted.some((p) => p.text.includes("2 of 2 words shown"))).toBe(true);
  });

  it("reports all eligible words, including those outside the limit, without truncating labels", () => {
    const rows = Array.from({ length: 30 }, (_, i) => [`word${i}`, "East", 30 - i]);
    const result = draw({ topN: 5 }, rows);
    const words = result.hits.filter((h) => h.summary?.columns.includes("rank"));
    expect(words.length).toBeLessThanOrEqual(5);
    expect(result.painted.some((p) => p.text === `${words.length} of 30 words shown`)).toBe(true);
    expect(result.painted.filter((p) => p.text.startsWith("word")).every((p) => !p.text.includes("…"))).toBe(true);
  });

  it("keeps placed words inside the canvas with no collisions even with accented ink and generous spacing", () => {
    for (const arrange of ["spiral", "rows", "columns"]) {
      const { hits } = draw({ wordCloudArrange: arrange, wordCloudGap: 16 }, Array.from({ length: 25 }, (_, i) => [`Été${i}`, "East", 25 - i]), 420, 300);
      const boxes = hits.filter((h) => h.shape === "rect" && h.summary?.columns.includes("rank")) as (HitTarget & { x: number; y: number; w: number; h: number })[];
      expect(boxes.length).toBeGreaterThan(0);
      for (const [i, box] of boxes.entries()) {
        expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.w).toBeLessThanOrEqual(420); expect(box.y + box.h).toBeLessThanOrEqual(300);
        for (const other of boxes.slice(i + 1)) expect(box.x < other.x + other.w && box.x + box.w > other.x && box.y < other.y + other.h && box.y + box.h > other.y).toBe(false);
      }
    }
  });

  it("persists size contrast and spacing in portable chart links", () => {
    const link = { src: "mock://sales.csv", chart: { kind: "wordCloud" as const, xField: "word" }, visual: { wordCloudGap: 12, wordCloudSizing: "log", wordCloudFont: "Fraunces" } };
    expect(decodeChartLink(encodeChartLink(link))?.visual).toEqual(link.visual);
  });
});
