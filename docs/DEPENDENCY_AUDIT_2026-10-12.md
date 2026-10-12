# Dependency assessment (LOOM-462, LOOM-463)

**Date:** 2026-10-12

## Next.js (LOOM-462)

- **Installed:** `next@^15.1.0` with React 19 and `output: "export"`.
- **Decision:** Stay on Next 15.1.x pending a focused upgrade PR; run `npm audit` in CI and patch minors when advisories affect the static export path.
- **Gate:** `npm run build`, `npx tsc --noEmit`, Vitest.

## Vega / Vega-Lite (LOOM-463)

- **Installed:** `vega@^6.2.0`, `vega-lite@^5.21.0`.
- **Decision:** Keep Vega 6 + Vega-Lite 5 pair (supported combo for Loom specs); verify with `npm ls vega vega-lite` on clean install.
- **Gate:** Representative spec export tests in Vitest (`chartLink`, `dashboardMicrosite`).

Run locally:

```bash
npm ci && npm audit --omit=dev && npm ls vega vega-lite
```

## Vitest / Vite (LOOM-465)

- **Installed:** `vitest@^3.2.4` (resolved `3.2.7`) and `@vitest/coverage-v8@^3.2.4`, with separate `vitest.dom.config.ts` jsdom project (LOOM-673).
- **Peer fix:** `overrides.vega-lite.vega: "$vega"` so Vega-Lite 5 accepts app-pinned Vega 6 without `--legacy-peer-deps`.
- **Related:** `@cloudflare/workers-types` bumped to `^5.20260923.1` (wrangler optional peer).
- **Verified (2026-10-12):** Clean `npm ci` → `vitest@3.2.7` + `vega@6.2.0`; `npx vitest run` 1062 passed; `npx vitest run -c vitest.dom.config.ts` 9 passed; no Vite CJS Node API deprecation; `npm run check:worker` and `npx tsc --noEmit` clean.
- **Gate:** `npm ci && npx vitest run && npx vitest run -c vitest.dom.config.ts`.

## CSS toolchain (LOOM-466)

- **Tailwind 3.4 + PostCSS 8** — theme tokens live in `src/styles/globals.css`; avoid major Tailwind v4 migration without a visual regression pass.
- **Gate:** spot-check light/dark/contrast themes after any `tailwindcss` or `autoprefixer` bump; run `npm run build` only (no full-repo Prettier).
