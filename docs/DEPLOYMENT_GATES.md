# Deployment gates and promotion (LOOM-670)

| Stage | Command / workflow | Credentials | Must pass |
|-------|----------------------|-------------|-----------|
| PR | `.github/workflows/ci.yml` | None for Workers dry-run | `make ci` equivalent jobs |
| Web preview | `npm run deploy:dry` | Cloudflare API (read-only dry-run) | build + Worker typecheck |
| Web production | `make loft` | Production Worker + assets | `check-ts`, `test`, `build` (Makefile prerequisite) |
| MCP production | `make loft-mcp` | Separate Worker | `check:mcp` locally first |
| macOS release | Tag → `release-tauri.yml` | Apple signing secrets | Rust + web build (see LOOM-439) |

**Policy:** Failed CI cannot deploy; preview namespaces must not write production KV (see [WORKER_ENVIRONMENTS.md](./WORKER_ENVIRONMENTS.md)).

**Rollback:** Redeploy previous Worker version from Cloudflare dashboard; static assets are immutable per deploy id.

**Lockfiles (LOOM-516):** Clean checkout uses `npm ci`, `cargo fetch --locked`, and committed `package-lock.json`, `mcp/package-lock.json`, `src-tauri/Cargo.lock`.
