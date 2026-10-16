// =================================================================
// LOOM-499 — Worker request-handler tests (fetch-csv, source, stories, feedback)
// =================================================================
// Drives the real `default.fetch` entry with a fake `caches.default`, in-memory
// KV and a mocked global `fetch`; no network, production KV or GitHub token.
// =================================================================

import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../catalog-proxy";
import { catalogSearchCacheKey, sourceCacheKey } from "../../src/lib/workerCatalogPolicy";

const ORIGIN = "https://loom.ibm.io";
const MiB = 1024 * 1024;

// ---- Fakes ----------------------------------------------------------

interface StoredResponse {
  status: number;
  headers: [string, string][];
  body: ArrayBuffer;
}

function createFakeCache() {
  const store = new Map<string, StoredResponse>();
  const keyOf = (k: string | Request) => (typeof k === "string" ? k : k.url);
  return {
    store,
    async match(k: string | Request): Promise<Response | undefined> {
      const hit = store.get(keyOf(k));
      if (!hit) return undefined;
      return new Response(hit.body.slice(0), { status: hit.status, headers: hit.headers });
    },
    async put(k: string | Request, res: Response): Promise<void> {
      store.set(keyOf(k), {
        status: res.status,
        headers: [...res.headers.entries()],
        body: await res.arrayBuffer(),
      });
    },
    async delete(k: string | Request): Promise<boolean> {
      return store.delete(keyOf(k));
    },
  };
}

function createFakeKv() {
  const data = new Map<string, { value: string | ArrayBuffer; metadata?: Record<string, string> }>();
  const kv = {
    data,
    async get(key: string, type?: string) {
      const hit = data.get(key);
      if (!hit) return null;
      if (type === "json") return JSON.parse(hit.value as string);
      return hit.value;
    },
    async getWithMetadata(key: string) {
      const hit = data.get(key);
      return { value: hit?.value ?? null, metadata: hit?.metadata ?? null };
    },
    async put(
      key: string,
      value: string | ArrayBuffer,
      opts?: { metadata?: Record<string, string> },
    ) {
      data.set(key, { value, metadata: opts?.metadata });
    },
    async delete(key: string) {
      data.delete(key);
    },
  };
  return kv;
}

type FakeKv = ReturnType<typeof createFakeKv>;

let ipCounter = 0;
function freshIp(): string {
  ipCounter += 1;
  return `203.0.113.${(ipCounter % 250) + 1}-${ipCounter}`;
}

let cache: ReturnType<typeof createFakeCache>;
let pending: Promise<unknown>[];
let fetchMock: ReturnType<typeof vi.fn>;

function ctx() {
  return { waitUntil: (p: Promise<unknown>) => void pending.push(p) };
}

async function flush() {
  await Promise.all(pending.splice(0));
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: async () => new Response("asset", { status: 200 }) },
    ...overrides,
  };
}

function call(path: string, init: RequestInit = {}, env: Env = makeEnv()) {
  return worker.fetch(new Request(`${ORIGIN}${path}`, init), env, ctx());
}

beforeEach(() => {
  cache = createFakeCache();
  pending = [];
  fetchMock = vi.fn();
  vi.stubGlobal("caches", { default: cache });
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---- /api/fetch-csv -------------------------------------------------

describe("/api/fetch-csv", () => {
  const csvUrl = (u = "https://data.example.org/a.csv") => `/api/fetch-csv?url=${encodeURIComponent(u)}`;
  const sameOrigin = (ip = freshIp()) => ({
    headers: { "Sec-Fetch-Site": "same-origin", "CF-Connecting-IP": ip },
  });

  it("rejects anonymous / unknown-origin callers; allows Cap cross-site", async () => {
    const cross = await call(csvUrl(), { headers: { "Sec-Fetch-Site": "cross-site", "CF-Connecting-IP": freshIp() } });
    expect(cross.status).toBe(403);
    const curl = await call(csvUrl(), { headers: { "CF-Connecting-IP": freshIp() } });
    expect(curl.status).toBe(403);
    const badOrigin = await call(csvUrl(), {
      headers: { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site", "CF-Connecting-IP": freshIp() },
    });
    expect(badOrigin.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(new Response("a,b\n1,2\n"));
    const cap = await call(csvUrl(), {
      headers: {
        Origin: "https://localhost",
        "Sec-Fetch-Site": "cross-site",
        "CF-Connecting-IP": freshIp(),
      },
    });
    expect(cap.status).toBe(200);
  });

  it("accepts an approved Origin and reflects it in CORS", async () => {
    fetchMock.mockResolvedValueOnce(new Response("a,b\n1,2\n"));
    const res = await call(csvUrl(), { headers: { Origin: ORIGIN, "CF-Connecting-IP": freshIp() } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  });

  it("400s on missing, malformed and SSRF-blocked urls", async () => {
    expect((await call("/api/fetch-csv", sameOrigin())).status).toBe(400);
    expect((await call("/api/fetch-csv?url=not%20a%20url", sameOrigin())).status).toBe(400);
    for (const blocked of [
      "http://localhost/x.csv",
      "http://127.0.0.1/x.csv",
      "http://169.254.169.254/latest/meta-data",
      "http://10.0.0.5/x.csv",
      "http://[::1]/x.csv",
      "ftp://data.example.org/x.csv",
    ]) {
      const res = await call(csvUrl(blocked), sameOrigin());
      expect(res.status, blocked).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("MISS then HIT: caches a successful CSV", async () => {
    fetchMock.mockResolvedValueOnce(new Response("a,b\n1,2\n"));
    const first = await call(csvUrl(), sameOrigin());
    expect(first.status).toBe(200);
    expect(first.headers.get("X-Loom-Cache")).toBe("MISS");
    expect(first.headers.get("Content-Type")).toContain("text/csv");
    expect(await first.text()).toBe("a,b\n1,2\n");
    await flush();

    const second = await call(csvUrl(), sameOrigin());
    expect(second.status).toBe(200);
    expect(second.headers.get("X-Loom-Cache")).toBe("HIT");
    expect(await second.text()).toBe("a,b\n1,2\n");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sniffs xlsx (PK zip magic) and returns 415", async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0])));
    const res = await call(csvUrl(), sameOrigin());
    expect(res.status).toBe(415);
    expect(((await res.json()) as { error: string }).error).toMatch(/xlsx/i);
  });

  it("truncates bodies over 32 MiB and does not cache them", async () => {
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 34) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(MiB).fill(0x61));
        sent += 1;
      },
    });
    fetchMock.mockResolvedValueOnce(new Response(stream));
    const res = await call(csvUrl("https://data.example.org/huge.csv"), sameOrigin());
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Loom-Truncated")).toBe("1");
    expect((await res.arrayBuffer()).byteLength).toBe(32 * MiB);
    await flush();
    expect(cache.store.size).toBe(0);
  });

  it("maps upstream failure to 502 and empty bodies are not cached", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    const res = await call(csvUrl(), sameOrigin());
    expect(res.status).toBe(502);

    fetchMock.mockResolvedValueOnce(new Response(""));
    const empty = await call(csvUrl("https://data.example.org/empty.csv"), sameOrigin());
    expect(empty.status).toBe(200);
    await flush();
    expect(cache.store.size).toBe(0);
  });

  it("follows redirects manually and blocks a redirect into a private host", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/secret" } }),
    );
    const res = await call(csvUrl("https://data.example.org/redirect.csv"), sameOrigin());
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rate limits a single IP after 60 requests per minute", async () => {
    const ip = freshIp();
    let last = 0;
    for (let i = 0; i < 61; i += 1) {
      last = (await call("/api/fetch-csv", sameOrigin(ip))).status;
    }
    expect(last).toBe(429);
  });
});

// ---- /api/source/<kind> ---------------------------------------------

describe("/api/source/<kind>", () => {
  const usgsBody = JSON.stringify({
    type: "FeatureCollection",
    features: Array.from({ length: 3 }, (_, i) => ({ id: `q${i}`, properties: { mag: i } })),
  });

  function seedCache(ageMs: number, body = usgsBody) {
    cache.store.set(sourceCacheKey("usgs"), {
      status: 200,
      headers: [["X-Loom-Fetched-Ms", String(Date.now() - ageMs)]],
      body: new TextEncoder().encode(body).buffer as ArrayBuffer,
    });
  }

  it("404s on unknown kinds, including prototype keys", async () => {
    expect((await call("/api/source/not-a-kind")).status).toBe(404);
    expect((await call("/api/source/constructor")).status).toBe(404);
    expect((await call("/api/source/__proto__")).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("MISS fetches upstream, then HIT serves from cache without refetching", async () => {
    fetchMock.mockResolvedValueOnce(new Response(usgsBody));
    const miss = await call("/api/source/usgs");
    expect(miss.status).toBe(200);
    expect(miss.headers.get("X-Loom-Cache")).toBe("MISS");
    expect(miss.headers.get("X-Loom-Fetched-At")).toBeTruthy();
    expect(miss.headers.get("Cache-Control")).toContain("stale-while-revalidate");
    await miss.text();
    await flush();

    const hit = await call("/api/source/usgs/");
    expect(hit.headers.get("X-Loom-Cache")).toBe("HIT");
    expect(await hit.text()).toBe(usgsBody);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("serves STALE-REVALIDATING past TTL and refreshes in the background", async () => {
    seedCache(120_000); // usgs ttl 60s, stale window 600s
    fetchMock.mockResolvedValueOnce(new Response(usgsBody.replace("q0", "fresh")));
    const res = await call("/api/source/usgs");
    expect(res.headers.get("X-Loom-Cache")).toBe("STALE-REVALIDATING");
    expect(await res.text()).toBe(usgsBody);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const refreshed = await cache.match(sourceCacheKey("usgs"));
    expect(await refreshed!.text()).toContain("fresh");
  });

  it("refetches (MISS) when the cached copy is beyond the stale window", async () => {
    seedCache(10_000_000);
    fetchMock.mockResolvedValueOnce(new Response(usgsBody));
    const res = await call("/api/source/usgs");
    expect(res.headers.get("X-Loom-Cache")).toBe("MISS");
  });

  it("returns 502 when upstream fails or returns an empty payload and nothing is cached", async () => {
    fetchMock.mockResolvedValueOnce(new Response("down", { status: 503 }));
    const failed = await call("/api/source/usgs");
    expect(failed.status).toBe(502);
    expect(((await failed.json()) as { error: string }).error).toBe("Upstream fetch failed");

    fetchMock.mockResolvedValueOnce(new Response(""));
    const empty = await call("/api/source/usgs");
    expect(empty.status).toBe(502);
    expect(cache.store.has(sourceCacheKey("usgs"))).toBe(false);
  });

  it("reflects only approved Origins in CORS", async () => {
    fetchMock.mockResolvedValue(new Response(usgsBody));
    const ok = await call("/api/source/usgs", { headers: { Origin: ORIGIN } });
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    const bad = await call("/api/source/usgs", { headers: { Origin: "https://evil.example" } });
    expect(bad.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

// ---- Story publish / get / delete -----------------------------------

describe("stories", () => {
  const HTML = "<html><head><title>t</title></head><body>chart</body></html>";
  let kv: FakeKv;
  let env: Env;

  const publish = (body: unknown, init: RequestInit = {}, e: Env = env) =>
    call(
      "/api/stories",
      {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": freshIp(), ...(init.headers as object) },
        body: typeof body === "string" ? body : JSON.stringify(body),
      },
      e,
    );

  beforeEach(() => {
    kv = createFakeKv();
    env = makeEnv({ LOOM_STORIES: kv as unknown as KVNamespace, STORY_ADMIN_TOKEN: "admin-secret" });
  });

  it("requires an approved Origin or the admin bearer token to publish", async () => {
    const noOrigin = await call("/api/stories", {
      method: "POST",
      headers: { "CF-Connecting-IP": freshIp() },
      body: JSON.stringify({ html: HTML }),
    }, env);
    expect(noOrigin.status).toBe(403);

    const bad = await publish({ html: HTML }, { headers: { Origin: "https://evil.example" } });
    expect(bad.status).toBe(403);

    const wrongToken = await call("/api/stories", {
      method: "POST",
      headers: { Authorization: "Bearer nope", "CF-Connecting-IP": freshIp() },
      body: JSON.stringify({ html: HTML }),
    }, env);
    expect(wrongToken.status).toBe(403);
    expect([...kv.data.keys()].filter((k) => !k.startsWith("rl:"))).toEqual([]);

    const admin = await call("/api/stories", {
      method: "POST",
      headers: { Authorization: "Bearer admin-secret", "CF-Connecting-IP": freshIp() },
      body: JSON.stringify({ html: HTML }),
    }, env);
    expect(admin.status).toBe(200);
  });

  it("publishes html, returning a 32-hex id and public URL", async () => {
    const res = await publish({ html: HTML, title: "My chart" });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { id: string; url: string; hasData: boolean };
    expect(out.id).toMatch(/^[0-9a-f]{32}$/);
    expect(out.url).toBe(`${ORIGIN}/s/${out.id}`);
    expect(out.hasData).toBe(false);
    expect(kv.data.get(`s:${out.id}:html`)?.metadata?.title).toBe("My chart");
  });

  it("validates payloads: invalid JSON, missing/oversize html, non-HTML, size cap", async () => {
    expect((await publish("{not json")).status).toBe(400);
    expect((await publish({})).status).toBe(400);
    expect((await publish({ html: "just text" })).status).toBe(400);
    const bigHtml = `<html>${"a".repeat(4 * MiB + 10)}</html>`;
    expect((await publish({ html: bigHtml })).status).toBe(400);
    const tooLarge = await publish(`{"html":"${"a".repeat(6 * MiB + 10)}"}`);
    expect(tooLarge.status).toBe(413);
    expect([...kv.data.keys()].filter((k) => !k.startsWith("rl:"))).toEqual([]);
  });

  it("503s when LOOM_STORIES KV is not bound", async () => {
    const res = await publish({ html: HTML }, {}, makeEnv());
    expect(res.status).toBe(503);
  });

  it("enforces the per-IP publish limit through KV", async () => {
    const ip = "198.51.100.7";
    kv.data.set(`rl:stories:${ip}`, {
      value: JSON.stringify({ count: 20, resetAt: Date.now() + 60_000 }),
    });
    const res = await publish({ html: HTML }, { headers: { "CF-Connecting-IP": ip } });
    expect(res.status).toBe(429);
  });

  it("stores data lineage and rewrites the Open-in-Loom link", async () => {
    const html = `<html><a data-loom-open="1" href="https://x.example/">open</a></html>`;
    const res = await publish({ html, data: { rows: [{ a: 1 }] } });
    const out = (await res.json()) as { id: string; hasData: boolean };
    expect(out.hasData).toBe(true);
    expect(kv.data.get(`s:${out.id}:data`)?.value).toBe(JSON.stringify({ rows: [{ a: 1 }] }));
    expect(kv.data.get(`s:${out.id}:html`)?.value).toContain(`href="${ORIGIN}/#story=${out.id}"`);
  });

  it("rejects an og image whose bytes do not match the declared type", async () => {
    const fakePng = btoa("not really a png");
    const res = await publish({ html: HTML, ogImage: `data:image/png;base64,${fakePng}` });
    expect(res.status).toBe(400);
  });

  it("hosts a valid og image beside the page and rewrites tokens", async () => {
    const png = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0));
    const html = `<html><meta property="og:image" content="__LOOM_OG_IMG__"></html>`;
    const res = await publish({ html, ogImage: `data:image/png;base64,${png}` });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { id: string };
    expect(kv.data.get(`s:${out.id}:img`)?.metadata?.contentType).toBe("image/png");
    expect(kv.data.get(`s:${out.id}:html`)?.value).toContain(`${ORIGIN}/s/${out.id}.img`);
  });

  it("GET validates ids, 404s misses with no-store, serves html with sandbox CSP", async () => {
    expect((await call("/s/bad!id", {}, env)).status).toBe(400);
    expect((await call("/s/short", {}, env)).status).toBe(400);

    const miss = await call(`/s/${"a".repeat(32)}`, {}, env);
    expect(miss.status).toBe(404);
    expect(miss.headers.get("Cache-Control")).toBe("no-store");

    const pub = (await (await publish({ html: HTML, title: "T" })).json()) as { id: string };
    const res = await call(`/s/${pub.id}`, {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(res.headers.get("X-Loom-Story-Title")).toBe("T");
    expect(await res.text()).toBe(HTML);
  });

  it("GET serves .img and .data companions with their own content types", async () => {
    const id = "b".repeat(32);
    kv.data.set(`s:${id}:img`, { value: new Uint8Array([1, 2, 3]).buffer, metadata: { contentType: "image/jpeg" } });
    kv.data.set(`s:${id}:data`, { value: '{"rows":[]}' });
    const img = await call(`/s/${id}.img`, {}, env);
    expect(img.headers.get("Content-Type")).toBe("image/jpeg");
    const data = await call(`/s/${id}.data`, {}, env);
    expect(data.headers.get("Content-Type")).toContain("application/json");
    expect(await data.text()).toBe('{"rows":[]}');
  });

  it("GET 503s without KV", async () => {
    const res = await call(`/s/${"c".repeat(32)}`, {}, makeEnv());
    expect(res.status).toBe(503);
  });

  it("DELETE needs the admin token, validates id and removes all three keys", async () => {
    const id = "d".repeat(32);
    for (const k of ["html", "img", "data"]) kv.data.set(`s:${id}:${k}`, { value: "x" });

    const del = (path: string, token?: string, e: Env = env) =>
      call(path, { method: "DELETE", headers: token ? { Authorization: `Bearer ${token}` } : {} }, e);

    expect((await del(`/api/stories/${id}`)).status).toBe(401);
    expect((await del(`/api/stories/${id}`, "wrong")).status).toBe(401);
    expect((await del(`/api/stories/${id}`, "admin-secret", makeEnv({ LOOM_STORIES: kv as unknown as KVNamespace }))).status).toBe(401);
    expect(kv.data.size).toBe(3);

    expect((await del(`/api/stories/${id}`, "admin-secret")).status).toBe(200);
    expect(kv.data.size).toBe(0);
  });
});

// ---- /api/feedback --------------------------------------------------

describe("/api/feedback", () => {
  const post = (body: unknown, init: RequestInit = {}, env: Env = makeEnv({ GITHUB_TOKEN: "gh-test" })) =>
    call(
      "/api/feedback",
      {
        method: "POST",
        headers: { Origin: ORIGIN, "CF-Connecting-IP": freshIp(), ...(init.headers as object) },
        body: typeof body === "string" ? body : JSON.stringify(body),
      },
      env,
    );

  it("requires an approved Origin", async () => {
    const none = await call("/api/feedback", { method: "POST", body: "{}" }, makeEnv({ GITHUB_TOKEN: "t" }));
    expect(none.status).toBe(403);
    const bad = await post({}, { headers: { Origin: "https://evil.example" } });
    expect(bad.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("503s when GITHUB_TOKEN is unset", async () => {
    const res = await post({ title: "x" }, {}, makeEnv());
    expect(res.status).toBe(503);
  });

  it("rejects invalid JSON and oversized bodies", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post(`{"body":"${"a".repeat(MiB)}"}`)).status).toBe(413);
  });

  it("rate limits to 5 notes per hour per IP", async () => {
    const kv = createFakeKv();
    const ip = "198.51.100.99";
    kv.data.set(`rl:feedback:${ip}`, {
      value: JSON.stringify({ count: 5, resetAt: Date.now() + 60_000 }),
    });
    const res = await post(
      { title: "x" },
      { headers: { "CF-Connecting-IP": ip } },
      makeEnv({ GITHUB_TOKEN: "t", LOOM_STORIES: kv as unknown as KVNamespace }),
    );
    expect(res.status).toBe(429);
  });

  it("creates a GitHub issue with a bearer token and neutralized metadata fields", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ html_url: "https://github.com/o/r/issues/1" }), { status: 201 }),
    );
    const res = await post({ title: "Bug", body: "hello", kind: "bug`x @octocat", href: "https://loom.ibm.io/#a" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://github.com/o/r/issues/1" });

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toContain("api.github.com/repos/");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer gh-test");
    const sent = JSON.parse(init.body as string) as { title: string; body: string; labels: string[] };
    expect(sent.title).toBe("Bug");
    expect(sent.labels).toEqual(["feedback", "web"]);
    expect(sent.body).not.toContain("@octocat");
    expect(sent.body).toContain("@\u200boctocat");
    expect(sent.body).toContain("bug\\`x");
  });

  it("notes an omitted screenshot when KV is missing and links it when KV exists", async () => {
    const png = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0));
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ html_url: "https://github.com/o/r/issues/2" }), { status: 201 }),
    );

    await post({ title: "no kv", imageBase64: `data:image/png;base64,${png}` });
    const noKv = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as { body: string };
    expect(noKv.body).toContain("Screenshot omitted");

    const kv = createFakeKv();
    await post(
      { title: "kv", imageBase64: `data:image/png;base64,${png}` },
      {},
      makeEnv({ GITHUB_TOKEN: "t", LOOM_STORIES: kv as unknown as KVNamespace }),
    );
    const withKv = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string) as { body: string };
    expect(withKv.body).toMatch(/!\[screenshot\]\(https:\/\/loom\.ibm\.io\/s\/[0-9a-f]{12}\.img\)/);
    expect([...kv.data.keys()].some((k) => k.endsWith(":img"))).toBe(true);
  });

  it("maps GitHub failures and missing issue URLs to 502", async () => {
    fetchMock.mockResolvedValueOnce(new Response("denied", { status: 403 }));
    const denied = await post({ title: "a" });
    expect(denied.status).toBe(502);
    expect(((await denied.json()) as { error: string }).error).toContain("GitHub 403");

    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 201 }));
    const noUrl = await post({ title: "b" });
    expect(noUrl.status).toBe(502);
  });
});

// ---- /api/catalog/<portal> ------------------------------------------

describe("/api/catalog/<portal>", () => {
  it("serves a cached search as HIT without calling the upstream portal", async () => {
    const url = new URL(`${ORIGIN}/api/catalog/us?q=water&rows=5`);
    cache.store.set(catalogSearchCacheKey("us", url), {
      status: 200,
      headers: [["Content-Type", "application/json"]],
      body: new TextEncoder().encode('{"datasets":[]}').buffer as ArrayBuffer,
    });
    const res = await call("/api/catalog/us?q=water&rows=5");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Loom-Cache")).toBe("HIT");
    expect(await res.text()).toBe('{"datasets":[]}');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps an unreachable portal to a JSON 502", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const res = await call("/api/catalog/uk?q=nothing-cached");
    expect(res.status).toBe(502);
    expect(((await res.json()) as { requestId?: string }).requestId).toBeTruthy();
  });
});

// ---- Routing / preflight --------------------------------------------

describe("routing", () => {
  it("answers CORS preflight for approved origins and 403s fetch-csv for others", async () => {
    const ok = await call("/api/fetch-csv", { method: "OPTIONS", headers: { Origin: ORIGIN } });
    expect(ok.status).toBe(204);
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    const bad = await call("/api/fetch-csv", { method: "OPTIONS", headers: { Origin: "https://evil.example" } });
    expect(bad.status).toBe(403);
  });

  it("returns JSON 404 for unknown /api/ paths and falls through to ASSETS otherwise", async () => {
    expect((await call("/api/nope")).status).toBe(404);
    const asset = await call("/index.html");
    expect(await asset.text()).toBe("asset");
    expect(asset.headers.get("X-Content-Type-Options")).toBeTruthy();
  });
});

// ---- /api/source/usafacts_* (USAFacts Data gateway) -------------------

describe("/api/source/usafacts_*", () => {
  const fixture = (n: string) =>
    readFileSync(resolvePath(__dirname, "../../src-tauri/tests/fixtures/sources", n), "utf8");
  const sse = (n: string) => new Response(fixture(n), { headers: { "Content-Type": "text/event-stream" } });

  type ToolArgs = { tool_name: string; arguments: Record<string, string> };
  const toolArgs = (init?: RequestInit): ToolArgs =>
    (JSON.parse(String(init?.body)) as { params: { arguments: ToolArgs } }).params.arguments;

  it("states: one ACS call per vintage; unreleased years are skipped", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://data.mcp.usafacts.org/mcp");
      expect(init?.method).toBe("POST");
      const a = toolArgs(init);
      expect(a.tool_name).toBe("getAcs1");
      return a.arguments.year === "2024" ? sse("usafacts_acs1_2024.sse") : sse("usafacts_error.sse");
    });
    const res = await call("/api/source/usafacts_states");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { columns: string[]; rows: unknown[][] };
    expect(body.columns[0]).toBe("state_fips");
    expect(body.rows.length).toBe(52);
    expect(body.rows.every((r) => r[3] === 2024)).toBe(true);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(12);
  });

  it("states: 502 when every vintage fails and nothing is cached", async () => {
    fetchMock.mockImplementation(async () => sse("usafacts_error.sse"));
    const res = await call("/api/source/usafacts_states");
    expect(res.status).toBe(502);
  });

  it("nation: any failed series falls back to keyless fredgraph.csv", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith("https://fred.stlouisfed.org/graph/fredgraph.csv")) {
        return new Response(fixture(url.includes("GASREGW") ? "fredgraph_gas.csv" : "fredgraph_monthly.csv"));
      }
      const id = toolArgs(init).arguments.series_id;
      return id === "UNRATE" ? sse("usafacts_fred_unrate.sse") : sse("usafacts_error.sse");
    });
    const res = await call("/api/source/usafacts_nation");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { columns: string[]; rows: unknown[][] };
    const jan = body.rows.find((r) => r[0] === "2024-01-01")!;
    expect(body.columns.slice(0, 4)).toEqual(["month", "yr", "unemployment_rate", "inflation_yoy_pct"]);
    expect(jan[3]).not.toBeNull(); // CPI YoY only exists via the fallback here
    const fredCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes("fredgraph.csv"));
    expect(fredCalls.length).toBe(2);
  });

  it("nation: keeps partial gateway data when the fallback is down too", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("fredgraph.csv")) return new Response("down", { status: 503 });
      return toolArgs(init).arguments.series_id === "UNRATE" ? sse("usafacts_fred_unrate.sse") : sse("usafacts_error.sse");
    });
    const res = await call("/api/source/usafacts_nation");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: unknown[][] };
    expect(body.rows.length).toBeGreaterThan(12);
    expect(body.rows.every((r) => r[3] === null)).toBe(true);
  });
});
