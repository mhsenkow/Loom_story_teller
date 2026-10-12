import { describe, expect, it } from "vitest";
import { shouldRetryCsvOnCatalogFallback } from "../openDataCatalogPolicy";

describe("openDataCatalogPolicy", () => {
  it("does not retry xlsx guard errors", () => {
    expect(
      shouldRetryCsvOnCatalogFallback(
        new Error("This download is an Excel workbook (xlsx), not CSV."),
      ),
    ).toBe(false);
  });

  it("does not retry upstream 4xx", () => {
    expect(shouldRetryCsvOnCatalogFallback(new Error("Fetch CSV failed (403)"))).toBe(false);
  });

  it("retries network-style failures", () => {
    expect(shouldRetryCsvOnCatalogFallback(new TypeError("Failed to fetch"))).toBe(true);
  });
});
