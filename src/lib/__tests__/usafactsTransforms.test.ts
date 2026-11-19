import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACS_STATE_VARS,
  FREDGRAPH_NATION_MONTHLY_IDS,
  NBER_RECESSIONS,
  STATE_FIPS_ABBR,
  USAFACTS_NATION_COLUMNS,
  USAFACTS_NATION_SERIES,
  USAFACTS_STATES_COLUMNS,
  USAFACTS_STATE_JOBS_COLUMNS,
  US_STATES,
  UsafactsError,
  acsStateYears,
  acsStatesWide,
  acsUnknownVariable,
  acsVintageSettled,
  blsStateMonthly,
  blsStateUrBatches,
  compactBlsSeries,
  compactFredObservations,
  fredAnnualCpi,
  fredGraphNationMonthly,
  fredGraphNationPayloads,
  fredGraphStateIdBatches,
  fredGraphStateMonthly,
  fredNationMonthly,
  nberRecession,
  prevMonth,
  stateJobsYearRange,
  usafactsHash,
  usafactsPayload,
  usafactsToolCall,
} from "../../../workers/sourceTransforms";
import { SOURCE_BY_KIND } from "../sourceRegistry";
import { parseSourceRows } from "../webStreams";

const read = (n: string) => readFileSync(resolve(__dirname, "../../../src-tauri/tests/fixtures/sources", n), "utf8");

/** The error a payload throws (fails the test when it doesn't throw). */
function errorOf(text: string): UsafactsError {
  try {
    usafactsPayload(text);
  } catch (e) {
    expect(e).toBeInstanceOf(UsafactsError);
    return e as UsafactsError;
  }
  throw new Error("expected usafactsPayload to throw");
}

const toolError = (body: Record<string, unknown>) =>
  `data: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { isError: true, content: [{ type: "text", text: JSON.stringify(body) }] } })}\n`;

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

  it("classifies failures with the gateway's own retry advice", () => {
    // An unreleased ACS vintage: the agency 404s and the gateway says don't retry.
    const unreleased = errorOf(read("usafacts_error.sse"));
    expect(unreleased).toMatchObject({ kind: "upstream_rejected", retryable: false, upstreamStatus: 404 });
    expect(unreleased.notFound).toBe(true);
    // Explicit advice wins; without it, 429 / 5xx from the agency are transient.
    expect(errorOf(toolError({ kind: "upstream_error", message: "x", upstream_status: 503 })).retryable).toBe(true);
    expect(errorOf(toolError({ kind: "upstream_error", message: "x", upstream_status: 503, retryable: false })).retryable).toBe(false);
    expect(errorOf(toolError({ kind: "unknown_tool", message: "nope" })).retryable).toBe(false);
    expect(errorOf(toolError({ kind: "unsupported_argument", message: "rights tag" })).notFound).toBe(false);
    // JSON-RPC: internal / server errors are transient, request errors are ours.
    expect(errorOf(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "boom" } })).retryable).toBe(true);
    expect(errorOf(JSON.stringify({ jsonrpc: "2.0", error: { code: -32602, message: "bad" } })).retryable).toBe(false);
    // An HTML page from an edge in front of the gateway.
    expect(errorOf("<html>502</html>").retryable).toBe(true);
  });

  it("accepts BLS-shaped payloads and hashes request shapes stably", () => {
    expect((usafactsPayload(read("usafacts_bls_state_ur.sse")) as { Results: { series: unknown[] } }).Results.series.length).toBe(3);
    expect(usafactsHash("abc")).toBe(usafactsHash("abc"));
    expect(usafactsHash("abc")).not.toBe(usafactsHash("abd"));
    expect(usafactsHash(ACS_STATE_VARS.join(","))).toMatch(/^[0-9a-f]{8}$/);
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
    // Without CPI there is no real income; region comes from the state table.
    expect(al).toEqual(["01", "AL", "Alabama", 2024, 5157699, 66659, 15.19, 39.6, 4.23, al[9], "South", null, null, null, null, null]);
    expect(al[9]).toBeCloseTo(((637543 + 304002 + 64010 + 51280) / 3540061) * 100, 1);
    expect(new Set(out.rows.map((r) => r[1])).size).toBe(52);
    expect(Object.keys(STATE_FIPS_ABBR).length).toBe(52);
    expect(out.meta).toEqual({ vintages: [2024], dollarsOf: null });
  });

  it("reads education from B06009, and Puerto Rico from B06009PR", () => {
    const out = acsStatesWide([{ year: 2024, table: usafactsPayload(read("usafacts_acs1_2024.sse")) }]);
    const at = USAFACTS_STATES_COLUMNS.indexOf("bachelors_or_higher_pct");
    expect(out.rows.find((r) => r[1] === "PR")![at]).toBeCloseTo(((506436 + 214691) / 2428065) * 100, 2);
    expect(out.rows.every((r) => typeof r[at] === "number")).toBe(true);
    // A variable Census refuses is named so the call can be retried without it.
    const refused = errorOf(toolError({ kind: "upstream_rejected", message: "HTTP 400", upstream_status: 400, upstream_body: "error: unknown variable 'B15003_024E'", retryable: false }));
    expect(acsUnknownVariable(refused)).toBe("B15003_024E");
    expect(acsUnknownVariable(errorOf(read("usafacts_error.sse")))).toBeNull();
    expect(ACS_STATE_VARS.some((v) => v.startsWith("B15003"))).toBe(false);
  });

  it("tags every state with its Census region (PR on its own)", () => {
    const out = acsStatesWide([{ year: 2024, table: usafactsPayload(read("usafacts_acs1_2024.sse")) }]);
    const regionAt = USAFACTS_STATES_COLUMNS.indexOf("region");
    const counts = new Map<string, number>();
    for (const r of out.rows) counts.set(r[regionAt] as string, (counts.get(r[regionAt] as string) ?? 0) + 1);
    expect(Object.fromEntries(counts)).toEqual({ Northeast: 9, Midwest: 12, South: 17, West: 13, "Puerto Rico": 1 });
    expect(US_STATES.length).toBe(52);
  });

  it("restates income in the newest vintage's dollars with annual CPI", () => {
    const cpi = fredAnnualCpi(usafactsPayload(read("usafacts_fred_cpi_annual.sse")));
    expect(cpi.get(2012)).toBeCloseTo(229.586, 3);
    expect(cpi.has(2026)).toBe(false); // "." for an unfinished year
    const t2024 = usafactsPayload(read("usafacts_acs1_2024.sse"));
    const header = [...ACS_STATE_VARS, "state"];
    const t2012 = [header, header.map((h) => (h === "state" ? "01" : h === "NAME" ? "Alabama" : h === "B19013_001E" ? "41381" : "100"))];
    const out = acsStatesWide([{ year: 2024, table: t2024 }, { year: 2012, table: t2012 }], cpi);
    expect(out.meta).toEqual({ vintages: [2012, 2024], dollarsOf: 2024 });
    const realAt = USAFACTS_STATES_COLUMNS.indexOf("real_median_income");
    const al24 = out.rows.find((r) => r[1] === "AL" && r[3] === 2024)!;
    const al12 = out.rows.find((r) => r[1] === "AL" && r[3] === 2012)!;
    expect(al24[realAt]).toBe(66659); // its own year's dollars
    expect(al12[realAt]).toBe(Math.round((41381 * cpi.get(2024)!) / cpi.get(2012)!));
  });

  it("only re-asks the newest two vintages; older ones are settled", () => {
    const now = Date.UTC(2026, 10, 18);
    expect(acsVintageSettled(2023, now)).toBe(true);
    expect(acsVintageSettled(2024, now)).toBe(false);
    expect(acsVintageSettled(2025, now)).toBe(false);
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

  it("derives jobs added, decade and NBER recession months", () => {
    const at = (c: string) => USAFACTS_NATION_COLUMNS.indexOf(c);
    const payrolls = { observations: [
      { date: "2008-01-01", value: "138000" }, { date: "2008-02-01", value: "137900.5" },
      { date: "2008-04-01", value: "137700" }, // March missing → April has no "previous month"
      { date: "2020-03-01", value: "150000" }, { date: "2020-04-01", value: "129300" },
      { date: "2020-05-01", value: "132000" },
    ] };
    const out = fredNationMonthly(USAFACTS_NATION_SERIES.map((s) => (s.id === "PAYEMS" ? payrolls : null)));
    const row = (m: string) => out.rows.find((r) => r[0] === m)!;
    expect(row("2008-02-01")[at("jobs_added_k")]).toBe(-99.5);
    expect(row("2008-04-01")[at("jobs_added_k")]).toBeNull();
    expect(row("2020-04-01")[at("jobs_added_k")]).toBe(-20700);
    expect(row("2008-01-01")[at("decade")]).toBe("2000s");
    expect(row("2020-05-01")[at("decade")]).toBe("2020s");
    expect(row("2020-04-01")[at("recession")]).toBe("Recession");
    expect(row("2020-05-01")[at("recession")]).toBe("Expansion");
    // Boundaries follow FRED USREC: months after the peak through the trough.
    expect(nberRecession("1990-07-01")).toBe(false);
    expect(nberRecession("1990-08-01")).toBe(true);
    expect(nberRecession("2009-06-01")).toBe(true);
    expect(nberRecession("2009-07-01")).toBe(false);
    expect(nberRecession("2020-02-01")).toBe(false);
    expect(NBER_RECESSIONS.every(([a, b]) => a <= b)).toBe(true);
    expect(prevMonth("2020-01")).toBe("2019-12");
    expect(prevMonth("2020-10")).toBe("2020-09");
  });

  it("fredgraph fills only the series the gateway couldn't return", () => {
    const unrate = usafactsPayload(read("usafacts_fred_unrate.sse"));
    const fallback = fredGraphNationPayloads(read("fredgraph_monthly.csv"), read("fredgraph_gas.csv"));
    expect(fallback).toHaveLength(USAFACTS_NATION_SERIES.length);
    // The trimmed CSV has no JTSJOL / GS10 columns → those stay null rather than inventing data.
    expect(fallback[USAFACTS_NATION_SERIES.findIndex((s) => s.id === "JTSJOL")]).toBeNull();
    expect(FREDGRAPH_NATION_MONTHLY_IDS).toEqual(["UNRATE", "CPIAUCSL", "PAYEMS", "FEDFUNDS", "HOUST", "JTSJOL", "GS10"]);
    const gateway = USAFACTS_NATION_SERIES.map((s) => (s.id === "UNRATE" ? unrate : null));
    const merged = fredNationMonthly(gateway.map((p, i) => p ?? fallback[i] ?? null));
    const gatewayOnly = fredNationMonthly(gateway);
    const at = (c: string) => USAFACTS_NATION_COLUMNS.indexOf(c);
    for (const r of gatewayOnly.rows) {
      const m = merged.rows.find((x) => x[0] === r[0])!;
      expect(m[at("unemployment_rate")], String(r[0])).toBe(r[at("unemployment_rate")]);
    }
    const jan = merged.rows.find((r) => r[0] === "2024-01-01")!;
    expect(jan[at("inflation_yoy_pct")]).toBeGreaterThan(1); // filled from fredgraph levels
    expect(jan[at("jobs_added_k")]).not.toBeNull();
  });

  it("compacts FRED payloads to what the transform reads", () => {
    const unrate = usafactsPayload(read("usafacts_fred_unrate.sse"));
    const compact = compactFredObservations(unrate);
    expect(Object.keys(compact.observations[0]!)).toEqual(["date", "value"]);
    expect(fredNationMonthly([compact])).toEqual(fredNationMonthly([unrate]));
  });
});

describe("usafacts_state_jobs", () => {
  const bls = () => usafactsPayload(read("usafacts_bls_state_ur.sse"));
  const at = (c: string) => USAFACTS_STATE_JOBS_COLUMNS.indexOf(c);

  it("asks BLS for 19 calendar years in two batches of LAUS ids", () => {
    expect(stateJobsYearRange(Date.UTC(2026, 10, 18))).toEqual({ startyear: "2008", endyear: "2026" });
    const batches = blsStateUrBatches();
    expect(batches.map((b) => b.length)).toEqual([50, 2]);
    expect(batches[0]![0]).toBe("LASST010000000000003");
    expect(batches.flat()).toContain("LASST720000000000003");
    const fred = fredGraphStateIdBatches();
    expect(fred.map((b) => b.length)).toEqual([26, 26]);
    expect(fred.flat()).toEqual(expect.arrayContaining(["DCUR", "PRUR", "WYUR"]));
  });

  it("turns BLS series into state-month rows with the change from a year earlier", () => {
    const out = blsStateMonthly([bls()]);
    expect(out.columns).toEqual(SOURCE_BY_KIND.usafacts_state_jobs.columns);
    expect(out.rows).toHaveLength(3 * 33); // AL, CA, PR × 2024-01 … 2026-09
    const months = out.rows.map((r) => `${r[0]}|${r[at("state_abbr")]}`);
    expect([...months].sort()).toEqual(months);
    const row = (m: string, st: string) => out.rows.find((r) => r[0] === m && r[at("state_abbr")] === st)!;
    expect(row("2026-09-01", "AL")[at("unemployment_rate")]).toBe(3.5);
    expect(row("2026-09-01", "PR")).toMatchObject({ [at("state_name")]: "Puerto Rico", [at("region")]: "Puerto Rico" });
    expect(row("2026-09-01", "CA")[at("region")]).toBe("West");
    expect(row("2024-05-01", "CA")[at("unemployment_change_yoy")]).toBeNull(); // no 2023 asked for
    const now = row("2025-06-01", "CA")[at("unemployment_rate")] as number;
    const before = row("2024-06-01", "CA")[at("unemployment_rate")] as number;
    expect(row("2025-06-01", "CA")[at("unemployment_change_yoy")]).toBeCloseTo(now - before, 6);
    expect(compactBlsSeries(bls())).toEqual(compactBlsSeries(compactBlsSeries(bls())));
    expect(blsStateMonthly([compactBlsSeries(bls())])).toEqual(out);
    expect(parseSourceRows("usafacts_state_jobs", out)).toHaveLength(99);
  });

  it("the keyless fredgraph fallback produces the same rows", () => {
    const fred = fredGraphStateMonthly([read("fredgraph_state_ur.csv")], 2024);
    const fromBls = blsStateMonthly([bls()]);
    expect(fred.columns).toEqual(fromBls.columns);
    expect(fred.rows).toHaveLength(fromBls.rows.length);
    const key = (r: unknown[]) => `${r[0]}|${r[at("state_abbr")]}`;
    const blsByKey = new Map(fromBls.rows.map((r) => [key(r), r]));
    for (const r of fred.rows) expect(r, key(r)).toEqual(blsByKey.get(key(r)));
  });

  it("covers 50 states, DC and PR in the state table", () => {
    expect(new Set(US_STATES.map((s) => s[1])).size).toBe(52);
    expect(US_STATES.find((s) => s[1] === "DC")?.[3]).toBe("South");
  });
});
