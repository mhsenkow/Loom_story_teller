/**
 * LOOM-681 — Parity test for shared constants across Rust and TypeScript.
 *
 * City lists, ADSB receiver points, and other duplicated constants must stay
 * in sync between the Rust sources (sources.rs) and the TS Worker transforms
 * (sourceTransforms.ts). Changing a city in one place must fail this test.
 */
import { describe, expect, it } from "vitest";
import { WORLD_CITIES, ADSB_POINTS } from "../../../workers/sourceTransforms";
import * as fs from "fs";
import * as path from "path";

function readRustSources(): string {
  return fs.readFileSync(
    path.resolve(__dirname, "../../../src-tauri/src/sources.rs"),
    "utf-8",
  );
}

/** Extract CITIES array from sources.rs as { name, lat, lon }[]. */
function parseRustCities(rust: string): { name: string; lat: number; lon: number }[] {
  const block = rust.match(
    /pub\(crate\)\s+const\s+CITIES:\s*&\[CityDef\]\s*=\s*&\[([\s\S]*?)\];/,
  );
  if (!block) throw new Error("CITIES block not found in sources.rs");
  const entries = [...block[1].matchAll(/name:\s*"([^"]+)"[\s\S]*?lat:\s*([\d.eE+-]+)[\s\S]*?lon:\s*([\d.eE+-]+)/g)];
  return entries.map(([, name, lat, lon]) => ({
    name: name!,
    lat: parseFloat(lat!),
    lon: parseFloat(lon!),
  }));
}

/** Extract ADSB_POINTS from sources.rs as { lat, lon }[]. */
function parseRustAdsbPoints(rust: string): { lat: number; lon: number }[] {
  const block = rust.match(
    /const\s+ADSB_POINTS:\s*&\[\(f64,\s*f64\)\]\s*=\s*&\[([\s\S]*?)\];/,
  );
  if (!block) throw new Error("ADSB_POINTS block not found in sources.rs");
  const pairs = [...block[1].matchAll(/\(\s*([\d.eE+-]+)\s*,\s*([\d.eE+-]+)\s*\)/g)];
  return pairs.map(([, lat, lon]) => ({
    lat: parseFloat(lat!),
    lon: parseFloat(lon!),
  }));
}

describe("Rust ↔ TS constant parity (LOOM-681)", () => {
  const rust = readRustSources();
  const rustCities = parseRustCities(rust);
  const rustAdsb = parseRustAdsbPoints(rust);

  it("city sets contain the same names", () => {
    const tsNames = new Set(WORLD_CITIES.map((c) => c.name));
    const rsNames = new Set(rustCities.map((c) => c.name));
    expect(tsNames).toEqual(rsNames);
  });

  it("city coordinates match exactly (lat, lon)", () => {
    const tsMap = new Map<string, { lat: number; lon: number }>(
      WORLD_CITIES.map((c) => [c.name, { lat: c.lat, lon: c.lon }]),
    );
    for (const rc of rustCities) {
      const ts = tsMap.get(rc.name);
      expect(ts, `missing city ${rc.name} in TS`).toBeDefined();
      expect(ts!.lat).toBeCloseTo(rc.lat, 2);
      expect(ts!.lon).toBeCloseTo(rc.lon, 2);
    }
  });

  it("ADSB receiver points match exactly", () => {
    const tsPoints = ADSB_POINTS.map((p) => ({ lat: p.lat, lon: p.lon }));
    expect(tsPoints).toHaveLength(rustAdsb.length);
    for (let i = 0; i < rustAdsb.length; i++) {
      expect(tsPoints[i]!.lat).toBeCloseTo(rustAdsb[i]!.lat, 1);
      expect(tsPoints[i]!.lon).toBeCloseTo(rustAdsb[i]!.lon, 1);
    }
  });

  it("city count matches", () => {
    expect(WORLD_CITIES.length).toBe(rustCities.length);
  });
});

describe("keep-newest history feeds", () => {
  it("matches KEEP_NEWEST_KINDS in sources.rs", async () => {
    const { SOURCE_DEFS } = await import("../sourceRegistry");
    const ts = SOURCE_DEFS.filter((d) => d.keepNewest).map((d) => d.kind).sort();
    const block = readRustSources().match(/pub const KEEP_NEWEST_KINDS: &\[&str\] = &\[([^\]]*)\];/);
    expect(block, "KEEP_NEWEST_KINDS not found in sources.rs").toBeTruthy();
    const rust = [...block![1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!).sort();
    expect(ts).toEqual(rust);
    // Only ascending feeds make sense here
    for (const d of SOURCE_DEFS.filter((x) => x.keepNewest)) expect(d.orderBy).toMatch(/ ASC$/);
  });
});
