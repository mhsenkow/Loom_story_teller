// =================================================================
// iOS Tauri shell — saves, thumbnails and NeoSpace handoff
// =================================================================
// The iPhone/iPad webview cancels <a download> clicks, has no popups and
// blocks fetch(data:) under the CSP. These cover the fallbacks.
// =================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const shell = { tauri: false, mobile: false, capacitor: false };
const openExternalUrl = vi.fn<(url: string) => Promise<void>>(async () => {});

vi.mock("../tauri", () => ({
  isTauri: () => shell.tauri,
  isMobileOs: () => shell.mobile,
  isCapacitor: () => shell.capacitor,
  isNativeShell: () => shell.tauri || shell.capacitor,
  openExternalUrl: (url: string) => openExternalUrl(url),
}));

import { downloadBlob, savedToast } from "../download";
import { downloadBlob as nativeDownloadBlob, saveOrShareBlob } from "../nativeExport";
import { dataUrlToBlob } from "../chartViewThumbnails";
import { handOffToNeoSpace } from "../neospaceShare";
import { shareOrDownloadFile } from "../socialExport";

function stubDom() {
  const click = vi.fn();
  vi.stubGlobal("document", {
    createElement: () => ({ click, style: {} }),
    body: { appendChild: vi.fn(), removeChild: vi.fn() },
  });
  return click;
}

beforeEach(() => {
  shell.tauri = false;
  shell.mobile = false;
  shell.capacitor = false;
  openExternalUrl.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("downloadBlob on iPhone/iPad Tauri", () => {
  it("hands the file to the share sheet instead of a dead anchor click", async () => {
    shell.tauri = true;
    shell.mobile = true;
    const click = stubDom();
    const share = vi.fn(async () => {});
    vi.stubGlobal("navigator", { share });
    const out = await downloadBlob(new Blob(["a,b"], { type: "text/csv" }), "rows.csv");
    expect(out).toBe("shared");
    expect(share).toHaveBeenCalledTimes(1);
    expect(click).not.toHaveBeenCalled();
  });

  it("reports cancel and missing share honestly", async () => {
    shell.tauri = true;
    shell.mobile = true;
    stubDom();
    vi.stubGlobal("navigator", {
      share: vi.fn(async () => {
        throw new DOMException("cancel", "AbortError");
      }),
    });
    expect(await downloadBlob(new Blob(["x"]), "x.png")).toBe("cancelled");
    vi.stubGlobal("navigator", {});
    expect(await downloadBlob(new Blob(["x"]), "x.png")).toBe("unsupported");
  });

  it("still uses an anchor download on desktop and web", async () => {
    const click = stubDom();
    vi.stubGlobal("window", { setTimeout: vi.fn() });
    vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: vi.fn() });
    expect(await downloadBlob(new Blob(["x"]), "x.png")).toBe("downloaded");
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("only says saved when something was saved", () => {
    expect(savedToast("downloaded", "Image saved")).toBe("Image saved");
    expect(savedToast("shared", "Image saved")).toBe("Image saved");
    expect(savedToast("cancelled", "Image saved")).toBeNull();
    expect(savedToast("unsupported", "Image saved")).toMatch(/Couldn’t save/);
  });
});

describe("shareOrDownloadFile on iPhone/iPad Tauri", () => {
  it("throws instead of reporting a download when nothing could save", async () => {
    shell.tauri = true;
    shell.mobile = true;
    stubDom();
    vi.stubGlobal("navigator", {});
    await expect(shareOrDownloadFile(new Blob(["x"]), "pack.zip")).rejects.toThrow(/Couldn’t save/);
  });
});

describe("nativeExport on iPhone/iPad Tauri", () => {
  it("does not claim an anchor download worked", () => {
    shell.tauri = true;
    shell.mobile = true;
    stubDom();
    expect(nativeDownloadBlob(new Blob(["x"]), "x.json")).toBe("unsupported");
  });

  it("prefers share on iPadOS even with a Macintosh UA", async () => {
    shell.mobile = true; // isMobileOs covers MacIntel + touch
    const share = vi.fn(async () => {});
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", share });
    expect(await saveOrShareBlob(new Blob(["{}"]), "backup.json")).toBe("shared");
    expect(share).toHaveBeenCalled();
  });
});

describe("dataUrlToBlob", () => {
  it("decodes base64 without fetch", async () => {
    const blob = dataUrlToBlob("data:image/png;base64,AQID");
    expect(blob.type).toBe("image/png");
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it("decodes percent-encoded payloads and rejects non-data URLs", async () => {
    const blob = dataUrlToBlob("data:image/svg+xml,%3Csvg%2F%3E");
    expect(blob.type).toBe("image/svg+xml");
    expect(await blob.text()).toBe("<svg/>");
    expect(() => dataUrlToBlob("https://example.com/a.png")).toThrow();
  });
});

describe("handOffToNeoSpace without a popup", () => {
  it("opens the system browser in a native shell instead of navigating the app", async () => {
    shell.tauri = true;
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { assign } });
    await handOffToNeoSpace(null, { storyUrl: "https://loom.ibm.io/s/abc", text: "hi" });
    expect(assign).not.toHaveBeenCalled();
    expect(openExternalUrl).toHaveBeenCalledTimes(1);
    expect(openExternalUrl.mock.calls[0]?.[0]).toMatch(/^https:\/\/neospace\.ibm\.io\/\?compose=loom/);
  });

  it("navigates in a plain browser tab", async () => {
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { assign } });
    await handOffToNeoSpace(null, { storyUrl: "https://loom.ibm.io/s/abc", text: "hi" });
    expect(assign).toHaveBeenCalledTimes(1);
    expect(openExternalUrl).not.toHaveBeenCalled();
  });
});
