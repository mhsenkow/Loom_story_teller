/**
 * Browser ingest header normalization (JSON matrix / objects).
 */
import { describe, it, expect } from "vitest";
import { parseJsonText, parseNdjsonText } from "../webIngest";

describe("webIngest headers", () => {
  it("JSON matrix: blanks become col_n and duplicates get suffixes", () => {
    const json = JSON.stringify([
      ["", "value", "value", "  name  "],
      [1, "a", "b", "c"],
      [2, "d", "e", "f"],
    ]);
    const { sample } = parseJsonText(json);
    expect(sample.columns).toEqual(["col_1", "value", "value_2", "name"]);
    expect(sample.rows[0]).toEqual([1, "a", "b", "c"]);
    expect(sample.rows[1]).toEqual([2, "d", "e", "f"]);
  });

  it("JSON array of objects: duplicate keys from union stay distinct", () => {
    const json = JSON.stringify([
      { value: "first", other: 1 },
      { value: "second", extra: 2 },
    ]);
    const { sample } = parseJsonText(json);
    expect(sample.columns).toContain("value");
    expect(sample.rows[0]![sample.columns.indexOf("value")]).toBe("first");
    expect(sample.rows[1]![sample.columns.indexOf("value")]).toBe("second");
  });

  it("NDJSON: empty key columns normalize on ingest", () => {
    const text = ['{"":"x","value":1}', '{"":"y","value":2}'].join("\n");
    const { sample } = parseNdjsonText(text);
    expect(sample.columns).toEqual(["col_1", "value"]);
    expect(sample.rows[0]).toEqual(["x", 1]);
    expect(sample.rows[1]).toEqual(["y", 2]);
  });
});
