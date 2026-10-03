import { describe, expect, it } from "vitest";
import {
  WB_WIDE_INDICATORS,
  WORLD_CITIES,
  adsbToOpensky,
  auroraCells,
  cadDate,
  cneosApproaches,
  diameterFromH,
  gdacsEvents,
  joinCitibike,
  ll2ToSpacex,
  mergeCountries,
  mbtaVehicles,
  mempoolBlocks,
  mempoolLowestHeight,
  mergeUkCarbon,
  ndbcLatestObs,
  openMeteoCities,
  paprikaToGecko,
  steamTop,
  treasuryDebt,
  trimNwsAlerts,
  utcDay,
  worldBankWide,
} from "../../../workers/sourceTransforms";
import { SOURCE_DEFS } from "../sourceRegistry";
import { parseSourceRows } from "../webStreams";

describe("Worker source transforms (shapes the browser parsers read)", () => {
  it("openMeteoCities maps the multi-location array onto city names in order", () => {
    const body = WORLD_CITIES.map((_, i) => ({ latitude: 0, longitude: 0, current: { time: "2026-10-02T20:00", pm2_5: i } }));
    const out = openMeteoCities(body, "current");
    expect(out.cities).toHaveLength(12);
    expect(out.cities[3]).toMatchObject({ name: WORLD_CITIES[3].name, current: { pm2_5: 3 } });
    // Single location → bare object
    const one = openMeteoCities({ hourly: { time: ["2026-10-01T00:00"] } }, "hourly", [{ name: "X", lat: 1, lon: 2 }]);
    expect(one.cities).toEqual([{ name: "X", lat: 1, lon: 2, hourly: { time: ["2026-10-01T00:00"] } }]);
    expect(parseSourceRows("meteo", one)).toHaveLength(1);
  });

  it("trimNwsAlerts keeps the newest N features with parser fields only", () => {
    const body = {
      features: [
        { id: "a", geometry: { big: true }, properties: { sent: "2026-10-01T02:45:00-08:00", event: "Old", description: "x".repeat(1000) } },
        { id: "b", properties: { sent: "2026-10-02T16:43:00-04:00", event: "New", severity: "Severe", areaDesc: "Here" } },
        { id: "c", properties: { sent: "2026-10-02T10:00:00Z", event: "Mid" } },
      ],
    };
    const out = trimNwsAlerts(body, 2);
    expect(out.features.map((f) => f.id)).toEqual(["b", "c"]);
    expect(out.features[0]).not.toHaveProperty("geometry");
    expect(out.features[0]!.properties).not.toHaveProperty("description");
    const rows = parseSourceRows("nws", out);
    expect(rows[0]!.slice(0, 7)).toEqual(["b", "New", "", "Severe", "", "", "Here"]);
  });

  it("paprikaToGecko feeds parseCrypto", () => {
    const body = [
      {
        id: "btc-bitcoin",
        name: "Bitcoin",
        symbol: "BTC",
        rank: 1,
        quotes: { USD: { price: 84238.7, volume_24h: 34586488724.4, market_cap: 1692573758269, percent_change_24h: -0.25 } },
      },
    ];
    expect(parseSourceRows("crypto", paprikaToGecko(body))).toEqual([
      ["btc-bitcoin", "BTC", "Bitcoin", 84238.7, 1692573758269, 34586488724.4, -0.25, 1],
    ]);
  });

  it("adsbToOpensky converts units, flags ground, dedupes, and interleaves points", () => {
    const a = {
      now: 1790974052501,
      ac: [
        { hex: "a82cb1", flight: "COL626  ", lat: 40.54, lon: -79.43, alt_baro: 38000, gs: 349.5, track: 289.73, seen_pos: 0.04 },
        { hex: "aaa02d", flight: "N784JC  ", lat: 41.31, lon: -79.39, alt_baro: "ground", gs: 10, track: 30 },
        { hex: "nolatlon" },
      ],
    };
    const b = { now: 1790974050000, ac: [{ hex: "A82CB1", lat: 40.5, lon: -79.4 }, { hex: "c0ffee", lat: 33, lon: -97, alt_baro: 1000, gs: 100, track: 1 }] };
    const out = adsbToOpensky([a, b]);
    expect(out.time).toBe(1790974052);
    expect(out.states.map((s) => s[0])).toEqual(["a82cb1", "aaa02d", "c0ffee"]);
    const first = out.states[0]!;
    expect(first[1]).toBe("COL626");
    expect(first[7]).toBeCloseTo(38000 * 0.3048, 0); // meters
    expect(first[9]).toBeCloseTo(349.5 * 0.514444, 1); // m/s
    expect(out.states[1]![8]).toBe(true);
    expect(out.states[1]![7]).toBe(0);

    const rows = parseSourceRows("opensky", out);
    expect(rows).toHaveLength(3);
    // icao24, callsign, origin_country, lon, lat, baro_altitude, velocity, true_track, on_ground, ts
    expect(rows[0]!.slice(0, 5)).toEqual(["a82cb1", "COL626", "", -79.43, 40.54]);
    expect(rows[0]![7]).toBe(289.73);
    expect(rows[0]![9]).toBe(new Date(1790974052 * 1000).toISOString());
  });

  it("ll2ToSpacex maps Launch Library 2 previous launches (normal + list mode)", () => {
    const normal = {
      results: [
        {
          id: "4651fd8a",
          name: "Falcon Heavy | NROL-97",
          status: { abbrev: "Success" },
          net: "2026-10-02T03:54:00Z",
          rocket: { configuration: { name: "Falcon Heavy" } },
          mission: { name: "NROL-97", description: "Classified payload for the US National Reconnaissance Office" },
          agency_launch_attempt_count: 735,
        },
        { id: "x", name: "Falcon 9 Block 5 | Starlink G1", status: { abbrev: "Failure" }, net: "2026-01-01T00:00:00Z", mission: "Starlink G1" },
      ],
    };
    const rows = parseSourceRows("spacex", ll2ToSpacex(normal));
    expect(rows[0]).toEqual([
      "4651fd8a",
      "NROL-97",
      "2026-10-02T03:54:00Z",
      true,
      false,
      "Falcon Heavy",
      735,
      "Classified payload for the US National Reconnaissance Office",
    ]);
    expect(rows[1]).toEqual(["x", "Starlink G1", "2026-01-01T00:00:00Z", false, false, "Falcon 9 Block 5", null, ""]);
  });

  it("mergeCountries joins World Bank population and keeps density computed", () => {
    const mledoze = [
      { name: { common: "Aruba" }, cca3: "ABW", region: "Americas", subregion: "Caribbean", area: 180, capital: ["Oranjestad"], independent: false },
      { name: { common: "Kosovo" }, cca3: "UNK", region: "Europe", subregion: "Southeast Europe", area: 10908, capital: ["Pristina"], independent: true },
      { name: { common: "Nowhere" }, cca3: "NOW", region: "", subregion: "", area: 0, capital: [], independent: false },
    ];
    const wb = [
      { page: 1 },
      [
        { countryiso3code: "ABW", date: "2025", value: 108000 },
        { countryiso3code: "XKX", date: "2025", value: 1500000 },
        { countryiso3code: "AFE", date: "2025", value: 788844284 },
      ],
    ];
    const rows = parseSourceRows("countries", mergeCountries(mledoze, wb));
    expect(rows[0]).toEqual(["Aruba", "ABW", "Americas", "Caribbean", 108000, 180, 600, "Oranjestad", false]);
    expect(rows[1]![4]).toBe(1500000);
    expect(rows[2]!.slice(4, 7)).toEqual([null, 0, null]);
  });

  it("worldBankWide pivots indicators into country-year rows and drops aggregates", () => {
    const countries = [
      { page: 1 },
      [
        { id: "ABW", name: "Aruba", region: { id: "LCN" } },
        { id: "AFE", name: "Africa Eastern and Southern", region: { id: "NA", value: "Aggregates" } },
        { id: "FRA", name: "France", region: { id: "ECS" } },
      ],
    ];
    const ind = (rows: [string, string, number | null][]) => [
      { page: 1 },
      rows.map(([c, d, v]) => ({ countryiso3code: c, date: d, value: v, country: { value: c } })),
    ];
    const bodies = WB_WIDE_INDICATORS.map((w) =>
      w.column === "gdp_usd"
        ? ind([["ABW", "2023", 4e9], ["AFE", "2023", 1e12], ["FRA", "2023", null]])
        : w.column === "population"
          ? ind([["ABW", "2023", 108000], ["ABW", "2022", 107000]])
          : w.column === "co2_per_capita"
            ? ind([["ABW", "2023", 8.1]])
            : ind([]),
    );
    const out = worldBankWide(countries, bodies);
    expect(out.rows).toHaveLength(2); // FRA all-null dropped, AFE aggregate dropped
    const rows = parseSourceRows("world_bank", out);
    expect(rows[0]).toEqual(["ABW", "Aruba", 2023, 4e9, null, 108000, null, 8.1]);
    expect(rows[1]).toEqual(["ABW", "Aruba", 2022, null, null, 107000, null, null]);
  });

  it("joinCitibike joins GBFS info + status and drops uninstalled stations", () => {
    const info = {
      data: {
        stations: [
          { station_id: "s1", name: "Austin St & 76 Ave", lat: 40.71612, lon: -73.83735, capacity: 16 },
          { station_id: "s2", name: "Montrose Ave & Bushwick Ave", lat: 40.7077, lon: -73.9402, capacity: 0 },
          { station_id: "s3", name: "Gone", lat: 40.6, lon: -73.9, capacity: 10 },
        ],
      },
    };
    const status = {
      data: {
        stations: [
          { station_id: "s1", num_bikes_available: 15, num_ebikes_available: 14, num_docks_available: 0, is_installed: 1, is_renting: 1, last_reported: 1790973816 },
          { station_id: "s2", num_bikes_available: 3, num_docks_available: 33, is_installed: 1, is_renting: 0, last_reported: 1790973893 },
          { station_id: "s3", num_bikes_available: 0, is_installed: 0, is_renting: 0, last_reported: 86400 },
        ],
      },
    };
    const rows = parseSourceRows("citibike", joinCitibike(info, status));
    expect(rows).toEqual([
      ["s1", "Austin St & 76 Ave", 40.71612, -73.83735, 16, 15, 14, 0, 93.8, true, new Date(1790973816 * 1000).toISOString()],
      ["s2", "Montrose Ave & Bushwick Ave", 40.7077, -73.9402, 0, 3, 0, 33, null, false, new Date(1790973893 * 1000).toISOString()],
    ]);
  });

  it("mergeUkCarbon merges yesterday + today, deduped and sorted", () => {
    const y = { data: [{ from: "2026-10-01T23:30Z", intensity: { forecast: 149, actual: 151, index: "moderate" } }] };
    const t = {
      data: [
        { from: "2026-10-01T23:30Z", intensity: { forecast: 149, actual: 151, index: "moderate" } },
        { from: "2026-10-01T23:00Z", intensity: { forecast: 158, actual: 152, index: "moderate" } },
      ],
    };
    expect(mergeUkCarbon(y, t).data.map((d) => d.from)).toEqual(["2026-10-01T23:00Z", "2026-10-01T23:30Z"]);
  });

  it("utcDay formats UTC dates", () => {
    expect(utcDay(1, Date.UTC(2026, 9, 2, 0, 30))).toBe("2026-10-01");
  });
});

// Fixtures below are trimmed from real upstream responses captured 2026-10-02
// (fields the transforms ignore removed); synthetic rows are marked.
describe("Worker columnar transforms (new feeds) → browser rows", () => {
  const registryColumns = (kind: string) => SOURCE_DEFS.find((d) => d.kind === kind)!.columns;

  it("gdacs: one row per event (latest todate/episode, first-seen order), UTC dates, raw strings, centroid for polygons", () => {
    const body = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", bbox: [-167.8, 23.3, -167.8, 23.3], geometry: { type: "Point", coordinates: [-167.8, 23.3] }, properties: { eventtype: "TC", eventid: 1001321, episodeid: 49, name: "Tropical Cyclone NOLO-26", description: "Tropical Cyclone NOLO-26", alertlevel: "Green", alertscore: 1, country: "United States", fromdate: "2026-09-13T21:00:00", todate: "2026-10-02T21:00:00", datemodified: "2026-10-02T21:00:19", severitydata: { severity: 249.9984, severitytext: "Hurricane/Typhoon > 74 mph (maximum wind speed of 250 km/h)", severityunit: "km/h" } } },
        { type: "Feature", bbox: [13.696, 48.764, 13.696, 48.764], geometry: { type: "Point", coordinates: [13.696, 48.764] }, properties: { eventtype: "DR", eventid: 1018332, episodeid: 24, name: "Drought in Austria, Bosnia  and  Herzegovina, Ukraine, ", description: "Drought in Austria, Bosnia  and  Herzegovina, Ukraine, ", alertlevel: "Orange", alertscore: 2, country: "Austria, Bosnia & Herzegovina, Ukraine, ", fromdate: "2025-12-21T00:00:00", todate: "2026-10-02T07:08:01", datemodified: "2026-10-02T07:08:01", severitydata: { severity: 1759971.0, severitytext: "Medium impact for agricultural drought in 1759971 km2", severityunit: "km2" } } },
        { type: "Feature", bbox: [159.8843, 51.6886, 159.8843, 51.6886], geometry: { type: "Point", coordinates: [159.8843, 51.6886] }, properties: { eventtype: "EQ", eventid: 1569163, episodeid: 1737344, name: "Earthquake in Off East Coast Of Kamchatka", description: "Earthquake in Off East Coast Of Kamchatka", alertlevel: "Green", alertscore: 1, country: "Off East Coast Of Kamchatka", fromdate: "2026-10-02T20:54:15", todate: "2026-10-02T20:54:15", datemodified: "2026-10-02T21:23:49", severitydata: { severity: 5.0, severitytext: "Magnitude 5M, Depth:30.93km", severityunit: "M" } } },
        // synthetic: an older episode of the TC (dropped), a newer one of the quake (wins, same
        // todate → higher episodeid), a polygon flood with no bbox, a volcano with no geometry
        { type: "Feature", geometry: { type: "Point", coordinates: [-160, 20] }, properties: { eventtype: "TC", eventid: 1001321, episodeid: 48, name: "old", alertlevel: "Green", alertscore: 1, fromdate: "2026-09-13T21:00:00", todate: "2026-10-01T21:00:00" } },
        { type: "Feature", geometry: { type: "Point", coordinates: [159.9, 51.7] }, properties: { eventtype: "EQ", eventid: 1569163, episodeid: 1737345, name: "Earthquake in Off East Coast Of Kamchatka", alertlevel: "Orange", alertscore: 2, country: "Off East Coast Of Kamchatka", fromdate: "2026-10-02T20:54:15", todate: "2026-10-02T20:54:15", severitydata: { severity: 5.1, severityunit: "M" } } },
        { type: "Feature", geometry: null, properties: { eventtype: "VO", eventid: 9, name: "Etna", alertlevel: "Green", alertscore: 1, country: "Italy", fromdate: "2026-10-02T00:00:00", todate: null } },
        { type: "Feature", geometry: { type: "Polygon", coordinates: [[[10, 0], [14, 0], [14, 2], [10, 2], [10, 0]]] }, properties: { eventtype: "FL", eventid: 7, name: "", description: "Flood in Somewhere", alertlevel: "Red", alertscore: 3, country: "", fromdate: "2026-10-01T00:00:00", todate: "2026-10-02T00:00:00", severitydata: { severity: 0, severityunit: "" } } },
      ],
    };
    const out = gdacsEvents(body);
    expect(out.columns).toEqual(registryColumns("gdacs"));
    expect(parseSourceRows("gdacs", out)).toEqual([
      ["TC1001321", "Tropical cyclone", "Tropical Cyclone NOLO-26", "Green", 1, "United States", 23.3, -167.8, "2026-09-13T21:00:00.000Z", "2026-10-02T21:00:00.000Z", 249.9984, "km/h"],
      ["DR1018332", "Drought", "Drought in Austria, Bosnia  and  Herzegovina, Ukraine, ", "Orange", 2, "Austria, Bosnia & Herzegovina, Ukraine, ", 48.764, 13.696, "2025-12-21T00:00:00.000Z", "2026-10-02T07:08:01.000Z", 1759971, "km2"],
      ["EQ1569163", "Earthquake", "Earthquake in Off East Coast Of Kamchatka", "Orange", 2, "Off East Coast Of Kamchatka", 51.7, 159.9, "2026-10-02T20:54:15.000Z", "2026-10-02T20:54:15.000Z", 5.1, "M"],
      ["VO9", "Volcano", "Etna", "Green", 1, "Italy", null, null, "2026-10-02T00:00:00.000Z", null, null, null],
      ["FL7", "Flood", "Flood in Somewhere", "Red", 3, null, 1, 12, "2026-10-01T00:00:00.000Z", "2026-10-02T00:00:00.000Z", 0, null],
    ]);
  });

  it("buoys: NDBC fixed-width text, MM → null, UTC timestamps", () => {
    const text = [
      "#STN       LAT      LON  YYYY MM DD hh mm WDIR WSPD   GST WVHT  DPD APD MWD   PRES  PTDY  ATMP  WTMP  DEWP  VIS   TIDE",
      "#text      deg      deg   yr mo day hr mn degT  m/s   m/s   m   sec sec degT   hPa   hPa  degC  degC  degC  nmi     ft",
      "22101    37.24   126.02  2026 10 02 23 00 100   4.0    MM  0.0   0   MM  MM     MM    MM  18.0  23.4    MM   MM     MM",
      "41002    31.743  -74.955 2026 10 02 23 50  MM   0.0   1.0  0.8  11  7.2  98 1019.0    MM  26.8  28.7  21.3   MM     MM",
      "41002    31.743  -74.955 2026 10 02 23 50  MM   0.0   1.0  0.8  11  7.2  98 1019.0    MM  26.8  28.7  21.3   MM     MM",
      "",
    ].join("\n");
    const out = ndbcLatestObs(text);
    expect(out.columns).toEqual(registryColumns("buoys"));
    expect(parseSourceRows("buoys", out)).toEqual([
      ["22101", 37.24, 126.02, "2026-10-02T23:00:00.000Z", 100, 4, null, 0, 0, null, 18, 23.4],
      ["41002", 31.743, -74.955, "2026-10-02T23:50:00.000Z", null, 0, 1, 0.8, 11, 1019, 26.8, 28.7],
    ]);
  });

  it("mbta: route names + type words, m/s → mph, humanized enums, unknown route → id", () => {
    const body = {
      data: [
        { id: "y3243", type: "vehicle", attributes: { bearing: 90, current_status: "STOPPED_AT", label: "3243", latitude: 42.348941802978516, longitude: -71.09539031982422, occupancy_status: "MANY_SEATS_AVAILABLE", speed: null, updated_at: "2026-10-02T20:25:24-04:00" }, relationships: { route: { data: { id: "57", type: "route" } } } },
        { id: "1860", type: "vehicle", attributes: { bearing: 199, current_status: "IN_TRANSIT_TO", label: "1860", latitude: 42.23575973510742, longitude: -71.1348876953125, occupancy_status: null, speed: 19.7, updated_at: "2026-10-02T20:25:20-04:00" }, relationships: { route: { data: { id: "CR-Providence", type: "route" } } } },
        { id: "R-548BFAD1", type: "vehicle", attributes: { bearing: 190, current_status: "INCOMING_AT", label: "1871", latitude: 42.21029, longitude: -71.00126, occupancy_status: "FULL", speed: null, updated_at: "2026-10-02T20:24:37-04:00" }, relationships: { route: { data: { id: "Red", type: "route" } } } },
        // synthetic: route not in `included`, no position yet
        { id: "x1", type: "vehicle", attributes: { label: "", current_status: "", updated_at: null }, relationships: { route: { data: { id: "Shuttle-X", type: "route" } } } },
      ],
      included: [
        { id: "CR-Providence", type: "route", attributes: { long_name: "Providence/Stoughton Line", short_name: "", type: 2 } },
        { id: "Red", type: "route", attributes: { long_name: "Red Line", short_name: "", type: 1 } },
        { id: "57", type: "route", attributes: { long_name: "Watertown Yard - Kenmore Station", short_name: "57", type: 3 } },
      ],
    };
    const out = mbtaVehicles(body);
    expect(out.columns).toEqual(registryColumns("mbta"));
    const rows = parseSourceRows("mbta", out);
    expect(rows[1]![7]).toBeCloseTo(44.0679, 3);
    rows[1]![7] = 0;
    expect(rows).toEqual([
      ["y3243", "3243", "57", "Bus", 42.348941802978516, -71.09539031982422, 90, null, "Stopped at", "Many seats available", "2026-10-03T00:25:24.000Z"],
      ["1860", "1860", "Providence/Stoughton Line", "Commuter rail", 42.23575973510742, -71.1348876953125, 199, 0, "In transit to", null, "2026-10-03T00:25:20.000Z"],
      ["R-548BFAD1", "1871", "Red Line", "Subway", 42.21029, -71.00126, 190, null, "Incoming at", "Full", "2026-10-03T00:24:37.000Z"],
      ["x1", null, "Shuttle-X", null, null, null, null, null, null, null, null],
    ]);
  });

  it("aurora: 2° cells keyed by even SW corner (max per cell), drops < 3, lon → −180…180", () => {
    const body = {
      "Observation Time": "2026-10-03T00:15:00Z",
      "Forecast Time": "2026-10-03T01:50:00Z",
      "Data Format": "[Longitude, Latitude, Aurora]",
      type: "MultiPoint",
      coordinates: [[0, -84, 9], [0, -83, 10], [1, -83, 12], [0, -82, 12], [359, -88, 4], [359, -87, 5], [200, 65, 2], [200, 66, 0], [181, 90, 7]],
    };
    const out = auroraCells(body);
    expect(out.columns).toEqual(registryColumns("aurora"));
    const ts = "2026-10-03T01:50:00.000Z";
    expect(parseSourceRows("aurora", out)).toEqual([
      [0, -84, 12, ts],
      [0, -82, 12, ts],
      [180, 90, 7, ts],
      [-2, -88, 5, ts],
    ]);
    // A full 1° grid (65,160 points) → 180 × 91 distinct cells (lat 90 is its own row, as on
    // desktop); the web caps it under the 8k browser buffer
    const full: number[][] = [];
    for (let lon = 0; lon < 360; lon++) for (let lat = -90; lat <= 90; lat++) full.push([lon, lat, 50]);
    const all = auroraCells({ coordinates: full }, 3, Infinity).rows;
    expect(all.length).toBe(180 * 91);
    expect(new Set(all.map((r) => `${r[0]},${r[1]}`)).size).toBe(180 * 91);
    expect(auroraCells({ coordinates: full }).rows.length).toBe(6_000);
  });

  it("asteroids: CNEOS fields/data → LD, km, ISO dates, size from H", () => {
    const body = {
      signature: { version: "1.5", source: "NASA/JPL SBDB Close Approach Data API" },
      count: 3,
      fields: ["des", "orbit_id", "jd", "cd", "dist", "dist_min", "dist_max", "v_rel", "v_inf", "t_sigma_f", "h", "fullname"],
      data: [
        ["2026 RP39", "6", "2461317.000821359", "2026-Oct-03 12:01", "0.0156288744154242", "0.0155914173482273", "0.015666329852614", "6.13940599510947", "6.11157403334153", "< 00:01", "26.254", "       (2026 RP39)"],
        ["2026 TK", "1", "2461317.095966723", "2026-Oct-03 14:18", "0.00820770935267899", "0.00818508136714441", "0.00823035147057228", "3.08595187921763", "2.97889852218762", "00:27", "29.1", "       (2026 TK)"],
        // synthetic: unknown H
        ["2026 XX", "1", "2461320.5", "2026-Nov-01 00:00", "0.01", "0.01", "0.01", "10", "10", "00:01", null, "       (2026 XX)"],
      ],
    };
    const out = cneosApproaches(body);
    expect(out.columns).toEqual(registryColumns("asteroids"));
    expect(parseSourceRows("asteroids", out)).toEqual([
      ["2026 RP39", "(2026 RP39)", "2026-10-03T12:01:00.000Z", 0.0156288744154242 * 389.17, 0.0156288744154242 * 149_597_870.7, 6.13940599510947, 26.254, diameterFromH(26.254)],
      ["2026 TK", "(2026 TK)", "2026-10-03T14:18:00.000Z", 0.00820770935267899 * 389.17, 0.00820770935267899 * 149_597_870.7, 3.08595187921763, 29.1, diameterFromH(29.1)],
      ["2026 XX", "(2026 XX)", "2026-11-01T00:00:00.000Z", 0.01 * 389.17, 0.01 * 149_597_870.7, 10, null, null],
    ]);
    expect(diameterFromH(26.254)).toBeCloseTo(19.9, 1);
    // No approaches in the window → CAD omits `data` → zero rows (replace keeps the last snapshot)
    expect(cneosApproaches({ count: 0, fields: body.fields }).rows).toEqual([]);
    expect(cadDate("2026-Oct-05 13:42")).toBe("2026-10-05T13:42:00.000Z");
    expect(cadDate("garbage")).toBeNull();
    // H = 22 at albedo 0.14 ≈ 140 m (the classic "potentially hazardous" size)
    expect(diameterFromH(22)).toBeGreaterThan(130);
    expect(diameterFromH(22)).toBeLessThan(150);
  });

  it("steam: owners lower bound, cents → USD, review share, appid from key, empty developer → null", () => {
    const body = {
      "1623730": { appid: 1623730, name: "Palworld", developer: "Pocketpair", positive: 358266, negative: 22443, owners: "50,000,000 .. 100,000,000", average_2weeks: 0, price: "2099", discount: "25", ccu: 18028 },
      "730": { appid: 730, name: "Counter-Strike: Global Offensive", developer: "Valve", positive: 7642084, negative: 1173003, owners: "100,000,000 .. 200,000,000", average_2weeks: 0, price: "0", discount: "0", ccu: 1013936 },
      // synthetic: no reviews, no discount field
      "1": { name: "New", developer: "", positive: 0, negative: 0, owners: "0 .. 20,000", average_2weeks: 90, price: null, ccu: 5 },
    };
    const out = steamTop(body);
    expect(out.columns).toEqual(registryColumns("steam"));
    expect(parseSourceRows("steam", out)).toEqual([
      ["730", "Counter-Strike: Global Offensive", "Valve", 1013936, 7642084, 1173003, (7642084 / (7642084 + 1173003)) * 100, 100000000, 0, 0],
      ["1623730", "Palworld", "Pocketpair", 18028, 358266, 22443, (358266 / (358266 + 22443)) * 100, 50000000, 20.99, 25],
      ["1", "New", null, 5, 0, 0, null, 0, null, null],
    ]);
  });

  it("bitcoin: mempool pages → one row per height, newest first, sats → BTC", () => {
    const blk = (height: number, extra = {}) => ({ height, timestamp: 1790986810 - (969650 - height) * 600, tx_count: 6643, size: 1513504, extras: { medianFee: 0.38669064748201437, totalFees: 541722, reward: 313041722, pool: { name: "Foundry USA" } }, ...extra });
    const page1 = [blk(969650), blk(969649)];
    const page2 = [blk(969649), blk(969648, { extras: { pool: { name: "AntPool" } } })];
    expect(mempoolLowestHeight(page1)).toBe(969649);
    expect(mempoolLowestHeight([])).toBeNull();
    const out = mempoolBlocks([page1, page2]);
    expect(out.columns).toEqual(registryColumns("bitcoin"));
    const rows = parseSourceRows("bitcoin", out);
    expect(rows.map((r) => r[0])).toEqual([969650, 969649, 969648]);
    expect(rows[0]).toEqual([969650, "2026-10-03T00:20:10.000Z", 6643, 1.513504, 0.38669064748201437, 0.00541722, 3.13041722, "Foundry USA"]);
    // missing extras stay null, never 0
    expect(rows[2]!.slice(4)).toEqual([null, null, null, "AntPool"]);
  });

  it("debt: string amounts, 'null' → null, ascending by date", () => {
    const body = {
      data: [
        { record_date: "2026-10-01", debt_held_public_amt: "32433790394253.86", intragov_hold_amt: "7826851578136.17", tot_pub_debt_out_amt: "40260641972390.03" },
        { record_date: "1993-04-01", debt_held_public_amt: "null", intragov_hold_amt: "null", tot_pub_debt_out_amt: "4225873987843.44" },
      ],
      meta: { "total-count": 2 },
    };
    const out = treasuryDebt(body);
    expect(out.columns).toEqual(registryColumns("debt"));
    expect(parseSourceRows("debt", out)).toEqual([
      ["1993-04-01", 4225873987843.44, null, null],
      ["2026-10-01", 40260641972390.03, 32433790394253.86, 7826851578136.17],
    ]);
  });
});
