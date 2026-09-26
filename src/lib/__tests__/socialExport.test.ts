// =================================================================
// Social export unit tests
// =================================================================

import { describe, it, expect } from "vitest";
import {
  SOCIAL_PRESETS,
  getSocialPreset,
  buildSocialCaption,
  slugifyFilename,
} from "../socialExport";
import { buildZip } from "../zipStore";

describe("socialExport", () => {
  it("includes platform presets with pixel targets", () => {
    const ig = getSocialPreset("ig-square");
    expect(ig.width).toBe(1080);
    expect(ig.height).toBe(1080);
    const stories = getSocialPreset("stories");
    expect(stories.width).toBe(1080);
    expect(stories.height).toBe(1920);
    expect(stories.safeZones).toBe(true);
    expect(SOCIAL_PRESETS.length).toBeGreaterThanOrEqual(6);
  });

  it("builds a paste-ready caption", () => {
    const text = buildSocialCaption({
      title: "Sales vs Region",
      subtitle: "Northeast leads",
      reason: "Clear categorical breakdown",
      source: "sales.csv",
      handle: "@loom",
    });
    expect(text).toContain("Sales vs Region");
    expect(text).toContain("Northeast leads");
    expect(text).toContain("Source: sales.csv");
    expect(text).toContain("@loom");
  });

  it("slugifies filenames safely", () => {
    expect(slugifyFilename("Hello World!!")).toBe("Hello_World");
    expect(slugifyFilename("")).toBe("loom-export");
  });
});

describe("zipStore", () => {
  it("builds a zip with local file headers", () => {
    const enc = new TextEncoder();
    const zip = buildZip([
      { name: "a.txt", data: enc.encode("hello") },
      { name: "b.txt", data: enc.encode("world") },
    ]);
    expect(zip.length).toBeGreaterThan(40);
    // Local file header signature PK\x03\x04
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
    expect(zip[2]).toBe(0x03);
    expect(zip[3]).toBe(0x04);
  });
});
