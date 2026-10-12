import { describe, it, expect } from "vitest";
import { isUnsafeRegexPattern, safeUserRegex } from "../regexSafe";

describe("regexSafe", () => {
  it("rejects nested quantifiers like (a+)+", () => {
    expect(isUnsafeRegexPattern("(a+)+$")).toBe(true);
    expect(safeUserRegex("(a+)+$")).toBeNull();
  });

  it("allows simple patterns", () => {
    const re = safeUserRegex("^de");
    expect(re?.test("dewiki")).toBe(true);
  });

  it("(a+)+ on a long string returns quickly via rejection", () => {
    const re = safeUserRegex("(a+)+$");
    expect(re).toBeNull();
    const ok = safeUserRegex("wiki");
    const long = "a".repeat(5000);
    expect(ok?.test(long)).toBe(false);
  });
});
