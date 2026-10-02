/**
 * Unit tests for Dive — Scuba-style slice-and-dice engine.
 */
import { describe, it, expect } from "vitest";
import {
  applyDerivedColumns,
  compileDiveExpr,
  formatExprTime,
  nextDerivedName,
} from "../diveExpr";
import {
  autoBucketMs,
  decodeDiveLink,
  defaultDiveQuery,
  diveToSql,
  encodeDiveLink,
  formatDelta,
  parseDiveTime,
  percentileOf,
  profileDiveColumns,
  quantile,
  runDive,
  sanitizeDiveQuery,
  toTime,
  type DiveData,
  type DiveQuery,
} from "../dive";

const H = 3_600_000;
const base = Date.parse("2026-09-01T00:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

// 48 hours of edits: two wikis, bots on even hours, delta grows with hour.
const data: DiveData = {
  columns: ["ts", "wiki", "bot", "delta", "user"],
  rows: Array.from({ length: 48 }, (_, h) => [
    iso(base + h * H),
    h % 3 === 0 ? "dewiki" : "enwiki",
    h % 2 === 0,
    h,
    `u${h % 5}`,
  ]),
};
const profiles = profileDiveColumns(data);
const q = (over: Partial<DiveQuery> = {}): DiveQuery => ({ ...defaultDiveQuery(profiles), ...over });

describe("profiling", () => {
  it("classifies time, number, and category columns", () => {
    const kind = Object.fromEntries(profiles.map((p) => [p.name, p.kind]));
    expect(kind).toMatchObject({ ts: "time", wiki: "category", delta: "number", user: "category" });
  });

  it("defaults to count over time when there's a time column", () => {
    const d = defaultDiveQuery(profiles);
    expect(d.timeColumn).toBe("ts");
    expect(d.view).toBe("timeseries");
    expect(d.metrics).toEqual([{ agg: "count", column: null }]);
  });

  it("parses ISO strings and epoch numbers as time", () => {
    expect(toTime("2026-09-01T00:00:00Z")).toBe(base);
    expect(toTime(base / 1000)).toBe(base);
    expect(toTime(2024)).toBeNaN();
    expect(toTime("hello")).toBeNaN();
  });
});

describe("runDive", () => {
  it("groups, ranks, and totals", () => {
    const r = runDive(data, q({ groupBy: ["wiki"], view: "table" }), profiles);
    expect(r.matched).toBe(48);
    expect(r.groups.map((g) => g.values[0])).toEqual(["enwiki", "dewiki"]);
    expect(r.groups[0]!.metrics[0]).toBe(32);
    expect(r.total[0]).toBe(48);
  });

  it("applies filters", () => {
    const r = runDive(data, q({ filters: [{ column: "wiki", op: "=", values: ["DEWIKI"] }, { column: "delta", op: ">=", values: ["24"] }] }), profiles);
    expect(r.matched).toBe(8); // h = 24, 27, …, 45
    const nb = runDive(data, q({ filters: [{ column: "bot", op: "=", values: ["false"] }] }), profiles);
    expect(nb.matched).toBe(24);
  });

  it("computes avg / distinct / percentiles", () => {
    const r = runDive(
      data,
      q({ metrics: [{ agg: "avg", column: "delta" }, { agg: "distinct", column: "user" }, { agg: "p90", column: "delta" }] }),
      profiles,
    );
    expect(r.total[0]).toBeCloseTo(23.5);
    expect(r.total[1]).toBe(5);
    expect(r.total[2]).toBeCloseTo(quantile(Array.from({ length: 48 }, (_, i) => i), 0.9)!);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });

  it("windows to the latest rows and compares with the previous period", () => {
    const r = runDive(data, q({ range: "24h", compare: "previous" }), profiles);
    expect(r.matched).toBe(25); // hours 23..47 inclusive of the boundary
    expect(r.compareMatched).toBe(23);
    expect(r.totalCompare?.[0]).toBe(23);
    expect(formatDelta(25, 23)?.sign).toBe(1);
  });

  it("buckets a time series per top group", () => {
    const r = runDive(data, q({ groupBy: ["wiki"], bucket: "6h" }), profiles);
    expect(r.bucketMs).toBe(6 * H);
    expect(r.buckets.length).toBe(8);
    expect(r.series.map((s) => s.label)).toEqual(["enwiki", "dewiki"]);
    const sum = r.series.reduce((n, s) => n + s.points.reduce<number>((a, b) => a + (b ?? 0), 0), 0);
    expect(sum).toBe(48);
  });

  it("returns newest-first samples", () => {
    const r = runDive(data, q({ view: "samples" }), profiles);
    expect(r.samples[0]![0]).toBe(iso(base + 47 * H));
  });

  it("picks nice auto buckets", () => {
    expect(autoBucketMs(48 * H)).toBe(H);
    expect(autoBucketMs(60 * 60_000)).toBe(60_000);
  });
});

describe("sql + links", () => {
  it("renders DuckDB SQL for table and time-series views", () => {
    const tbl = diveToSql(q({ view: "table", groupBy: ["wiki"], filters: [{ column: "bot", op: "=", values: ["true"] }] }), "wiki_stream", profiles);
    expect(tbl).toContain("GROUP BY ALL");
    expect(tbl).toContain("WHERE bot = 'true'");
    const ts = diveToSql(q({ metrics: [{ agg: "p99", column: "delta" }] }), "wiki_stream", profiles, H);
    expect(ts).toContain("time_bucket(INTERVAL '1 hour'");
    expect(diveToSql(q({ range: "90d", view: "table" }), "t", profiles)).toContain("INTERVAL '90 days'");
    expect(ts).toContain("quantile_cont(delta, 0.99)");
  });

  it("round-trips a query through the URL hash", () => {
    const query = q({ groupBy: ["wiki"], filters: [{ column: "user", op: "contains", values: ["ü 'quote'"] }] });
    const hash = `#${encodeDiveLink({ src: "stream://wiki", query })}`;
    expect(decodeDiveLink(hash)).toEqual({ src: "stream://wiki", query });
    expect(decodeDiveLink("#dive=not-json")).toBeNull();
    expect(decodeDiveLink("")).toBeNull();
  });

  it("drops fields a new dataset doesn't have", () => {
    const other = profileDiveColumns({ columns: ["city", "revenue"], rows: [["Paris", 3], ["Oslo", 4]] });
    const s = sanitizeDiveQuery(q({ groupBy: ["wiki"], metrics: [{ agg: "sum", column: "delta" }] }), other);
    expect(s.groupBy).toEqual([]);
    expect(s.metrics).toEqual([{ agg: "count", column: null }]);
    expect(s.timeColumn).toBeNull();
    expect(s.view).toBe("table");
  });
});

describe("scuba parity", () => {
  it("ORs multiple values and supports regex / LIKE", () => {
    const multi = runDive(data, q({ filters: [{ column: "user", op: "=", values: ["u0", "u1"] }] }), profiles);
    expect(multi.matched).toBe(20); // 10 + 10 of 48
    const notIn = runDive(data, q({ filters: [{ column: "user", op: "!=", values: ["u0", "u1"] }] }), profiles);
    expect(notIn.matched).toBe(28);
    const re = runDive(data, q({ filters: [{ column: "wiki", op: "~", values: ["^de"] }] }), profiles);
    expect(re.matched).toBe(16);
    const like = runDive(data, q({ filters: [{ column: "wiki", op: "like", values: ["en%"] }] }), profiles);
    expect(like.matched).toBe(32);
    // A half-typed filter doesn't hide everything.
    expect(runDive(data, q({ filters: [{ column: "wiki", op: "=", values: [] }] }), profiles).matched).toBe(48);
  });

  it("upgrades single-value filters from older links", () => {
    const legacy = { ...q(), filters: [{ column: "wiki", op: "=", value: "dewiki" }] } as unknown as DiveQuery;
    const s = sanitizeDiveQuery(legacy, profiles);
    expect(s.filters).toEqual([{ column: "wiki", op: "=", values: ["dewiki"] }]);
    expect(s.fill).toBe("auto");
    expect(s.orderDir).toBe("desc");
  });

  it("parses custom windows relative to the newest row", () => {
    const end = base + 47 * H;
    expect(parseDiveTime("-3 hours", end)).toBe(end - 3 * H);
    expect(parseDiveTime("-1w", end)).toBe(end - 7 * 24 * H);
    expect(parseDiveTime("2 days ago", end)).toBe(end - 48 * H);
    expect(parseDiveTime("latest", end)).toBe(end);
    expect(parseDiveTime("2026-09-01T00:00:00Z", end)).toBe(base);
    expect(parseDiveTime("gibberish", end)).toBeNaN();
    const r = runDive(data, q({ range: "custom", start: "-5 hours", end: "-2 hours" }), profiles);
    expect(r.matched).toBe(4); // hours 42..45
    expect(r.timeErrors).toEqual([]);
    expect(runDive(data, q({ range: "custom", start: "nope" }), profiles).timeErrors.length).toBe(1);
  });

  it("sorts ascending and reports hits per group", () => {
    const r = runDive(data, q({ groupBy: ["wiki"], view: "table", orderDir: "asc" }), profiles);
    expect(r.groups.map((g) => g.values[0])).toEqual(["dewiki", "enwiki"]);
    expect(r.groups.map((g) => g.hits)).toEqual([16, 32]);
  });

  it("supports more percentiles and first / last seen on time columns", () => {
    expect(percentileOf("p5")).toBe(0.05);
    expect(percentileOf("p999")).toBe(0.999);
    expect(percentileOf("avg")).toBeNull();
    const r = runDive(data, q({ metrics: [{ agg: "min", column: "ts" }, { agg: "max", column: "ts" }, { agg: "p25", column: "delta" }] }), profiles);
    expect(r.total[0]).toBe(base);
    expect(r.total[1]).toBe(base + 47 * H);
    expect(r.metricKinds).toEqual(["time", "time", "number"]);
    expect(r.total[2]).toBeCloseTo(11.75);
  });

  it("fills empty buckets per the fill mode and plots every metric", () => {
    const sparse: DiveData = { columns: ["ts", "v"], rows: [[iso(base), 1], [iso(base + 3 * H), 2]] };
    const p = profileDiveColumns(sparse);
    const run = (fill: DiveQuery["fill"]) =>
      runDive(sparse, { ...defaultDiveQuery(p), bucket: "1h", fill, metrics: [{ agg: "count", column: null }, { agg: "avg", column: "v" }] }, p).series[0]!;
    expect(run("auto").byMetric[0]).toEqual([1, 0, 0, 1]);
    expect(run("auto").byMetric[1]).toEqual([1, null, null, 2]);
    expect(run("zero").byMetric[1]).toEqual([1, 0, 0, 2]);
    expect(run("blank").byMetric[0]).toEqual([1, null, null, 1]);
  });

  it("reads epoch micro / nanoseconds", () => {
    expect(toTime(base * 1000)).toBe(base);
    expect(toTime(base * 1e6)).toBe(base);
  });

  it("renders the new options into SQL", () => {
    const sql = diveToSql(
      q({
        view: "table",
        groupBy: ["kind"],
        metrics: [{ agg: "p95", column: "delta" }],
        orderDir: "asc",
        derived: [{ name: "kind", expr: "CASE WHEN bot THEN 'bot' ELSE 'human' END", enabled: true }],
        filters: [
          { column: "user", op: "=", values: ["u0", "u1"] },
          { column: "wiki", op: "~", values: ["^de"] },
        ],
        range: "custom",
        start: "-3 hours",
      }),
      "wiki_stream",
      profiles,
    );
    expect(sql).toContain("WITH src AS");
    expect(sql).toContain("CASE WHEN bot THEN 'bot' ELSE 'human' END AS kind");
    expect(sql).toContain("user IN ('u0', 'u1')");
    expect(sql).toContain("regexp_matches(wiki::VARCHAR, '^de', 'i')");
    expect(sql).toContain("ts >= (SELECT max(ts) FROM src) - INTERVAL '3 hours'");
    expect(sql).toContain("ASC NULLS LAST");
    expect(sql).toContain("count(*) AS hits");
    expect(sql).toContain("quantile_cont(delta, 0.95) AS p95_delta");
  });
});

describe("derived columns", () => {
  const cols = ["ts", "wiki", "bot", "delta", "user", "title"];
  const ev = (src: string, row: unknown[]) => compileDiveExpr(src, cols).evaluate(row);
  const row = ["2026-09-01 13:45:10", "enwiki", true, -12, "Ann", "Main Page"];

  it("does arithmetic, strings, and booleans with SQL NULL rules", () => {
    expect(ev("delta * 2 + 1", row)).toBe(-23);
    expect(ev("abs(delta) / 4", row)).toBe(3);
    expect(ev("lower(user) || '@' || wiki", row)).toBe("ann@enwiki");
    expect(ev("bot AND delta < 0", row)).toBe(true);
    expect(ev("NOT bot OR NULL", row)).toBeNull();
    expect(ev("delta / 0", row)).toBeNull();
    expect(ev("coalesce(NULL, user)", row)).toBe("Ann");
    expect(ev("wiki IN ('dewiki', 'enwiki')", row)).toBe(true);
    expect(ev("title LIKE 'Main%'", row)).toBe(true);
    expect(ev("delta BETWEEN -20 AND 0", row)).toBe(true);
    expect(ev("user IS NOT NULL", row)).toBe(true);
    expect(ev("CAST(delta AS VARCHAR) || 'b'", row)).toBe("-12b");
    expect(ev("'3.7'::INTEGER", row)).toBe(3);
  });

  it("supports CASE, regex, and split helpers", () => {
    expect(ev("CASE WHEN delta > 0 THEN 'add' WHEN delta < 0 THEN 'cut' ELSE 'none' END", row)).toBe("cut");
    expect(ev("CASE wiki WHEN 'enwiki' THEN 'English' ELSE 'Other' END", row)).toBe("English");
    expect(ev("regexp_extract(title, '^(\\w+)', 1)", row)).toBe("Main");
    expect(ev("split_part(title, ' ', 2)", row)).toBe("Page");
    expect(ev("if(bot, 'bot', 'human')", row)).toBe("bot");
    expect(ev("round(10 / 3, 2)", row)).toBe(3.33);
  });

  it("buckets and labels time", () => {
    expect(ev("hour(ts)", row)).toBe(13);
    expect(ev("date_trunc('hour', ts)", row)).toBe("2026-09-01 13:00:00");
    expect(ev("date_trunc('day', ts)", row)).toBe("2026-09-01");
    expect(ev("strftime(ts, '%Y-%m')", row)).toBe("2026-09");
    expect(ev("dayname(ts)", row)).toBe("Tuesday");
    expect(formatExprTime(new Date(2026, 8, 1).getTime())).toBe("2026-09-01");
  });

  it("reports errors with positions", () => {
    expect(() => compileDiveExpr("delta +", cols)).toThrow(/ended early|end/);
    expect(() => compileDiveExpr("nope + 1", cols)).toThrow(/Unknown column nope/);
    expect(() => compileDiveExpr("frob(delta)", cols)).toThrow(/Unknown function/);
    expect(() => compileDiveExpr("'open", cols)).toThrow(/Unclosed/);
    expect(compileDiveExpr('"title" || DELTA', cols).refs).toEqual(["title", "delta"]);
  });

  it("appends derived columns that later ones (and the query) can use", () => {
    const out = applyDerivedColumns(
      data.columns,
      data.rows,
      [
        { name: "kind", expr: "CASE WHEN bot THEN 'bot' ELSE 'human' END", enabled: true },
        { name: "label", expr: "kind || ':' || wiki", enabled: true },
        { name: "broken", expr: "delta +", enabled: true },
        { name: "off", expr: "1", enabled: false },
      ],
    );
    expect(out.columns).toEqual([...data.columns, "kind", "label"]);
    expect(out.errors[2]).toMatch(/end/);
    expect(out.rows[0]!.slice(-2)).toEqual(["bot", "bot:dewiki"]);
    const p = profileDiveColumns({ columns: out.columns, rows: out.rows });
    const r = runDive({ columns: out.columns, rows: out.rows }, { ...defaultDiveQuery(p), groupBy: ["kind"], view: "table" }, p);
    expect(r.groups.map((g) => [g.values[0], g.hits])).toEqual([
      ["bot", 24],
      ["human", 24],
    ]);
    expect(nextDerivedName(["derived_1", "x"])).toBe("derived_2");
  });
});
