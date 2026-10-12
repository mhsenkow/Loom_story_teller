# Inspect and clear local data (LOOM-278)

| Storage | Keys / DB | Inspect today | Clear today |
|---------|-----------|---------------|-------------|
| Settings | `loom-app-settings` | Settings panel | Theme reset |
| Recent files | `loom-recent-files` | Sidebar recents | Remove individual (desktop) |
| Web datasets | IDB `loom-web-files` | File list in sidebar | Delete file from list |
| Discover cache | memory + `discoverStories` session | Reopen panel | Close app |
| Query history | `loom-query-history` | Query view | Clear history control |

**Full reset (proposal):** Settings → “Clear local browser data” should call `clearWebFileStore()` + wipe listed localStorage keys with confirmation showing byte estimate.

**Desktop:** Clear = unmount folder; DuckDB tables dropped on new mount.
