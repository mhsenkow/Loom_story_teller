import React from "react";
import { act } from "react";
import { render, screen } from "@testing-library/react";
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
    vi.restoreAllMocks();
    delete document.documentElement.dataset.shellWidth;
  });

  it("coalesces resize updates to one animation frame", () => {
    const renders = vi.fn();
    render(<WidthProbe onRender={renders} />);
    expect(screen.getByLabelText("width")).toHaveTextContent("900");

    act(() => {
      setInnerWidth(901);
      window.dispatchEvent(new Event("resize"));
      setInnerWidth(902);
      window.dispatchEvent(new Event("resize"));
      setInnerWidth(903);
      window.dispatchEvent(new Event("resize"));
    });

    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("width")).toHaveTextContent("900");

    act(() => {
      rafQueue.splice(0).forEach((cb) => cb(16));
    });

    expect(screen.getByLabelText("width")).toHaveTextContent("903");
    expect(renders).toHaveBeenCalledTimes(2);
  });
});
