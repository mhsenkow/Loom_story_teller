import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DeployMismatchBanner } from "../DeployMismatchBanner";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

function serveBuild(id: { current: string }) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(`${id.current}\n`, { status: 200 }));
}

it("does not flag a fresh load as stale because the tab saw an older deploy", async () => {
  sessionStorage.setItem("loom-build-id", "2026-10-24T10:00:00.000Z");
  serveBuild({ current: "2026-10-24T15:50:54.662Z" });
  await act(async () => {
    render(<DeployMismatchBanner />);
  });
  expect(screen.queryByText(/new version of Loom/)).toBeNull();
});

it("offers a reload when a deploy lands while the tab stays open", async () => {
  const id = { current: "build-a" };
  serveBuild(id);
  await act(async () => {
    render(<DeployMismatchBanner />);
  });
  id.current = "build-b";
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(await screen.findByText(/new version of Loom/)).toBeTruthy();
});
