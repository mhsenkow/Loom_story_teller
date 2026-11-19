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
    expect(out.url).toBe(`${ORIGIN}/plot/my-chart/${out.id}`);
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

  it("batches rate-limit writes instead of putting on every publish", async () => {
    const ip = freshIp();
    const headers = { "CF-Connecting-IP": ip };
    expect((await publish({ html: HTML }, { headers })).status).toBe(200);
    const key = `rl:stories:${ip}`;
    expect(JSON.parse(kv.data.get(key)!.value as string).count).toBe(1);
    expect((await publish({ html: HTML }, { headers })).status).toBe(200);
    expect(JSON.parse(kv.data.get(key)!.value as string).count).toBe(1);
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
    const html = `<html><meta property="og:url" content="__LOOM_PAGE_URL__"><meta property="og:image" content="__LOOM_OG_IMG__"></html>`;
    const res = await publish({ html, ogImage: `data:image/png;base64,${png}` });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { id: string };
    expect(kv.data.get(`s:${out.id}:img`)?.metadata?.contentType).toBe("image/png");
    expect(kv.data.get(`s:${out.id}:html`)?.value).toContain(`${ORIGIN}/plot/chart/${out.id}.png`);
    expect(kv.data.get(`s:${out.id}:html`)?.value).toContain(`og:url" content="${ORIGIN}/plot/chart/${out.id}"`);
  });

  it("serves an oEmbed photo for the plot URL", async () => {
    const jpeg = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xd9));
    const html = `<html><head><link rel="alternate" type="application/json+oembed" href="__LOOM_OEMBED_URL__" /></head></html>`;
    const res = await publish({ html, title: "Correlation matrix", ogImage: `data:image/jpeg;base64,${jpeg}` });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { id: string; url: string };
    expect(kv.data.get(`s:${out.id}:html`)?.value).toContain(`/oembed?url=`);
    const card = await call(`/oembed?url=${encodeURIComponent(out.url)}`, {}, env);
    expect(card.status).toBe(200);
    const body = (await card.json()) as { type: string; title: string; url: string; width: number; height: number };
    expect(body.type).toBe("photo");
    expect(body.title).toBe("Correlation matrix");
    expect(body.url).toBe(`${out.url}.jpg`);
    expect(body.width).toBe(1200);
    expect(body.height).toBe(627);
  });

  it("GET validates ids, 404s misses with no-store, serves html with sandbox CSP", async () => {
    expect((await call("/s/bad!id", {}, env)).status).toBe(400);
    expect((await call("/s/short", {}, env)).status).toBe(400);

    const miss = await call(`/s/${"a".repeat(32)}`, {}, env);
    expect(miss.status).toBe(404);
    expect(miss.headers.get("Cache-Control")).toBe("no-store");

    const pub = (await (await publish({ html: HTML, title: "T" })).json()) as { id: string };
    const res = await call(`/plot/t/${pub.id}`, {}, env);
    expect(res.status).toBe(200);
    expect((await call(`/s/${pub.id}`, {}, env)).status).toBe(200);
    expect(res.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(res.headers.get("X-Loom-Story-Title")).toBe("T");
    expect(res.headers.get("X-Robots-Tag")).toContain("max-image-preview:large");
    expect(await res.text()).toBe(HTML);
  });

  it("GET serves .img and .data companions with their own content types", async () => {
    const id = "b".repeat(32);
    kv.data.set(`s:${id}:img`, { value: new Uint8Array([1, 2, 3]).buffer, metadata: { contentType: "image/jpeg" } });
    kv.data.set(`s:${id}:data`, { value: '{"rows":[]}' });
    const img = await call(`/s/${id}.img`, {}, env);
    expect(img.headers.get("Content-Type")).toBe("image/jpeg");
    expect(img.headers.get("Content-Disposition")).toBe("inline");
    expect(img.headers.get("X-Robots-Tag")).toContain("max-image-preview:large");
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
    expect(res.headers.get("Access-Control-Allow-Origin")).not.toBeNull();
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

  /**
   * Gateway mock: ACS from the 2024 fixture (for 2024 only, or every vintage with `allYears`),
   * the newest vintage unreleased (404), CPI annual.
   */
  const statesGateway = (opts: { failAcs?: boolean; allYears?: boolean } = {}) =>
    async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://data.mcp.usafacts.org/mcp");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("Mcp-Protocol-Version")).toBe("2025-03-26");
      const a = toolArgs(init);
      if (a.tool_name === "getSeriesObservations") return sse("usafacts_fred_cpi_annual.sse");
      if (a.tool_name === "getRegionalData") return sse("usafacts_bea_sarpp1.sse");
      expect(a.tool_name).toBe("getAcs1");
      if (opts.failAcs) return new Response("bad gateway", { status: 502 });
      const newest = String(new Date().getUTCFullYear() - 1);
      const released = opts.allYears ? a.arguments.year !== newest : a.arguments.year === "2024";
      return released ? sse("usafacts_acs1_2024.sse") : sse("usafacts_error.sse");
    };
  const acsYearsAsked = () =>
    fetchMock.mock.calls.map(([, init]) => toolArgs(init as RequestInit)).filter((a) => a.tool_name === "getAcs1").map((a) => a.arguments.year);
  const expireFeedCopy = (kind: string) => {
    for (const k of [...cache.store.keys()]) if (k.startsWith(sourceCacheKey(kind))) cache.store.delete(k);
  };

  it("states: one ACS call per vintage + annual CPI; unreleased years are skipped", async () => {
    fetchMock.mockImplementation(statesGateway());
    const res = await call("/api/source/usafacts_states");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { columns: string[]; rows: unknown[][]; meta: { dollarsOf: number } };
    expect(body.columns[0]).toBe("state_fips");
    expect(body.columns.slice(10, 12)).toEqual(["region", "real_median_income"]);
    expect(body.columns.slice(-4)).toEqual(["price_level", "rent_price_level", "income_local_usd", "real_personal_income_pc"]);
    expect(body.rows.length).toBe(52);
    expect(body.rows.every((r) => r[3] === 2024)).toBe(true);
    expect(body.meta.dollarsOf).toBe(2024);
    // Real income is the 2024 value itself when 2024 is the base year.
    expect(body.rows.every((r) => r[11] === r[5])).toBe(true);
    expect(acsYearsAsked().length).toBeGreaterThanOrEqual(12);
  });

  it("states: a refresh re-asks only the newest vintages; settled ones come from the memo", async () => {
    fetchMock.mockImplementation(statesGateway({ allYears: true }));
    expect((await call("/api/source/usafacts_states")).status).toBe(200);
    await flush();
    const first = acsYearsAsked();
    fetchMock.mockClear();
    expireFeedCopy("usafacts_states");
    expect((await call("/api/source/usafacts_states")).status).toBe(200);
    const second = acsYearsAsked();
    const thisYear = new Date().getUTCFullYear();
    // Years ≤ thisYear-3 are settled (30 days) and the one before was fetched today → only
    // the still-unreleased newest vintage is asked again.
    expect(first.length).toBeGreaterThanOrEqual(12);
    expect(second).toEqual([String(thisYear - 1)]);
    // CPI is fresh for a week → not asked again.
    expect(fetchMock.mock.calls.some(([, init]) => toolArgs(init as RequestInit).tool_name === "getSeriesObservations")).toBe(false);
  });

  it("states: retries a transient gateway failure once", async () => {
    const seen = new Map<string, number>();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const a = toolArgs(init);
      const k = `${a.tool_name}:${a.arguments.year ?? ""}`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
      if (k === "getAcs1:2024" && seen.get(k) === 1) return new Response("overloaded", { status: 503 });
      return statesGateway()(url, init);
    });
    const res = await call("/api/source/usafacts_states");
    const body = (await res.json()) as { rows: unknown[][] };
    expect(body.rows.length).toBe(52);
    expect(seen.get("getAcs1:2024")).toBe(2);
    // Not-found vintages are final: asked once each.
    expect(seen.get("getAcs1:2015")).toBe(1);
  });

  it("states: a variable Census no longer knows costs that column, not the vintage", async () => {
    const gets: string[] = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const a = toolArgs(init);
      if (a.tool_name === "getAcs1" && a.arguments.year === "2024") {
        gets.push(a.arguments.get!);
        if (a.arguments.get!.includes("B06009PR_006E")) {
          const body = { kind: "upstream_rejected", message: "HTTP 400", upstream_status: 400, upstream_body: "error: unknown variable 'B06009PR_006E'", retryable: false };
          return new Response(`data: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { isError: true, content: [{ type: "text", text: JSON.stringify(body) }] } })}\n`);
        }
      }
      return statesGateway()(url, init);
    });
    const res = await call("/api/source/usafacts_states");
    const body = (await res.json()) as { columns: string[]; rows: unknown[][] };
    expect(gets).toHaveLength(2);
    expect(gets[1]).not.toContain("B06009PR_006E");
    expect(body.rows.length).toBe(52);
    // The vintage survives with every other column (the transform nulls whatever is absent).
    expect(body.rows.find((r) => r[1] === "AL")![body.columns.indexOf("bachelors_or_higher_pct")]).not.toBeNull();
  });

  it("states: the memo stands in for vintages that fail on a refresh", async () => {
    fetchMock.mockImplementation(statesGateway({ allYears: true }));
    expect((await call("/api/source/usafacts_states")).status).toBe(200);
    await flush();
    expireFeedCopy("usafacts_states");
    fetchMock.mockImplementation(statesGateway({ failAcs: true }));
    const res = await call("/api/source/usafacts_states");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: unknown[][] };
    // Every released vintage (all but the newest) comes back from the memo, 52 states each.
    const released = new Set(body.rows.map((r) => r[3]));
    expect(released.size).toBe(new Date().getUTCFullYear() - 2012 - 2); // 2012 … last-1, minus 2020
    expect(body.rows.length).toBe(released.size * 52);
  });

  it("states: with no edge copy, the KV last-good copy beats a 502", async () => {
    const kv = createFakeKv();
    const env = makeEnv({ LOOM_STORIES: kv as unknown as KVNamespace });
    fetchMock.mockImplementation(statesGateway());
    expect((await call("/api/source/usafacts_states", {}, env)).status).toBe(200);
    await flush();
    expect(kv.data.has("srclast:usafacts_states")).toBe(true);
    // A different edge: empty Cache API, gateway down for every vintage.
    cache.store.clear();
    fetchMock.mockImplementation(statesGateway({ failAcs: true }));
    const res = await call("/api/source/usafacts_states", {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Loom-Cache")).toBe("STALE-DURABLE");
    expect(((await res.json()) as { rows: unknown[][] }).rows.length).toBe(52);
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

  it("nation: asks for all eight series; the CSV only fills the ones the gateway lacked", async () => {
    const asked: string[] = [];
    const csvUrls: string[] = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("fredgraph.csv")) {
        csvUrls.push(url);
        return new Response(fixture(url.includes("GASREGW") ? "fredgraph_gas.csv" : "fredgraph_monthly.csv"));
      }
      const id = toolArgs(init).arguments.series_id!;
      asked.push(id);
      return id === "UNRATE" ? sse("usafacts_fred_unrate.sse") : sse("usafacts_error.sse");
    });
    const res = await call("/api/source/usafacts_nation");
    const body = (await res.json()) as { columns: string[]; rows: unknown[][] };
    expect(asked.sort()).toEqual(["CPIAUCSL", "FEDFUNDS", "GASREGW", "GS10", "HOUST", "JTSJOL", "PAYEMS", "UNRATE"]);
    expect(csvUrls.some((u) => u.includes("id=UNRATE,CPIAUCSL,PAYEMS,FEDFUNDS,HOUST,JTSJOL,GS10"))).toBe(true);
    expect(body.columns.slice(-3)).toEqual(["jobs_added_k", "decade", "recession"]);
    const unrate = (m: string) => body.rows.find((r) => r[0] === m)?.[2];
    // Feb 2024 UNRATE: gateway fixture and fredgraph agree, but the gateway's copy is the one kept.
    expect(unrate("2024-02-01")).toBe(3.9);
    const feb = body.rows.find((r) => r[0] === "2024-02-01")!;
    expect(feb[body.columns.indexOf("jobs_added_k")]).not.toBeNull(); // payrolls from the CSV
    expect(feb[body.columns.indexOf("recession")]).toBe("Expansion");
  });
});

// ---- /api/source/usafacts_state_jobs (BLS LAUS via the gateway) ---------

describe("/api/source/usafacts_state_jobs", () => {
  const fixture = (n: string) =>
    readFileSync(resolvePath(__dirname, "../../src-tauri/tests/fixtures/sources", n), "utf8");
  const sse = (n: string) => new Response(fixture(n), { headers: { "Content-Type": "text/event-stream" } });
  const toolArgs = (init?: RequestInit) =>
    (JSON.parse(String(init?.body)) as { params: { arguments: { source_id: string; tool_name: string; arguments: { seriesid: string[]; startyear: string; endyear: string } } } }).params.arguments;

  it("two getSeriesData calls for 52 states, 19 years", async () => {
    const calls: { seriesid: string[]; startyear: string; endyear: string }[] = [];
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      const a = toolArgs(init);
      expect([a.source_id, a.tool_name]).toEqual(["bls", "getSeriesData"]);
      calls.push(a.arguments);
      return sse("usafacts_bls_state_ur.sse");
    });
    const res = await call("/api/source/usafacts_state_jobs");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { columns: string[]; rows: unknown[][] };
    expect(calls.map((c) => c.seriesid.length).sort()).toEqual([2, 50]);
    expect(Number(calls[0]!.endyear) - Number(calls[0]!.startyear)).toBe(18);
    expect(body.columns).toEqual(["month", "yr", "state_fips", "state_abbr", "state_name", "region", "unemployment_rate", "unemployment_change_yoy"]);
    expect(body.rows.length).toBe(99); // the fixture holds AL, CA, PR
  });

  it("falls back to keyless fredgraph.csv when a BLS batch fails", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("fredgraph.csv")) {
        expect(url).toMatch(/id=([A-Z]{2}UR,){25}[A-Z]{2}UR$/);
        return new Response(fixture("fredgraph_state_ur.csv"));
      }
      return toolArgs(init).arguments.seriesid.length === 2 ? new Response("down", { status: 500 }) : sse("usafacts_bls_state_ur.sse");
    });
    const res = await call("/api/source/usafacts_state_jobs");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: unknown[][] };
    expect(body.rows.length).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("fredgraph.csv")).length).toBe(2);
  });

  it("keeps the BLS rows it has when the fallback is down too", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("fredgraph.csv")) return new Response("down", { status: 503 });
      return toolArgs(init).arguments.seriesid.length === 2 ? new Response("down", { status: 500 }) : sse("usafacts_bls_state_ur.sse");
    });
    const res = await call("/api/source/usafacts_state_jobs");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { rows: unknown[][] }).rows.length).toBe(99);
  });
});

// ---- /api/source/usafacts_budget* and usafacts_household ------------------------

describe("/api/source/usafacts_budget, budget_lines, household", () => {
  const fixture = (n: string) => readFileSync(resolvePath(__dirname, "../../src-tauri/tests/fixtures/sources", n), "utf8");
  const sse = (n: string) => new Response(fixture(n), { headers: { "Content-Type": "text/event-stream" } });
  const toolArgs = (init?: RequestInit) =>
    (JSON.parse(String(init?.body)) as { params: { arguments: { source_id: string; tool_name: string; arguments: Record<string, unknown> } } }).params.arguments;
  /** The gateway's MTS reply split into two 1000-row-style pages. */
  const mtsPages = () => {
    const raw = fixture("usafacts_treasury_mts9.sse").split("\n").filter((l) => l.startsWith("data:")).at(-1)!.slice(5);
    const result = (JSON.parse(raw) as { result: { structuredContent: { data: unknown[] } } }).result.structuredContent;
    const half = Math.ceil(result.data.length / 2);
    const page = (n: number) => ({ data: result.data.slice((n - 1) * half, n * half), meta: { "total-pages": 2 } });
    return (n: number) => new Response(`data: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { structuredContent: page(n) } })}\n`);
  };

  it("budget: pages through the gateway and joins the average rate", async () => {
    const pages = mtsPages();
    const asked: number[] = [];
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      const a = toolArgs(init);
      expect(a.source_id).toBe("treasury");
      if (a.tool_name === "getAvgInterestRates") return sse("usafacts_treasury_avg_rates.sse");
      const n = Number(a.arguments["page[number]"]);
      asked.push(n);
      return pages(n);
    });
    const res = await call("/api/source/usafacts_budget");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { columns: string[]; rows: unknown[][] };
    expect(asked).toEqual([1, 2]);
    expect(body.rows).toHaveLength(34);
    const oct = body.rows.find((r) => r[0] === "2026-10-01")!;
    expect(oct[body.columns.indexOf("interest_share_pct")]).toBeCloseTo(19.82, 2);
    expect(oct[body.columns.indexOf("avg_interest_rate_pct")]).toBe(3.57);
  });

  it("budget_lines: reuses the budget memo instead of asking Treasury again", async () => {
    const pages = mtsPages();
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      const a = toolArgs(init);
      return a.tool_name === "getAvgInterestRates" ? sse("usafacts_treasury_avg_rates.sse") : pages(Number(a.arguments["page[number]"]));
    });
    expect((await call("/api/source/usafacts_budget")).status).toBe(200);
    await flush();
    fetchMock.mockClear();
    const res = await call("/api/source/usafacts_budget_lines");
    const body = (await res.json()) as { rows: unknown[][] };
    expect(body.rows.length).toBeGreaterThan(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("budget: falls back to direct Fiscal Data when the gateway is down", async () => {
    const direct: string[] = [];
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith("https://api.fiscaldata.treasury.gov/")) {
        direct.push(url);
        const raw = url.includes("avg_interest_rates") ? "usafacts_treasury_avg_rates.sse" : "usafacts_treasury_mts9.sse";
        const line = fixture(raw).split("\n").filter((l) => l.startsWith("data:")).at(-1)!.slice(5);
        return new Response(JSON.stringify((JSON.parse(line) as { result: { structuredContent: unknown } }).result.structuredContent));
      }
      return new Response("down", { status: 503 });
    });
    const res = await call("/api/source/usafacts_budget");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { rows: unknown[][] }).rows).toHaveLength(34);
    expect(direct.some((u) => u.includes("mts_table_9") && u.includes("page%5Bsize%5D=10000"))).toBe(true);
    expect(direct.some((u) => u.includes("avg_interest_rates"))).toBe(true);
  });

  it("household: each series falls back to its own fredgraph CSV, and a ZIP doesn't count", async () => {
    const csv: string[] = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith("https://fred.stlouisfed.org/graph/fredgraph.csv")) {
        csv.push(url);
        if (url.includes("id=PSAVERT&")) return new Response(fixture("fredgraph_q_psavert.csv"));
        return new Response("PK\u0003\u0004 not a csv");
      }
      const id = toolArgs(init).arguments.series_id;
      if (id === "MSPUS") return sse("usafacts_fred_q_mspus.sse");
      if (id === "LES1252881500Q") return sse("usafacts_fred_q_les.sse");
      return new Response("down", { status: 502 });
    });
    const res = await call("/api/source/usafacts_household");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { columns: string[]; rows: unknown[][] };
    const q = body.rows.find((r) => r[0] === "2024-01-01")!;
    expect(q[body.columns.indexOf("saving_rate_pct")]).not.toBeNull(); // from fredgraph
    expect(q[body.columns.indexOf("home_price_years_of_pay")]).toBeCloseTo(426800 / (1136 * 52), 2);
    expect(q[body.columns.indexOf("card_delinquency_pct")]).toBeNull(); // ZIP rejected
    expect(csv.every((u) => !u.includes(","))).toBe(true); // one series per request
  });

  it("states: BEA price levels land in the panel", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      const a = toolArgs(init);
      if (a.source_id === "bea") {
        if (a.arguments.TableName === "SARPP" && a.arguments.LineCode === "1") return sse("usafacts_bea_sarpp1.sse");
        return new Response("down", { status: 503 });
      }
      if (a.tool_name === "getSeriesObservations") return sse("usafacts_fred_cpi_annual.sse");
      return a.arguments.year === "2024" ? sse("usafacts_acs1_2024.sse") : sse("usafacts_error.sse");
    });
    const res = await call("/api/source/usafacts_states");
    const body = (await res.json()) as { columns: string[]; rows: unknown[][] };
    const ms = body.rows.find((r) => r[1] === "MS")!;
    expect(ms[body.columns.indexOf("price_level")]).toBeCloseTo(86.953, 3);
    expect(ms[body.columns.indexOf("income_local_usd")]).not.toBeNull();
    expect(ms[body.columns.indexOf("rent_price_level")]).toBeNull(); // that BEA call failed: only its column is empty
  });
});
