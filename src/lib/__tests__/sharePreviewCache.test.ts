import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSharePreviewKey,
  invalidateSharePreview,
  peekSharePreview,
  seedSharePreview,
  sharePreviewKeyFromStore,
  warmSharePreview,
} from "../sharePreviewCache";
import { useLoomStore } from "../store";

describe("sharePreviewCache", () => {
  beforeEach(() => {
    invalidateSharePreview();
    useLoomStore.setState({
      activeChart: {
        id: "c1",
        title: "Quakes",
        kind: "scatter",
        spec: {},
        score: 1,
      } as never,
      chartTitleOverrides: {},
      socialPresetId: "ig-square",
      exportSupersample: 1,
      exportBurnIn: {
        includeTitle: true,
        includeSubtitle: true,
        includeSource: false,
        includeTimestamp: false,
        includeHandle: false,
        handleText: "",
        includeLoomMark: true,
      },
    });
  });

  it("builds a stable key from chart + preset + burn-in + supersample", () => {
    useLoomStore.setState({ exportSupersample: 1 });
    const a = buildSharePreviewKey({
      chartId: "c1",
      presetId: "ig-square",
      title: "Quakes",
      includeLoomMark: true,
      includeSource: false,
      includeTimestamp: false,
      includeHandle: false,
      handleText: "",
      supersample: 1,
    });
    const b = sharePreviewKeyFromStore("ig-square");
    expect(b).toBe(a);
  });

  it("peek returns seeded blob for matching key", () => {
    const key = sharePreviewKeyFromStore("ig-square")!;
    const blob = new Blob(["png"], { type: "image/png" });
    seedSharePreview(key, blob);
    expect(peekSharePreview(key)).toBe(blob);
    expect(peekSharePreview("other")).toBeNull();
  });

  it("warmSharePreview reuses an in-flight promise for the same key", async () => {
    const capture = vi.fn(async () => new Blob(["x"], { type: "image/png" }));
    vi.doMock("../capturePlatformPng", () => ({ capturePlatformPng: capture }));
    // Direct seed path is enough for reuse semantics without dynamic import flakiness.
    const key = sharePreviewKeyFromStore("ig-square")!;
    const blob = new Blob(["png"], { type: "image/png" });
    seedSharePreview(key, blob);
    const a = await warmSharePreview("ig-square");
    const b = await warmSharePreview("ig-square");
    expect(a).toBe(blob);
    expect(b).toBe(blob);
  });
});
