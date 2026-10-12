# Multi-file import outcomes (LOOM-251)

**Target UX (proposal):** When importing multiple files, show per-file success/failure without discarding successful parses.

| Outcome | User message | Store state |
|---------|--------------|-------------|
| All succeed | “Imported N files” | All in `files` / web cache |
| Partial | “Imported 3 of 5 — 2 failed” + expandable errors | Successful files kept |
| All fail | Single error summary | No partial activation |

**Current (2026-10-12):** Sidebar batch import stops on first error; this doc is the acceptance spec for a follow-up change in `Sidebar.tsx` / `webIngest.ts`.
