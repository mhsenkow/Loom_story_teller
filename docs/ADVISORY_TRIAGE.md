# Dependency advisory triage (LOOM-531)

**Cadence:** Each release candidate and monthly on `main`.

## npm (root + mcp)

```bash
npm ci && npm audit --omit=dev
cd mcp && npm ci && npm audit --omit=dev
```

| Severity | Action |
|----------|--------|
| Critical / high affecting static export, Worker, or Tauri webview | Patch or pin within 7 days; block release if exploit is network-facing |
| High in devDependencies only | Patch before next minor bump |
| Moderate / low | Track in PR; batch monthly |

## Rust (`src-tauri`)

```bash
cd src-tauri && cargo audit
```

| Severity | Action |
|----------|--------|
| Unmaintained crate used in release binary | Replace or document exception |
| RUSTSEC with fix available | Upgrade in focused PR with `cargo test` |

## Evidence

Record audit output date in [DEPENDENCY_AUDIT_2026-10-12.md](./DEPENDENCY_AUDIT_2026-10-12.md) or append a dated section when triage runs.
