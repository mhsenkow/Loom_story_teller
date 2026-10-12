import { describe, expect, it } from "vitest";
import { formatWebBatchImportToast, summarizeWebBatchOutcomes } from "../webBatchImport";

describe("webBatchImport", () => {
  it("summarizes mixed outcomes", () => {
    const summary = summarizeWebBatchOutcomes([
      { status: "loaded", fileName: "a.csv", path: "web://a" },
      { status: "failed", fileName: "bad.json", error: "parse error" },
    ]);
    expect(summary.loaded).toHaveLength(1);
    expect(summary.failed).toHaveLength(1);
    expect(formatWebBatchImportToast(summary, "My Loom data")).toMatch(/1 failed/);
  });
});
