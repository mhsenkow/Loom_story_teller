import { describe, expect, it } from "vitest";
import { isAllowedNeoSpaceOrigin, safeNeoSpaceFileName } from "../neospace";

describe("neospace handoff", () => {
  it("allows listed NeoSpace and preview origins", () => {
    expect(isAllowedNeoSpaceOrigin("https://neospace.ibm.io")).toBe(true);
    expect(isAllowedNeoSpaceOrigin("https://foo.neospace-dc4.pages.dev")).toBe(true);
    expect(isAllowedNeoSpaceOrigin("https://evil.pages.dev")).toBe(false);
    expect(isAllowedNeoSpaceOrigin("https://github.com.evil.example")).toBe(false);
  });

  it("rejects localhost in production builds", () => {
    expect(isAllowedNeoSpaceOrigin("http://localhost:9999", { allowLocalDev: false })).toBe(false);
    expect(isAllowedNeoSpaceOrigin("http://127.0.0.1:3000", { allowLocalDev: false })).toBe(false);
    expect(isAllowedNeoSpaceOrigin("http://localhost:9999", { allowLocalDev: true })).toBe(true);
  });

  it("sanitizes file names", () => {
    expect(safeNeoSpaceFileName("My Chart.csv")).toMatch(/\.csv$/);
    expect(safeNeoSpaceFileName("<script>.csv")).not.toContain("<");
  });
});
