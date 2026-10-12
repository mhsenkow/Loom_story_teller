// =================================================================
// NeoSpace / bruh postMessage handoff — origin + filename guards
// =================================================================

export const NEOSPACE_ORIGINS = new Set([
  "https://neospace.ibm.io",
  "https://neospace-dc4.pages.dev",
]);

export const BRUH_ORIGINS = new Set([
  "https://bruh.ibm.io",
  "https://bruh.mhsenkow.workers.dev",
  "https://bruh-15b.pages.dev",
]);

export type NeoSpaceOriginOptions = {
  /** When false, localhost/127.0.0.1 handoffs are rejected (production builds). */
  allowLocalDev?: boolean;
};

export function isAllowedNeoSpaceOrigin(
  origin: string,
  opts?: NeoSpaceOriginOptions,
): boolean {
  const allowLocalDev = opts?.allowLocalDev ?? process.env.NODE_ENV !== "production";
  if (NEOSPACE_ORIGINS.has(origin) || BRUH_ORIGINS.has(origin)) return true;
  try {
    const u = new URL(origin);
    const host = u.hostname.toLowerCase();
    if (host.endsWith(".neospace-dc4.pages.dev")) return true;
    if (host.endsWith(".pages.dev") && host.includes("evil")) return false;
    if (host === "localhost" || host === "127.0.0.1") return allowLocalDev;
    if (u.protocol !== "https:") return false;
    return false;
  } catch {
    return false;
  }
}

export function safeNeoSpaceFileName(name: string): string {
  const base = (name || "neospace-insights.csv").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return base.toLowerCase().endsWith(".csv") ? base : `${base}.csv`;
}
