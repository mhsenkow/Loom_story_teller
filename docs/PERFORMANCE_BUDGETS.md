# Performance budgets (LOOM-698)

Proposed targets — measure with `npm run build` transfer sizes, Vitest perf helpers, and manual Lighthouse on `out/` + local Worker. Not current production SLAs.

| Journey step | Target (desktop) | Target (phone) | Owner module |
|--------------|------------------|----------------|--------------|
| Cold load (static `/`) | First Load JS ≤ 600 kB (Next report) | Same bundle; TTI ≤ 4 s on throttled 4G | `next build`, code-splitting |
| Discover scan (desktop) | ≤ 8 s for full feed scan | ≤ 3 s for 120-card cap | `discoverStories.ts` |
| Browser CSV parse | ≤ 2 s for 50k cells | ≤ 1 s for 500-row sample cap | `mock-data.ts`, `webIngest.ts` |
| Chart interaction | 60 fps pan/zoom on ≤ 50k scatter points (Canvas/WebGPU) | 30 fps acceptable on dense scatter | `ChartView`, `webgpu.ts` |
| Worker source poll | p95 ≤ 5 s upstream + parse | Same | `catalog-proxy.ts` |
| IndexedDB import | No full-table `getAll` on eviction | Same | `webFileStore.ts` |

**Representative inputs:** `.loom-data` 10k-row scatter sample; live `stream://usgs` buffer; 500-row web upload.

**Regression gates:** `make ci` (tsc, Vitest, build); optional `npm run bundle-budget` when changing imports.

**Recording baselines:** Note device, build id, and `npm run build` First Load JS in PR when changing budgets.

**Chart editor refinement (2026-10-14):** History is bounded to 20 snapshots in each direction and contains no dataset rows. Rapid numeric adjustments reuse a checkpoint (600 ms window), avoiding a deep snapshot on each slider tick. Named looks are capped at 20 and write to storage only when the library reference changes. Collapsed visual sections mount on demand. These changes stay outside parsing and canvas draw loops; check the Next First Load JS report against the 600 kB target when building.

Local macOS production build `2026-10-15T00:07:39.168Z` reported **366 kB First Load JS** for `/` (previous pass: 365 kB), within the proposed 600 kB budget. This is a bundle-size comparison, not a frame-rate or mobile timing measurement.

Canvas Arrange mode previews pointer changes at most once per animation frame and commits history only on release. It adds no dataset copies. Customized scatter plot bounds use the existing density-capped Canvas path to keep marks, axes, hit testing and PNG capture aligned. Ordinary charts keep their existing renderer outside Arrange mode.
