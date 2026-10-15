import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CanvasArrangeOverlay,
  type ArrangeChange,
} from "../CanvasArrangeOverlay";

beforeEach(() => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup() {
  const onCommit = vi.fn(),
    onPreview = vi.fn(),
    onDone = vi.fn();
  render(
    <CanvasArrangeOverlay
      width={600}
      height={500}
      contentHeight={500}
      frameMax={{ width: 800, height: 700, aspectLocked: false }}
      layout={{
        plot: { x: 70, y: 80, w: 450, h: 340 },
        title: { x: 70, y: 4, w: 450, h: 58 },
        legend: { x: 420, y: 90, w: 90, h: 100 },
      }}
      visual={{}}
      annotations={[]}
      allowPlot
      onCommit={onCommit}
      onPreview={onPreview}
      onDone={onDone}
    />,
  );
  return { onCommit, onPreview, onDone };
}

describe("canvas arrangement gestures", () => {
  it("previews a drag and commits once at release", () => {
    const { onCommit, onPreview } = setup();
    const title = screen.getByRole("button", { name: "Move Title & subtitle" });
    fireEvent.pointerDown(title, { button: 0, clientX: 100, clientY: 20 });
    fireEvent.pointerMove(title, { clientX: 130, clientY: 70 });
    expect(onPreview).toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.pointerUp(title, { clientX: 130, clientY: 70 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    const change = onCommit.mock.calls[0]![0] as ArrangeChange;
    expect(change).toMatchObject({
      visual: { titleX: 100 / 600, titleY: 54 / 500, titleScale: 1 },
    });
  });
  it("Escape cancels the preview without recording an edit", () => {
    const { onCommit, onPreview, onDone } = setup();
    const title = screen.getByRole("button", { name: "Move Title & subtitle" });
    fireEvent.pointerDown(title, { button: 0, clientX: 100, clientY: 20 });
    fireEvent.pointerMove(title, { clientX: 150, clientY: 70 });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerUp(title);
    expect(onCommit).not.toHaveBeenCalled();
    expect(onPreview).toHaveBeenLastCalledWith(null);
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onDone).toHaveBeenCalledOnce();
  });
  it("width handles keep typography unchanged and support keyboard increments", () => {
    const { onCommit } = setup();
    const handle = screen.getByRole("button", {
      name: "Resize Title & subtitle width",
    });
    fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true });
    expect(onCommit).toHaveBeenCalledWith(
      {
        visual: {
          titleX: 70 / 600,
          titleY: 4 / 500,
          titleWidth: 440 / 600,
          titleScale: 1,
        },
      },
      "arrange:title",
    );
  });
  it("a click without movement selects without an Undo entry", () => {
    const { onCommit } = setup();
    const title = screen.getByRole("button", { name: "Move Title & subtitle" });
    fireEvent.pointerDown(title, { button: 0, clientX: 100, clientY: 20 });
    fireEvent.pointerUp(title, { clientX: 100, clientY: 20 });
    expect(onCommit).not.toHaveBeenCalled();
  });
});
