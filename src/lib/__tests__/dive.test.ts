/**
 * Unit tests for Dive — Scuba-style slice-and-dice engine.
 */
import { describe, it, expect } from "vitest";
import {
  autoBucketMs,
  decodeDiveLink,
  defaultDiveQuery,
  diveToSql,
  encodeDiveLink,
  formatDelta,
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
    const r = runDive(data, q({ filters: [{ column: "wiki", op: "=", value: "DEWIKI" }, { column: "delta", op: ">=", value: "24" }] }), profiles);
    expect(r.matched).toBe(8); // h = 24, 27, …, 45
    const nb = runDive(data, q({ filters: [{ column: "bot", op: "=", value: "false" }] }), profiles);
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
    const tbl = diveToSql(q({ view: "table", groupBy: ["wiki"], filters: [{ column: "bot", op: "=", value: "true" }] }), "wiki_stream", profiles);
    expect(tbl).toContain("GROUP BY ALL");
    expect(tbl).toContain("WHERE bot = 'true'");
    const ts = diveToSql(q({ metrics: [{ agg: "p99", column: "delta" }] }), "wiki_stream", profiles, H);
    expect(ts).toContain("time_bucket(INTERVAL '1 hour'");
    expect(diveToSql(q({ range: "90d", view: "table" }), "t", profiles)).toContain("INTERVAL '90 days'");
    expect(ts).toContain("quantile_cont(delta, 0.99)");
  });

  it("round-trips a query through the URL hash", () => {
    const query = q({ groupBy: ["wiki"], filters: [{ column: "user", op: "contains", value: "ü 'quote'" }] });
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
