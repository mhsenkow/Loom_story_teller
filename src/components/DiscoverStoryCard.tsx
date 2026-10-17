// =================================================================
// DiscoverStoryCard — an evidence-led story with an editable chart.
// =================================================================

"use client";

import { memo, useMemo } from "react";
import { ChartCard } from "./ChartCard";
import { discoverSourceBrief, type DiscoverStory } from "@/lib/discoverStories";
import {
  discoverChartLabel,
  discoverChartSettings,
  discoverEvidence,
} from "@/lib/discoverPresentation";
import { discoverFreshness } from "@/lib/discoverFreshness";
import { readableDiscoverText, discoverFieldLabel } from "@/lib/discoverEditorial";
import { DISCOVER_FAMILIES, discoverFamily } from "@/lib/discoverChartCatalog";
import { feedRef } from "@/lib/sourceRef";
import { SourcePrefMenu, useSourcePref } from "./SourcePrefControls";
import type { DiscoverFlowTier } from "@/lib/discoverFlowLayout";

const SETTINGS_VISIBLE = 2;

export const DiscoverStoryCard = memo(function DiscoverStoryCard({
  story,
  featured = false,
  tier = "standard",
  opening = false,
  disabled = false,
  onOpen,
  onInspect,
  groupId,
  variants,
  onChooseVariant,
  now,
}: {
  story: DiscoverStory;
  featured?: boolean;
  tier?: DiscoverFlowTier;
  opening?: boolean;
  disabled?: boolean;
  onOpen: (story: DiscoverStory) => void;
  onInspect: (story: DiscoverStory) => void;
  groupId?: string;
  variants?: DiscoverStory[];
  onChooseVariant?: (groupId: string, storyId: string) => void;
  now?: number;
}) {
  const brief = discoverSourceBrief(story.kind);
  const evidence = useMemo(() => discoverEvidence(story), [story]);
  const settings = useMemo(
    () => discoverChartSettings(story.chart),
    [story.chart],
  );
  const visibleSettings = settings.slice(0, SETTINGS_VISIBLE);
  const hiddenSettings = settings.length - visibleSettings.length;
  const freshness = discoverFreshness(story, now);
  const sourceRef = feedRef(story.kind);
  const pref = useSourcePref(sourceRef);
  const clock = now ?? Date.now();
  const recentlyUpdated =
    story.dataChangedAt != null &&
    story.dataChangedAt <= clock + 60_000 &&
    clock - story.dataChangedAt < 900_000;
  const fields = [
    discoverFieldLabel(story.chart.xField),
    story.chart.yField ? discoverFieldLabel(story.chart.yField) : "count",
    story.chart.sizeField ? discoverFieldLabel(story.chart.sizeField) : null,
  ]
    .filter(Boolean)
    .join(" × ");
  const metaTitle = [
    DISCOVER_FAMILIES[discoverFamily(story.chartKind)].prompt,
    freshness.title,
    `${evidence.cached ? "Saved snapshot · " : ""}${evidence.coverage}`,
    evidence.period,
  ]
    .filter(Boolean)
    .join("\n");
  const hasVariants = !!(variants && variants.length > 1 && groupId);
  return (
    <article
      className={`discover-story relative discover-tier-${tier} ${featured ? "discover-story-featured" : ""} ${pref.reaction === "hide" ? "opacity-60" : ""}`}
      data-source-ref={sourceRef}
      data-tier={tier}
    >
      <button
        type="button"
        className="discover-story-open"
        onClick={() => onOpen(story)}
        disabled={disabled}
        aria-label={`Open chart: ${story.hook}`}
        aria-busy={opening}
      >
        <div className="discover-story-preview">
          <ChartCard
            rec={story.chart}
            data={story.sample}
            isActive={false}
            onClick={() => onOpen(story)}
            previewOnly
            hero={featured || tier === "lead"}
          />
          <span className="discover-story-kind">
            {discoverChartLabel(story.chartKind)}
          </span>
          {featured && <span className="discover-story-spotlight">Worth a closer look</span>}
          {recentlyUpdated && (
            <span className="discover-story-updated" title="Updated data">
              <span className="sr-only">Updated data</span>
            </span>
          )}
          <span className="discover-story-cta" aria-hidden>
            {opening ? "Opening…" : "Open ↗"}
          </span>
        </div>
        <div className="discover-story-copy">
          <p className="discover-story-eyebrow" title={fields}>
            {pref.reaction === "love" && (
              <span className="text-loom-accent" title="You love this source">
                ♥{" "}
              </span>
            )}
            {story.category}{" "}
            <span aria-hidden> / </span> {story.fileName}
          </p>
          <h3>{story.hook}</h3>
          <p className="discover-story-blurb">{story.blurb}</p>
          {story.insight && (
            <div className="discover-story-insight">
              <strong>{story.insight.label}</strong>
              <span>{story.insight.detail}</span>
            </div>
          )}
          {visibleSettings.length > 0 && (
            <ul className="discover-story-settings" aria-label="Chart settings">
              {visibleSettings.map((setting) => (
                <li key={setting}>{setting}</li>
              ))}
              {hiddenSettings > 0 && (
                <li title={settings.slice(SETTINGS_VISIBLE).join(" · ")}>
                  +{hiddenSettings}
                </li>
              )}
            </ul>
          )}
        </div>
      </button>
      <div className="discover-story-proof">
        <p className="discover-story-meta" title={metaTitle}>
          <span className={freshness.due ? "discover-freshness-due" : ""}>
            <span className="sr-only">{freshness.label}</span>
            <span aria-hidden>
              {freshness.shortLabel}
              {freshness.due ? " · due" : ""}
            </span>
          </span>
          <span aria-hidden> · </span>
          <span>{evidence.shortCoverage}</span>
        </p>
        {hasVariants && (
          <label className="discover-story-views">
            <span className="sr-only">{variants!.length} views</span>
            <select
              aria-label={`Chart perspective for ${story.hook}`}
              value={story.id}
              disabled={disabled}
              onChange={(event) => onChooseVariant?.(groupId!, event.target.value)}
            >
              {variants!.map((variant) => (
                <option key={variant.id} value={variant.id}>
                  {[
                    discoverChartLabel(variant.chartKind),
                    readableDiscoverText(
                      variant.chart.title,
                      variant.sample.columns,
                    ),
                    ...discoverChartSettings(variant.chart),
                  ].join(" · ")}
                </option>
              ))}
            </select>
            <span aria-hidden className="discover-story-views-count">
              {variants!.length}↗
            </span>
          </label>
        )}
        <div className="discover-story-source">
          <button
            type="button"
            onClick={() => onInspect(story)}
            disabled={disabled}
            title={`${brief.tldr}\n${brief.credit}`}
          >
            <span className="sr-only">Source &amp; data</span>
            <span aria-hidden>Source</span>
          </button>
          <SourcePrefMenu
            sourceRef={sourceRef}
            label={brief.label}
            actions={["love", "less", "hide", "save"]}
            triggerClassName="discover-story-more"
          />
        </div>
      </div>
    </article>
  );
});
