/**
 * Unit tests for browser CSV parsing (gov open-data quirks).
 */
import { describe, it, expect } from "vitest";
import {
  parseCsvRecords,
  sniffCsvDelimiter,
  coerceCsvNumber,
  parseCsvToInspectResult,
  looksLikeSpreadsheetBinary,
  inspectFromTabular,
  inferTabularColumnTypes,
  normalizeTabularCells,
  parseTabularLexemes,
  looksLikeIdentifierString,
  normalizeTabularHeaders,
} from "../mock-data";

describe("mock-data CSV", () => {
  describe("normalizeTabularHeaders", () => {
    it("names blank columns col_1, col_2 by position", () => {
      expect(normalizeTabularHeaders(["", "  ", "\t"])).toEqual([
        "col_1",
        "col_2",
        "col_3",
      ]);
    });

    it("suffixes duplicate names and avoids colliding with existing _2", () => {
      expect(normalizeTabularHeaders(["value", "value", "value_2", "value"])).toEqual([
        "value",
        "value_2",
        "value_2_2",
        "value_3",
      ]);
    });
  });

  describe("coerceCsvNumber", () => {
    it("parses US thousands separators", () => {
      expect(coerceCsvNumber(" 1,203,514 ")).toBe(1203514);
      expect(coerceCsvNumber("10.9")).toBe(10.9);
    });

    it("keeps US decimals with 3 places (not EU thousands)", () => {
      expect(coerceCsvNumber("-72.923")).toBe(-72.923);
      expect(coerceCsvNumber("30.405")).toBe(30.405);
      expect(coerceCsvNumber("1.234.567")).toBe(1234567);
    });

    it("parses EU decimal comma", () => {
      expect(coerceCsvNumber("10,9")).toBe(10.9);
    });

    it("returns null for non-numeric text", () => {
      expect(coerceCsvNumber("North East")).toBeNull();
      expect(coerceCsvNumber("")).toBeNull();
      expect(coerceCsvNumber("0x1A")).toBeNull();
    });

    it("parses accounting negatives in parentheses", () => {
      expect(coerceCsvNumber("(1,234)")).toBe(-1234);
      expect(coerceCsvNumber("($1,234.00)")).toBe(-1234);
    });

    it("parses signed currency and explicit plus signs", () => {
      expect(coerceCsvNumber("-$1,234")).toBe(-1234);
      expect(coerceCsvNumber("-$5.00")).toBe(-5);
      expect(coerceCsvNumber("$-5.00")).toBe(-5);
      expect(coerceCsvNumber("-€1.234,56")).toBe(-1234.56);
      expect(coerceCsvNumber("+1,234")).toBe(1234);
      expect(coerceCsvNumber("−1,234")).toBe(-1234);
      expect(coerceCsvNumber("--5")).toBeNull();
      expect(coerceCsvNumber("$")).toBeNull();
    });

    it("reads a leading 0, group as a decimal comma, not thousands", () => {
      expect(coerceCsvNumber("0,125")).toBe(0.125);
      expect(coerceCsvNumber("1,250")).toBe(1250);
    });

    it("reports true min/max for text and date columns, not first/last row", () => {
      const full = inspectFromTabular(
        ["when", "name", "n"],
        [["2026-03-01", "pear", "5"], ["2025-01-15", "apple", "-2"], ["2026-12-31", "zucchini", "10"], ["2025-06-01", "fig", "1"]],
      );
      expect([full.stats[0]?.min_value, full.stats[0]?.max_value]).toEqual(["2025-01-15", "2026-12-31"]);
      expect([full.stats[1]?.min_value, full.stats[1]?.max_value]).toEqual(["apple", "zucchini"]);
      expect([full.stats[2]?.min_value, full.stats[2]?.max_value]).toEqual(["-2", "10"]);
    });

    it("types a column of signed currency as DOUBLE with no incompatible cells", () => {
      const columns = ["profit"];
      const rawRows = [["$100"], ["-$50"], ["-$25"]];
      const full = inspectFromTabular(columns, rawRows);
      expect(full.stats[0]?.data_type).toBe("DOUBLE");
      expect(full.sample.rows.map((r) => r[0])).toEqual([100, -50, -25]);
      expect(full.diagnostics.incompatible_count).toBe(0);
    });
  });

  describe("null tokens in numeric columns", () => {
    it("treats N/A as null for typing", () => {
      const csv = [
        "value",
        "10",
        "20",
        "N/A",
        "30",
        "40",
        "50",
        "60",
      ].join("\n");
      const { stats, sample } = parseCsvToInspectResult("nulls.csv", csv, 100);
      expect(stats[0]?.data_type).toMatch(/DOUBLE|INTEGER|FLOAT/i);
      expect(sample.rows.some((r) => r[0] === null)).toBe(true);
    });
  });

  describe("parseCsvRecords", () => {
    it("keeps commas and newlines inside quotes", () => {
      const text = `a,b\n"hello, world","line1\nline2"\n3,4\n`;
      const rows = parseCsvRecords(text);
      expect(rows).toHaveLength(3);
      expect(rows[1]).toEqual(["hello, world", "line1\nline2"]);
      expect(rows[2]).toEqual(["3", "4"]);
    });
  });

  describe("looksLikeSpreadsheetBinary", () => {
    it("detects PK zip / xlsx signature", () => {
      expect(looksLikeSpreadsheetBinary("PK\x03\x04fake")).toBe(true);
      expect(looksLikeSpreadsheetBinary("Region,Households\nA,1\n")).toBe(false);
    });
  });

  describe("parseCsvToInspectResult", () => {
    it("types fuel-poverty region CSV with thousands as DOUBLE", () => {
      const text = `Region,Number of households,Proportion of households fuel poor (%)
North East," 1,203,514 ", 10.9
North West," 3,242,792 ", 14.1
`;
      const { stats, sample } = parseCsvToInspectResult("fuel_region.csv", text);
      expect(sample.columns).toContain("Number of households");
      const hh = stats.find((c) => c.name === "Number of households");
      expect(hh?.data_type).toBe("DOUBLE");
      expect(sample.rows[0]![1]).toBe(1203514);
      expect(sample.rows[0]![2]).toBe(10.9);
    });

    it("parses NEH-style multiline quoted ProjectDesc without shifting columns", () => {
      const text = [
        "AppNumber,Latitude,Longitude,ProjectDesc,AwardOutright",
        'CHA-1,34.4,-119.8,"Line one',
        'Line two with, comma",104833.0',
        "CHA-2,40.7,-74.0,Short desc,500.0",
        "",
      ].join("\n");
      const { stats, sample } = parseCsvToInspectResult("neh.csv", text);
      expect(sample.rows).toHaveLength(2);
      expect(sample.rows[0]![1]).toBe(34.4);
      expect(sample.rows[0]![2]).toBe(-119.8);
      expect(String(sample.rows[0]![3])).toContain("Line one");
      expect(sample.rows[0]![4]).toBe(104833);
      const lat = stats.find((c) => c.name === "Latitude");
      expect(lat?.data_type).toBe("DOUBLE");
    });

    it("throws on xlsx bytes labeled as csv", () => {
      expect(() => parseCsvToInspectResult("epc.csv", "PK\x03\x04xlsx")).toThrow(/Excel workbook/i);
    });

    it("does not poison rows when truncated mid-quoted field", () => {
      const good = [
        "Latitude,Longitude,ProjectDesc",
        '34.4,-119.8,"ok desc"',
        '40.7,-74.0,"cut here',
      ].join("\n");
      // Incomplete trailing quote — would previously absorb following bytes as one cell
      const { sample } = parseCsvToInspectResult("neh.csv", good);
      expect(sample.rows).toHaveLength(1);
      expect(sample.rows[0]![0]).toBe(34.4);
      expect(sample.rows[0]![1]).toBe(-119.8);
    });

    it("CSV import keeps distinct values under duplicate and blank headers", () => {
      const text = `value,,value
a,only-b,b
c,only-d,d
`;
      const { sample } = parseCsvToInspectResult("dup.csv", text);
      expect(sample.columns).toEqual(["value", "col_2", "value_2"]);
      expect(sample.rows[0]).toEqual(["a", "only-b", "b"]);
      expect(sample.rows[1]).toEqual(["c", "only-d", "d"]);
    });

    it("reports incompatible cells in DOUBLE columns instead of silent coercion", () => {
      const columns = ["amount"];
      const rawRows = [["10"], ["not-a-number"], ["20"]];
      const lexemes = parseTabularLexemes(columns, rawRows);
      const types = inferTabularColumnTypes(columns, lexemes);
      expect(types[0]).toBe("DOUBLE");
      const { rows, diagnostics } = normalizeTabularCells(columns, lexemes, types);
      expect(rows[1]![0]).toBe("not-a-number");
      expect(diagnostics.incompatible_count).toBe(1);
      const full = inspectFromTabular(columns, rawRows);
      expect(full.diagnostics.incompatible_count).toBe(1);
    });

    it("infers ISO date columns without name heuristics", () => {
      const columns = ["when"];
      const rawRows = [["2026-10-12"], ["2026-01-01"], ["not-a-date"]];
      const lexemes = parseTabularLexemes(columns, rawRows);
      const types = inferTabularColumnTypes(columns, lexemes);
      expect(types[0]).toBe("VARCHAR");
      const clean = [["2026-10-12"], ["2026-01-01"], ["2026-01-02"]];
      const lex2 = parseTabularLexemes(columns, clean);
      expect(inferTabularColumnTypes(columns, lex2)[0]).toBe("DATE");
    });

    it("normalizes booleans to 0/1 consistently across formats", () => {
      const { sample } = inspectFromTabular(
        ["flag"],
        [[true], [false], ["true"]],
      );
      expect(sample.types[0]).toBe("DOUBLE");
      expect(sample.rows[0]![0]).toBe(1);
      expect(sample.rows[1]![0]).toBe(0);
    });

    it("preserves ZIP, FIPS, and long digit identifiers as strings", () => {
      expect(looksLikeIdentifierString("02134")).toBe(true);
      expect(looksLikeIdentifierString("00123")).toBe(true);
      expect(looksLikeIdentifierString("1234567890123456789")).toBe(true);
      const { sample } = inspectFromTabular(
        ["zip", "fips", "record_id", "amount"],
        [["02134", "00123", "1234567890123456789", "10.5"]],
      );
      expect(sample.types[0]).toBe("VARCHAR");
      expect(sample.types[1]).toBe("VARCHAR");
      expect(sample.types[2]).toBe("VARCHAR");
      expect(sample.rows[0]![0]).toBe("02134");
      expect(sample.rows[0]![1]).toBe("00123");
      expect(sample.rows[0]![2]).toBe("1234567890123456789");
      expect(sample.rows[0]![3]).toBe(10.5);
    });
  });

  describe("sniffCsvDelimiter (LOOM-493)", () => {
    it("detects tab and semicolon headers", () => {
      expect(sniffCsvDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
      expect(sniffCsvDelimiter("a;b;c\n1;2;3")).toBe(";");
      expect(sniffCsvDelimiter("a,b,c\n1,2,3")).toBe(",");
    });
  });
});
