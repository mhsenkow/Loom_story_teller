// =================================================================
// Public Loom origin — share / reopen links for anyone
// =================================================================
// Capacitor and the workers.dev deploy host must not appear in links
// recipients open. Always hand out loom.ibm.io for stories and #chart=
// / #story= reopen URLs so any browser (or the App Store app via web)
// can load the same chart.

/** Product web origin — App Store + shared links point here. */
export const PUBLIC_LOOM_ORIGIN = "https://loom.ibm.io";

/**
 * Origin to put in shareable links.
 * On loom.ibm.io → same origin. Everywhere else (Cap, workers.dev, localhost) → product host.
 */
export function publicLoomWebOrigin(): string {
  const loc =
    typeof globalThis !== "undefined"
      ? (globalThis as { location?: { hostname?: string; origin?: string } }).location
      : undefined;
  if (!loc?.hostname) return PUBLIC_LOOM_ORIGIN;
  try {
    if (loc.hostname === "loom.ibm.io" && loc.origin) return loc.origin;
  } catch {
    /* ignore */
  }
  return PUBLIC_LOOM_ORIGIN;
}

/** Rewrite workers.dev / localhost story URLs to the public product host. */
export function toPublicLoomUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === "loom.ibm.io") return url;
    const local =
      u.hostname === "localhost" ||
      u.hostname === "127.0.0.1" ||
      u.hostname === "tauri.localhost" ||
      u.hostname.endsWith(".workers.dev");
    if (!local) return url;
    return `${PUBLIC_LOOM_ORIGIN}${u.pathname}${u.search}${u.hash}`;
  } catch {
    return url;
  }
}
