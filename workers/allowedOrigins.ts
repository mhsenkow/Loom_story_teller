// =================================================================
// allowedOrigins — shared browser-origin allowlist for Worker mutations
// =================================================================

/** Default hosts when env.ALLOWED_ORIGIN_HOSTS is unset (LOOM-654). */
export const DEFAULT_ALLOWED_ORIGIN_HOSTS = [
  "loom.ibm.io",
  "loom-storyteller.mhsenkow.workers.dev",
  "localhost",
  "127.0.0.1",
  "tauri.localhost",
  "localhost.localdomain",
] as const;

export function parseAllowedOriginHosts(raw: string | undefined): string[] {
  if (!raw?.trim()) return [...DEFAULT_ALLOWED_ORIGIN_HOSTS];
  return raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

export function originAllowed(origin: string | null, hosts: readonly string[]): boolean {
  if (!origin) return false;
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return hosts.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export function allowedOriginHostsFromEnv(env: { ALLOWED_ORIGIN_HOSTS?: string }): string[] {
  return parseAllowedOriginHosts(env.ALLOWED_ORIGIN_HOSTS);
}
