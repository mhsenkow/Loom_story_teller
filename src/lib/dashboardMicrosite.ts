// =================================================================
// Dashboard microsite — build self-contained HTML for sharing
// =================================================================
// Produces a single HTML file that mirrors the in-app dashboard:
// Loom dark theme, same card layout (aspect 4/3), same grid templates.

export interface MicrositeSlotInfo {
  label: string;
  viewType: string;
  snapshotDataUrl: string | null;
  sourceLabel?: string; // e.g. file name or "Query: ..."
}

export interface MicrositeInput {
  dashboardName: string;
  slots: MicrositeSlotInfo[];
  lastUpdatedMs: number | null;
  layoutTemplate?: string;
  /** Open Graph / link-preview image (data URL). */
  ogImageDataUrl?: string | null;
  /** Optional caption / description for meta tags. */
  caption?: string | null;
}

/** Human-readable export time with local time zone (for microsite footers). */
export function formatMicrositeTimestamp(ms: number): string {
  try {
    return new Date(ms).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return new Date(ms).toISOString();
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only allow safe CSS color tokens into generated `<style>` blocks. */
function sanitizeCssColor(value: string, fallback: string): string {
  const v = value.trim();
  if (
    /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) ||
    /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+(?:\s*,\s*[\d.]+\s*)?\)$/i.test(v) ||
    /^hsla?\(\s*[\d.]+\s*,\s*[\d.]+%\s*,\s*[\d.]+%(?:\s*,\s*[\d.]+\s*)?\)$/i.test(v)
  ) {
    return v;
  }
  return fallback;
}

const SHARE_PAGE_CSP =
  "default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

function snapshotThemeTokens(): Record<string, string> {
  const fallbacks = {
    bg: "#0a0a0c",
    surface: "#111114",
    elevated: "#1a1a1f",
    border: "#2a2a30",
    text: "#e8e8ec",
    muted: "#6b6b78",
    accent: "#6c5ce7",
  };
  if (typeof document === "undefined") {
    return { ...fallbacks };
  }
  const s = getComputedStyle(document.documentElement);
  const get = (k: string, fb: string) =>
    sanitizeCssColor(s.getPropertyValue(k).trim() || fb, fb);
  return {
    bg: get("--loom-bg", fallbacks.bg),
    surface: get("--loom-surface", fallbacks.surface),
    elevated: get("--loom-elevated", fallbacks.elevated),
    border: get("--loom-border", fallbacks.border),
    text: get("--loom-text", fallbacks.text),
    muted: get("--loom-muted", fallbacks.muted),
    accent: get("--loom-accent", fallbacks.accent),
  };
}

/** Build a self-contained HTML string for the dashboard (shareable microsite). */
export function buildDashboardMicrositeHtml(input: MicrositeInput): string {
  const {
    dashboardName,
    slots,
    lastUpdatedMs,
    layoutTemplate = "auto",
    ogImageDataUrl,
    caption,
  } = input;
  const title = escapeHtml(dashboardName);
  const desc = escapeHtml(
    (caption || `${dashboardName} — data story exported from Loom`).slice(0, 280),
  );
  const LOOM = snapshotThemeTokens();
  const ogImage =
    ogImageDataUrl?.startsWith("data:") ? LOOM_OG_IMG_TOKEN : escapeHtml(ogImageDataUrl ?? "");
  const ogMeta = ogImageDataUrl
    ? `
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${desc}" />
  <meta property="og:image" content="${ogImage}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="627" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${desc}" />
  <meta name="twitter:image" content="${ogImage}" />
  <meta name="description" content="${desc}" />`
    : `
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${desc}" />
  <meta name="description" content="${desc}" />`;

  // Grid: match app's gridClass and gridStyle for 1+2 / stream
  const is1p2 = layoutTemplate === "1+2";
  const isStream = layoutTemplate === "stream";
  const gridInlineStyle = is1p2
    ? "display:grid; grid-template-columns: 1fr 1fr; grid-auto-rows: minmax(140px, 1fr); gap: 0.75rem;"
    : isStream
      ? "display:grid; grid-template-columns: repeat(3, 1fr); grid-auto-rows: minmax(160px, 1fr); gap: 0.75rem;"
      : "";
  const gridClass = (is1p2 || isStream)
    ? "dm-grid"
    : layoutTemplate === "1x1"
      ? "dm-grid dm-cols-1"
      : layoutTemplate === "2x1"
        ? "dm-grid dm-cols-2"
        : layoutTemplate === "2x2"
          ? "dm-grid dm-cols-2"
          : layoutTemplate === "3x2"
            ? "dm-grid dm-cols-3"
            : "dm-grid dm-cols-auto";

  const slotCards = slots
    .map((slot, i) => {
      const rowSpan2 = is1p2 && i === 0 ? " dm-slot-span-2" : "";
      const streamHero = isStream && i === 0 ? " dm-stream-hero" : "";
      const content = slot.snapshotDataUrl
        ? `<img src="${escapeHtml(slot.snapshotDataUrl)}" alt="${escapeHtml(slot.label)}" class="dm-slot-img" />`
        : `<div class="dm-slot-placeholder">${escapeHtml(slot.label)}</div>`;
      const sourceLine = slot.sourceLabel
        ? `<p class="dm-slot-source">${escapeHtml(slot.sourceLabel)}</p>`
        : "";
      return `
    <div class="dm-card${rowSpan2}${streamHero}">
      <span class="dm-card-type">${escapeHtml(slot.viewType)}</span>
      <div class="dm-card-content">${content}</div>
      <p class="dm-card-title">${escapeHtml(slot.label)}</p>${sourceLine}
    </div>`;
    })
    .join("\n");

  const headerUpdated =
    lastUpdatedMs
      ? `<span class="dm-header-muted">Updated ${escapeHtml(formatMicrositeTimestamp(lastUpdatedMs))}</span>`
      : "";

  const lineageSection =
    lastUpdatedMs || slots.some((s) => s.sourceLabel)
      ? `
  <footer class="dm-footer">
    ${lastUpdatedMs ? `<p><strong>Last updated:</strong> ${escapeHtml(formatMicrositeTimestamp(lastUpdatedMs))}</p>` : ""}
    ${slots.some((s) => s.sourceLabel) ? `<p><strong>Data sources:</strong> ${slots.map((s) => s.sourceLabel).filter(Boolean).map((l) => escapeHtml(l!)).join("; ")}</p>` : ""}
    <p>Exported from Loom — local-first data storytelling</p>
  </footer>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${SHARE_PAGE_CSP}" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>${ogMeta}
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      font-family: "Inter", "SF Pro Display", system-ui, sans-serif;
      background: ${LOOM.bg};
      color: ${LOOM.text};
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .dm-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid ${LOOM.border};
      background: ${LOOM.surface};
      flex-shrink: 0;
    }
    .dm-header-title { font-size: 0.875rem; font-weight: 600; margin: 0; }
    .dm-header-muted { font-size: 0.65rem; color: ${LOOM.muted}; }
    .dm-main {
      flex: 1;
      overflow-y: auto;
      padding: 1rem;
    }
    .dm-grid {
      display: grid;
      gap: 0.75rem;
    }
    .dm-cols-1 { grid-template-columns: repeat(1, minmax(0, 1fr)); }
    .dm-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .dm-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .dm-cols-auto {
      grid-template-columns: repeat(1, minmax(0, 1fr));
    }
    @media (min-width: 640px) { .dm-cols-auto { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (min-width: 1024px) { .dm-cols-auto { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    @media (min-width: 1280px) { .dm-cols-auto { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
    .dm-slot-span-2 { grid-row: span 2; }
    .dm-card {
      display: flex;
      flex-direction: column;
      min-height: 140px;
      aspect-ratio: 4 / 3;
      padding: 0.75rem;
      border: 1px solid ${LOOM.border};
      border-radius: 10px;
      background: ${LOOM.surface};
      text-align: left;
    }
    .dm-slot-span-2.dm-card { aspect-ratio: auto; min-height: 200px; }
    .dm-stream-hero.dm-card { grid-column: span 2; aspect-ratio: auto; min-height: 200px; }
    .dm-card-type {
      font-size: 0.65rem;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: ${LOOM.muted};
      flex-shrink: 0;
    }
    .dm-card-content {
      margin-top: 0.25rem;
      flex: 1;
      min-height: 0;
      border-radius: 6px;
      background: rgba(10, 10, 12, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .dm-slot-img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .dm-slot-placeholder {
      font-size: 0.65rem;
      color: ${LOOM.muted};
    }
    .dm-card-title {
      font-size: 0.75rem;
      font-weight: 500;
      color: ${LOOM.text};
      margin: 0.375rem 0 0 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .dm-slot-source {
      font-size: 0.65rem;
      color: ${LOOM.muted};
      margin: 0.125rem 0 0 0;
      flex-shrink: 0;
    }
    .dm-footer {
      margin-top: 1.5rem;
      padding-top: 1rem;
      border-top: 1px solid ${LOOM.border};
      font-size: 0.65rem;
      color: ${LOOM.muted};
    }
    .dm-footer p { margin: 0.25rem 0; }
  </style>
</head>
<body>
  <header class="dm-header">
    <h1 class="dm-header-title">${title}</h1>
    ${headerUpdated || "<span></span>"}
  </header>
  <main class="dm-main">
    <div class="${gridClass}"${gridInlineStyle ? ` style="${gridInlineStyle}"` : ""}>${slotCards}
    </div>${lineageSection}
  </main>
</body>
</html>`;
}

export interface ChartSharePageInput {
  title: string;
  /** Post caption / blurb shown under the image and used for link previews. */
  caption?: string | null;
  imageDataUrl: string;
  sourceLabel?: string | null;
  /** Absolute URL of the Loom app, for the "make your own" link. */
  appUrl?: string | null;
  /** Absolute Loom URL with `#chart=…` that reopens this exact chart (replaces the "make your own" link). */
  openUrl?: string | null;
  /** When a data snapshot travels with the story — show lineage details. */
  lineage?: {
    capturedAt: string;
    rowCount: number;
    totalRows: number;
    truncated: boolean;
    columns: string[];
  } | null;
}

/** Stable tokens the Worker rewrites to hosted plot URLs. */
export const LOOM_SHARE_IMG_TOKEN = "__LOOM_SHARE_IMG__";
export const LOOM_OG_IMG_TOKEN = "__LOOM_OG_IMG__";
export const LOOM_PAGE_URL_TOKEN = "__LOOM_PAGE_URL__";
export const LOOM_OEMBED_URL_TOKEN = "__LOOM_OEMBED_URL__";

/**
 * One line under the card title. Drops a repeated headline so Slack, iMessage,
 * LinkedIn, and X show the interesting sentence, not the title twice.
 */
export function shareCardBlurb(title: string, caption?: string | null): string {
  const headline = title.trim().toLowerCase();
  const lines = (caption || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && line.toLowerCase() !== headline);
  const text = lines.join(" ").replace(/\s+/g, " ").trim();
  const blurb = text || "Open the plot. The chart is the picture.";
  return blurb.slice(0, 200);
}

function shareJsonLd(title: string, description: string): string {
  const json = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: title || "Loom chart",
    description,
    image: {
      "@type": "ImageObject",
      url: LOOM_OG_IMG_TOKEN,
      width: 1200,
      height: 627,
    },
    url: LOOM_PAGE_URL_TOKEN,
    publisher: { "@type": "Organization", name: "Loom", url: "https://loom.ibm.io" },
  }).replace(/</g, "\\u003c");
  return json;
}

/**
 * Single-chart share page: one big image, headline, caption, source.
 * Image slots use stable tokens so the Worker can swap in hosted JPEGs
 * (unfurlers reject data: URLs; huge HTML payloads are slow).
 */
export function buildChartSharePageHtml(input: ChartSharePageInput): string {
  const LOOM = snapshotThemeTokens();
  const title = escapeHtml(input.title || "Loom chart");
  const captionText = (input.caption || "").trim();
  const desc = escapeHtml(shareCardBlurb(input.title || "Loom chart", captionText));
  // Prefer tokens; fall back to escaped data URL for offline / non-Worker paths.
  const img = input.imageDataUrl?.startsWith("data:")
    ? LOOM_SHARE_IMG_TOKEN
    : escapeHtml(input.imageDataUrl || LOOM_SHARE_IMG_TOKEN);
  const ogImg = LOOM_OG_IMG_TOKEN;
  const captionHtml = captionText
    ? `<p class="cs-caption">${escapeHtml(captionText).replace(/\n/g, "<br />")}</p>`
    : "";
  const when = input.lineage?.capturedAt
    ? new Date(input.lineage.capturedAt).toLocaleString()
    : new Date().toLocaleString();
  const sourceBits: string[] = [];
  if (input.sourceLabel) sourceBits.push(`Data: ${escapeHtml(input.sourceLabel)}`);
  sourceBits.push(escapeHtml(when));
  if (input.lineage) {
    const n = input.lineage.truncated
      ? `${input.lineage.rowCount.toLocaleString()} of ${input.lineage.totalRows.toLocaleString()} rows`
      : `${input.lineage.rowCount.toLocaleString()} rows`;
    sourceBits.push(escapeHtml(n));
    sourceBits.push("snapshot travels with this link");
  }
  const source = `<p class="cs-meta">${sourceBits.join(" · ")}</p>`;
  const colLine =
    input.lineage?.columns?.length
      ? `<p class="cs-meta cs-cols">Columns: ${escapeHtml(input.lineage.columns.slice(0, 24).join(", "))}${
          input.lineage.columns.length > 24 ? "…" : ""
        }</p>`
      : "";
  const cta = input.openUrl
    ? `<a class="cs-cta" data-loom-open="1" href="${escapeHtml(input.openUrl)}">${
        input.lineage ? "Open with shared data in Loom →" : "Open this chart in Loom →"
      }</a>`
    : input.appUrl
      ? `<a class="cs-cta" href="${escapeHtml(input.appUrl)}">Make your own with Loom →</a>`
      : `<span class="cs-cta">Made with Loom</span>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${SHARE_PAGE_CSP}" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${title}</title>
  <meta name="description" content="${desc}" />
  <meta name="robots" content="index, follow, max-image-preview:large" />
  <meta name="theme-color" content="${LOOM.bg}" />
  <link rel="canonical" href="${LOOM_PAGE_URL_TOKEN}" />
  <link rel="image_src" href="${ogImg}" />
  <link rel="alternate" type="application/json+oembed" href="${LOOM_OEMBED_URL_TOKEN}" title="${title}" />
  <meta property="og:site_name" content="Loom" />
  <meta property="og:locale" content="en_US" />
  <meta property="og:type" content="article" />
  <meta property="og:url" content="${LOOM_PAGE_URL_TOKEN}" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${desc}" />
  <meta property="og:image" content="${ogImg}" />
  <meta property="og:image:secure_url" content="${ogImg}" />
  <meta property="og:image:type" content="image/jpeg" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="627" />
  <meta property="og:image:alt" content="${title}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${desc}" />
  <meta name="twitter:image" content="${ogImg}" />
  <meta name="twitter:image:alt" content="${title}" />
  <meta name="twitter:image:width" content="1200" />
  <meta name="twitter:image:height" content="627" />
  <script type="application/ld+json">${shareJsonLd(input.title || "Loom chart", shareCardBlurb(input.title || "Loom chart", captionText))}</script>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Inter", "SF Pro Display", system-ui, sans-serif;
      background: ${LOOM.bg};
      color: ${LOOM.text};
      min-height: 100vh;
      display: flex;
      justify-content: center;
      padding: max(16px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom));
    }
    main { width: 100%; max-width: 760px; display: flex; flex-direction: column; gap: 18px; }
    h1 { font-size: clamp(1.25rem, 4.5vw, 1.75rem); font-weight: 600; line-height: 1.2; margin: 8px 0 0; letter-spacing: -0.02em; }
    .cs-figure {
      margin: 0;
      border: 1px solid ${LOOM.border};
      border-radius: 18px;
      overflow: hidden;
      background: ${LOOM.surface};
      box-shadow: 0 18px 50px color-mix(in srgb, ${LOOM.text} 8%, transparent);
    }
    .cs-figure img { display: block; width: 100%; height: auto; }
    .cs-caption { margin: 0; font-size: 1rem; line-height: 1.5; color: ${LOOM.text}; opacity: 0.9; }
    .cs-meta { margin: 0; font-size: 0.75rem; color: ${LOOM.muted}; }
    .cs-cols { opacity: 0.85; word-break: break-word; }
    .cs-cta {
      align-self: flex-start;
      margin-top: 2px;
      font-size: 0.95rem;
      font-weight: 500;
      color: ${LOOM.accent};
      text-decoration: none;
    }
    a.cs-cta:hover { text-decoration: underline; text-underline-offset: 3px; }
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <figure class="cs-figure"><img src="${img}" alt="${title}" /></figure>
    ${captionHtml}
    ${source}
    ${colLine}
    ${cta}
  </main>
</body>
</html>`;
}
