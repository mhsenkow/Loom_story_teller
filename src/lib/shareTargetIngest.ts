// =================================================================
// Loom — Web Share Target recovery (LOOM-457)
// =================================================================

export function parseShareIngestToken(hash: string): string | null {
  const m = hash.match(/[#&]ingest=share:([a-zA-Z0-9-]+)/);
  return m?.[1] ?? null;
}

export async function loadSharedTargetFile(token: string): Promise<File | null> {
  if (typeof caches === "undefined") return null;
  const cache = await caches.open("loom-shell-v1");
  const res = await cache.match(`/share-ingest/${token}`);
  if (!res) return null;
  const name = res.headers.get("x-loom-share-name") ?? "shared-file.csv";
  const type = res.headers.get("content-type") ?? "application/octet-stream";
  const buf = await res.arrayBuffer();
  return new File([buf], name, { type });
}
