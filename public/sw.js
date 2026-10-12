/* Loom minimal service worker — app shell + source snapshot cache (LOOM-457, LOOM-459) */
/* BUILD_ID is rewritten on each `next build` by scripts/write-build-id.mjs */
const BUILD_ID = "dev";
const SHELL = `loom-shell-${BUILD_ID}`;
const SOURCE = "loom-source-v1";
const STATIC = `loom-static-${BUILD_ID}`;
const SHELL_PATHS = ["/", "/index.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(SHELL_PATHS).catch(() => undefined)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, SOURCE, STATIC]);
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("loom-") && !keep.has(key))
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

async function cacheSourceResponse(request, response) {
  const cache = await caches.open(SOURCE);
  const headers = new Headers(response.headers);
  headers.set("x-loom-captured-at", String(Date.now()));
  const body = await response.clone().arrayBuffer();
  await cache.put(request, new Response(body, { status: response.status, headers }));
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === "GET" && url.pathname.startsWith("/api/source/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SOURCE);
        const cached = await cache.match(event.request);
        try {
          const fresh = await fetch(event.request);
          if (fresh.ok) {
            event.waitUntil(cacheSourceResponse(event.request, fresh.clone()));
            return fresh;
          }
          if (cached) return cached;
          return fresh;
        } catch {
          if (cached) return cached;
          throw new Error("offline");
        }
      })(),
    );
    return;
  }

  // LOOM-416: let a cold offline start boot the shell + hashed chunks so
  // durable IndexedDB uploads can reopen. Same-origin GET only; no API/user data.
  if (event.request.method === "GET" && url.origin === self.location.origin) {
    if (url.pathname.startsWith("/_next/static/")) {
      event.respondWith(
        (async () => {
          const cache = await caches.open(STATIC);
          const hit = await cache.match(event.request);
          if (hit) return hit;
          const res = await fetch(event.request);
          if (res.ok) event.waitUntil(cache.put(event.request, res.clone()));
          return res;
        })(),
      );
      return;
    }
    if (event.request.mode === "navigate" && url.pathname === "/") {
      event.respondWith(
        (async () => {
          const cache = await caches.open(SHELL);
          try {
            const res = await fetch(event.request, { cache: "no-store" });
            if (res.ok) event.waitUntil(cache.put("/", res.clone()));
            return res;
          } catch {
            const hit = (await cache.match("/")) || (await cache.match("/index.html"));
            if (hit) return hit;
            throw new Error("offline");
          }
        })(),
      );
      return;
    }
  }

  if (event.request.method === "POST" && url.pathname === "/share-target") {
    event.respondWith(
      (async () => {
        const form = await event.request.formData();
        const file = form.get("file");
        if (!(file instanceof File)) {
          return Response.redirect("/?share=unsupported", 303);
        }
        const cache = await caches.open(SHELL);
        const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await cache.put(
          `/share-ingest/${token}`,
          new Response(await file.arrayBuffer(), {
            headers: {
              "content-type": file.type || "application/octet-stream",
              "x-loom-share-name": file.name,
            },
          }),
        );
        return Response.redirect(`/#ingest=share:${token}`, 303);
      })(),
    );
  }
});
