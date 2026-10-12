/**
 * LOOM-435 — Citi Bike GBFS parity gate.
 *
 * The Worker `joinCitibike` → `parseSourceRows("citibike", …)` path and the
 * Rust `citibike_rows` path must emit identical typed values for the same GBFS
 * payloads. This test reads the shared fixtures under
 * `src-tauri/tests/fixtures/sources/gbfs_parity_*.json` and checks the TS side
 * against the expected output.  A matching Rust test
 * (`citibike_matches_shared_parity_fixture`) checks the native side.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { joinCitibike } from "../../../workers/sourceTransforms";
import { parseSourceRows } from "../webStreams";
import { SOURCE_DEFS } from "../sourceRegistry";

const fixtureDir = path.resolve(__dirname, "../../../src-tauri/tests/fixtures/sources");
const readFixture = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(fixtureDir, name), "utf-8"));

describe("Citi Bike GBFS parity gate (LOOM-435)", () => {
  const info = readFixture("gbfs_parity_info.json");
  const status = readFixture("gbfs_parity_status.json");
  const expected = readFixture("gbfs_parity_expected.json");

  it("columns match the source registry and the shared fixture", () => {
    const registryCols = SOURCE_DEFS.find((d) => d.kind === "citibike")!.columns;
    expect(expected.columns).toEqual(registryCols);
  });

  it("TS joinCitibike → parseSourceRows produces the parity-expected rows", () => {
    const joined = joinCitibike(info, status);
    const rows = parseSourceRows("citibike", joined);

    // Normalize: fixture rows may have timestamp strings; parseSourceRows
    // also produces ISO strings from epoch seconds.
    const normalize = (v: unknown) => (typeof v === "number" ? v : v);
    const normalizedExpected = expected.rows.map((r: unknown[]) => r.map(normalize));
    const normalizedGot = rows.map((r) => r.map(normalize));

    expect(normalizedGot).toEqual(normalizedExpected);
  });

  it("uninstalled stations are excluded", () => {
    const joined = joinCitibike(info, status);
    const rows = parseSourceRows("citibike", joined);
    const ids = rows.map((r) => r[0]);
    expect(ids).not.toContain("uninstalled");
  });

  it("stations without coordinates are excluded", () => {
    const joined = joinCitibike(info, status);
    const rows = parseSourceRows("citibike", joined);
    const ids = rows.map((r) => r[0]);
    expect(ids).not.toContain("no-coords");
  });

  it("stations not in info feed are excluded", () => {
    const joined = joinCitibike(info, status);
    const rows = parseSourceRows("citibike", joined);
    const ids = rows.map((r) => r[0]);
    expect(ids).not.toContain("not-in-info");
  });

  it("zero-capacity station has null pct_full, not zero", () => {
    const joined = joinCitibike(info, status);
    const rows = parseSourceRows("citibike", joined);
    const zeroCap = rows.find((r) => r[0] === "zero-cap");
    expect(zeroCap).toBeDefined();
    expect(zeroCap![4]).toBe(0);    // capacity
    expect(zeroCap![8]).toBeNull();  // pct_full — not 0
  });

  it("overfull station caps pct_full at 100", () => {
    const joined = joinCitibike(info, status);
    const rows = parseSourceRows("citibike", joined);
    const overfull = rows.find((r) => r[0] === "overfull");
    expect(overfull).toBeDefined();
    expect(overfull![8]).toBe(100);
  });
});
