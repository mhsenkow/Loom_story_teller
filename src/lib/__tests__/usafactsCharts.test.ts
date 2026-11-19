// =================================================================
// USAFacts feeds — opening charts, Discover quality, and first-look hooks
// =================================================================
// Builds real samples from the gateway fixtures (the same ones the Worker
// and Rust tests use), then checks that each feed's curated story spans
// the chart catalog, survives Discover's unit / additivity checks, scopes
// maps and rankings to the newest period, and writes a factual hook.
// =================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACS_STATE_VARS,
  USAFACTS_NATION_SERIES,
  acsStatesWide,
  blsStateMonthly,
  fredAnnualCpi,
  fredNationMonthly,
  usafactsPayload,
} from "../../../workers/usafacts";
import { applyChartTimeWindow } from "../chartTime";
import { preferMeasureAxes } from "../canvasCharts/shared";
import { qualifyDiscoverChart, isAdditiveDiscoverMeasure } from "../discoverChartQuality";
import { discoverHookFor } from "../discoverHooks";
import { discoverFieldLabel, formatDiscoverValue } from "../discoverEditorial";
import { createDiscoverAssessor } from "../discoverSignals";
import { buildDiscoverStories } from "../discoverStories";
import type { ColumnInfo, QueryResult } from "../queryTypes";
import { usafactsStory, recommendSourceStory } from "../recs/sourceStory";
import { SOURCE_BY_KIND, type SourceKind } from "../sourceRegistry";

const read = (n: string) => readFileSync(resolve(__dirname, "../../../src-tauri/tests/fixtures/sources", n), "utf8");

function sampleOf(kind: SourceKind, rows: unknown[][]): QueryResult {
  const def = SOURCE_BY_KIND[kind];
  return { columns: def.columns, types: def.types, rows: rows as QueryResult["rows"], total_rows: rows.length };
}

function statsOf(sample: QueryResult): ColumnInfo[] {
  return sample.columns.map((name, i) => {
    const vals = sample.rows.map((r) => r[i]).filter((v) => v != null);
    const nums = vals.filter((v): v is number => typeof v === "number");
    const sorted = [...vals].map(String).sort();
    return {
      name,
      data_type: sample.types[i]!,
      null_count: sample.rows.length - vals.length,
      distinct_count: new Set(vals.map(String)).size,
      min_value: nums.length ? String(Math.min(...nums)) : (sorted[0] ?? null),
      max_value: nums.length ? String(Math.max(...nums)) : (sorted.at(-1) ?? null),
    } as ColumnInfo;
  });
}

/** Two vintages (2024 from the fixture, 2023 scaled down) so trends and "latest year" differ. */
function statesSample(): QueryResult {
  const t2024 = usafactsPayload(read("usafacts_acs1_2024.sse")) as { results: string[][] };
  const header = t2024.results[0]!;
  const incomeAt = header.indexOf("B19013_001E");
  const t2023 = [header, ...t2024.results.slice(1).map((r) => r.map((v, i) => (i === incomeAt ? String(Math.round(Number(v) * 0.95)) : v)))];
  const cpi = fredAnnualCpi(usafactsPayload(read("usafacts_fred_cpi_annual.sse")));
  expect(header).toEqual([...ACS_STATE_VARS, "state"]);
  return sampleOf("usafacts_states", acsStatesWide([{ year: 2024, table: t2024 }, { year: 2023, table: t2023 }], cpi).rows);
}

function nationSample(): QueryResult {
  const unrate = usafactsPayload(read("usafacts_fred_unrate.sse"));
  const gas = usafactsPayload(read("usafacts_fred_gas.sse"));
  const payrolls = { observations: [{ date: "2026-08-01", value: "160000" }, { date: "2026-09-01", value: "160142" }] };
  return sampleOf(
    "usafacts_nation",
    fredNationMonthly(USAFACTS_NATION_SERIES.map((s) => (s.id === "UNRATE" ? unrate : s.id === "GASREGW" ? gas : s.id === "PAYEMS" ? payrolls : null))).rows,
  );
}

function stateJobsSample(): QueryResult {
  return sampleOf("usafacts_state_jobs", blsStateMonthly([usafactsPayload(read("usafacts_bls_state_ur.sse"))]).rows);
}

/** Live Worker payloads captured 2026-11-18 (state jobs trimmed to 10 states) — realistic spans for evidence checks. */
type GoldenKind = "usafacts_states" | "usafacts_nation" | "usafacts_state_jobs" | "usafacts_budget" | "usafacts_budget_lines" | "usafacts_household";

function golden(kind: GoldenKind): QueryResult {
  const name = kind.replace(/^usafacts_/, "");
  const body = JSON.parse(readFileSync(resolve(__dirname, "fixtures/usafacts", `${name}.json`), "utf8")) as { columns: string[]; rows: unknown[][] };
  expect(body.columns).toEqual(SOURCE_BY_KIND[kind].columns);
  return sampleOf(kind, body.rows);
}

const SAMPLES = {
  usafacts_states: () => golden("usafacts_states"),
  usafacts_nation: () => golden("usafacts_nation"),
  usafacts_state_jobs: () => golden("usafacts_state_jobs"),
  usafacts_budget: () => golden("usafacts_budget"),
  usafacts_budget_lines: () => golden("usafacts_budget_lines"),
  usafacts_household: () => golden("usafacts_household"),
} as const;

describe.each(Object.keys(SAMPLES) as (keyof typeof SAMPLES)[])("%s opening story", (kind) => {
  const sample = SAMPLES[kind]();
  const stats = statsOf(sample);
  const story = recommendSourceStory(kind, stats, sample);
  const curated = usafactsStory(kind, (k, title, subtitle, score, xField, yField, colorField, yAggregate, sizeField, extra) => ({
    id: title, kind: k, title, subtitle, score, spec: {}, xField, yField, colorField, yAggregate: yAggregate ?? null,
    sizeField: sizeField ?? undefined, ...extra,
  }), sample)[1];

  it("spans the chart catalog, not just lines and maps", () => {
    const kinds = new Set(curated.map((c) => c.kind));
    expect(kinds.size, [...kinds].join(", ")).toBeGreaterThanOrEqual(kind === "usafacts_state_jobs" || kind === "usafacts_budget_lines" ? 10 : 20);
    expect(story.charts.length).toBeGreaterThan(curated.length - 1);
  });

  it("keeps every curated chart through Discover's unit and additivity checks", () => {
    for (const c of curated) expect(qualifyDiscoverChart(kind, c), `${c.kind} · ${c.title}`).not.toBeNull();
  });

  it("only names real columns, and every windowed chart keeps rows", () => {
    for (const c of curated) {
      for (const f of [c.xField, c.yField, c.colorField, c.sizeField, c.zField, c.y2Field, c.timeWindowField]) {
        if (f) expect(sample.columns, `${c.title} → ${f}`).toContain(f);
      }
      if (c.timeWindow) {
        const out = applyChartTimeWindow(sample.rows, sample.columns, c);
        expect(out.rows.length, c.title).toBeGreaterThan(0);
        expect(out.rows.length, c.title).toBeLessThan(sample.rows.length);
      }
    }
  });

  it("opens every curated chart with the fields it was written with", () => {
    for (const c of curated) {
      const opened = story.charts.find((s) => s.title === c.title && s.kind === c.kind);
      expect(opened, c.title).toBeDefined();
      expect([opened!.xField, opened!.yField, opened!.colorField], `${c.kind} · ${c.title}`).toEqual([c.xField, c.yField, c.colorField]);
    }
  });

  it("gives every curated chart evidence Discover can lead with", () => {
    const assess = createDiscoverAssessor(stats, sample, kind);
    for (const c of story.charts.slice(0, curated.length)) {
      const q = qualifyDiscoverChart(kind, c);
      expect(q && assess(q), `${c.kind} · ${c.title}`).toBeTruthy();
    }
  });

  it("writes a first-look hook from the sample", () => {
    const hook = discoverHookFor(kind, sample, story.charts[0]!);
    expect(hook.category).toBe("Economy");
    expect(hook.score).toBeGreaterThanOrEqual(80);
    expect(story.charts.some((c) => c.kind === hook.preferKind)).toBe(true);
  });
});

describe("USAFacts specifics", () => {
  it("maps and rankings show the newest vintage, not a peak across years", () => {
    const sample = statesSample();
    const maps = recommendSourceStory("usafacts_states", statsOf(sample), sample).charts.filter((c) => c.kind === "choropleth" && c.title.endsWith("map"));
    expect(maps.length).toBeGreaterThanOrEqual(3);
    for (const m of maps) {
      const kept = applyChartTimeWindow(sample.rows, sample.columns, m).rows;
      expect(new Set(kept.map((r) => r[3])), m.title).toEqual(new Set([2024]));
      expect(m.subtitle).toContain("2024");
    }
  });

  it("never sums medians, rates or prices into a part-to-whole chart", () => {
    expect(isAdditiveDiscoverMeasure("usafacts_states", "population")).toBe(true);
    expect(isAdditiveDiscoverMeasure("usafacts_states", "median_household_income")).toBe(false);
    expect(isAdditiveDiscoverMeasure("usafacts_states", "real_median_income")).toBe(false);
    expect(isAdditiveDiscoverMeasure("usafacts_states", "median_age")).toBe(false);
    expect(isAdditiveDiscoverMeasure("usafacts_nation", "gas_price_usd")).toBe(false);
    expect(isAdditiveDiscoverMeasure("usafacts_state_jobs", "unemployment_rate")).toBe(false);
    const treemap = { id: "t", kind: "treemap" as const, title: "", subtitle: "", score: 1, spec: {}, xField: "state_name", yField: "median_household_income", colorField: "region", yAggregate: "sum" as const };
    expect(qualifyDiscoverChart("usafacts_states", treemap)).toBeNull();
  });

  it("radar / parallel / glyph axes skip codes and years when real measures remain", () => {
    const cols = SOURCE_BY_KIND.usafacts_states.columns;
    const numericIdx = cols.map((_, i) => i).filter((i) => !["state_abbr", "state_name", "region"].includes(cols[i]!));
    const axes = preferMeasureAxes(numericIdx, cols).map((i) => cols[i]);
    expect(axes).not.toContain("state_fips");
    expect(axes).not.toContain("yr");
    expect(axes).toContain("median_household_income");
    // Too few measures left → keep what there was rather than draw nothing.
    expect(preferMeasureAxes([0, 1, 2], ["id", "year", "value"])).toEqual([0, 1, 2]);
  });

  it("drops row counts on monthly / yearly panels, keeps them for draws", () => {
    const base = { id: "c", title: "", subtitle: "", score: 1, spec: {}, colorField: null, yField: null };
    expect(qualifyDiscoverChart("usafacts_state_jobs", { ...base, kind: "bar", xField: "region", yAggregate: "count" })).toBeNull();
    expect(qualifyDiscoverChart("usafacts_nation", { ...base, kind: "pie", xField: "recession" })).toBeNull();
    expect(qualifyDiscoverChart("usafacts_state_jobs", { ...base, kind: "bar", xField: "region", yField: "unemployment_rate", yAggregate: "mean" })).not.toBeNull();
    expect(qualifyDiscoverChart("powerball", { ...base, kind: "bar", xField: "powerball", yAggregate: "count" })).not.toBeNull();
  });

  it("never plots a budget total against its own parts or a 12-month sum against its month", () => {
    const base = { id: "s", title: "", subtitle: "", score: 1, spec: {}, colorField: null };
    for (const [x, y] of [["receipts_b", "individual_income_tax_b"], ["outlays_b", "deficit_b"], ["net_interest_b", "net_interest_ttm_b"], ["net_interest_ttm_b", "interest_share_pct"]]) {
      expect(qualifyDiscoverChart("usafacts_budget", { ...base, kind: "scatter", xField: x!, yField: y! }), `${x} × ${y}`).toBeNull();
    }
    // A real relationship (the rate on the debt vs the interest bill) stays.
    expect(qualifyDiscoverChart("usafacts_budget", { ...base, kind: "scatter", xField: "avg_interest_rate_pct", yField: "interest_share_pct" })).not.toBeNull();
    expect(qualifyDiscoverChart("usafacts_household", { ...base, kind: "scatter", xField: "median_home_price_usd", yField: "home_price_years_of_pay" })).toBeNull();
  });

  it("names budget columns and dollar-billion values the way people say them", () => {
    expect(discoverFieldLabel("net_interest_ttm_b")).toBe("12-month net interest ($B)");
    expect(discoverFieldLabel("customs_duties_b")).toBe("customs duties ($B)");
    expect(discoverFieldLabel("fy")).toBe("fiscal year");
    expect(discoverFieldLabel("interest_share_pct")).toBe("interest's share of revenue");
    expect(formatDiscoverValue(2112.25, "deficit_ttm_b", "usafacts_budget")).toBe("$2.11T");
    expect(formatDiscoverValue(-25.56, "customs_duties_b", "usafacts_budget")).toBe("−$25.6B");
    expect(formatDiscoverValue(970.36, "net_interest_ttm_b", "usafacts_budget")).toBe("$970B");
  });

  it("doesn't plot real income against the nominal income it's computed from", () => {
    const base = { id: "s", title: "", subtitle: "", score: 1, spec: {}, colorField: null };
    expect(qualifyDiscoverChart("usafacts_states", { ...base, kind: "scatter", xField: "real_median_income", yField: "median_household_income" })).toBeNull();
    expect(qualifyDiscoverChart("usafacts_states", { ...base, kind: "isoScatter", xField: "median_household_income", yField: "real_median_income" })).toBeNull();
    // Over time, the two lines side by side are the point (the gap is inflation).
    expect(qualifyDiscoverChart("usafacts_states", { ...base, kind: "line", xField: "yr", yField: "median_household_income", y2Field: "real_median_income" })).not.toBeNull();
    expect(qualifyDiscoverChart("usafacts_states", { ...base, kind: "scatter", xField: "real_median_income", yField: "poverty_rate" })).not.toBeNull();
  });

  it("every feed keeps its headline card in the first look", () => {
    for (const kind of Object.keys(SAMPLES) as (keyof typeof SAMPLES)[]) {
      const sample = SAMPLES[kind]();
      const stats = statsOf(sample);
      const probe = recommendSourceStory(kind, stats, sample, { discoverProbe: true });
      const head = buildDiscoverStories(kind, stats, sample, probe.charts, 40).find((s) => s.headline);
      expect(head, kind).toBeDefined();
      const hook = discoverHookFor(kind, sample, head!.chart);
      expect(head!.hook, kind).toBe(hook.hook);
      // A hook about one measure opens on that measure, alone, with its forecast / rings when it has them.
      if (hook.preferField) {
        expect(head!.chart.yField, kind).toBe(hook.preferField);
        expect(head!.chart.y2Field ?? null, kind).toBeNull();
      }
    }
  });

  it("hooks lead with the newest finding", () => {
    const states = statesSample();
    const sh = discoverHookFor("usafacts_states", states, recommendSourceStory("usafacts_states", statsOf(states), states).charts[0]!);
    expect(sh.hook).toMatch(/earns the most · \$[\d,]+ median income \(2024\)/);
    expect(sh.blurb).toMatch(/After inflation, the typical state's median income is (up|down) [\d.]+% since 2023/);

    const nation = nationSample();
    const nh = discoverHookFor("usafacts_nation", nation, recommendSourceStory("usafacts_nation", statsOf(nation), nation).charts[0]!);
    expect(nh.hook).toMatch(/^\+142k jobs in Sep 2026 · unemployment [\d.]+%$/);
    expect(nh.preferKind).toBe("bar");

    const jobs = stateJobsSample();
    const jh = discoverHookFor("usafacts_state_jobs", jobs, recommendSourceStory("usafacts_state_jobs", statsOf(jobs), jobs).charts[0]!);
    expect(jh.hook).toMatch(/^Unemployment (rose|fell) in \d of 3 states over the past year \(Sep 2026\)$/);
    expect(jh.blurb).toMatch(/Highest now: Puerto Rico at 6\.2%/);
  });
});
