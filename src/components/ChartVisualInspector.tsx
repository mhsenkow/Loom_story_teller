"use client";
// Section order, visibility, titles and initial disclosure state belong to the chart catalog.
import type { ReactNode } from "react";
import type { ChartDefinition, ChartVisualSectionId } from "@/lib/chartDefinitions";
import { ChartInspectorSection } from "./ChartInspectorSection";
export function ChartVisualInspector({ definition, open, onToggle, content }: {
  definition: ChartDefinition;
  open: Readonly<Record<string, boolean>>;
  onToggle: (id: ChartVisualSectionId, next: boolean) => void;
  content: Record<ChartVisualSectionId, () => ReactNode>;
}) {
  return definition.inspector.visualSections.map(section => {
    const expanded = open[section.id] ?? section.defaultOpen;
    return <ChartInspectorSection key={section.id} sectionId={section.id} title={section.title} open={expanded} onToggle={() => onToggle(section.id, !expanded)}>
      {expanded ? content[section.id]() : null}
    </ChartInspectorSection>;
  });
}
