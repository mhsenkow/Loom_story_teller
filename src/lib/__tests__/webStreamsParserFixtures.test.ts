import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSourceRows, type Cell } from "../webStreams";

const FIX = join(__dirname, "../__fixtures__/webStreams");

function load(name: string): unknown {
  return JSON.parse(readFileSync(join(FIX, name), "utf8"));
}

const FIXTURE_KINDS = [
  ["usgs", "usgs.json", (row: Cell[]) => {
    expect(row[0]).toBe("usgs-1");
    expect(typeof row[1]).toBe("number");
    expect(String(row[3])).toContain("2023");
  }],
  ["nws", "nws.json", (row: Cell[]) => {
    expect(row[0]).toBe("nws-1");
    expect(String(row[8])).toContain("2026");
    expect(row[2]).toBe("Hot");
  }],
  ["meteo", "meteo.json", (row: Cell[]) => {
    expect(String(row[0])).toContain("2026");
    expect(typeof row[4]).toBe("number");
  }],
  ["aq", "aq.json", (row: Cell[]) => {
    expect(String(row[0])).toContain("2026");
    expect(typeof row[4]).toBe("number");
  }],
  ["iss", "iss.json", (row: Cell[]) => {
    expect(String(row[0])).toContain("202");
    expect(typeof row[1]).toBe("number");
  }],
  ["opensky", "opensky.json", (row: Cell[]) => {
    expect(row[0]).toBe("abc123");
    expect(typeof row[3]).toBe("number");
    expect(String(row[9])).toContain("202");
  }],
  ["countries", "countries.json", (row: Cell[]) => {
    expect(row[0]).toBe("Testland");
    expect(typeof row[4]).toBe("number");
  }],
  ["spacex", "spacex.json", (row: Cell[]) => {
    expect(row[0]).toBe("spx-1");
    expect(String(row[2])).toContain("2026");
    expect(typeof row[6]).toBe("number");
  }],
  ["nyc311", "nyc311.json", (row: Cell[]) => {
    expect(row[0]).toBe("311-1");
    expect(String(row[1])).toContain("2026");
    expect(typeof row[7]).toBe("number");
  }],
  ["covid", "covid.json", (row: Cell[]) => {
    expect(row[0]).toBe("Test Country");
    expect(typeof row[1]).toBe("number");
  }],
  ["fema", "fema.json", (row: Cell[]) => {
    expect(row[0]).toBe("fema-1");
    expect(typeof row[1]).toBe("number");
    expect(String(row[6])).toContain("2026");
  }],
  ["hn", "hn.json", (row: Cell[]) => {
    expect(row[0]).toBe("hn-1");
    expect(typeof row[3]).toBe("number");
    expect(String(row[6])).toContain("2026");
  }],
  ["lobsters", "lobsters.json", (row: Cell[]) => {
    expect(row[0]).toBe("lb-1");
    expect(typeof row[3]).toBe("number");
    expect(String(row[7])).toContain("2026");
  }],
  ["crypto", "crypto.json", (row: Cell[]) => {
    expect(row[0]).toBe("bitcoin");
    expect(typeof row[3]).toBe("number");
  }],
  ["world_bank", "world_bank.json", (row: Cell[]) => {
    expect(row[0]).toBe("USA");
    expect(typeof row[2]).toBe("number");
    expect(typeof row[3]).toBe("number");
  }],
] as const;

describe("webStreams parser fixtures (LOOM-491)", () => {
  for (const [kind, file, assert] of FIXTURE_KINDS) {
    it(`${kind} preserves ids, timestamps, and a numeric cell`, () => {
      const rows = parseSourceRows(kind, load(file));
      expect(rows.length).toBeGreaterThan(0);
      assert(rows[0]!);
    });
  }
});
