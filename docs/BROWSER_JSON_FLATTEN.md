# Nested JSON flattening policy (LOOM-198)

**Scope:** `webIngest.ts` JSON / NDJSON paths.

| Input shape | Behavior |
|-------------|----------|
| Array of flat objects | Columns = union of keys; missing → null |
| Columnar `{ "a": [1,2], "b": [3,4] }` | Zip to rows |
| Nested object values | **Rejected** in v1 — cell shows `[object Object]` avoided by skipping keys whose values are non-scalar objects |
| Arrays in cells | JSON-stringify for display column or reject row (document in import toast) |

**Future:** Optional `flatten` depth query param on import with explicit column naming (`parent.child`).

**Version:** Bump `persistEnvelope` when flatten rules change.
