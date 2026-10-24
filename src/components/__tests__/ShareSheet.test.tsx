import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const png = new Blob(["png"], { type: "image/png" });

vi.mock("@/lib/sharePreviewCache", () => ({
  peekSharePreview: () => png,
  sharePreviewKeyFromStore: (id: string) => `key-${id}`,
  warmSharePreview: async () => png,
}));
vi.mock("@/lib/capturePlatformPng", () => ({ capturePlatformPng: vi.fn(async () => png) }));
vi.mock("@/lib/download", () => ({
  downloadBlob: vi.fn(async () => "saved"),
  savedToast: () => null,
}));
vi.mock("@/lib/socialExport", async (orig) => ({
  ...(await orig<typeof import("@/lib/socialExport")>()),
  publishStoryToWorker: vi.fn(async () => ({ url: "https://loom.ibm.io/s/abc123", id: "abc123" })),
  toLinkPreviewJpeg: vi.fn(async () => "data:image/jpeg;base64,AA"),
  copyTextToClipboard: vi.fn(async () => true),
}));

import { ShareSheet } from "../ShareSheet";
import { useLoomStore } from "@/lib/store";
import { downloadBlob } from "@/lib/download";
import { copyTextToClipboard } from "@/lib/socialExport";

beforeEach(() => {
  useLoomStore.getState().reset();
  useLoomStore.setState({
    activeChart: { id: "c1", kind: "bar", title: "name sized by total", subtitle: "", score: 1, spec: {}, xField: "name", yField: "total", colorField: null },
    shareSheetOpen: true,
  } as never);
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
  window.open = vi.fn(() => ({}) as Window);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function openDestinations() {
  render(<ShareSheet />);
  const share = await screen.findByRole("button", { name: "Share" });
  await waitFor(() => expect(share).not.toBeDisabled());
  fireEvent.click(share);
  return screen.findByRole("group", { name: "Where to share" });
}

it("leads with Mastodon, SeenU and Bluesky, then LinkedIn, then the rest", async () => {
  const where = await openDestinations();
  const featured = within(where).getByRole("group", { name: "Featured" });
  expect(within(featured).getAllByRole("button").map((b) => b.textContent?.split(/On |Image|Caption/)[0])).toEqual(["Mastodon", "SeenU", "Bluesky"]);
  const labels = within(where).getAllByRole("button").map((b) => b.querySelector("span")?.textContent?.replace(/[▸▾]/g, "").trim());
  const after = labels.slice(labels.indexOf("Bluesky") + 1);
  expect(after[0]).toBe("LinkedIn");
  expect(after).toEqual(expect.arrayContaining(["X", "Threads", "Instagram", "Facebook", "Reddit", "WhatsApp", "Telegram", "Email"]));
});

it("hands SeenU a saved 4:5 image and the copied caption on desktop, then opens it", async () => {
  const where = await openDestinations();
  const seenu = within(within(where).getByRole("group", { name: "Featured" })).getByRole("button", { name: /SeenU/ });
  await waitFor(() => expect(seenu).not.toBeDisabled());
  fireEvent.click(seenu);
  await screen.findByText("Finish on SeenU");
  expect(copyTextToClipboard).toHaveBeenCalledWith(expect.stringContaining("https://loom.ibm.io/s/abc123"));
  expect(downloadBlob).toHaveBeenCalledWith(png, expect.stringMatching(/-seenu\.png$/));
  expect(window.open).toHaveBeenCalledWith("https://seenu.io/", "_blank", "noopener,noreferrer");
});
