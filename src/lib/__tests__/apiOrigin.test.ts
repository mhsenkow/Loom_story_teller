// =================================================================
// apiUrl — same-origin on web, Worker origin inside Tauri shells
// =================================================================

import { afterEach, describe, expect, it, vi } from "vitest";
import { apiUrl, DEFAULT_CATALOG_ORIGIN } from "../openDataCatalog";

describe("apiUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses relative paths in a normal browser", () => {
    vi.stubGlobal("window", { location: { hostname: "loom.ibm.io" } });
    expect(apiUrl("/api/source/usgs")).toBe("/api/source/usgs");
  });

  it("prefixes the Worker origin inside Tauri", () => {
    vi.stubGlobal("window", {
      location: { hostname: "tauri.localhost" },
      __TAURI_INTERNALS__: {},
    });
    expect(apiUrl("/api/source/usgs")).toBe(`${DEFAULT_CATALOG_ORIGIN}/api/source/usgs`);
    expect(apiUrl("api/feedback")).toBe(`${DEFAULT_CATALOG_ORIGIN}/api/feedback`);
  });
});
