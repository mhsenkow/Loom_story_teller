// =================================================================
// fetchCsvTextWeb — native shells must hit Worker, not SPA index.html
// =================================================================

import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CATALOG_ORIGIN, fetchCsvTextWeb } from "../openDataCatalog";
import { looksLikeHtmlDocument } from "../openDataCatalogPolicy";

describe("looksLikeHtmlDocument", () => {
  it("detects SPA shells", () => {
    expect(looksLikeHtmlDocument("<!DOCTYPE html><html><head></head></html>")).toBe(true);
    expect(looksLikeHtmlDocument("  <html lang=en>")).toBe(true);
  });

  it("accepts CSV", () => {
    expect(looksLikeHtmlDocument("a,b\n1,2\n")).toBe(false);
  });
});

describe("fetchCsvTextWeb", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("Capacitor: goes straight to the Worker (skips relative /api)", async () => {
    vi.stubGlobal("window", {
      location: { hostname: "localhost" },
      Capacitor: { isNativePlatform: () => true },
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url.startsWith(DEFAULT_CATALOG_ORIGIN)).toBe(true);
      expect(url).toContain("/api/fetch-csv?url=");
      return new Response("col_a,col_b\n1,2\n", {
        status: 200,
        headers: { "Content-Type": "text/csv", "X-Loom-Truncated": "0" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { text, truncated } = await fetchCsvTextWeb("https://example.com/data.csv");
    expect(text).toContain("col_a");
    expect(truncated).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("browser: falls back to Worker when same-origin returns index.html", async () => {
    vi.stubGlobal("window", { location: { hostname: "loom.ibm.io" } });
    const spa = "<!DOCTYPE html><html><head><title>Loom</title></head><body></body></html>";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/fetch-csv")) {
        return new Response(spa, { status: 200, headers: { "Content-Type": "text/html" } });
      }
      expect(url.startsWith(DEFAULT_CATALOG_ORIGIN)).toBe(true);
      return new Response("year,value\n2020,1\n", { status: 200, headers: { "Content-Type": "text/csv" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { text } = await fetchCsvTextWeb("https://example.com/a.csv");
    expect(text).toContain("year,value");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
