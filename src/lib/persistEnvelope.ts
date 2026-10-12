// =================================================================
// persistEnvelope — versioned localStorage payloads (LOOM-179)
// =================================================================

export const PERSIST_SCHEMA_VERSION = 1;

export type PersistEnvelope<T> = { v: number; data: T };

export function wrapPersist<T>(data: T, version = PERSIST_SCHEMA_VERSION): PersistEnvelope<T> {
  return { v: version, data };
}

export function unwrapPersist<T>(raw: unknown, migrate?: (v: number, data: unknown) => T | null): T | null {
  if (raw == null) return null;
  if (typeof raw === "object" && raw !== null && "v" in raw && "data" in raw) {
    const env = raw as PersistEnvelope<unknown>;
    const v = typeof env.v === "number" ? env.v : 0;
    if (v === PERSIST_SCHEMA_VERSION) return env.data as T;
    return migrate?.(v, env.data) ?? (env.data as T);
  }
  return migrate?.(0, raw) ?? (raw as T);
}

/** Legacy theme rename for app settings v0. */
export function migrateAppSettingsV0(data: unknown): Record<string, unknown> | null {
  if (typeof data !== "object" || data === null) return null;
  const o = { ...(data as Record<string, unknown>) };
  if (o.theme === "high-contrast") o.theme = "contrast";
  if (o.theme === "colorblind") {
    o.theme = "dark";
    o.colorblindCharts = true;
  }
  return o;
}
