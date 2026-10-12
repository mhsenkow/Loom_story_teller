# Parser coverage inventory (LOOM-497)

| Surface | Module | Fixture tests |
|---------|--------|---------------|
| Browser CSV/TSV | `mock-data.ts` | `mock-data.test.ts` |
| Browser ingest | `webIngest.ts` | `webFormats.test.ts`, `importParity.test.ts` |
| Worker transforms | `workers/sourceTransforms.ts` | `sourceTransforms.test.ts` |
| Web stream parsers | `webStreams.ts` | `webStreamsParsers.test.ts`, `webStreamsResilience.test.ts` |
| Desktop sources | `sources.rs` | `sources_tests.rs` (Rust) |

**Gaps to fill next:** FIRMS/NWIS/Starlink/Lobsters boundary fixtures in Rust; degraded Worker payloads (LOOM-498).
