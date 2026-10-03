import { describe, expect, it } from "vitest";
import {
  WB_WIDE_INDICATORS,
  WORLD_CITIES,
  adsbToOpensky,
  joinCitibike,
  ll2ToSpacex,
  mergeCountries,
  mergeUkCarbon,
  openMeteoCities,
  paprikaToGecko,
  trimNwsAlerts,
  utcDay,
  worldBankWide,
} from "../../../workers/sourceTransforms";
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
