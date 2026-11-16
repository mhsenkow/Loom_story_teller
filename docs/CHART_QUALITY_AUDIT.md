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
