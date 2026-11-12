# Chart quality pass — November 11, 2026

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
