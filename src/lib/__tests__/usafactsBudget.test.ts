// =================================================================
// USAFacts budget / household / cost-of-living transforms, series
// signals, calendar-aware forecasts and story analysis presets.
// =================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACS_STATE_VARS,
  MTS9_LINES,
  USAFACTS_BUDGET_COLUMNS,
  USAFACTS_BUDGET_LINES_COLUMNS,
  USAFACTS_HOUSEHOLD_COLUMNS,
  USAFACTS_HOUSEHOLD_SERIES,
  USAFACTS_STATES_COLUMNS,
  acsStatesWide,
  avgRateByMonth,
  beaStateYears,
  beaValueFor,
  budgetLines,
  budgetMonthly,
  compactBea,
  fiscalYear,
  fredGraphLooksLikeCsv,
  fredGraphObservations,
  householdQuarterly,
  quarterInRecession,
  usafactsPayload,
} from "../../../workers/usafacts";
import { SOURCE_BY_KIND } from "../sourceRegistry";
import { parseSourceRows } from "../webStreams";
import { calendarMonthIndex, calendarStepMonths, forecastCalendar, forecastSeries } from "../timeSeriesAnalysis";
import { chartForecast } from "../chartAnalysis";
import { forecastSteps } from "../canvasCharts/analysisLayers";
import { extremeSince, firstCrossAbove, monthName, monthlySeries, recentAnomaly, trendCrossing, trendForecast } from "../seriesSignals";
import { analysisPresetPatch } from "../store/coreSlice";
import type { ChartRecommendation } from "../recommendations";

const read = (n: string) => readFileSync(resolve(__dirname, "../../../src-tauri/tests/fixtures/sources", n), "utf8");
const mts = () => usafactsPayload(read("usafacts_treasury_mts9.sse"));
const rates = () => usafactsPayload(read("usafacts_treasury_avg_rates.sse"));

describe("usafacts_budget", () => {
  const out = budgetMonthly([mts()], rates());
  const at = (c: string) => USAFACTS_BUDGET_COLUMNS.indexOf(c);
  const row = (m: string) => out.rows.find((r) => r[0] === `${m}-01`)!;

  it("matches the registry and keeps fiscal years straight", () => {
    expect(out.columns).toEqual(SOURCE_BY_KIND.usafacts_budget.columns);
    expect(out.rows).toHaveLength(34); // 2024-01 … 2026-10
    expect(fiscalYear("2025-09")).toBe(2025);
    expect(fiscalYear("2025-10")).toBe(2026);
    expect(row("2026-10")[at("fy")]).toBe(2027);
  });

  it("computes deficits, 12-month sums and interest's share of revenue", () => {
    // Sep 2025 ran a surplus (a large negative education outlay); deficits are outlays − receipts.
    expect(row("2025-09")[at("deficit_b")]).toBeCloseTo(-197.95, 2);
    expect(row("2025-09")[at("receipts_b")]).toBeCloseTo(543.66, 2);
    expect(row("2024-11")[at("net_interest_ttm_b")]).toBeNull(); // 2023-12 isn't in the fixture
    expect(row("2024-12")[at("net_interest_ttm_b")]).toBeCloseTo(907.59, 2);
    expect(row("2026-10")[at("interest_share_pct")]).toBeCloseTo(19.82, 2);
    expect(row("2026-10")[at("avg_interest_rate_pct")]).toBe(3.57);
    expect(row("2026-06")[at("customs_duties_b")]).toBeCloseTo(-25.56, 2); // tariff refunds
    expect(parseSourceRows("usafacts_budget", out)).toHaveLength(34);
  });

  it("reads average rates only for total marketable debt", () => {
    const r = avgRateByMonth({ data: [
      { record_date: "2026-10-31", security_desc: "Treasury Bills", avg_interest_rate_amt: "4.1" },
      { record_date: "2026-10-31", security_desc: "Total Marketable", avg_interest_rate_amt: "3.57" },
    ] });
    expect([...r]).toEqual([["2026-10", 3.57]]);
  });
});

describe("usafacts_budget_lines", () => {
  const out = budgetLines([mts()]);
  const at = (c: string) => USAFACTS_BUDGET_LINES_COLUMNS.indexOf(c);

  it("has one row per month × line, and each flow's lines add up to its total", () => {
    expect(out.columns).toEqual(SOURCE_BY_KIND.usafacts_budget_lines.columns);
    const lines = MTS9_LINES.filter((l) => !l.total).length + 2; // + Other receipts / Other outlays
    expect(out.rows).toHaveLength(34 * lines);
    const sep = out.rows.filter((r) => r[0] === "2025-09-01");
    const other = sep.find((r) => r[at("line")] === "Other outlays")!;
    expect(other[at("amount_b")]).toBeCloseTo(-77.07, 2);
    const wide = budgetMonthly([mts()], null).rows.find((r) => r[0] === "2025-09-01")!;
    for (const [flow, total] of [["Receipts", "receipts_b"], ["Outlays", "outlays_b"]] as const) {
      const sum = sep.filter((r) => r[at("flow")] === flow).reduce((s, r) => s + (r[at("amount_b")] as number), 0);
      expect(sum, flow).toBeCloseTo(wide[USAFACTS_BUDGET_COLUMNS.indexOf(total)] as number, 1);
    }
  });

  it("shares of each flow add to 100% over 12 months", () => {
    const oct = out.rows.filter((r) => r[0] === "2026-10-01" && r[at("flow")] === "Outlays");
    expect(oct.reduce((s, r) => s + (r[at("share_ttm_pct")] as number), 0)).toBeCloseTo(100, 0);
    expect(oct.find((r) => r[at("line")] === "Net interest")![at("amount_ttm_b")]).toBeCloseTo(1063.95, 1);
  });
});

describe("usafacts_household", () => {
  const ids = USAFACTS_HOUSEHOLD_SERIES.map((s) => s.id);
  const payloads = ids.map((id) =>
    id === "MSPUS" ? usafactsPayload(read("usafacts_fred_q_mspus.sse")) : id === "LES1252881500Q" ? usafactsPayload(read("usafacts_fred_q_les.sse")) : null,
  );
  const out = householdQuarterly(payloads);
  const at = (c: string) => USAFACTS_HOUSEHOLD_COLUMNS.indexOf(c);

  it("derives years of pay, decade and recession quarters", () => {
    expect(out.columns).toEqual(SOURCE_BY_KIND.usafacts_household.columns);
    const q = (d: string) => out.rows.find((r) => r[0] === d)!;
    expect(q("2024-01-01")[at("home_price_years_of_pay")]).toBeCloseTo(426800 / (1136 * 52), 2);
    expect(q("2020-04-01")[at("recession")]).toBe("Recession"); // Apr 2020
    expect(q("2020-01-01")[at("recession")]).toBe("Recession"); // Mar 2020 is in Q1
    expect(q("2024-01-01")[at("recession")]).toBe("Expansion");
    expect(q("2024-01-01")[at("decade")]).toBe("2020s");
    expect(quarterInRecession("2009-07-01")).toBe(false);
    expect(quarterInRecession("2009-04-01")).toBe(true);
  });

  it("scales revolving credit and claims, and reads one-series fredgraph CSVs", () => {
    const scaled = householdQuarterly(ids.map((id) => (id === "REVOLSL" ? { observations: [{ date: "2026-07-01", value: "1359243.35" }] } : null)));
    expect(scaled.rows[0]![at("revolving_credit_b")]).toBeCloseTo(1359.24, 2);
    const obs = fredGraphObservations(read("fredgraph_q_psavert.csv"), "PSAVERT")!;
    expect(obs.observations.at(-1)).toEqual({ date: "2026-07-01", value: "4.1" });
    expect(fredGraphObservations("PK\u0003\u0004zip", "PSAVERT")).toBeNull();
    expect(fredGraphObservations("<html>nope</html>", "PSAVERT")).toBeNull();
    expect(fredGraphLooksLikeCsv("﻿observation_date,UNRATE\n")).toBe(true);
    expect(fredGraphLooksLikeCsv("DATE,UNRATE\n")).toBe(true);
  });
});

describe("BEA price levels in usafacts_states", () => {
  const bea = beaStateYears(compactBea(usafactsPayload(read("usafacts_bea_sarpp1.sse"))));

  it("maps state FIPS → year → value and borrows last year's for the newest vintage", () => {
    expect(bea.get("28")!.get(2024)).toBeCloseTo(86.953, 3);
    expect(bea.has("00")).toBe(false);
    expect(beaValueFor(bea.get("28"), 2025)).toBeCloseTo(86.953, 3); // carried one year
    expect(beaValueFor(bea.get("28"), 2027)).toBeNull(); // never more than one
  });

  it("re-prices real income at national-average costs", () => {
    const table = usafactsPayload(read("usafacts_acs1_2024.sse"));
    const out = acsStatesWide([{ year: 2024, table }], null, { rpp: bea });
    expect(out.columns).toEqual(SOURCE_BY_KIND.usafacts_states.columns);
    const at = (c: string) => USAFACTS_STATES_COLUMNS.indexOf(c);
    const ms = out.rows.find((r) => r[1] === "MS")!;
    expect(ms[at("price_level")]).toBeCloseTo(86.953, 3);
    // No CPI → no real income → nothing to re-price (never a nominal / real mix).
    expect(ms[at("income_local_usd")]).toBeNull();
    const cpi = new Map([[2024, 313.698]]);
    const withReal = acsStatesWide([{ year: 2024, table }], cpi, { rpp: bea });
    const ms2 = withReal.rows.find((r) => r[1] === "MS")!;
    expect(ms2[at("income_local_usd")]).toBe(Math.round(((ms2[at("real_median_income")] as number) * 100) / 86.953));
    expect(withReal.rows.find((r) => r[1] === "PR")![at("price_level")]).toBeNull(); // BEA doesn't cover PR
    expect(ACS_STATE_VARS.length).toBeGreaterThan(10);
  });
});

describe("calendar-aware forecasts", () => {
  const months = Array.from({ length: 24 }, (_, i) => ({ x: Date.UTC(2024, i, 1), y: 10 + i }));

  it("recognises month, quarter and year steps on month starts", () => {
    expect(calendarMonthIndex(Date.UTC(2026, 9, 1))).toBe(2026 * 12 + 9);
    expect(calendarMonthIndex(Date.UTC(2026, 9, 2))).toBeNull();
    expect(calendarStepMonths(months)).toBe(1);
    expect(calendarStepMonths([0, 3, 6].map((m) => ({ x: Date.UTC(2020, m, 1), y: 1 })))).toBe(3);
    expect(calendarStepMonths([{ x: Date.UTC(2020, 0, 1), y: 1 }, { x: Date.UTC(2020, 2, 1), y: 1 }, { x: Date.UTC(2020, 3, 1), y: 1 }])).toBeNull();
  });

  it("steps whole months and lands on month starts", () => {
    const f = forecastCalendar(months, 3, "line")!;
    expect(f.points.map((p) => new Date(p.x).toISOString().slice(0, 10))).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
    expect(f.points[2]!.y).toBeCloseTo(36, 6);
    expect(new Date(f.anchor.x).toISOString().slice(0, 10)).toBe("2025-12-01");
    // Non-calendar input is unchanged.
    const plain = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((x) => ({ x, y: x * 2 }));
    expect(forecastCalendar(plain, 2, "line")).toEqual(forecastSeries(plain, 2, "line"));
  });

  it("turns a story's calendar horizon into plotted steps (months folded into years → fewer steps)", () => {
    const yearly = Array.from({ length: 30 }, (_, i) => ({ x: Date.UTC(1995 + i, 0, 1), y: i }));
    const quarterly = Array.from({ length: 30 }, (_, i) => ({ x: Date.UTC(2000, i * 3, 1), y: i }));
    const preset = { enabled: true, horizon: 24, horizonMonths: 24 };
    expect(forecastSteps(months, preset)).toBe(24);
    expect(forecastSteps(quarterly, preset)).toBe(8);
    expect(forecastSteps(yearly, preset)).toBe(2);
    expect(forecastSteps(yearly, { enabled: true, horizon: 5 })).toBe(5); // user-set intervals stay intervals
  });

  it("lets the Analyze preview forecast monthly dates (previously 'irregular')", () => {
    const rows = months.map((p) => [new Date(p.x).toISOString().slice(0, 10), p.y]);
    const r = chartForecast(rows, ["month", "v"], "month", "v", "max", 6, "holt", 12, true);
    expect(r.reason).toBeNull();
    expect(r.forecast?.points).toHaveLength(6);
  });
});

describe("series signals", () => {
  const sample = (values: (number | null)[], start = Date.UTC(2020, 0, 1)) => ({
    columns: ["month", "v"],
    types: ["DATE", "DOUBLE"],
    rows: values.map((v, i) => {
      const d = new Date(start);
      d.setUTCMonth(d.getUTCMonth() + i);
      return [d.toISOString().slice(0, 10), v];
    }),
    total_rows: values.length,
  });

  it("finds records and 'highest since'", () => {
    const pts = monthlySeries(sample([5, 9, 4, 3, 6, 7, 8]), "month", "v");
    const e = extremeSince(pts, "high")!;
    expect(e.record).toBe(false);
    expect(e.since?.t).toBe("2020-02-01");
    expect(e.months).toBe(5);
    expect(extremeSince(monthlySeries(sample([1, 2, 3, 4]), "month", "v"), "high")!.record).toBe(true);
    expect(extremeSince(monthlySeries(sample([4, 3, 5, 2]), "month", "v"), "low")!.record).toBe(true);
    expect(monthlySeries(sample([1, null, 3]), "month", "v")).toHaveLength(2);
    expect(monthName("2026-10-01")).toBe("Oct 2026");
  });

  it("forecasts the recent trend and when it crosses a line", () => {
    const pts = monthlySeries(sample(Array.from({ length: 30 }, (_, i) => 10 + i * 0.5)), "month", "v");
    const f = trendForecast(pts, 12, "line")!;
    expect(f.t).toBe("2023-06-01");
    expect(f.y).toBeCloseTo(10 + 41 * 0.5, 6);
    expect(trendCrossing(pts, 30, true, 48, "line")).toBe("2023-05-01"); // first forecast month ≥ 30
    expect(trendCrossing(pts, 5, true)).toBeNull(); // already above
  });

  it("flags a recent break from pattern and the first crossing between two series", () => {
    const flat = Array.from({ length: 20 }, (_, i) => 7 + (i % 3) * 0.1);
    const pts = monthlySeries(sample([...flat, -25]), "month", "v");
    const a = recentAnomaly(pts, 12, 3.5, 3)!;
    expect(a.y).toBe(-25);
    expect(recentAnomaly(monthlySeries(sample(flat), "month", "v"))).toBeNull();
    const up = monthlySeries(sample([1, 2, 3, 4]), "month", "v");
    const flat3 = monthlySeries(sample([2.5, 2.5, 2.5, 2.5]), "month", "v");
    expect(firstCrossAbove(up, flat3)).toBe("2020-03-01");
  });
});

describe("story analysis presets", () => {
  const line: ChartRecommendation = {
    id: "x", kind: "line", title: "", subtitle: "", score: 1, spec: {}, xField: "month", yField: "interest_share_pct", colorField: null,
    analysisPreset: { forecast: { horizon: 24, method: "holt" }, anomaly: { window: 12, threshold: 3.5 } },
  };

  it("opens a story with its forecast and anomaly layers, once", () => {
    const patch = analysisPresetPatch(null, line);
    expect(patch.smartResults?.analysis).toMatchObject({ forecast: { enabled: true, horizon: 24, method: "holt" }, anomaly: { enabled: true, window: 12 } });
    // The person's own settings for that chart win.
    expect(analysisPresetPatch(patch.smartResults!, line)).toEqual({});
    // Charts analysis can't run on (color series, y2) get nothing.
    expect(analysisPresetPatch(null, { ...line, colorField: "line" })).toEqual({});
    expect(analysisPresetPatch(null, { ...line, analysisPreset: undefined })).toEqual({});
  });
});
