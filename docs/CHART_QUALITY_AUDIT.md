# Chart quality pass — November 11–12, 2026

Coordination note for the concurrent Fable/Claude work: this pass focuses on canvas correctness, legibility, responsive chart/editor space, and regression coverage. The workspace already contained typography, chart reading, mobile packaging, and other changes; those are preserved. No deployment or commit was made by this pass.

## Behavior to preserve during integration

- **Aggregation:** Count counts rows even when the selected measure is blank. Sum/mean omit missing observations instead of manufacturing zero-valued groups. Pie, treemap, packed bubble and sunburst omit nonpositive aggregates instead of taking their absolute value. The Data Cube excludes nonfinite axis values.
- **Validation:** Radar, parallel coordinates and correlation do not require hidden X/Y fields. Booleans and blanks do not qualify as numeric measures; correlation needs two varying measures. Hidden, unsupported channel fields do not block drawing.
- **Legibility:** Short time domains retain distinct ticks. Dense horizontal bars thin their labels while preserving marks and hit targets. Size keys fit their circles and labels; ramp endpoint labels cannot overlap. Isometric labels sit outside the visible floor edges and thin by measured collisions. Network names use free space outside small nodes. Pie/sunburst centers, pie legends and funnel names adapt to available space. Short cubes retain visible geometry.
- **Responsive editing:** Ideas opens on demand below 1440px on non-phone workspaces, and on phones shorter than 740px. Its expanded cards fit the available container width rather than the window width. Tablet/compact desktop inspector width is bounded. Phones need at least 740px of height for the preview/editor split; shorter screens use the taller sheet. The mobile tool rail is included in chart height calculations. Editor section names and selected choices remain visible. The entire encoding field wrapper accepts drops.
- **Recovery:** Classic charts that produce no marks display a field/aggregate recovery message. Positive-area charts specifically explain that they need positive totals.

## Durable coverage

| Test | Coverage |
| --- | --- |
| `src/lib/__tests__/chartRenderAudit.test.ts` | Every registered chart type: 560 cases, 1,610 renderer invocations, three stage sizes, missing/zero/signed/singleton/empty data, dark colors, large text, thumbnails, dense categories, reversed layout; finite geometry and balanced canvas state |
| `src/lib/__tests__/fixtures/chartAudit.ts` | Valid deterministic data/encodings for the full 70-type catalog; also bundled into real Chromium for visual review |
| `src/lib/__tests__/chartQuality.test.ts` | Count/missing/negative aggregation, multi-measure validation, projected tick collisions and size-key bounds |
| `src/components/__tests__/ChartPanelTab.test.tsx` | Encoding, Visual, Analyze and Overlays for every chart kind; field drops and undo |
| `e2e/chart-quality.spec.ts` | 1440×1000, 1100×800, 834×1112, 390×844, 320×568 and 667×375; main chart size, reachable Share, usable editor height, all sections, keyboard navigation, aggregate editing/undo, and compact Ideas browsing |

## Verification checkpoint

The combined working tree, including the concurrent social/editorial changes, passes `make check`: 3,152 Node tests, 163 DOM tests and 105 Rust tests; one live-network Rust test is intentionally ignored. The production browser suite passed all 11 tests, including sharing, canvas arrangement/undo and desktop/phone typography. Share tests handle either restored phone-editor state. The static export reported 501 kB First Load JS for `/`, below the existing 600 kB budget, and `npm run bundle-budget` passed. These figures describe the combined working tree, not an isolated size delta.

The final Ideas card sizing also passed all six viewport checks after rebuilding. Physical iOS/Android devices and hardware WebGPU frame timing are outside this browser/Canvas audit. Keep the existing Canvas/WebGPU eligibility rules and shared layout calculations aligned when integrating further visual changes.

## 3D follow-up and handoff — November 12

- **Camera UI:** `SceneCameraControls` gives orbit scatter, cube, globe and globe trails four views, bounded zoom, and reset. The compact bar is outside the canvas, so it does not cover marks or appear in PNGs. Shift + arrows rotates; + / − zoom; 0 resets. Plain arrows retain mark navigation. Wheel zoom uses a non-passive local listener, ignores horizontal-only scrolling, and leaves pivot-panel scrolling alone. Drag, pinch cancellation, primary-button filtering and pointer-capture cleanup are hardened.
- **Correct coordinates:** Missing encoded Z rows are omitted. Constant X/Y/Z domains expand around the actual value, including zero, negative and large constants. Constant size stays equal when reversed. This fixes constant-depth clouds disappearing outside the frame.
- **Projection and GPU parity:** `orbitSceneLayout` supplies the CPU projection, sorted point order, GPU camera frame and hit positions. Accelerated orbit scatter uploads normalized coordinates before float32 conversion, paints far to near, receives axes and hover targets, and clears stale points for empty data. Tick values project their true world coordinates rather than interpolating screen endpoints. Axis labels share collision boxes.
- **Voxel selection:** Ray/box intersections pick visible corners and the nearest face, respect slices and pivot transitions, and reject empty gaps. Cube taps pick from their release position instead of trusting an old hover. Short phone cubes reserve less excess label space, keeping more room for the geometry.
- **Map layout:** Automatic category legends use the outside edges of the map canvas, keeping small globes visible beside their keys.

Coverage added: `orbitQuality.test.ts` (16 data, projection, picking and keyboard cases), a GPU lifecycle case for camera uniforms and empty-frame clearing, and `e2e/three-d.spec.ts` (eight desktop/small-phone journeys, including view selection, keyboard, wheel, drag and reset). The final focused renderer run passes **629 tests**. The full `make check` checkpoint passes **3,187 Node, 163 DOM and 105 Rust tests**, with the existing live-network Rust test ignored; the additional GPU lifecycle case was verified in the focused run. The isolated production build remains **501 kB First Load JS**.

The final isolated production app passes **all 19 browser tests**, including sharing, arrangement/undo, six responsive editor sizes, typography and the eight 3D journeys. `git diff --check` passes; targeted lint has no errors (existing warnings remain).

Visual review used **105 renders** across orbit scatter, data cube, globe, globe trails, isometric scatter, isometric bars and terrain, plus actual app views at 1440×1000, 390×844 and 320×568. Phone screenshots and build artifacts from this pass were local-only (not checked in).

**Remaining device validation:** The headless Chromium WebGPU adapter stalled. Canvas visuals, GPU uniform uploads/lifecycle and TypeScript passed; actual shader execution and hardware frame timing are not certified by this run. Check accelerated orbit scatter on a physical WebGPU-capable device, including axis alignment, point depth order, hover, and switching to an empty dataset. No deployment was performed by this pass.

## Repeatable control audit — November 16, 2026

Run `npm run test:charts` while refining charts. The same tests remain part of the standard Node/DOM CI gates; no separate scheduled service is required.

| Layer | What it proves |
| --- | --- |
| Catalog geometry | Every registered renderer at phone/tablet/desktop dimensions, empty/missing/signed/constant data, dense labels, large type and thumbnails; finite geometry and balanced Canvas state |
| Parameter effects | 476 tests across all 70 kinds through the production Canvas stage: palette, opacity, aggregates, Top N, legends, value labels, point size/shape, direction/scales, tick rotation, bar corners, lines, rolling means, comparisons, normalization, residuals and specialized modes; adjustable grid visibility/style/opacity |
| Numeric readouts | Exact Chord/Mosaic results for sum/mean/min/max/count, including missing measures; prevents a changed label from masking unchanged arithmetic |
| Inspector | Every kind opens every section; grid/point controls match capabilities; size edits undo; connected scatter accepts a date in Order |
| Existing integration | Grouped/faceted hits retain original row identity; source-chart dispatch, persistence/share/spec parity, keyboard and responsive editor journeys |

Changes in this pass: fixed default-circle size controls in line/radar/lollipop/slope/bump/connected-scatter/error-bar charts; bubble-map size now scales its upper radius; live size units no longer jump at 6. Connected-scatter Order accepts dates and does not offer size inversion. Opacity now reaches the affected box/radar/correlation/creative/terrain marks. Correlation labels honor explicit Off, and tick rotation follows its setting. Waffle/Mosaic/Stream legends honor None. Unsupported legend/grid controls are omitted. Specialized shared-grid renderers receive the authored axis/grid settings. Chord/Mosaic now compute all five aggregates rather than changing the title of a sum.

For each new parameter or renderer:

1. Add a valid deterministic recipe to `fixtures/chartAudit.ts` / `chartStageAudit.ts` and keep the catalog switch exhaustive.
2. Add a discriminating `chartParameterEffects` probe using the real stage. Choose data that exercises the behavior (enough categories for Top N, dates for prior-period comparisons, varying measures for size). Repeated baseline paints must match. Assert exact numbers separately for transformations; paint differences alone can be just text changes.
3. Check the actual inspector action and undo, plus save/share round trips where the stored shape changes. Declare unsupported controls in capabilities instead of leaving active no-ops.
4. Review browser renders at large and small sizes with light/dark colors, large text and dense labels; check hover/pin/keyboard, PNG and the documented SVG approximation. Use `npm run build` followed by `LOOM_E2E=1 npm run test:e2e` for the existing viewport journeys.
5. Run `make check`; use `make ci` before release. Verify WebGPU on physical hardware and touch gestures on iOS/Android before certifying those paths.

This is a regression framework, not a claim that every combination of settings is visually optimal. Exact GPU pixels, physical-device timing and every pairwise control combination remain outside the Canvas parameter suite. Expand the probes when a bug or new control exposes a gap rather than relying on a one-time visual sign-off.

The responsive browser pass also caught a cramped editor at 667×375. On short phone screens, the modal sheet now uses nearly the full available height so the section tabs leave room for usable controls; taller-phone live editing keeps its existing sizing.

Verification: the full `make check` checkpoint passed (3,690 Node, 163 DOM, 105 Rust; one existing network test ignored). After the final date-ordering and landscape refinements, `npm run test:charts` passed 1,624 Node and 83 inspector tests, the production static build and bundle budget passed, and all 19 browser journeys passed. A local gallery review covered all 70 chart kinds. Existing lint warnings remain; physical WebGPU/device validation is still required. No deployment was performed.

## Physical Mac GPU validation — November 16, 2026

Tested the local production export `2026-11-16T15:02:03.395Z` on an **Apple M2 Ultra**, headed Chrome **157.0.8103.52**, with the Apple `metal-3` WebGPU adapter (`isFallbackAdapter: false`). Scope was narrowed to Mac validation; no iOS/Android physical-device sign-off is implied. Globe/globe-trail still use Canvas under the existing feature gate.

- **20 hardware checks passed:** production scatter, orbit/firefly and cube shader initialization; actual pixel coordinates against the shared CPU projection; transparency/depth ordering; size and opacity changes; Retina backing-store resize; empty-data clearing; visible cube voxels; no GPU validation errors.
- **12 headed app journeys passed:** all eight existing desktop/small-viewport camera journeys, plus four tests that require a visible WebGPU layer, real adapter and GPU submissions. These exercise scatter keyboard zoom/reset, orbit/firefly keyboard readouts and pin/clear, and cube slicing/pivot-table controls. Small viewports emulate layout on the Mac, not physical touch hardware.
- **Bug found and fixed:** 2D scatter returned before clearing when its uploaded point count became zero, leaving stale pixels. It now submits a background clear, matching the scene renderer. The existing lifecycle test now verifies populated → empty submission, and the hardware audit verifies actual cleared pixels.
- **Timing:** 50,000 scatter points, 800×600 backing store, 120 measured frames after 10 warmups: submission-to-GPU-completion median **1.4 ms**, p95 **2.5 ms**; animation-frame interval median **16.7 ms**, p95 **18.6 ms**. This measures CPU submission plus GPU completion in the renderer fixture, not full-app input latency or isolated shader timestamps. Other devices, battery/thermal states and larger datasets need their own measurements.

Repeat from the repository root after `npm ci` and `npm run build`:

```sh
npm run test:gpu       # Isolated headed Chrome; fails on unavailable/software GPU
npm run test:gpu:app   # Starts/reuses local preview; production app journeys
```

The renderer audit bundles the current renderer sources and WGSL with esbuild; it is not shipped in the application. Keep the static build current when comparing it to app journeys. It writes adapter/host/browser/build metadata, a fixture-bundle SHA-256, check results, timing, and a screenshot under `test-results/gpu-renderer/`; app artifacts use `test-results/gpu-app/`. Override the former with `LOOM_GPU_REPORT_DIR` and the app URL with `LOOM_E2E_BASE_URL`. These are opt-in local checks, not silent software fallbacks or required headless CI jobs. Reports are temporary test artifacts; copy them before a general Playwright run clears `test-results/`.

Final Mac validation gate: `make check`, production build, bundle budget and `git diff --check` passed. Existing lint warnings remain. Physical iOS/Android validation was excluded at the user’s request.

## Authoritative chart definitions — November 16, 2026

All 70 kinds now have an exhaustive typed entry in `src/lib/chartDefinitions/catalog.ts`. Field policies, labels, capabilities, structural requirements, encoding adaptation, renderer routing, interaction policies and SVG limitations come from that contract. The inspector generates its visual sections from the definition; shared numeric descriptors drive the migrated sliders. Existing algorithms and specialized controls remain adapters, preserving chart behavior rather than pretending every chart has interchangeable geometry.

The migration adds **1,374 contract tests**: pre-migration metadata and effective Canvas paint hashes/hit counts for every kind, a field-type matrix, section/adapter consistency, numeric range effects, immutable/unknown-kind checks, and a Worker-safe dependency check. Full-catalog DOM tests verify the generated section list; bar, scatter and line verify slider ranges, changes, undo and redo. New kinds must supply a definition, adapter and fixture/baseline; new capabilities require an explicit contract key.

Validation: **5,064 Node tests, 167 DOM tests, and 105 Rust tests passed** (`make check`; one existing Rust network test ignored). MCP typecheck, production build, bundle budget, and all **19 standard browser journeys** passed; four hardware-only tests are intentionally skipped in the standard browser project. Existing lint warnings remain at 106, with no errors. The production route reports **446 kB First Load JS**, down from 510 kB before this migration. The catalog is created once; no dataset scans or render loops were added.

The final headed Mac hardware project also passed all **four accelerated-chart journeys** (scatter, orbit scatter, firefly and data cube) against the refactored production app, requiring real GPU adapters/submissions and functioning chart interactions. No deployment was performed.

## Chart-aware anomaly detection and extrapolation — November 16, 2026

All 70 chart definitions now declare statistical units, mark-overlay support and the ordered-source forecast route. `chartAnalysis.test.ts` adds 87 cases: each catalog policy plus grouped bar arithmetic, 3D Z outliers, cube membership, independent series/facets, missing/flat samples, stale scope, source-index mapping and forecast guards. Eight production Canvas adapters must change actual paint with flags. Default-render goldens remain unchanged. `ChartAnalysisCard.test.tsx` adds 73 UI cases, including every chart kind, filtered-row provenance, hide/remove, forecast dates/methods/horizon/aggregation and seasonal-history rejection. `ChartAnalysisExport.test.tsx` verifies PNGs retain the painted statistical layer for scatter, orbit scatter and firefly instead of stale GPU pixels or a fresh scene without outlines.

The full gate passed with 5,151 Node tests, 240 DOM tests and 105 Rust tests (one existing ignore), plus the three new focused export tests. TypeScript, Worker, Rust/clippy, MCP and production build passed; lint remains at 106 existing warnings with no errors. Five headed Mac Chrome application journeys cover bar, line, scatter, orbit scatter and cube, including detection visibility/removal and GPU fallback/recovery. A normal bar demo with no flags is accepted as a valid result; arithmetic/paint fixtures independently verify unusual-bar detection.

Scope limits are deliberate and visible: MAD/IQR/Z-score compare scalar measures or individual coordinate axes, not joint-density models; forecasts pool explicitly selected ordered source values and appear in preview tables except the existing single-series line overlay. Specialized charts currently show source-row/frequency evidence rather than pretending to analyze layout geometry. Detection uses loaded filtered samples. Physical validation remains Mac only.

## Mobile interaction and empty-state refinement — November 16, 2026

Phone analysis now uses the taller reading sheet, while Fields/Visual retain the live preview. Evidence tables have a bounded, keyboard-focusable scroll region, real column/row headers and readable tabular numbers. Inputs preserve partial edits until blur/Enter, including blank drafts, multi-digit entry and bounds. Touch controls target 44px; WebKit selects use explicit appearance/height to avoid native sizing overriding the minimum. Phone input text uses 16px. The software-keyboard viewport moves/caps the editor, and nested portal explanations own Tab/Escape without closing the underlying sheet.

`EmptyState` supplies five theme-aware inline SVG variants for dataset, filter, quiet detection, forecast and query states. Illustrations and results use short existing motion tokens, with no decorative loops; OS and app reduced-motion preferences disable them. Recovery buttons reset view filters or open the library. Explorer, Query, chart setup and Analyze share these states.

Regression coverage: `MobileAnalysisRefinement.test.tsx` verifies partial-input commits, empty-filter recovery and nested modal ownership. `playwright.mobile.config.ts` runs the existing six-viewport chart-editor journey plus four analysis viewports (320×568, 390×844, 667×375, 834×1112), reduced motion and a simulated software-keyboard viewport in both Chromium and WebKit. This is browser emulation on macOS; it does not claim physical iOS/Android, native-picker or native-keyboard validation.

Final mobile checkpoint: production build `2026-11-16T18:13:52.343Z`; **24/24 Chromium + WebKit journeys passed**, including all four analysis sizes, nested explanation focus restoration, native-select touch sizing, reduced motion and simulated keyboard occlusion. `make check` passed with 5,151 Node tests, 246 DOM tests and 105 Rust tests (one existing ignore); lint remains at 106 existing warnings and no errors. Production build, MCP type check, bundle budget and whitespace checks passed. Browser screenshots are under `test-results/mobile-refinement/` (generated, not source assets).
