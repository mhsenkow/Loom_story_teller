/**
 * Unit tests for browser CSV parsing (gov open-data quirks).
 */
import { describe, it, expect } from "vitest";
import {
  parseCsvRecords,
  coerceCsvNumber,
  parseCsvToInspectResult,
  looksLikeSpreadsheetBinary,
} from "../mock-data";

describe("mock-data CSV", () => {
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
  });
});
