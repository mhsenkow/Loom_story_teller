// =================================================================
// chipPaste tests (LOOM-571)
// =================================================================

import { describe, expect, it } from "vitest";
import { splitChipPaste } from "../chipPaste";

describe("splitChipPaste", () => {
  it("keeps quoted city with comma as one value", () => {
    expect(splitChipPaste('"Washington, D.C."')).toEqual(["Washington, D.C."]);
  });

  it("keeps an unquoted City, D.C. / City, ST paste as one chip (LOOM-571)", () => {
    expect(splitChipPaste("Washington, D.C.")).toEqual(["Washington, D.C."]);
    expect(splitChipPaste("Portland, OR")).toEqual(["Portland, OR"]);
    expect(splitChipPaste("Washington, D.C., Boston")).toEqual(["Washington, D.C.", "Boston"]);
  });

  it("does not merge lists of abbreviations", () => {
    expect(splitChipPaste("IL, CA, TX")).toEqual(["IL", "CA", "TX"]);
  });

  it("splits unquoted comma lists", () => {
    expect(splitChipPaste("a, b, c")).toEqual(["a", "b", "c"]);
  });

  it("prefers newlines over commas", () => {
    expect(splitChipPaste("Washington, D.C.\nNew York, NY")).toEqual([
      "Washington, D.C.",
      "New York, NY",
    ]);
  });

  it("splits on tabs", () => {
    expect(splitChipPaste("alpha\tbeta")).toEqual(["alpha", "beta"]);
  });
});
