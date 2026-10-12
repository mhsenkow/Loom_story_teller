// =================================================================
// Worker transform boundary / degraded-input tests (LOOM-498)
// =================================================================
// Malformed or partial upstream payloads must yield documented null /
// dropped-row output — never a fabricated 0 measurement or an invented
// timestamp. Covers FIRMS, NWIS, Starlink, Open-Meteo city batches and
// Citi Bike joins.
// =================================================================

import { describe, expect, it } from "vitest";
import {
  FIRMS_COLUMNS,
  NWIS_COLUMNS,
  STARLINK_COLUMNS,
  WORLD_CITIES,
  firmsViirsCsv,
  joinCitibike,
  nwisIvWide,
  openMeteoCities,
  starlinkGp,
} from "../../../workers/sourceTransforms";

const col = (columns: string[], name: string) => columns.indexOf(name);

describe("firmsViirsCsv degraded input", () => {
  const header = "latitude,longitude,bright_ti4,bright_ti5,frp,confidence,satellite,acq_date,acq_time,daynight";

  it("returns no rows for empty / header-only / garbage text", () => {
    expect(firmsViirsCsv("").rows).toEqual([]);
    expect(firmsViirsCsv(header).rows).toEqual([]);
    expect(firmsViirsCsv("<html>502 Bad Gateway</html>").rows).toEqual([]);
  });

  it("keeps blank measurements null (not 0) and drops rows without coordinates", () => {
    const csv = [header, "34.5,-110.2,,,  ,n,N20,2026-10-12,930,D", ",,300,280,5,h,N20,2026-10-12,0100,N", "x,y,1,1,1,h,N20,2026-10-12,0100,N"].join("\n");
    const out = firmsViirsCsv(csv);
    expect(out.rows).toHaveLength(1);
    const r = out.rows[0]!;
    expect(r[col(FIRMS_COLUMNS, "bright_ti4")]).toBeNull();
    expect(r[col(FIRMS_COLUMNS, "bright_ti5")]).toBeNull();
    expect(r[col(FIRMS_COLUMNS, "frp")]).toBeNull();
    expect(r[col(FIRMS_COLUMNS, "acq_ts")]).toBe("2026-10-12T09:30:00Z");
  });

  it("invalid date/time gives a null timestamp, and a UTF-8 BOM header still parses", () => {
    const csv = `\uFEFF${header}\n34.5,-110.2,300,280,5,h,N20,not-a-date,xx,D`;
    const out = firmsViirsCsv(csv);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]![col(FIRMS_COLUMNS, "acq_ts")]).toBeNull();
  });

  it("missing optional columns degrade to null, not NaN or 0", () => {
    const out = firmsViirsCsv("latitude,longitude,acq_date,acq_time\n1,2,2026-10-12,0000");
    expect(out.rows[0]![col(FIRMS_COLUMNS, "frp")]).toBeNull();
    expect(out.rows[0]![col(FIRMS_COLUMNS, "confidence")]).toBeNull();
  });
});

describe("nwisIvWide degraded input", () => {
  const series = (code: string, values: unknown[], extra: Record<string, unknown> = {}) => ({
    sourceInfo: {
      siteCode: [{ value: "01646500" }],
      siteName: "Potomac",
      geoLocation: { geogLocation: { latitude: 38.9, longitude: -77.1 } },
    },
    variable: { variableCode: [{ value: code }], ...extra },
    values: [{ value: values }],
  });
  const body = (...ts: unknown[]) => ({ value: { timeSeries: ts } });

  it("returns no rows for missing timeSeries or a non-object body", () => {
    expect(nwisIvWide({}).rows).toEqual([]);
    expect(nwisIvWide(null).rows).toEqual([]);
    expect(nwisIvWide("oops").rows).toEqual([]);
  });

  it("turns the -999999 sentinel into null and drops all-sentinel rows", () => {
    const out = nwisIvWide(
      body(
        series("00060", [
          { dateTime: "2026-10-12T10:00:00.000-04:00", value: "-999999" },
          { dateTime: "2026-10-12T10:15:00.000-04:00", value: "1200" },
        ]),
        series("00065", [
          { dateTime: "2026-10-12T10:00:00.000-04:00", value: "-999999" },
          { dateTime: "2026-10-12T10:15:00.000-04:00", value: "-999999" },
        ]),
      ),
    );
    expect(out.rows).toHaveLength(1);
    const r = out.rows[0]!;
    expect(r[col(NWIS_COLUMNS, "discharge_cfs")]).toBe(1200);
    expect(r[col(NWIS_COLUMNS, "gage_height_ft")]).toBeNull();
    expect(r[col(NWIS_COLUMNS, "ts")]).toBe("2026-10-12T14:15:00.000Z");
  });

  it("honours a series-specific noDataValue", () => {
    const out = nwisIvWide(
      body(
        series("00060", [{ dateTime: "2026-10-12T10:00:00.000Z", value: "-1" }, { dateTime: "2026-10-12T11:00:00.000Z", value: "5" }], {
          noDataValue: -1,
        }),
      ),
    );
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]![col(NWIS_COLUMNS, "discharge_cfs")]).toBe(5);
  });

  it("drops unparseable timestamps and blank values instead of fabricating 0", () => {
    const out = nwisIvWide(
      body(
        series("00060", [
          { dateTime: "yesterday-ish", value: "10" },
          { dateTime: "2026-10-12T10:00:00.000Z", value: "" },
          { dateTime: "2026-10-12T10:05:00.000Z", value: "   " },
        ]),
      ),
    );
    expect(out.rows).toEqual([]);
  });

  it("a gauge with only stage keeps null discharge (missing join)", () => {
    const out = nwisIvWide(body(series("00065", [{ dateTime: "2026-10-12T10:00:00.000Z", value: "3.2" }])));
    expect(out.rows[0]![col(NWIS_COLUMNS, "discharge_cfs")]).toBeNull();
    expect(out.rows[0]![col(NWIS_COLUMNS, "gage_height_ft")]).toBe(3.2);
  });
});

describe("starlinkGp degraded input", () => {
  it("non-array / empty bodies yield no rows", () => {
    expect(starlinkGp({ error: "rate limited" }).rows).toEqual([]);
    expect(starlinkGp("No GP data found").rows).toEqual([]);
    expect(starlinkGp([]).rows).toEqual([]);
  });

  it("skips records without a NORAD id and drops debris", () => {
    const out = starlinkGp([
      { OBJECT_NAME: "STARLINK-1", NORAD_CAT_ID: 1, EPOCH: "2026-10-12T00:00:00" },
      { OBJECT_NAME: "STARLINK-2" },
      { OBJECT_NAME: "STARLINK-3 DEB", NORAD_CAT_ID: 3 },
    ]);
    expect(out.rows.map((r) => r[0])).toEqual([1]);
  });

  it("nulls invalid epochs and blank elements (no 0 inclination, no raw garbage timestamp)", () => {
    const out = starlinkGp([{ OBJECT_NAME: "STARLINK-9", NORAD_CAT_ID: "9", EPOCH: "garbage", INCLINATION: "", MEAN_MOTION: " ", BSTAR: null }]);
    const r = out.rows[0]!;
    expect(r[col(STARLINK_COLUMNS, "epoch")]).toBeNull();
    expect(r[col(STARLINK_COLUMNS, "inclination")]).toBeNull();
    expect(r[col(STARLINK_COLUMNS, "mean_motion")]).toBeNull();
    expect(r[col(STARLINK_COLUMNS, "bstar")]).toBeNull();
  });

  it("treats zone-less epochs as UTC and caps output", () => {
    const rows = Array.from({ length: 2600 }, (_, i) => ({ OBJECT_NAME: `S-${i}`, NORAD_CAT_ID: i + 1, EPOCH: "2026-10-12T01:02:03" }));
    const out = starlinkGp(rows);
    expect(out.rows).toHaveLength(2500);
    expect(out.rows[0]![col(STARLINK_COLUMNS, "epoch")]).toBe("2026-10-12T01:02:03.000Z");
  });
});

describe("partial batches and missing joins", () => {
  it("openMeteoCities skips cities missing from a short/partial batch and keeps order", () => {
    const body = [
      { current: { time: "t", pm2_5: 1 } },
      {},
      { current: { time: "t", pm2_5: 3 } },
    ];
    const out = openMeteoCities(body, "current");
    expect(out.cities.map((c) => c.name)).toEqual([WORLD_CITIES[0].name, WORLD_CITIES[2].name]);
  });

  it("openMeteoCities returns an empty list for an error object", () => {
    expect(openMeteoCities({ error: true, reason: "limit" }, "current").cities).toEqual([]);
  });

  it("joinCitibike drops statuses with no station_information match", () => {
    const info = { data: { stations: [{ station_id: "a", name: "A", lat: 40.7, lon: -74, capacity: 10 }] } };
    const status = {
      data: {
        stations: [
          { station_id: "a", is_installed: 1, num_bikes_available: 4, last_reported: 1_760_000_000 },
          { station_id: "ghost", is_installed: 1, num_bikes_available: 9 },
        ],
      },
    };
    expect(joinCitibike(info, status).stations.map((s) => s.station_id)).toEqual(["a"]);
  });
});
