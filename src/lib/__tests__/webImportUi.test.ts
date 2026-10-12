import { describe, expect, it } from "vitest";
import { formatWebImportError } from "../webImportUi";
import { WebIngestAbortedError } from "../webIngest";

describe("formatWebImportError", () => {
  it("maps picker denial and cloud read failures", () => {
    expect(formatWebImportError(new DOMException("denied", "NotAllowedError"))).toMatch(/denied/i);
    expect(formatWebImportError(new DOMException("sec", "SecurityError"))).toMatch(/blocked/i);
    expect(formatWebImportError(new DOMException("read", "NotReadableError"))).toMatch(/iCloud|Files/i);
  });

  it("passes through byte budget and permission sync errors", () => {
    expect(
      formatWebImportError(
        new Error(
          "“huge.csv” is 50.0 MB — browser imports are limited to 48 MB. Use the desktop app for very large files.",
        ),
      ),
    ).toMatch(/48 MB/);
    expect(formatWebImportError(new Error("Permission needed to read your Loom data folder"))).toMatch(/Allow/);
  });

  it("returns empty for cancel / abort", () => {
    expect(formatWebImportError(new DOMException("cancel", "AbortError"))).toBe("");
    expect(formatWebImportError(new WebIngestAbortedError())).toBe("");
  });
});
