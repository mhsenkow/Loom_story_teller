import React from "react";
import { act } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useViewportWidth } from "../useMediaQuery";

function WidthProbe({ onRender }: { onRender: (width: number) => void }) {
  const width = useViewportWidth();
  onRender(width);
  return <output aria-label="width">{width}</output>;
}

function setInnerWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
}

describe("useViewportWidth", () => {
  let rafQueue: FrameRequestCallback[];

  beforeEach(() => {
    document.documentElement.dataset.shellWidth = "";
    delete document.documentElement.dataset.shellMode;
    rafQueue = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      rafQueue[id - 1] = () => undefined;
    });
    setInnerWidth(900);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete document.documentElement.dataset.shellWidth;
    delete document.documentElement.dataset.shellMode;
  });

  function flushRaf() {
    act(() => {
      rafQueue.splice(0).forEach((cb) => cb(16));
    });
  }

  it("coalesces resize updates to one animation frame", () => {
    const renders = vi.fn();
    render(<WidthProbe onRender={renders} />);
    // Subscribe schedules an immediate rAF remeasure (iPad cold-start).
    expect(window.requestAnimationFrame).toHaveBeenCalled();
    flushRaf();
    expect(screen.getByLabelText("width")).toHaveTextContent("900");
    const baselineRaf = (window.requestAnimationFrame as ReturnType<typeof vi.fn>).mock.calls.length;
    const baselineRenders = renders.mock.calls.length;

    act(() => {
      setInnerWidth(901);
      window.dispatchEvent(new Event("resize"));
      setInnerWidth(902);
      window.dispatchEvent(new Event("resize"));
      setInnerWidth(903);
      window.dispatchEvent(new Event("resize"));
    });

    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(baselineRaf + 1);
    expect(screen.getByLabelText("width")).toHaveTextContent("900");

    flushRaf();

    expect(screen.getByLabelText("width")).toHaveTextContent("903");
    expect(renders).toHaveBeenCalledTimes(baselineRenders + 1);
  });

  it("follows live innerWidth even when bootstrap stamped a phone width", () => {
    document.documentElement.dataset.shellWidth = "390";
    document.documentElement.dataset.shellMode = "phone";
    setInnerWidth(1024);
    render(<WidthProbe onRender={() => undefined} />);
    expect(screen.getByLabelText("width")).toHaveTextContent("1024");

    flushRaf();
    expect(document.documentElement.dataset.shellWidth).toBe("1024");
    expect(document.documentElement.dataset.shellMode).toBe("tablet");
  });
});
