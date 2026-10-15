# Agent work integrated for the October 14 release

This release combines the root checkout's uncommitted Claude/Cursor changes with the chart-editor refinements and the remaining edits found in two older Claude worktrees. Both worktrees started from commits already in `main`. Their original pending edits are preserved as separate commits on the existing Claude branches; the reconciled implementation ships from `main`.

| Worktree | Pending work | Integration |
| --- | --- | --- |
| `claude/brave-herschel-b9cefe` | Durable published stories, preview-image metadata, TTLs and KV binding documentation | Superseded by the current `LOOM_STORIES` implementation, configured production/preview namespace IDs, rate limiting and handler tests. Retained that implementation rather than replacing it with the older `STORIES` binding or weaker handlers. |
| `claude/eloquent-cray-499643` | Phone column reorder controls and unclipped column/view menus | Ported into the current `ExplorerView`, sharing its reorder operation and table undo. |
| `claude/eloquent-cray-499643` | Phone Keep only / Exclude drill behavior in Dive | Ported into the current `DiveView` while retaining newer derived-column, history, sample sorting and chart-zoom behavior. |
| `claude/eloquent-cray-499643` | Larger cube controls and tap-to-swap guidance | Ported into the current `DataCubePivot`, preserving its newer keyboard and accessibility behavior. |
| `claude/eloquent-cray-499643` | Schema tap assignment, shared encoding helper and tests | Superseded by the current schema assignment and encoding paths, which retain chart extras, validate field compatibility, open the Encoding panel and record undo. Retained the newer implementation rather than introducing the older duplicate helper. |

The complete root change set also includes chart encoding hints, searchable field selection, source parity/fetch fixes, renderer/layout improvements, syntax highlighting, shell refinements, native CSP updates, the iOS build-number change, named personal looks, chart Undo/Redo, workspace backup support and development-cache fixes. Editor-local launch configuration and nested Git checkouts remain outside release artifacts.

`MobileCarryover.test.tsx` verifies phone column reorder/undo and Dive exclusion. The release gate checks the frontend, catalog Worker, MCP Worker, static export and Rust. Shared recommendation types import source metadata directly rather than loading the desktop/browser IPC bridge into MCP.
