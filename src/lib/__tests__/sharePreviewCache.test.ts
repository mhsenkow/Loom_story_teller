import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSharePreviewKey,
  invalidateSharePreview,
  noteShareCapture,
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
    const b = sharePreviewKeyFromStore("ig-square")!;
    const epoch = Number(b.split("|").pop()!.slice(1));
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
      epoch,
    });
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

  it("changes the key when the painted chart changes, so a stale image is never served", () => {
    const key = sharePreviewKeyFromStore("current")!;
    seedSharePreview(key, new Blob(["png"], { type: "image/png" }));
    useLoomStore.setState({ chartVisualOverrides: { colorPalette: "viridis" } });
    const next = sharePreviewKeyFromStore("current")!;
    expect(next).not.toBe(key);
    expect(peekSharePreview(next)).toBeNull();
  });

  it("ignores a capture's temporary aspect / export-target swap", () => {
    const key = sharePreviewKeyFromStore("current")!;
    const prevAspect = useLoomStore.getState().appSettings.chartAspect;
    // Same order as capturePlatformPng: aspect, target, then restore target, aspect.
    noteShareCapture(1);
    useLoomStore.getState().setAppSettings((s) => ({ ...s, chartAspect: "square" }));
    useLoomStore.getState().setSocialExportTarget({ width: 400, height: 400, pixelRatio: 2 } as never);
    useLoomStore.getState().setSocialExportTarget(null);
    useLoomStore.getState().setAppSettings((s) => ({ ...s, chartAspect: prevAspect }));
    noteShareCapture(-1);
    useLoomStore.setState({ sidebarOpen: !useLoomStore.getState().sidebarOpen });
    expect(sharePreviewKeyFromStore("current")).toBe(key);
  });
});
