// =================================================================
// nativeExport — share payload cascade for LinkedIn / file+URL
// =================================================================

import { describe, expect, it } from "vitest";
import { buildImageShareAttempts, shareCaptionWithLink } from "../nativeExport";

describe("shareCaptionWithLink", () => {
  it("appends the story URL under the caption", () => {
    expect(shareCaptionWithLink("Quakes today", "https://loom.ibm.io/s/abc")).toBe(
      "Quakes today\n\nhttps://loom.ibm.io/s/abc",
    );
  });

  it("does not duplicate an URL already in the caption", () => {
    const url = "https://loom.ibm.io/s/abc";
    expect(shareCaptionWithLink(`See ${url}`, url)).toBe(`See ${url}`);
  });
});

describe("buildImageShareAttempts", () => {
  const file = new File([new Uint8Array([1, 2, 3])], "chart.png", { type: "image/png" });

  it("leads with file+url, then url-only (LinkedIn), then file-only", () => {
    const attempts = buildImageShareAttempts({
      file,
      title: "Chart",
      caption: "Hello",
      url: "https://loom.ibm.io/s/xyz",
    });
    expect(attempts[0]?.files?.[0]).toBe(file);
    expect(attempts[0]?.url).toBe("https://loom.ibm.io/s/xyz");
    expect(attempts[0]?.text).toContain("https://loom.ibm.io/s/xyz");
    const urlOnly = attempts.find((a) => a.url && !a.files);
    expect(urlOnly?.url).toBe("https://loom.ibm.io/s/xyz");
    expect(attempts.at(-1)?.files?.[0]).toBe(file);
    expect(attempts.at(-1)?.url).toBeUndefined();
  });

  it("omits url payloads when no story link", () => {
    const attempts = buildImageShareAttempts({
      file,
      title: "Chart",
      caption: "Hello",
    });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.files?.[0]).toBe(file);
    expect(attempts[0]?.url).toBeUndefined();
  });
});
