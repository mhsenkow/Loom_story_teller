import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Dialog } from "../ui/Dialog";
import { Sheet } from "../ui/Sheet";

afterEach(cleanup);

/** Opener button stays mounted; the overlay mounts open and may be removed while still open. */
function Harness({ overlay, show }: { overlay: "dialog" | "sheet"; show: boolean }) {
  const noop = () => {};
  return (
    <>
      <button type="button">Opener</button>
      {show && overlay === "dialog" && (
        <Dialog open onClose={noop} ariaLabel="Test dialog">
          <button type="button">Inside</button>
        </Dialog>
      )}
      {show && overlay === "sheet" && (
        <Sheet open onClose={noop} ariaLabel="Test sheet">
          <button type="button">Inside</button>
        </Sheet>
      )}
    </>
  );
}

describe.each(["dialog", "sheet"] as const)("%s focus restore", (overlay) => {
  it("returns focus to the opener when unmounted while still open", () => {
    const { rerender } = render(<Harness overlay={overlay} show={false} />);
    const opener = screen.getByRole("button", { name: "Opener" });
    opener.focus();
    rerender(<Harness overlay={overlay} show />);
    act(() => screen.getByRole("button", { name: "Inside" }).focus());
    rerender(<Harness overlay={overlay} show={false} />);
    expect(document.activeElement).toBe(opener);
  });
});
