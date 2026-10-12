// =================================================================
// Upstream endpoint policy + shared-constant parity (LOOM-436, LOOM-681)
// =================================================================
// Reads the Worker and Rust sources as text (like sourceRegistry.test.ts
// does for columns) so changing a city, ADSB point, cap, upstream host
// or the FX URL in one runtime without the other fails here.
// =================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ADSB_POINTS, WORLD_CITIES, adsbToOpensky } from "../../../workers/sourceTransforms";
import { SOURCE_DEFS, SOURCE_KINDS, type SourceKind } from "../sourceRegistry";
import { SOURCE_ENDPOINTS } from "../sourceEndpoints";
import { parseSourceRows } from "../webStreams";

const ROOT = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const rust = read("src-tauri/src/sources.rs");
const worker = read("workers/catalog-proxy.ts");
const transforms = read("workers/sourceTransforms.ts");
const fixture = (n: string) => JSON.parse(read(`src-tauri/tests/fixtures/sources/${n}`));

describe("endpoint policy inventory (LOOM-436)", () => {
  it("has an explicit contract for every source kind and nothing extra", () => {
    expect(Object.keys(SOURCE_ENDPOINTS).sort()).toEqual([...SOURCE_KINDS].sort());
    expect(SOURCE_DEFS.length).toBe(SOURCE_KINDS.length);
  });

  it.each(SOURCE_KINDS.map((k) => [k]))("%s: primary hosts appear in the Worker (and Rust when shared)", (kind) => {
    const c = SOURCE_ENDPOINTS[kind as SourceKind];
    expect(c.primary.length).toBeGreaterThan(0);
    for (const host of c.primary) {
      expect(worker, `${kind}: ${host} missing from workers/catalog-proxy.ts`).toContain(host);
      if (c.desktop === "same") expect(rust, `${kind}: ${host} missing from sources.rs`).toContain(host);
    }
  });

  it("listed fallback hosts are real Worker fallbacks", () => {
    for (const [kind, c] of Object.entries(SOURCE_ENDPOINTS)) {
      for (const fb of c.fallbacks) {
        const host = fb.split(" ")[0]!;
        expect(worker, `${kind} fallback ${host}`).toContain(host);
      }
    }
  });

  it("FX desktop and Worker use the same host and /v1 path (no reliance on a redirect)", () => {
    expect(rust).toContain("https://api.frankfurter.dev/v1/");
    expect(worker).toContain("https://api.frankfurter.dev/v1/");
    expect(rust).not.toContain("api.frankfurter.app/");
    expect(worker).not.toContain("api.frankfurter.app/");
  });

  it("FX web parser and desktop fixture agree on schema and values", () => {
    const expected = fixture("fx_parity_expected.json") as { columns: string[]; rows: unknown[][] };
    const def = SOURCE_DEFS.find((d) => d.kind === "fx")!;
    expect(expected.columns).toEqual(def.columns);
    const rows = parseSourceRows("fx", fixture("fx.json")).sort(
      (a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[2]).localeCompare(String(b[2])),
    );
    expect(rows).toEqual(expected.rows);
  });
});

describe("shared constants (LOOM-681)", () => {
  it("WORLD_CITIES equals Rust CITIES by name, lat and lon (order-independent)", () => {
    const block = rust.match(/const CITIES: &[^=]*= &\[([\s\S]*?)\n\];/)?.[1] ?? "";
    const rustCities = [
      ...block.matchAll(/name:\s*"([^"]+)",\s*lat:\s*(-?[\d.]+),\s*lon:\s*(-?[\d.]+)/g),
    ].map((m) => `${m[1]}|${Number(m[2])}|${Number(m[3])}`);
    const tsCities = WORLD_CITIES.map((c) => `${c.name}|${c.lat}|${c.lon}`);
    expect(rustCities.length).toBe(WORLD_CITIES.length);
    expect(tsCities.sort()).toEqual(rustCities.sort());
  });

  it("ADSB_POINTS equal Rust ADSB_POINTS in order", () => {
    const block = rust.match(/const ADSB_POINTS:[^=]*= &\[([\s\S]*?)\];/)?.[1] ?? "";
    const rustPts = [...block.matchAll(/\(\s*(-?[\d.]+),\s*(-?[\d.]+)\s*\)/g)].map((m) => `${Number(m[1])},${Number(m[2])}`);
    expect(rustPts.length).toBeGreaterThan(0);
    expect(ADSB_POINTS.map((p) => `${p.lat},${p.lon}`)).toEqual(rustPts);
  });

  it("row caps match (aircraft, NWS alerts, Starlink)", () => {
    const num = (re: RegExp, src: string) => {
      const n = Number((src.match(re)?.[1] ?? "").replace(/_/g, ""));
      expect(Number.isFinite(n) && n > 0, `cap pattern not found: ${re}`).toBe(true);
      return n;
    };
    expect(num(/const MAX_AIRCRAFT: usize = ([\d_]+)/, rust)).toBe(num(/max = ([\d_]+),\s*\n\): \{ time: number/, transforms));
    expect(num(/const NWS_MAX_ALERTS: usize = ([\d_]+)/, rust)).toBe(
      num(/export function trimNwsAlerts\(body: unknown, max = ([\d_]+)/, transforms),
    );
    expect(num(/const STARLINK_CAP: usize = ([\d_]+)/, rust)).toBe(num(/const STARLINK_CAP = ([\d_]+)/, transforms));
  });

  it("adsbToOpensky default cap is the shared aircraft cap", () => {
    const many = Array.from({ length: 2500 }, (_, i) => ({ hex: i.toString(16).padStart(6, "0"), lat: 1, lon: 1 }));
    expect(adsbToOpensky([{ now: 1, ac: many }]).states.length).toBeLessThanOrEqual(2000);
  });
});
