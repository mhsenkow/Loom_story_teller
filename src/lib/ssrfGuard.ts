// =================================================================
// SSRF guard for Worker-side outbound fetches (fetch-csv proxy)
// =================================================================

const BLOCKED_HOST_SUFFIXES = [".local", ".internal"] as const;

function stripIpv6Brackets(hostname: string): string {
  const h = hostname.trim();
  if (h.startsWith("[") && h.endsWith("]")) return h.slice(1, -1);
  return h;
}

function parseIpv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets;
}

/** Expand IPv6 to 8 hextets (handles :: compression). Returns null if invalid. */
function parseIpv6Hextets(host: string): number[] | null {
  const h = host.toLowerCase();
  if (!h.includes(":")) return null;
  if (h.includes(".")) return null; // IPv4-mapped — treat via v4 check on tail if needed
  const [left, right] = h.split("::");
  const leftParts = left ? left.split(":").filter(Boolean) : [];
  const rightParts = right !== undefined ? right.split(":").filter(Boolean) : [];
  if (right === undefined && leftParts.length !== 8) return null;
  const missing = 8 - leftParts.length - rightParts.length;
  if (missing < 0) return null;
  if (right === undefined && missing !== 0) return null;
  const all = [...leftParts, ...Array(missing).fill("0"), ...rightParts];
  if (all.length !== 8) return null;
  const hextets: number[] = [];
  for (const part of all) {
    if (!/^[0-9a-f]{1,4}$/i.test(part)) return null;
    hextets.push(parseInt(part, 16));
  }
  return hextets;
}

function isBlockedIpv4(octets: number[]): boolean {
  if (octets[0] === 0) return true; // 0.0.0.0/8
  if (octets[0] === 10) return true; // 10.0.0.0/8
  if (octets[0] === 127) return true; // 127.0.0.0/8
  if (octets[0] === 169 && octets[1] === 254) return true; // link-local
  if (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) return true; // private
  if (octets[0] === 192 && octets[1] === 168) return true;
  if (octets[0] === 100 && octets[1]! >= 64 && octets[1]! <= 127) return true; // CGNAT 100.64.0.0/10
  return false;
}

function isBlockedIpv6(hextets: number[]): boolean {
  if (hextets.slice(0, 7).every((h) => h === 0) && hextets[7] === 1) return true; // ::1
  if ((hextets[0]! & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((hextets[0]! & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  return false;
}

/**
 * True when the hostname must not be fetched (private, loopback, metadata, etc.).
 */
export function isBlockedHost(hostname: string): boolean {
  const raw = hostname.toLowerCase();
  const host = stripIpv6Brackets(raw);
  if (host === "localhost" || host === "0.0.0.0") return true;
  for (const suf of BLOCKED_HOST_SUFFIXES) {
    if (host === suf.slice(1) || host.endsWith(suf)) return true;
  }

  const v4 = parseIpv4(host);
  if (v4) return isBlockedIpv4(v4);

  const v6 = parseIpv6Hextets(host);
  if (v6) return isBlockedIpv6(v6);

  // Legacy dotted forms sometimes slip through as hostnames
  if (/^127\.\d+\.\d+\.\d+$/.test(host)) return true;

  return false;
}

export function assertHttpUrlAllowed(url: URL): void {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only http(s) URLs allowed");
  }
  if (isBlockedHost(url.hostname)) {
    throw new Error("Host not allowed");
  }
}

export interface ManualFetchOptions extends RequestInit {
  maxRedirects?: number;
}

/**
 * Fetch with redirect: manual — re-validates each Location hop.
 */
export async function fetchWithSsrfGuard(
  input: string,
  init: ManualFetchOptions = {},
): Promise<Response> {
  const maxRedirects = init.maxRedirects ?? 5;
  let current = new URL(input);
  assertHttpUrlAllowed(current);

  let redirectCount = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const response = await fetch(current.toString(), { ...init, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("Location");
      if (!location) return response;
      if (redirectCount >= maxRedirects) {
        throw new Error("Too many redirects");
      }
      current = new URL(location, current);
      assertHttpUrlAllowed(current);
      redirectCount += 1;
      continue;
    }
    return response;
  }
}
