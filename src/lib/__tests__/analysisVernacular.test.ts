import { describe, expect, it } from "vitest";
import {
  extractMentionedColumns,
  looksLikeAnalysisTalk,
  resolveAnalysisVernacular,
  stripTalkFiller,
} from "../analysisVernacular";

describe("resolveAnalysisVernacular", () => {
  it("maps distribution talk to histogram", () => {
    const hits = resolveAnalysisVernacular("show me the distribution");
    expect(hits[0]?.kind).toBe("histogram");
  });

  it("maps over time / trend to line", () => {
    expect(resolveAnalysisVernacular("plot this over time")[0]?.kind).toBe("line");
    expect(resolveAnalysisVernacular("what's the trend")[0]?.kind).toBe("line");
  });

  it("maps correlation language to scatter or corr matrix", () => {
    expect(resolveAnalysisVernacular("are these correlated")[0]?.kind).toBe("scatter");
    expect(resolveAnalysisVernacular("correlation matrix")[0]?.kind).toBe("corrMatrix");
  });

  it("maps share / composition to pie", () => {
    expect(resolveAnalysisVernacular("share of total")[0]?.kind).toBe("pie");
  });

  it("maps geo talk to choropleth", () => {
    expect(resolveAnalysisVernacular("map it by state")[0]?.kind).toBe("choropleth");
  });

  it("maps look language to presets", () => {
    expect(resolveAnalysisVernacular("make it tufte")[0]?.look).toBe("tufte");
    expect(resolveAnalysisVernacular("clarity look")[0]?.look).toBe("clarity");
  });

  it("wires log scale and stacked percent extras", () => {
    expect(resolveAnalysisVernacular("log scale")[0]?.extras?.yScale).toBe("log");
    expect(resolveAnalysisVernacular("100% stacked")[0]?.extras?.barStackMode).toBe("percent");
  });

  it("picks columns from X vs Y phrasing", () => {
    const hits = resolveAnalysisVernacular("site_name vs discharge_cfs", {
      columns: ["site_name", "discharge_cfs", "ts"],
    });
    expect(hits[0]?.kind).toBe("scatter");
    expect(hits[0]?.fields).toEqual(["site_name", "discharge_cfs"]); // left→right from “vs”
  });

  it("clears filters and deep-scan as actions", () => {
    expect(resolveAnalysisVernacular("clear filters")[0]?.action).toBe("clear-filters");
    expect(resolveAnalysisVernacular("suggest charts")[0]?.action).toBe("deep-scan");
  });
});

describe("stripTalkFiller", () => {
  it("drops politeness wrappers", () => {
    expect(stripTalkFiller("please show me a histogram")).toMatch(/histogram/i);
  });
});

describe("extractMentionedColumns", () => {
  it("finds longest column tokens", () => {
    expect(extractMentionedColumns("filter discharge_cfs high", ["cfs", "discharge_cfs"])).toEqual([
      "discharge_cfs",
    ]);
  });
});

describe("looksLikeAnalysisTalk", () => {
  it("detects chart vernacular", () => {
    expect(looksLikeAnalysisTalk("distribution")).toBe(true);
    expect(looksLikeAnalysisTalk("flood gauges oregon")).toBe(false);
  });
});
