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
