// =================================================================
// Worker handler tests — LOOM-499
// =================================================================
// Tests for handleFetchCsv, handleSource, handlePublishStory with
// mocked fetch/caches/KV. Covers SSRF, forbidden origin, unknown
// source kind, cache headers, origin check, and body-size cap.
// =================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Env } from "../catalog-proxy";

// ---------------------------------------------------------------------------
// Mocks — fetch, caches, crypto (Workers runtime)
// ---------------------------------------------------------------------------

const mockCachePut = vi.fn().mockResolvedValue(undefined);
const mockCacheMatch = vi.fn().mockResolvedValue(undefined);
const mockCacheDelete = vi.fn().mockResolvedValue(true);

const mockCache = {
  put: mockCachePut,
  match: mockCacheMatch,
  delete: mockCacheDelete,
} as unknown as Cache;

const originalFetch = globalThis.fetch;
const originalCaches = (globalThis as unknown as { caches?: unknown }).caches;

const mockKvGet = vi.fn().mockResolvedValue(null);
const mockKvPut = vi.fn().mockResolvedValue(undefined);
const mockKvDelete = vi.fn().mockResolvedValue(undefined);
const mockKvGetWithMetadata = vi.fn().mockResolvedValue({ value: null, metadata: null });
const mockKv = {
  get: mockKvGet,
  put: mockKvPut,
  delete: mockKvDelete,
  getWithMetadata: mockKvGetWithMetadata,
} as unknown as KVNamespace;

function makeEnv(overrides?: Partial<Env>): Env {
  return {
    ASSETS: { fetch: vi.fn().mockResolvedValue(new Response("ok")) },
    LOOM_STORIES: mockKv,
    STORY_ADMIN_TOKEN: "test-admin-token",
    ...overrides,
  };
}

function makeRequest(
  url: string,
  init?: RequestInit & { headers?: Record<string, string> },
): Request {
  return new Request(url, init);
}

const noopCtx = { waitUntil: () => {} };

beforeEach(() => {
  vi.resetAllMocks();
  mockCacheMatch.mockResolvedValue(undefined);
  mockCachePut.mockResolvedValue(undefined);
  mockKvGet.mockResolvedValue(null);

  // Stub caches.default
  (globalThis as Record<string, unknown>).caches = {
    default: mockCache,
    open: vi.fn().mockResolvedValue(mockCache),
  };

  // Default fetch mock (for upstream calls)
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response("col1,col2\na,1\nb,2", { status: 200 }),
  );
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalCaches) {
    (globalThis as Record<string, unknown>).caches = originalCaches;
  }
});

// Lazy import after mocks are in place
async function importHandlers() {
  // Use dynamic import to ensure mocks are active
  const mod = await import("../catalog-proxy");
  return mod;
}

// ===================================================================
// handleFetchCsv
// ===================================================================
describe("handleFetchCsv", () => {
  it("rejects cross-site origin (Sec-Fetch-Site: cross-site) with 403", async () => {
    const { handleFetchCsv } = await importHandlers();
    const req = makeRequest("https://loom.ibm.io/api/fetch-csv?url=https://example.com/data.csv", {
      headers: { "Sec-Fetch-Site": "cross-site" },
    });
    const res = await handleFetchCsv(req, new URL(req.url), noopCtx);
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/[Ff]orbidden/);
  });

  it("rejects request with no origin and no Sec-Fetch-Site with 403", async () => {
    const { handleFetchCsv } = await importHandlers();
    const req = makeRequest("https://loom.ibm.io/api/fetch-csv?url=https://example.com/data.csv");
    const res = await handleFetchCsv(req, new URL(req.url), noopCtx);
    expect(res.status).toBe(403);
  });

  it("returns 400 for SSRF-blocked private IP target", async () => {
    const { handleFetchCsv } = await importHandlers();
    const req = makeRequest(
      "https://loom.ibm.io/api/fetch-csv?url=http://192.168.1.1/secret",
      { headers: { "Sec-Fetch-Site": "same-origin" } },
    );
    const res = await handleFetchCsv(req, new URL(req.url), noopCtx);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/[Hh]ost not allowed/);
  });

  it("returns 400 for SSRF-blocked localhost target", async () => {
    const { handleFetchCsv } = await importHandlers();
    const req = makeRequest(
      "https://loom.ibm.io/api/fetch-csv?url=http://localhost:8080/admin",
      { headers: { "Sec-Fetch-Site": "same-origin" } },
    );
    const res = await handleFetchCsv(req, new URL(req.url), noopCtx);
    expect(res.status).toBe(400);
  });

  it("returns 400 for SSRF-blocked 127.0.0.1 target", async () => {
    const { handleFetchCsv } = await importHandlers();
    const req = makeRequest(
      "https://loom.ibm.io/api/fetch-csv?url=http://127.0.0.1/secret",
      { headers: { "Sec-Fetch-Site": "same-origin" } },
    );
    const res = await handleFetchCsv(req, new URL(req.url), noopCtx);
    expect(res.status).toBe(400);
  });

  it("returns 400 for SSRF-blocked 10.x.x.x target", async () => {
    const { handleFetchCsv } = await importHandlers();
    const req = makeRequest(
      "https://loom.ibm.io/api/fetch-csv?url=http://10.0.0.1/internal",
      { headers: { "Sec-Fetch-Site": "same-origin" } },
    );
    const res = await handleFetchCsv(req, new URL(req.url), noopCtx);
    expect(res.status).toBe(400);
  });

  it("returns 400 when url param is missing", async () => {
    const { handleFetchCsv } = await importHandlers();
    const req = makeRequest("https://loom.ibm.io/api/fetch-csv", {
      headers: { "Sec-Fetch-Site": "same-origin" },
    });
    const res = await handleFetchCsv(req, new URL(req.url), noopCtx);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/[Mm]issing url/);
  });

  it("returns 400 for invalid url param", async () => {
    const { handleFetchCsv } = await importHandlers();
    const req = makeRequest("https://loom.ibm.io/api/fetch-csv?url=not-a-url", {
      headers: { "Sec-Fetch-Site": "same-origin" },
    });
    const res = await handleFetchCsv(req, new URL(req.url), noopCtx);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/[Ii]nvalid url/);
  });

  it("proxies valid CSV for same-origin request", async () => {
    const { handleFetchCsv } = await importHandlers();
    const csvBody = "name,value\nalice,42\nbob,99";
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(csvBody, { status: 200 }),
    );
    const req = makeRequest(
      "https://loom.ibm.io/api/fetch-csv?url=https://data.gov/file.csv",
      { headers: { "Sec-Fetch-Site": "same-origin" } },
    );
    const res = await handleFetchCsv(req, new URL(req.url), noopCtx);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe(csvBody);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
  });

  it("returns 502 when upstream fails", async () => {
    const { handleFetchCsv } = await importHandlers();
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response("Not found", { status: 404 }),
    );
    const req = makeRequest(
      "https://loom.ibm.io/api/fetch-csv?url=https://example.com/gone.csv",
      { headers: { "Sec-Fetch-Site": "same-origin" } },
    );
    const res = await handleFetchCsv(req, new URL(req.url), noopCtx);
    expect(res.status).toBe(502);
  });

  it("blocks ftp:// scheme", async () => {
    const { handleFetchCsv } = await importHandlers();
    const req = makeRequest(
      "https://loom.ibm.io/api/fetch-csv?url=ftp://evil.com/data",
      { headers: { "Sec-Fetch-Site": "same-origin" } },
    );
    const res = await handleFetchCsv(req, new URL(req.url), noopCtx);
    expect(res.status).toBe(400);
  });
});

// ===================================================================
// handleSource
// ===================================================================
describe("handleSource", () => {
  it("returns 404 for unknown source kind", async () => {
    const { handleSource } = await importHandlers();
    const req = makeRequest("https://loom.ibm.io/api/source/nonexistent");
    const res = await handleSource("nonexistent", req, noopCtx);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/[Uu]nknown source/);
  });

  it("returns 404 for prototype-pollution kind (__proto__)", async () => {
    const { handleSource } = await importHandlers();
    const req = makeRequest("https://loom.ibm.io/api/source/__proto__");
    const res = await handleSource("__proto__", req, noopCtx);
    expect(res.status).toBe(404);
  });

  it("returns 404 for constructor kind", async () => {
    const { handleSource } = await importHandlers();
    const req = makeRequest("https://loom.ibm.io/api/source/constructor");
    const res = await handleSource("constructor", req, noopCtx);
    expect(res.status).toBe(404);
  });

  it("every SOURCE_FETCHERS kind has a matching TTL", async () => {
    const { SOURCE_FETCHERS, SOURCE_TTL_SECS } = await importHandlers();
    for (const kind of Object.keys(SOURCE_FETCHERS)) {
      const ttl = SOURCE_TTL_SECS[kind];
      expect(ttl, `${kind} missing TTL`).toBeDefined();
      expect(typeof ttl, `${kind} TTL type`).toBe("number");
      expect(ttl! > 0, `${kind} TTL > 0`).toBe(true);
    }
  });

  it("sets Cache-Control with stale-while-revalidate on MISS", async () => {
    const { handleSource } = await importHandlers();
    const geoJson = JSON.stringify({
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: { mag: 2.5 } }],
    });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(geoJson, { status: 200 }),
    );
    const req = makeRequest("https://loom.ibm.io/api/source/usgs");
    const res = await handleSource("usgs", req, noopCtx);
    expect(res.status).toBe(200);
    const cc = res.headers.get("Cache-Control");
    expect(cc).toContain("public");
    expect(cc).toContain("stale-while-revalidate");
    expect(res.headers.get("X-Loom-Cache")).toBe("MISS");
  });
});

// ===================================================================
// handlePublishStory
// ===================================================================
describe("handlePublishStory", () => {
  it("rejects request with no Origin and no admin token with 403", async () => {
    const { handlePublishStory } = await importHandlers();
    const html = "<html><body>Hello</body></html>";
    const req = makeRequest("https://loom.ibm.io/api/stories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html }),
    });
    const env = makeEnv({ STORY_ADMIN_TOKEN: undefined });
    const res = await handlePublishStory(req, env);
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/[Ff]orbidden/);
  });

  it("allows publish with valid admin Bearer token", async () => {
    const { handlePublishStory } = await importHandlers();
    const html = "<html><body>Story</body></html>";
    const req = makeRequest("https://loom.ibm.io/api/stories", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-admin-token",
      },
      body: JSON.stringify({ html }),
    });
    const env = makeEnv();
    const res = await handlePublishStory(req, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; url: string };
    expect(body.id).toBeTruthy();
    expect(body.url).toContain("/s/");
  });

  it("returns loom.ibm.io story URLs even when POSTed on workers.dev", async () => {
    const { handlePublishStory } = await importHandlers();
    const html = "<html><body>Cap publish</body></html>";
    const req = makeRequest("https://loom-storyteller.mhsenkow.workers.dev/api/stories", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://localhost",
      },
      body: JSON.stringify({ html }),
    });
    const env = makeEnv({ STORY_ADMIN_TOKEN: undefined });
    const res = await handlePublishStory(req, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { url: string };
    expect(body.url.startsWith("https://loom.ibm.io/s/")).toBe(true);
    expect(body.url).not.toContain("mhsenkow");
  });

  it("allows publish from approved Origin", async () => {
    const { handlePublishStory } = await importHandlers();
    const html = "<html><body>Story from web</body></html>";
    const req = makeRequest("https://loom.ibm.io/api/stories", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://loom.ibm.io",
      },
      body: JSON.stringify({ html }),
    });
    const env = makeEnv();
    const res = await handlePublishStory(req, env);
    expect(res.status).toBe(200);
  });

  it("rejects unapproved Origin without admin token", async () => {
    const { handlePublishStory } = await importHandlers();
    const html = "<html><body>Evil story</body></html>";
    const req = makeRequest("https://loom.ibm.io/api/stories", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example.com",
      },
      body: JSON.stringify({ html }),
    });
    const env = makeEnv({ STORY_ADMIN_TOKEN: undefined });
    const res = await handlePublishStory(req, env);
    expect(res.status).toBe(403);
  });

  it("rejects oversized body with 413", async () => {
    const { handlePublishStory } = await importHandlers();
    const bigBody = "x".repeat(7 * 1024 * 1024);
    const req = makeRequest("https://loom.ibm.io/api/stories", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-admin-token",
        "Content-Length": String(bigBody.length),
      },
      body: bigBody,
    });
    const env = makeEnv();
    const res = await handlePublishStory(req, env);
    expect(res.status).toBe(413);
  });

  it("rejects non-HTML body with 400", async () => {
    const { handlePublishStory } = await importHandlers();
    const req = makeRequest("https://loom.ibm.io/api/stories", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-admin-token",
      },
      body: JSON.stringify({ html: "just plain text, no html tag" }),
    });
    const env = makeEnv();
    const res = await handlePublishStory(req, env);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/[Ee]xpected.*HTML/);
  });

  it("rejects HTML > 4MB with 400", async () => {
    const { handlePublishStory } = await importHandlers();
    const bigHtml = `<html><body>${"x".repeat(4.5 * 1024 * 1024)}</body></html>`;
    const req = makeRequest("https://loom.ibm.io/api/stories", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-admin-token",
      },
      body: JSON.stringify({ html: bigHtml }),
    });
    const env = makeEnv();
    const res = await handlePublishStory(req, env);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/too large/i);
  });

  it("returns 503 when LOOM_STORIES KV is not configured", async () => {
    const { handlePublishStory } = await importHandlers();
    const html = "<html><body>Story</body></html>";
    const req = makeRequest("https://loom.ibm.io/api/stories", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-admin-token",
      },
      body: JSON.stringify({ html }),
    });
    const env = makeEnv({ LOOM_STORIES: undefined });
    const res = await handlePublishStory(req, env);
    expect(res.status).toBe(503);
  });
});

// ===================================================================
// fetchCsvAuthorized / storyMutationAuthorized (exported helpers)
// ===================================================================
describe("fetchCsvAuthorized", () => {
  it("allows same-origin requests", async () => {
    const { fetchCsvAuthorized } = await importHandlers();
    const req = makeRequest("https://loom.ibm.io/api/fetch-csv", {
      headers: { "Sec-Fetch-Site": "same-origin" },
    });
    expect(fetchCsvAuthorized(req)).toBe(true);
  });

  it("blocks cross-site without an allowed Origin", async () => {
    const { fetchCsvAuthorized } = await importHandlers();
    const req = makeRequest("https://loom.ibm.io/api/fetch-csv", {
      headers: { "Sec-Fetch-Site": "cross-site" },
    });
    expect(fetchCsvAuthorized(req)).toBe(false);
  });

  it("allows Capacitor cross-site with https://localhost Origin", async () => {
    const { fetchCsvAuthorized } = await importHandlers();
    const req = makeRequest("https://loom.ibm.io/api/fetch-csv", {
      headers: { "Sec-Fetch-Site": "cross-site", Origin: "https://localhost" },
    });
    expect(fetchCsvAuthorized(req)).toBe(true);
  });

  it("allows approved Origin when Sec-Fetch-Site is absent", async () => {
    const { fetchCsvAuthorized } = await importHandlers();
    const req = makeRequest("https://loom.ibm.io/api/fetch-csv", {
      headers: { Origin: "https://loom.ibm.io" },
    });
    expect(fetchCsvAuthorized(req)).toBe(true);
  });

  it("blocks anonymous request (no headers)", async () => {
    const { fetchCsvAuthorized } = await importHandlers();
    const req = makeRequest("https://loom.ibm.io/api/fetch-csv");
    expect(fetchCsvAuthorized(req)).toBe(false);
  });
});

describe("storyMutationAuthorized", () => {
  it("allows matching admin token", async () => {
    const { storyMutationAuthorized } = await importHandlers();
    const req = makeRequest("https://loom.ibm.io/api/stories", {
      method: "POST",
      headers: { Authorization: "Bearer test-admin-token" },
    });
    expect(storyMutationAuthorized(req, makeEnv())).toBe(true);
  });

  it("allows approved origin without token", async () => {
    const { storyMutationAuthorized } = await importHandlers();
    const req = makeRequest("https://loom.ibm.io/api/stories", {
      method: "POST",
      headers: { Origin: "https://loom.ibm.io" },
    });
    expect(storyMutationAuthorized(req, makeEnv())).toBe(true);
  });

  it("rejects wrong token and wrong origin", async () => {
    const { storyMutationAuthorized } = await importHandlers();
    const req = makeRequest("https://loom.ibm.io/api/stories", {
      method: "POST",
      headers: {
        Authorization: "Bearer wrong-token",
        Origin: "https://evil.example.com",
      },
    });
    expect(storyMutationAuthorized(req, makeEnv())).toBe(false);
  });
});

describe("worker entry exports", () => {
  // workerd treats every named export of the entry module as an entrypoint and
  // refuses to boot when one is a primitive (e.g. `export const X = "..."`).
  it("exports only functions or objects", async () => {
    const mod = (await importHandlers()) as Record<string, unknown>;
    for (const [name, value] of Object.entries(mod)) {
      const t = typeof value;
      expect(t === "function" || (t === "object" && value !== null), `export ${name} is ${t}`).toBe(true);
    }
  });
});
