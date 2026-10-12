import { describe, expect, it } from "vitest";
import {
  webFileDisplayName,
  webFileStablePath,
  webFileStablePathFromFile,
  webFileStoragePathCandidates,
  legacyWebUploadPath,
} from "../webFileIdentity";

describe("webFileIdentity", () => {
  it("encodes nested linked paths as stable keys", () => {
    expect(webFileStablePath("2024/data.csv")).toBe("web://file/2024/data.csv");
    expect(webFileStablePath("a b/c.csv")).toBe("web://file/a%20b/c.csv");
  });

  it("decodes display names from stable paths", () => {
    expect(webFileDisplayName("web://file/2024/data.csv")).toBe("2024/data.csv");
    expect(webFileDisplayName(legacyWebUploadPath("solo.csv"))).toBe("solo.csv");
  });

  it("keeps distinct stable keys for same basename in different folders", () => {
    const a = webFileStablePath("east/data.csv");
    const b = webFileStablePath("west/data.csv");
    expect(a).not.toBe(b);
  });

  it("resolves legacy and stable storage candidates", () => {
    expect(webFileStoragePathCandidates("web://solo.csv")).toEqual([
      "web://file/solo.csv",
      "web://solo.csv",
    ]);
  });

  it("derives stable path from File.name (relative path for linked folders)", () => {
    const f = new File(["x"], "nested/rows.csv", { type: "text/csv" });
    expect(webFileStablePathFromFile(f)).toBe("web://file/nested/rows.csv");
  });
});
