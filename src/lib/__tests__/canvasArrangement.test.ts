import { describe, expect, it } from "vitest";
import {
  arrangementPlot,
  arrangedFrameSize,
  wrapAnnotationLines,
  constrainRect,
  manipulateRect,
  titleArrangementRect,
} from "../canvasArrangement";
import { sanitizeChartVisualOverrides } from "../chartVisualSanitize";
import { useLoomStore } from "../store";

describe("canvas arrangement", () => {
  const bounds = { x: 0, y: 0, w: 400, h: 300 };
  it("keeps a dragged object within the frame without changing its size", () => {
    expect(
      manipulateRect(
        { x: 30, y: 50, w: 100, h: 40 },
        "move",
        900,
        -400,
        bounds,
      ),
    ).toEqual({ x: 300, y: 0, w: 100, h: 40 });
  });
  it("snaps to center but allows precise Alt-style positioning", () => {
    const r = { x: 30, y: 40, w: 100, h: 40 };
    expect(manipulateRect(r, "move", 117, 0, bounds).x).toBe(150);
    expect(manipulateRect(r, "move", 117, 0, bounds, false).x).toBe(147);
  });
  it("side handles change only their dimension and enforce usable sizes", () => {
    const r = { x: 30, y: 40, w: 100, h: 80 };
    expect(manipulateRect(r, "e", 50, 100, bounds)).toEqual({ ...r, w: 150 });
    expect(manipulateRect(r, "s", 100, -200, bounds).h).toBe(24);
    expect(manipulateRect(r, "se", 900, 900, bounds)).toEqual({
      ...r,
      w: 370,
      h: 260,
    });
  });
  it("makes normalized plot and title placement responsive", () => {
    const visual = {
      plotX: 0.2,
      plotY: 0.2,
      plotWidth: 0.6,
      plotHeight: 0.5,
      titleX: 0.15,
      titleY: 0.05,
      titleWidth: 0.7,
      titleScale: 1.5,
    };
    expect(arrangementPlot(1000, 800, visual)).toEqual({
      left: 200,
      top: 160,
      right: 800,
      bottom: 560,
    });
    expect(arrangementPlot(500, 400, visual)).toEqual({
      left: 100,
      top: 80,
      right: 400,
      bottom: 280,
    });
    expect(titleArrangementRect(1000, 800, 60, visual)).toEqual({
      x: 150,
      y: 40,
      w: 700,
      h: 87,
    });
    expect(arrangementPlot(500, 400, {})).toBeUndefined();
  });
  it("wraps note text at words, preserves paragraphs and splits long URLs", () => {
    expect(
      wrapAnnotationLines("one two three\nabcdefghij", 7, (s) => s.length),
    ).toEqual(["one two", "three", "abcdefg", "hij"]);
  });
  it("keeps locked frame proportions while enforcing a usable minimum", () => {
    const size = arrangedFrameSize(
      { width: 600, height: 750, aspectLocked: true },
      { canvasWidth: 0.5, canvasHeight: 0.7 },
    );
    expect(size).toEqual({ width: 300, height: 375, aspectLocked: true });
    expect(
      arrangedFrameSize(
        { width: 200, height: 250, aspectLocked: true },
        { canvasWidth: 0.35 },
      ),
    ).toEqual({ width: 200, height: 250, aspectLocked: true });
  });
  it("clamps shared geometry and rejects malformed values", () => {
    expect(
      sanitizeChartVisualOverrides({
        legendPosition: "custom",
        titleScale: 100,
        legendHeight: -0.5,
        canvasWidth: NaN,
        plotX: Infinity,
        titleWidth: "bad",
      }),
    ).toEqual({ legendPosition: "custom", titleScale: 2.5, legendHeight: 0.1 });
    expect(constrainRect({ x: -100, y: 500, w: 999, h: 999 }, bounds)).toEqual(
      bounds,
    );
  });
  it("restores annotation movement and resizing together with one Undo", () => {
    useLoomStore.getState().reset();
    const s = useLoomStore.getState();
    s.addChartAnnotation("sample", "A note", 0.4, 0.4);
    const before = useLoomStore.getState().chartAnnotations.sample[0]!;
    s.updateChartAnnotation("sample", before.id, {
      x: 0.8,
      y: 0.7,
      width: 0.4,
      fontSize: 18,
    });
    expect(useLoomStore.getState().chartAnnotations.sample[0]).toMatchObject({
      x: 0.8,
      width: 0.4,
      fontSize: 18,
    });
    useLoomStore.getState().undoChartEdit();
    expect(useLoomStore.getState().chartAnnotations.sample[0]).toEqual(before);
    useLoomStore.getState().redoChartEdit();
    expect(useLoomStore.getState().chartAnnotations.sample[0]).toMatchObject({
      x: 0.8,
      width: 0.4,
      fontSize: 18,
    });
    const count = useLoomStore.getState().chartEditUndoStack.length;
    useLoomStore
      .getState()
      .updateChartAnnotation("sample", before.id, { x: 0.8 });
    expect(useLoomStore.getState().chartEditUndoStack).toHaveLength(count);
  });
});
