// Builds immutable chart contracts from explicit catalog entries; safe in Workers/MCP.
import type { ChartKind } from "../recs/types";
import { CHART_CAPABILITY_KEYS, type ChartCapabilities, type ChartChannelId, type ChartDefinition, type ChartFieldType, type ChartTransform, type ChartVisualSection } from "./types";

type DefinitionInput = {
  analysis: ChartDefinition["analysis"]["basis"];
  adaptation: ChartDefinition["adaptation"];
  label: string;
  family: ChartDefinition["family"];
  capabilities: readonly (keyof ChartCapabilities)[];
  fields: Record<ChartChannelId, { label: string; accepts: readonly ChartFieldType[] }>;
  sizePrimary: boolean;
  defaultAggregate: ChartDefinition["defaultAggregate"];
  requirements: ChartDefinition["requirements"];
  gpu: ChartDefinition["render"]["gpu"];
  svg: ChartDefinition["exports"]["svg"];
};

export const CHART_TRANSFORMS = ["aggregate", "facetRow", "topN", "groupChannels", "compareY", "comparePrevious", "deltaDisplay", "layoutDirection", "yScale", "rollingWindow", "seriesNormalize", "residualOverlay", "anomalyHighlight", "bumpMode", "wordCloudMode", "pyramidScaleMode"] as const satisfies readonly ChartTransform[];
const SERIES_TOOLS = ["rollingWindow", "seriesNormalize", "residualOverlay", "anomalyHighlight", "bumpMode", "wordCloudMode", "pyramidScaleMode"] as const;

export function defineChart<K extends ChartKind>(kind: K, input: DefinitionInput): ChartDefinition & { readonly kind: K } {
  const capabilities = Object.freeze(Object.fromEntries(CHART_CAPABILITY_KEYS.map(key => [key, input.capabilities.includes(key)])) as unknown as ChartCapabilities);
  const channels = Object.freeze(Object.fromEntries((Object.keys(input.fields) as ChartChannelId[]).map(id => [id, Object.freeze({
    ...input.fields[id], accepts: Object.freeze([...input.fields[id].accepts]),
    enabled: capabilities[`${id}Channel`],
    required: id === "x" ? capabilities.xChannel : id === "y" ? input.requirements.y : id === "z" ? input.gpu === "cube" : id === "size" ? input.requirements.distinctEnd : false,
    primary: id !== "size" || input.sizePrimary,
  })])) as unknown as ChartDefinition["channels"]);
  const sections: ChartVisualSection[] = [];
  const section = (id: ChartVisualSection["id"], title: string, defaultOpen = false) => sections.push(Object.freeze({ id, title, defaultOpen }));
  section("personal", "My looks");
  section("design", "Design system", true);
  section("color", "Color");
  section("look", "Composition");
  if (capabilities.wordCloudMode) section("cloud", "Word cloud", true);
  section("type", "Typography");
  if (input.family === "geo" || kind === "choropleth") section("map", "Basemap", true);
  if (capabilities.pointMarker || capabilities.barMarks || capabilities.lineMarks) section("marks", capabilities.barMarks ? "Bars" : capabilities.lineMarks ? kind === "area" ? "Area" : "Lines" : "Points");
  if (capabilities.cartesian) section("axes", "Axes & grid");
  section("layout", "Layout");
  section("atmosphere", "Atmosphere");
  section("notes", "Annotations");
  return Object.freeze({
    kind, label: input.label, family: input.family, capabilities, channels,
    analysis: Object.freeze({ basis: input.analysis, overlay: input.analysis === "cells" ? "cube" : input.analysis === "rows" ? "none" : "marks", forecast: "ordered-source" }),
    transforms: Object.freeze(CHART_TRANSFORMS.filter(key => capabilities[key])),
    adaptation: Object.freeze([...input.adaptation]),
    defaultAggregate: input.defaultAggregate,
    requirements: Object.freeze({ ...input.requirements }),
    render: Object.freeze({ canvas: input.family, gpu: input.gpu }),
    interactions: Object.freeze({
      navigation: input.gpu === "scatter" ? "scatter" : input.gpu === "cube" ? "cube" : "marks",
      camera: input.gpu === "cube" || input.gpu === "gated-globe" || kind === "scatter3d",
      picking: input.gpu === "scatter" ? "scatter" : input.gpu === "cube" ? "cube-ray" : input.family === "geo" ? "geo" : "marks",
    }),
    exports: Object.freeze({ png: "canvas-capture", svg: Object.freeze({ ...input.svg }) }),
    inspector: Object.freeze({ visualSections: Object.freeze(sections), seriesTools: SERIES_TOOLS.some(key => capabilities[key]) }),
  });
}
