/**
 * Unit tests for formatting utilities.
 */
import { describe, it, expect } from "vitest";
import { formatBytes, formatNumber, truncate, extensionIcon } from "../format";

describe("format", () => {
  describe("formatBytes", () => {
    it("returns '0 B' for zero", () => {
      expect(formatBytes(0)).toBe("0 B");
    });
    it("formats bytes without decimal", () => {
      expect(formatBytes(500)).toBe("500 B");
    });
    it("formats KB with one decimal", () => {
      expect(formatBytes(1536)).toBe("1.5 KB");
    });
    it("formats MB and GB", () => {
      expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
      expect(formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
    });
  });

  describe("formatNumber", () => {
    it("formats small numbers with locale", () => {
      expect(formatNumber(0)).toBe("0");
      expect(formatNumber(999)).toBe("999");
    });
    it("formats K suffix for thousands", () => {
      expect(formatNumber(1500)).toBe("1.5K");
    });
    it("formats M suffix for millions", () => {
      expect(formatNumber(2_500_000)).toBe("2.5M");
    });
    it("formats B suffix for billions", () => {
      expect(formatNumber(1_200_000_000)).toBe("1.2B");
    });
  });

  describe("truncate", () => {
    it("returns string unchanged when within length", () => {
      expect(truncate("hello", 10)).toBe("hello");
    });
    it("truncates and adds ellipsis when over length", () => {
      expect(truncate("hello world", 8)).toBe("hello w…");
    });
  });

  describe("extensionIcon", () => {
    it("returns CSV for csv", () => {
      expect(extensionIcon("csv")).toBe("CSV");
    });
    it("returns PQ for parquet", () => {
      expect(extensionIcon("parquet")).toBe("PQ");
    });
    it("returns ? for unknown", () => {
      expect(extensionIcon("xlsx")).toBe("?");
    });
  });
});
