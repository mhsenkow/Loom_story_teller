import { describe, expect, it } from "vitest";
import { formatDateCell } from "../dateFormat";

describe("formatDateCell", () => {
  it("keeps DATE values on the same calendar day in western time zones", () => {
    const prev = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      expect(formatDateCell("2025-03-01", "DATE")).toBe("2025-03-01");
    } finally {
      process.env.TZ = prev;
    }
  });

  it("shows em dash for missing values", () => {
    expect(formatDateCell(null, "DATE")).toBe("—");
    expect(formatDateCell("", "TIMESTAMP")).toBe("—");
  });

  it("formats naive timestamps without UTC day shift", () => {
    expect(formatDateCell("2026-10-12 14:30:00", "TIMESTAMP")).toBe("2026-10-12 14:30");
  });

  it("keeps calendar day in Pacific/Auckland (LOOM-486)", () => {
    const prev = process.env.TZ;
    process.env.TZ = "Pacific/Auckland";
    try {
      expect(formatDateCell("2026-03-29", "DATE")).toBe("2026-03-29");
    } finally {
      process.env.TZ = prev;
    }
  });
});
