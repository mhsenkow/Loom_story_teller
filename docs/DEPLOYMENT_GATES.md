# Deployment gates and promotion (LOOM-670)

| Stage | Command / workflow | Credentials | Must pass |
|-------|----------------------|-------------|-----------|
| PR | `.github/workflows/ci.yml` | None for Workers dry-run | `make ci` equivalent jobs |
| Web preview | `npm run deploy:dry` | Cloudflare API (read-only dry-run) | build + Worker typecheck |
| Web production | `make loft` | Production Worker + assets | `check-ts`, `test`, `build` (Makefile prerequisite) |
| MCP production | `make loft-mcp` | Separate Worker | `check:mcp` locally first |
| macOS release | Tag → `release-tauri.yml` | Apple signing secrets | Rust + web build (see LOOM-439) |

**Policy:** Failed CI cannot deploy; preview namespaces must not write production KV (see [WORKER_ENVIRONMENTS.md](./WORKER_ENVIRONMENTS.md)).

**Runtime:** `.nvmrc`, package engines, Docker and CI use Node 24. Current Wrangler requires Node 22 or newer, so the former Node 20 pin could type-check locally but fail Worker dry-run packaging in CI. Runtime preflight reads `.nvmrc` to keep the release commands aligned.

**Rollback:** Redeploy previous Worker version from Cloudflare dashboard; static assets are immutable per deploy id.

**Lockfiles (LOOM-516):** Clean checkout uses `npm ci`, `cargo fetch --locked`, and committed `package-lock.json`, `mcp/package-lock.json`, `src-tauri/Cargo.lock`.
