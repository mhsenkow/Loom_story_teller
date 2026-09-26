// =================================================================
// Story carousel / pack export — numbered PNGs + ZIP from a dashboard
// =================================================================

import { useLoomStore } from "./store";
import {
  capturePlatformPng,
  looksLikeFailedCapture,
} from "./capturePlatformPng";
import {
  buildCarouselZip,
  buildSocialCaption,
  getSocialPreset,
  slugifyFilename,
  type SocialPresetId,
} from "./socialExport";
import { getRecommendationReason } from "./recommendations";

function afterPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Export every chart slot in a dashboard as numbered PNGs at a platform size,
 * then return a ZIP blob (PNGs + caption.txt).
 */
export async function exportStoryCarouselZip(
  dashboardId: string,
  presetId: SocialPresetId,
): Promise<{ blob: Blob; count: number } | null> {
  const getState = useLoomStore.getState;
  const dashboard = getState().dashboards.find((d) => d.id === dashboardId);
  const chartIds =
    dashboard?.slots.filter((s) => s.viewType === "chart").map((s) => s.viewId) ?? [];
  if (chartIds.length === 0) return null;

  const preset = getSocialPreset(presetId);
  getState().setPreviewCapture({
    dashboardId,
    current: 0,
    total: chartIds.length,
    label: `Exporting carousel (${preset.label})…`,
  });

  const slides: { filename: string; blob: Blob }[] = [];
  const captionParts: string[] = [];

  try {
    for (let i = 0; i < chartIds.length; i++) {
      const cid = chartIds[i]!;
      const view = getState().chartViews.find((v) => v.id === cid);
      const name = view?.name ?? `Chart ${i + 1}`;
      getState().setPreviewCapture({
        dashboardId,
        current: i + 1,
        total: chartIds.length,
        label: `Slide ${i + 1}/${chartIds.length}: ${name}`,
      });
      getState().applyChartView(cid);
      await sleep(200);
      await afterPaint();

      const blob = await capturePlatformPng(presetId, { attempts: 3 });
      if (!blob || (await looksLikeFailedCapture(blob))) continue;

      const pad = String(i + 1).padStart(2, "0");
      const fileBase = slugifyFilename(name);
      slides.push({ filename: `${pad}-${fileBase}.png`, blob });

      const chart = getState().activeChart;
      const title =
        (chart && getState().chartTitleOverrides[chart.id]) ||
        chart?.title ||
        name;
      captionParts.push(
        buildSocialCaption({
          title: `${i + 1}. ${title}`,
          subtitle: chart?.subtitle,
          reason: chart ? getRecommendationReason(chart) : null,
          source: view?.fileName ?? getState().selectedFile?.name,
        }),
      );
    }

    if (slides.length === 0) return null;

    const zip = await buildCarouselZip(slides, [
      {
        name: "caption.txt",
        text: `${dashboard?.name ?? "Story"}\n\n${captionParts.join("\n\n—\n\n")}\n`,
      },
      {
        name: "README.txt",
        text: `Loom story pack — ${preset.label}\n${slides.length} slides\nDrop into Instagram carousel or Stories in order.\n`,
      },
    ]);
    return { blob: zip, count: slides.length };
  } finally {
    getState().setPreviewCapture(null);
  }
}
