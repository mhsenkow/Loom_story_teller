"use client";

// =================================================================
// ChartSocialRail — vote and comment on the chart that's open
// =================================================================
// Sits beside the chart tool rail (vertical on desktop, a row on phones).
// Only public live-feed charts get one: people's own files never reach the
// community. An edited chart is its own community item, so the counts
// follow whatever recipe is on screen.
// =================================================================

import { useEffect, useMemo } from "react";
import { useLoomStore } from "@/lib/store";
import { socialTargetFromState } from "@/lib/socialKey";
import { VoteControl } from "@/components/VoteControl";

export function ChartSocialRail({ orientation }: { orientation: "vertical" | "horizontal" }) {
  const enabled = useLoomStore((s) => s.socialEnabled);
  const activeChart = useLoomStore((s) => s.activeChart);
  const selectedFile = useLoomStore((s) => s.selectedFile);
  const chartTitleOverrides = useLoomStore((s) => s.chartTitleOverrides);
  const loadSummary = useLoomStore((s) => s.loadSocialSummary);

  const target = useMemo(
    () => socialTargetFromState({ activeChart, selectedFile, chartTitleOverrides }),
    [activeChart, selectedFile, chartTitleOverrides],
  );

  useEffect(() => {
    if (enabled && target) void loadSummary();
  }, [enabled, target?.key, loadSummary]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!enabled || !target) return null;
  return (
    <div className="chart-social-rail" data-orientation={orientation}>
      <VoteControl socialKey={target.key} meta={{ title: target.title, link: target.link }} variant="stage" />
    </div>
  );
}
