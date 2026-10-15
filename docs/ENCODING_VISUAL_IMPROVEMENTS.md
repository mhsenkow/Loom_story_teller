# Encoding & Visual Panel Improvements

Working backlog for Composer / agents. Full original plan lives in `.cursor/plans/`. This file tracks **shipped** vs **next**.

## Shipped (this pass)

### Encoding validation & feedback
- [x] `encodingPanelHints()` in [`src/lib/chartSupport.ts`](../src/lib/chartSupport.ts) — dumbbell ends, split mismatch, Top N vs cardinality, high-cardinality color, Y skew → log, pyramid/slope dual measure
- [x] Inline hint banners in Encoding panel (`role="alert"` / `status`)
- [x] Facet vs Split helper copy
- [x] Direction helper for all directions (not only down/left)
- [x] Time window: “pick a Time column” empty hint; “Showing N / M rows” copy
- [x] Z / Depth, Glow, Outline, Opacity channel descriptions
- [x] More channels header lists which channels are set

### Advanced encoding (were recommendation-only)
- [x] ChartCapabilities: `rollingWindow`, `seriesNormalize`, `residualOverlay`, `anomalyHighlight`, `bumpMode`
- [x] Encoding → Series tools UI for line/area/scatter/bump
- [x] `extrasForKind` clears those when switching chart types
- [x] `patchChartExtra` helper for single-field updates

### Accessibility
- [x] EncodingSlot: `aria-labelledby` / `aria-describedby`, type in option labels, focus ring
- [x] IconToggleGroup: radiogroup + arrow/Home/End keyboard nav + `focus-visible` ring
- [x] Schema assign opens Encoding section and preserves extras ([`PreviewFooter.tsx`](../src/components/PreviewFooter.tsx))

### Visual panel
- [x] Cap-aware banner when axes/marks controls are hidden for the active kind
- [x] Collapsible Typography + Marks sections

### Tests
- [x] [`src/lib/__tests__/encodingPanelHints.test.ts`](../src/lib/__tests__/encodingPanelHints.test.ts)

### Encoding honesty (pass 2–3)
- [x] `encodingDropAllowed()` — reject non-numeric Size / scatter Y / etc. on drop & select
- [x] Undo via `commitRec` on all encoding apply paths (incl. time, aggregate, tooltip, bar stack, random)
- [x] Top N select trims options above category cardinality
- [x] Size / Z are drop targets; X/Y/Size options disable incompatible columns (`· skip`)

---

## Next batch (priority order)

### P0 — searchable selects
- [x] `ColumnFieldPicker` + `columnFieldSearch` — type-ahead, All/#/Abc/Time chips, keyboard nav (Encoding slots)
- [x] Picker refinement — stable arrow navigation with None enabled, Home/End, labelled search, distinct selected/active states, unique option IDs, keyboard-accessible type filters, outside-focus dismissal, and viewport-aware portal placement (including mobile keyboard). DOM journey and placement regression tests cover this behavior.

### P1 — Encoding
5. ENC-011 — auto-expand Time / More / Tooltip when relevant
7. ENC-031–034 — ChartKindPicker grouping + scores
8. ENC-046 — Sort channel
9. ENC-057 — save encoding presets per dataset
10. Surface comparePrevious more clearly next to Compare Y

### P1 — Visual / a11y
11. [x] Consistent Visual disclosures, collapse-all / expand-all, and automatic opening for chart-directed focus
12. Persist visualLocks / encodingLocks (localStorage or chart view)
13. Verify every Visual slider maps through `ChartRenderOpts` (audit markStrokeWidth color, etc.)
14. Reduced-motion: skip shuffle / entrance animation when `prefers-reduced-motion`
15. High-contrast theme: bump EncodingSlot focus rings

### P2 — Polish
16. ENC-021 — drag ghost preview
17. ENC-022 — reorder tooltip chips
18. ENC-026 — custom date range picker
19. [x] Visual palette search / filter
20. Split ChartPanelTab into `EncodingPanel.tsx` + `VisualPanel.tsx` (file is ~3.3k lines)

---

## How to continue

The chart editor now also has a named personal look library (20 styles, local persistence and workspace backup portability) and bounded Undo/Redo with atomic palette edits and grouped numeric adjustments. Titles, notes, reference lines, modes and portable specs restore together. Tests cover store history, validation, persistence, backup merge, and the inspector journeys.

1. Prefer pure helpers in `src/lib/chartSupport.ts` / `recs/*` + Vitest under `src/lib/__tests__/`.
2. Keep UI changes in `ChartPanelTab.tsx` (or extract when splitting).
3. Gate controls with `chartCapabilities(kind)` — never show dead knobs.
4. Run: `npx vitest run src/lib/__tests__/encodingPanelHints.test.ts` and `npx tsc --noEmit`.
