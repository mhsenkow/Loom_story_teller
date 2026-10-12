import { describe, expect, it } from "vitest";
import { escapeCsvCell, queryResultToCsv } from "../csvExport";

describe("escapeCsvCell formula neutralization", () => {
  it("prefixes spreadsheet formula trigger characters", () => {
    expect(escapeCsvCell("=1+1")).toBe("'=1+1");
    expect(escapeCsvCell("+cmd")).toBe("'+cmd");
    expect(escapeCsvCell("-1+1")).toBe("'-1+1");
    expect(escapeCsvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(escapeCsvCell("\tTAB")).toBe("'\tTAB");
    // CR also triggers CSV quoting
    expect(escapeCsvCell("\rCR")).toBe(`"'\rCR"`);
  });

  it("leaves finite numbers alone (including negatives)", () => {
    expect(escapeCsvCell(42)).toBe("42");
    expect(escapeCsvCell(-12.5)).toBe("-12.5");
    expect(escapeCsvCell(0)).toBe("0");
  });

  it("still quotes commas and embedded quotes", () => {
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    expect(escapeCsvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
  });

  it("applies neutralization in full CSV export", () => {
    const csv = queryResultToCsv({
      columns: ["name", "formula"],
      types: ["VARCHAR", "VARCHAR"],
      rows: [["ok", "=1+1"]],
      total_rows: 1,
    });
    expect(csv).toContain("'=1+1");
  });

  it("excel profile adds BOM and CRLF", () => {
    const csv = queryResultToCsv(
      { columns: ["a"], types: ["VARCHAR"], rows: [[1]], total_rows: 1 },
      "excel",
    );
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("\r\n");
  });
});
