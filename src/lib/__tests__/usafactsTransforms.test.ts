import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACS_STATE_VARS,
  STATE_FIPS_ABBR,
  USAFACTS_NATION_COLUMNS,
  USAFACTS_NATION_SERIES,
  USAFACTS_STATES_COLUMNS,
  acsStateYears,
  acsStatesWide,
  fredGraphNationMonthly,
  fredNationMonthly,
  usafactsPayload,
  usafactsToolCall,
} from "../../../workers/sourceTransforms";
import { SOURCE_BY_KIND } from "../sourceRegistry";
import { parseSourceRows } from "../webStreams";

const read = (n: string) => readFileSync(resolve(__dirname, "../../../src-tauri/tests/fixtures/sources", n), "utf8");

describe("USAFacts gateway envelope", () => {
  it("builds a call_source_tool JSON-RPC request", () => {
    const body = JSON.parse(usafactsToolCall("fred", "getSeriesObservations", { series_id: "UNRATE" }));
    expect(body).toMatchObject({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "call_source_tool", arguments: { source_id: "fred", tool_name: "getSeriesObservations", arguments: { series_id: "UNRATE" } } },
    });
  });

  it("reads SSE replies whose payload is text content", () => {
    const acs = usafactsPayload(read("usafacts_acs1_2024.sse")) as { results: string[][] };
    expect(acs.results[0]).toEqual([...ACS_STATE_VARS, "state"]);
    const fred = usafactsPayload(read("usafacts_fred_unrate.sse")) as { observations: unknown[] };
    expect(fred.observations.length).toBeGreaterThan(12);
  });

  it("reads plain JSON replies with structuredContent", () => {
    const text = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { structuredContent: { observations: [{ date: "2026-01-01", value: "4" }] } } });
    expect(usafactsPayload(text)).toEqual({ observations: [{ date: "2026-01-01", value: "4" }] });
  });

  it("throws on gateway error shapes", () => {
    expect(() => usafactsPayload(read("usafacts_error.sse"))).toThrow(/upstream_rejected/);
    expect(() => usafactsPayload(JSON.stringify({ jsonrpc: "2.0", error: { message: "boom" } }))).toThrow(/boom/);
    expect(() => usafactsPayload("<html>")).toThrow(/unreadable/);
    expect(() => usafactsPayload(JSON.stringify({ result: {} }))).toThrow(/empty/);
  });
});

describe("usafacts_states", () => {
  it("asks for 2012 → last year, skipping 2020", () => {
    const ys = acsStateYears(Date.UTC(2026, 9, 16));
    expect(ys[0]).toBe(2012);
    expect(ys.at(-1)).toBe(2025);
    expect(ys).not.toContain(2020);
  });

  it("turns an ACS grid into wide state-year rows matching the registry", () => {
    const table = usafactsPayload(read("usafacts_acs1_2024.sse"));
    const out = acsStatesWide([{ year: 2024, table }]);
    expect(out.columns).toEqual(SOURCE_BY_KIND.usafacts_states.columns);
    expect(out.columns).toEqual(USAFACTS_STATES_COLUMNS);
    expect(out.rows.length).toBe(52);
    const al = out.rows.find((r) => r[1] === "AL")!;
    // Alabama 2024: pop 5,157,699; income 66,659; poverty 760,634 / 5,008,112; unemployed 103,581 / 2,447,875
    expect(al).toEqual(["01", "AL", "Alabama", 2024, 5157699, 66659, 15.19, 39.6, 4.23, al[9]]);
    expect(al[9]).toBeCloseTo(((637543 + 304002 + 64010 + 51280) / 3540061) * 100, 1);
    expect(new Set(out.rows.map((r) => r[1])).size).toBe(52);
    expect(Object.keys(STATE_FIPS_ABBR).length).toBe(52);
  });

  it("drops Census jam values, sorts newest year first, and tolerates a bare grid", () => {
    const header = [...ACS_STATE_VARS, "state"];
    const row = (fips: string, pop: string, income: string) =>
      header.map((h) => (h === "state" ? fips : h === "NAME" ? `S${fips}` : h === "B01003_001E" ? pop : h === "B19013_001E" ? income : "10"));
    const out = acsStatesWide([
      { year: 2013, table: [header, row("06", "100", "-666666666")] },
      { year: 2014, table: { results: [header, row("01", "50", "1"), row("99", "1", "1")] } },
    ]);
    expect(out.rows.map((r) => [r[3], r[1]])).toEqual([
      [2014, "AL"],
      [2013, "CA"],
    ]);
    expect(out.rows[1]![5]).toBeNull();
  });

  it("parses through the web columnar parser", () => {
    const out = acsStatesWide([{ year: 2024, table: usafactsPayload(read("usafacts_acs1_2024.sse")) }]);
    const rows = parseSourceRows("usafacts_states", out);
    expect(rows.length).toBe(52);
    expect(typeof rows[0]![4]).toBe("number");
  });
});

describe("usafacts_nation", () => {
  it("merges FRED observations by month in registry order", () => {
    const unrate = usafactsPayload(read("usafacts_fred_unrate.sse"));
    const gas = usafactsPayload(read("usafacts_fred_gas.sse"));
    const payloads = USAFACTS_NATION_SERIES.map((s) => (s.id === "UNRATE" ? unrate : s.id === "GASREGW" ? gas : null));
    const out = fredNationMonthly(payloads);
    expect(out.columns).toEqual(SOURCE_BY_KIND.usafacts_nation.columns);
    expect(out.columns).toEqual(USAFACTS_NATION_COLUMNS);
    const jan = out.rows.find((r) => r[0] === "2024-01-01")!;
    expect(jan[1]).toBe(2024);
    expect(jan[2]).toBeCloseTo(3.7, 1);
    expect(jan[7]).toBeGreaterThan(2);
    expect(jan[3]).toBeNull();
    const months = out.rows.map((r) => r[0] as string);
    expect([...months].sort()).toEqual(months);
  });

  it("fredgraph fallback computes CPI year-over-year and drops pre-1990 rows", () => {
    const out = fredGraphNationMonthly(read("fredgraph_monthly.csv"), read("fredgraph_gas.csv"));
    expect(out.columns).toEqual(USAFACTS_NATION_COLUMNS);
    const r2024 = out.rows.find((r) => r[0] === "2024-01-01")!;
    expect(r2024[3]).toBeGreaterThan(1); // inflation from 2023-01 → 2024-01 levels
    expect(r2024[3]).toBeLessThan(6);
    expect(r2024[7]).toBeCloseTo(3.075, 3);
    const r2023 = out.rows.find((r) => r[0] === "2023-01-01")!;
    expect(r2023[3]).toBeNull(); // no 2022 level in the trimmed fixture
    expect(fredGraphNationMonthly("observation_date,UNRATE\n1980-01-01,6\n", "").rows).toEqual([]);
  });
});
