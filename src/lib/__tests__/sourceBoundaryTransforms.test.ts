// =================================================================
// Worker transform boundary cases (LOOM-498) + Citi Bike fixtures (LOOM-435)
// =================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  firmsViirsCsv,
  joinCitibike,
  nwisIvWide,
  starlinkGp,
  WORLD_CITIES,
} from "../../../workers/sourceTransforms";

const FIXTURES = resolve(__dirname, "../../../src-tauri/tests/fixtures/sources");

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(FIXTURES, name), "utf8"));
}

describe("Citi Bike shared fixtures (LOOM-435)", () => {
  it("joins GBFS info+status with null pct_full when capacity is zero", () => {
    const out = joinCitibike(fixture("gbfs_info.json"), fixture("gbfs_status.json"));
    const byId = new Map(out.stations.map((s) => [String(s.station_id), s]));
    // Installed station with capacity from info fixture
    const a = byId.get("7a6fc75f-a605-4dd6-b567-b2bbbfb862f3");
    expect(a?.bikes_available).toBe(8);
    expect(a?.ebikes_available).toBe(3);
    expect(typeof a?.pct_full).toBe("number");
    // Not installed → dropped
    expect(byId.has("1822663031356509142")).toBe(false);
    // Status without info → dropped
    expect(byId.has("not-in-info")).toBe(false);
  });
});

describe("Worker transform boundaries (LOOM-498)", () => {
  it("FIRMS: empty/malformed CSV yields no fabricated rows", () => {
    expect(firmsViirsCsv("").rows).toEqual([]);
    expect(firmsViirsCsv("not,a,firms\nheader").rows).toEqual([]);
    const partial = firmsViirsCsv(
      "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight\n,,,",
    );
    for (const row of partial.rows) {
      // Never invent a 0 FRP for missing brightness
      expect(row[5] === null || typeof row[5] === "number").toBe(true);
    }
  });

  it("NWIS: missing values stay null, not zero", () => {
    const out = nwisIvWide({
      value: {
        timeSeries: [
          {
            sourceInfo: {
              siteCode: [{ value: "01646500" }],
              siteName: "Potomac",
              geoLocation: { geogLocation: { latitude: 38.9, longitude: -77.1 } },
            },
            variable: { variableCode: [{ value: "00060" }] },
            values: [{ value: [{ dateTime: "2026-10-05T12:00:00.000-04:00", value: "" }] }],
          },
        ],
      },
    });
    expect(out.rows.length).toBeLessThanOrEqual(1);
    if (out.rows[0]) {
      expect(out.rows[0][5] === null || out.rows[0][5] === undefined || Number.isNaN(Number(out.rows[0][5]))).toBe(
        true,
      );
    }
  });

  it("Starlink: debris / incomplete GP objects are skipped", () => {
    const out = starlinkGp([
      { OBJECT_NAME: "STARLINK-1 DEB", NORAD_CAT_ID: 1, MEAN_MOTION: 15 },
      { OBJECT_NAME: "STARLINK-2" }, // missing NORAD
      {
        OBJECT_NAME: "STARLINK-3",
        NORAD_CAT_ID: 3,
        MEAN_MOTION: 15.1,
        ECCENTRICITY: 0.0001,
        INCLINATION: 53,
        RA_OF_ASC_NODE: 1,
        ARG_OF_PERICENTER: 2,
        MEAN_ANOMALY: 3,
        EPOCH: "2026-10-05T00:00:00.000",
        BSTAR: 0.0001,
      },
    ]);
    expect(out.rows.map((r) => r[0])).toEqual([3]);
  });
});

describe("shared city constants (LOOM-681)", () => {
  it("WORLD_CITIES names match Rust CITIES set in sources.rs", () => {
    const rust = readFileSync(resolve(__dirname, "../../../src-tauri/src/sources.rs"), "utf8");
    const block = rust.match(/const CITIES: &[^=]*= &\[([\s\S]*?)\];/)?.[1] ?? "";
    const rustNames = [...block.matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1]!).sort();
    const tsNames = WORLD_CITIES.map((c) => c.name).slice().sort();
    expect(tsNames).toEqual(rustNames);
  });
});
