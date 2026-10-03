import { afterEach, describe, expect, it, vi } from "vitest";
import { SOURCE_DEFS, SOURCE_KINDS } from "../sourceRegistry";
import {
  parseSourceRows,
  stormLevel,
  webSourceClear,
  webSourceSnapshot,
  webSourceStart,
  webSourceStop,
} from "../webStreams";

describe("web source parsers (new feeds)", () => {
  it("eonet: one row per event at its latest geometry; polygons use the ring centroid", () => {
    const body = {
      events: [
        {
          id: "EONET_24962",
          title: "Typhoon Choi-wan",
          closed: null,
          categories: [{ id: "severeStorms", title: "Severe Storms" }],
          sources: [{ id: "JTWC", url: "https://example" }],
          geometry: [
            { magnitudeValue: 70.0, magnitudeUnit: "kts", date: "2026-10-02T12:00:00Z", type: "Point", coordinates: [144.6, 17.7] },
            { magnitudeValue: 60.0, magnitudeUnit: "kts", date: "2026-10-02T06:00:00Z", type: "Point", coordinates: [144.6, 16.9] },
          ],
        },
        {
          id: "EONET_1",
          title: "Some Fire",
          closed: "2026-10-01T00:00:00Z",
          categories: [{ title: "Wildfires" }],
          sources: [{ id: "IRWIN" }],
          geometry: [
            { date: "2026-09-30T00:00:00Z", type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] },
          ],
        },
      ],
    };
    expect(parseSourceRows("eonet", body)).toEqual([
      ["EONET_24962", "Typhoon Choi-wan", "Severe Storms", "JTWC", "2026-10-02T12:00:00.000Z", 17.7, 144.6, 70, "kts", "open"],
      ["EONET_1", "Some Fire", "Wildfires", "IRWIN", "2026-09-30T00:00:00.000Z", 1, 1, null, null, "closed"],
    ]);
  });

  it("spaceweather: Kp rows with NOAA G-scale (object and legacy table shapes)", () => {
    const rows = parseSourceRows("spaceweather", [
      { time_tag: "2026-10-02T15:00:00", Kp: 0.33, a_running: 2, station_count: 8 },
      { time_tag: "2026-10-02T18:00:00", Kp: 6.67, a_running: 80, station_count: 8 },
    ]);
    expect(rows).toEqual([
      ["2026-10-02T15:00:00.000Z", 0.33, 2, 8, "G0"],
      ["2026-10-02T18:00:00.000Z", 6.67, 80, 8, "G3"],
    ]);
    const legacy = parseSourceRows("spaceweather", [
      ["time_tag", "Kp", "a_running", "station_count"],
      ["2026-10-02 15:00:00.000", "4.67", "39", "8"],
    ]);
    expect(legacy).toEqual([["2026-10-02T15:00:00.000Z", 4.67, 39, 8, "G1"]]);
    expect([4.33, 5, 5.33, 6, 7, 8, 9].map(stormLevel)).toEqual(["G0", "G1", "G1", "G2", "G3", "G4", "G5"]);
  });

  it("ukcarbon: half-hour rows with null actual when not yet measured", () => {
    const body = {
      data: [
        { from: "2026-10-01T23:00Z", to: "2026-10-01T23:30Z", intensity: { forecast: 158, actual: 152, index: "moderate" } },
        { from: "2026-10-02T22:30Z", to: "2026-10-02T23:00Z", intensity: { forecast: 114, actual: null, index: "low" } },
      ],
    };
    expect(parseSourceRows("ukcarbon", body)).toEqual([
      ["2026-10-01T23:00:00.000Z", 158, 152, "moderate"],
      ["2026-10-02T22:30:00.000Z", 114, null, "low"],
    ]);
  });

  it("pageviews: drops Main_Page / special namespaces, re-ranks, spaces in titles", () => {
    const body = {
      items: [
        {
          year: "2026",
          month: "10",
          day: "01",
          articles: [
            { article: "Main_Page", views: 6672618, rank: 1 },
            { article: "Christa_Pike", views: 4309025, rank: 2 },
            { article: "Special:Search", views: 897019, rank: 3 },
            { article: "Wikipedia:Featured_pictures", views: 600233, rank: 4 },
            { article: "USS_Theodore_Roosevelt_(CVN-71)", views: 495200, rank: 5 },
            { article: "-", views: 1000, rank: 6 },
            { article: "User_talk:Someone", views: 900, rank: 7 },
          ],
        },
      ],
    };
    expect(parseSourceRows("pageviews", body)).toEqual([
      [1, "Christa Pike", 4309025, "2026-10-01"],
      [2, "USS Theodore Roosevelt (CVN-71)", 495200, "2026-10-01"],
    ]);
  });

  it("climate: monthly anomaly rows from { departure } / bare numbers", () => {
    const body = {
      description: { title: "Global Land and Ocean Average Temperature Departures", units: "Degrees Celsius" },
      data: { "188002": { departure: -0.47 }, "188001": { departure: -0.4 }, "202609": 1.21, "202610": { departure: -999 } },
    };
    expect(parseSourceRows("climate", body)).toEqual([
      ["1880-01-01", 1880, 1, -0.4],
      ["1880-02-01", 1880, 2, -0.47],
      ["2026-09-01", 2026, 9, 1.21],
    ]);
  });

  it("fx: time series → one row per (date, quote) with change vs previous day", () => {
    const body = {
      amount: 1,
      base: "EUR",
      start_date: "2026-07-03",
      end_date: "2026-07-07",
      rates: {
        "2026-07-07": { USD: 1.1, JPY: 160 },
        "2026-07-03": { USD: 1.0, JPY: 160 },
      },
    };
    expect(parseSourceRows("fx", body)).toEqual([
      ["2026-07-03", "EUR", "USD", 1.0, null],
      ["2026-07-03", "EUR", "JPY", 160, null],
      ["2026-07-07", "EUR", "USD", 1.1, 10],
      ["2026-07-07", "EUR", "JPY", 160, 0],
    ]);
    // Old `/latest` shape still works
    expect(parseSourceRows("fx", { base: "EUR", date: "2026-10-02", rates: { USD: 1.08 } })).toEqual([
      ["2026-10-02", "EUR", "USD", 1.08, 0],
    ]);
  });

  it("launches: Launch Library 2 normal mode (objects) and list mode (strings)", () => {
    const normal = {
      results: [
        {
          id: "da43",
          name: "Falcon 9 Block 5 | SDA Tranche 1",
          net: "2026-10-05T08:17:00Z",
          status: { name: "Go for Launch", abbrev: "Go" },
          pad: { name: "Space Launch Complex 4E", location: { name: "Vandenberg SFB, CA, USA" } },
          launch_service_provider: { name: "SpaceX" },
          rocket: { configuration: { full_name: "Falcon 9 Block 5", name: "Falcon 9" } },
          mission: { type: "Government/Top Secret", orbit: { name: "Low Earth Orbit", abbrev: "LEO" } },
        },
        {
          id: "ns",
          name: "New Shepard | NS-40",
          net: "2026-10-06T00:00:00Z",
          status: { name: "To Be Confirmed" },
          mission: { type: "Tourism", orbit: { name: "Suborbital", abbrev: "Sub" } },
        },
      ],
    };
    const rows = parseSourceRows("launches", normal);
    expect(rows[0]).toEqual([
      "da43",
      "Falcon 9 Block 5 | SDA Tranche 1",
      "2026-10-05T08:17:00Z",
      "Go for Launch",
      "Space Launch Complex 4E",
      "Vandenberg SFB, CA, USA",
      "SpaceX",
      "Falcon 9 Block 5",
      true,
    ]);
    expect(rows[1]![8]).toBe(false);
    const list = {
      results: [
        {
          id: "a1",
          name: "Long March 12 | Unknown Payload",
          net: "2026-10-09T19:25:00Z",
          status: { name: "Go for Launch" },
          lsp_name: "CASC",
          mission: "Unknown Payload",
          pad: "Commercial LC-2",
          location: "Wenchang Space Launch Site",
        },
      ],
    };
    expect(parseSourceRows("launches", list)[0]!.slice(4, 8)).toEqual([
      "Commercial LC-2",
      "Wenchang Space Launch Site",
      "CASC",
      "Long March 12",
    ]);
  });

  it("every parser emits rows as wide as its registry columns", () => {
    const samples: Partial<Record<(typeof SOURCE_KINDS)[number], unknown>> = {
      eonet: { events: [{ id: "e", geometry: [{ type: "Point", coordinates: [1, 2], date: "2026-01-01T00:00:00Z" }] }] },
      citibike: { stations: [{ station_id: "s" }] },
      spaceweather: [{ time_tag: "2026-01-01T00:00:00", Kp: 1 }],
      ukcarbon: { data: [{ from: "2026-01-01T00:00Z", intensity: {} }] },
      pageviews: { items: [{ year: "2026", month: "01", day: "01", articles: [{ article: "A", views: 1 }] }] },
      climate: { data: { "202601": 1 } },
      world_bank: { rows: [{ country_code: "ABW", yr: 2023 }] },
      fx: { rates: { "2026-01-01": { USD: 1 } } },
      countries: [{ name: { common: "A" } }],
      spacex: [{ id: "x" }],
    };
    // Columnar feeds: the Worker sends `{ columns, rows }` named after the registry
    for (const k of ["gdacs", "buoys", "mbta", "aurora", "asteroids", "steam", "bitcoin", "debt"] as const) {
      const cols = SOURCE_DEFS.find((d) => d.kind === k)!.columns;
      samples[k] = { columns: cols, rows: [cols.map(() => null)] };
    }
    for (const d of SOURCE_DEFS) {
      const body = samples[d.kind];
      if (body === undefined) continue;
      const rows = parseSourceRows(d.kind, body);
      expect(rows.length, d.kind).toBeGreaterThan(0);
      expect(rows[0]!.length, d.kind).toBe(d.columns.length);
    }
  });

  it("columnar parser maps by name, coerces to registry types, nulls unknown columns", () => {
    const body = {
      // Worker order differs and one registry column is missing ("severity_unit")
      columns: ["title", "id", "event_type", "alert_level", "alert_score", "country", "latitude", "longitude", "start_ts", "end_ts", "severity", "extra"],
      rows: [["Quake", "EQ1", "Earthquake", "Green", "1", "", "51.5", null, "2026-10-02T20:54:15Z", "nope", "", "x"]],
    };
    expect(parseSourceRows("gdacs", body)).toEqual([
      ["EQ1", "Earthquake", "Quake", "Green", 1, null, 51.5, null, "2026-10-02T20:54:15.000Z", null, null, null],
    ]);
    expect(parseSourceRows("debt", { columns: ["record_date", "total_debt"], rows: [["2026-10-01", "1.5"]] })).toEqual([
      ["2026-10-01", 1.5, null, null],
    ]);
    expect(parseSourceRows("mbta", { error: "MBTA 429" })).toEqual([]);
  });
});

describe("web source buffers replace snapshot feeds instead of appending", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function pollTwice(kind: "citibike" | "meteo" | "mbta" | "debt", bodies: unknown[]) {
    const fetchMock = vi.fn();
    for (const b of bodies) fetchMock.mockResolvedValueOnce({ ok: true, json: async () => b });
    vi.stubGlobal("fetch", fetchMock);
    await webSourceClear(kind);
    for (let i = 0; i < bodies.length; i++) {
      await webSourceStart(kind);
      await webSourceStop(kind);
    }
    return webSourceSnapshot(kind);
  }

  it("citibike keeps one row per station across polls", async () => {
    const poll = (bikes: number) => ({
      stations: [
        { station_id: "s1", bikes_available: bikes, capacity: 10 },
        { station_id: "s2", bikes_available: 1, capacity: 10 },
      ],
    });
    const snap = await pollTwice("citibike", [poll(3), poll(7)]);
    expect(snap.sample.total_rows).toBe(2);
    const s1 = snap.sample.rows.find((r) => r[0] === "s1")!;
    expect(s1[5]).toBe(7);
  });

  it("mbta (columnar) keeps one row per vehicle across polls", async () => {
    const cols = SOURCE_DEFS.find((d) => d.kind === "mbta")!.columns;
    const poll = (lat: number) => ({
      columns: cols,
      rows: [
        ["v1", "1", "Red Line", "Subway", lat, -71, 90, null, "In transit", null, "2026-10-03T00:25:24Z"],
        ["v2", "2", "57", "Bus", 42.3, -71.1, 0, 10, "Stopped", "Full", "2026-10-03T00:25:24Z"],
        ["v2", "2", "57", "Bus", 42.3, -71.1, 0, 10, "Stopped", "Full", "2026-10-03T00:25:24Z"],
      ],
    });
    const snap = await pollTwice("mbta", [poll(42.1), poll(42.2)]);
    expect(snap.sample.total_rows).toBe(2);
    expect(snap.sample.rows.find((r) => r[0] === "v1")![4]).toBe(42.2);
  });

  it("debt keeps its whole history (more than the default 8k-row cap)", async () => {
    const rows: unknown[][] = [];
    for (let i = 0; i < 8_500; i++) rows.push([new Date(Date.UTC(1993, 3, 1) + i * 86_400_000).toISOString().slice(0, 10), i, null, null]);
    const snap = await pollTwice("debt", [{ columns: ["record_date", "total_debt", "held_by_public", "intragovernmental"], rows }]);
    expect(snap.sample.total_rows).toBe(8_500);
  });

  it("an empty / failed-shape poll keeps the last good snapshot", async () => {
    const good = { cities: [{ name: "X", lat: 1, lon: 2, hourly: { time: ["2026-10-01T00:00", "2026-10-01T01:00"], temperature_2m: [1, 2] } }] };
    const snap = await pollTwice("meteo", [good, good, { error: "nope" }]);
    expect(snap.sample.total_rows).toBe(2);
  });
});
