# Portable Spec Parity — Chart Kind → Vega-Lite mapping

_Generated 2026-10-12 from `src/lib/chartSpecParity.ts`._

Loom uses Vega-Lite JSON as the portable chart definition ("the brain"),
but pixels come from Canvas 2D, WebGPU, or the geo-map renderer. Not every
chart kind maps 1:1 to Vega-Lite, so each `ChartKind` declares one of
three honest tiers:

| Tier | Meaning |
|------|---------|
| **native** | `spec.mark` is the real Vega-Lite mark; x/y/color encodings round-trip. SVG export is faithful (modulo theme). |
| **stand-in** | `spec` carries encoding fields + the nearest VL mark so links and field-pickers work, but layout/geometry comes from Loom's custom renderer. See _limitation_ column. |
| **none** | `spec` is `{}`; fields live on the recommendation object only. No SVG export. |

## Full Chart Kind Table

| Kind | Tier | VL Mark | Limitation |
|------|------|---------|------------|
| `scatter` | native | `circle` | — |
| `bubble` | native | `circle` | — |
| `line` | native | `line` | — |
| `area` | native | `area` | — |
| `bar` | native | `bar` | — |
| `histogram` | native | `bar` | — |
| `heatmap` | native | `rect` | — |
| `box` | native | `boxplot` | — |
| `strip` | native | `tick` | — |
| `pie` | native | `arc` | — |
| `hexbin` | stand-in | `rect` | Hex binning is done by Loom; Vega-Lite has no hexbin mark, so the spec shows square cells. |
| `lollipop` | stand-in | `circle` | Stems are drawn by Loom; the spec only encodes the dots. |
| `dumbbell` | stand-in | `rule` | End-point dots are drawn by Loom; the spec only encodes the connecting rule. |
| `funnel` | stand-in | `bar` | Centered, tapering stages are drawn by Loom; the spec is plain bars. |
| `waterfall` | stand-in | `bar` | Running-total offsets are computed by Loom; the spec is plain bars. |
| `violin` | stand-in | `area` | Kernel density and mirroring are computed by Loom. |
| `ridgeline` | stand-in | `area` | Density and row overlap are computed by Loom. |
| `radar` | stand-in | `line` | Polar axes are drawn by Loom; the spec is a Cartesian line. |
| `parallel` | stand-in | `line` | Per-axis normalisation is done by Loom; the spec is a plain line. |
| `treemap` | stand-in | `rect` | Layout is computed by Loom's canvas renderer; the spec only carries encoding fields. |
| `sunburst` | stand-in | `arc` | Layout is computed by Loom's canvas renderer; the spec only carries encoding fields. |
| `forceBubble` | stand-in | `circle` | Layout is computed by Loom's canvas renderer; the spec only carries encoding fields. |
| `sankey` | stand-in | `rect` | Layout is computed by Loom's canvas renderer; the spec only carries encoding fields. |
| `network` | stand-in | `rect` | Layout is computed by Loom's canvas renderer; the spec only carries encoding fields. |
| `arcDiagram` | stand-in | `rect` | Layout is computed by Loom's canvas renderer; the spec only carries encoding fields. |
| `pareto` | stand-in | `bar` | The cumulative-percent line layer is added by Loom; the spec is the bar layer only. |
| `corrMatrix` | none | — | Correlation matrix is drawn by Loom from numeric columns; `spec` is empty (no SVG export). |
| `choropleth` | stand-in | `geoshape` | Map projection and geometry are drawn by Loom's map renderer; the spec is a circle stand-in. |
| `bucketField` | stand-in | `circle` | No Vega-Lite equivalent; spec is a circle stand-in carrying the encoding fields. |
| `beeswarm` | stand-in | `circle` | Collision-free packing is computed by Loom. |
| `chernoff` | stand-in | `circle` | No Vega-Lite equivalent; spec is a circle stand-in carrying the encoding fields. |
| `glyphStar` | stand-in | `circle` | No Vega-Lite equivalent; spec is a circle stand-in carrying the encoding fields. |
| `waffle` | stand-in | `circle` | No Vega-Lite equivalent; spec is a circle stand-in carrying the encoding fields. |
| `isotype` | stand-in | `circle` | No Vega-Lite equivalent; spec is a circle stand-in carrying the encoding fields. |
| `pyramid` | stand-in | `circle` | No Vega-Lite equivalent; spec is a circle stand-in carrying the encoding fields. |
| `slope` | stand-in | `circle` | No Vega-Lite equivalent; spec is a circle stand-in carrying the encoding fields. |
| `bump` | stand-in | `circle` | No Vega-Lite equivalent; spec is a circle stand-in carrying the encoding fields. |
| `stream` | stand-in | `circle` | No Vega-Lite equivalent; spec is a circle stand-in carrying the encoding fields. |
| `horizon` | stand-in | `circle` | No Vega-Lite equivalent; spec is a circle stand-in carrying the encoding fields. |
| `spiral` | stand-in | `circle` | No Vega-Lite equivalent; spec is a circle stand-in carrying the encoding fields. |
| `radialBar` | stand-in | `circle` | No Vega-Lite equivalent; spec is a circle stand-in carrying the encoding fields. |
| `chord` | stand-in | `circle` | No Vega-Lite equivalent; spec is a circle stand-in carrying the encoding fields. |
| `voronoi` | stand-in | `circle` | No Vega-Lite equivalent; spec is a circle stand-in carrying the encoding fields. |
| `isoBars` | stand-in | `circle` | No Vega-Lite equivalent; spec is a circle stand-in carrying the encoding fields. |
| `isoScatter` | stand-in | `circle` | No Vega-Lite equivalent; spec is a circle stand-in carrying the encoding fields. |
| `flower` | stand-in | `circle` | No Vega-Lite equivalent; spec is a circle stand-in carrying the encoding fields. |
| `mosaic` | stand-in | `circle` | No Vega-Lite equivalent; spec is a circle stand-in carrying the encoding fields. |
| `contour` | stand-in | `circle` | No Vega-Lite equivalent; spec is a circle stand-in carrying the encoding fields. |
| `scatter3d` | stand-in | `circle` | 3D / particle scene drawn by WebGPU or the Canvas fallback; the spec is a 2D circle stand-in. |
| `trailRibbon` | stand-in | `circle` | 3D / particle scene drawn by WebGPU or the Canvas fallback; the spec is a 2D circle stand-in. |
| `quakeTerrain` | stand-in | `circle` | 3D / particle scene drawn by WebGPU or the Canvas fallback; the spec is a 2D circle stand-in. |
| `firefly` | stand-in | `circle` | 3D / particle scene drawn by WebGPU or the Canvas fallback; the spec is a 2D circle stand-in. |
| `loomWeave` | stand-in | `circle` | 3D / particle scene drawn by WebGPU or the Canvas fallback; the spec is a 2D circle stand-in. |
| `dataCube` | stand-in | `rect` | Voxel cube is drawn by WebGPU or the Canvas fallback; the spec is a 2D rect grid. |
| `geoPoints` | stand-in | `circle` | Map projection and geometry are drawn by Loom's map renderer; the spec is a circle stand-in. |
| `geoBubbles` | stand-in | `circle` | Map projection and geometry are drawn by Loom's map renderer; the spec is a circle stand-in. |
| `geoHex` | stand-in | `circle` | Map projection and geometry are drawn by Loom's map renderer; the spec is a circle stand-in. |
| `globe` | stand-in | `circle` | Map projection and geometry are drawn by Loom's map renderer; the spec is a circle stand-in. |
| `globeTrail` | stand-in | `circle` | Map projection and geometry are drawn by Loom's map renderer; the spec is a circle stand-in. |
| `arcMap` | stand-in | `circle` | Map projection and geometry are drawn by Loom's map renderer; the spec is a circle stand-in. |

## Summary

- **10 native kinds** — scatter, bubble, line, area, bar, histogram, heatmap, box, strip, pie
- **49 stand-in kinds** — encoding fields present, but geometry is custom
- **1 none kind** — corrMatrix (no portable spec at all)

## Verification

`src/lib/__tests__/chartSpecParity.test.ts` asserts that:
1. Every selectable `ChartKind` in `CHART_KIND_OPTIONS` has an entry in `CHART_SPEC_PARITY`.
2. Every non-native kind has a `limitation` string ≥ 15 characters.
3. The registry matches what `createChartRec` actually builds for each kind.
4. Native kinds keep x/y/theta encodings round-trippable.

See `src/lib/chartSpecParity.ts` for the authoritative registry.
