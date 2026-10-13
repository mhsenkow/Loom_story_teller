// =================================================================
// publicOrigin — share links always point at loom.ibm.io
// =================================================================

import { afterEach, describe, expect, it, vi } from "vitest";
import { PUBLIC_LOOM_ORIGIN, publicLoomWebOrigin, toPublicLoomUrl } from "../publicOrigin";

describe("toPublicLoomUrl", () => {
  it("rewrites workers.dev and localhost to the product host", () => {
    expect(toPublicLoomUrl("https://loom-storyteller.mhsenkow.workers.dev/s/abc")).toBe(
      `${PUBLIC_LOOM_ORIGIN}/s/abc`,
    );
    expect(toPublicLoomUrl("https://localhost/#story=xyz")).toBe(`${PUBLIC_LOOM_ORIGIN}/#story=xyz`);
  });

  it("leaves loom.ibm.io unchanged", () => {
    expect(toPublicLoomUrl("https://loom.ibm.io/s/abc")).toBe("https://loom.ibm.io/s/abc");
  });
});

describe("publicLoomWebOrigin", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses product origin inside Capacitor-like localhost", () => {
    vi.stubGlobal("window", { location: { hostname: "localhost", origin: "https://localhost" } });
    expect(publicLoomWebOrigin()).toBe(PUBLIC_LOOM_ORIGIN);
  });

  it("keeps loom.ibm.io when already there", () => {
    vi.stubGlobal("window", { location: { hostname: "loom.ibm.io", origin: "https://loom.ibm.io" } });
    expect(publicLoomWebOrigin()).toBe("https://loom.ibm.io");
  });
});
