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
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Loom dark theme tokens (match globals.css) so microsite matches the app
const LOOM = {
  bg: "#0a0a0c",
  surface: "#111114",
  elevated: "#1a1a1f",
  border: "#2a2a30",
  text: "#e8e8ec",
  muted: "#6b6b78",
  accent: "#6c5ce7",
};

/** Build a self-contained HTML string for the dashboard (shareable microsite). */
export function buildDashboardMicrositeHtml(input: MicrositeInput): string {
  const { dashboardName, slots, lastUpdatedMs, layoutTemplate = "auto" } = input;
  const title = escapeHtml(dashboardName);

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
      ? `<span class="dm-header-muted">Updated ${escapeHtml(
          new Date(lastUpdatedMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        )}</span>`
      : "";

  const lineageSection =
    lastUpdatedMs || slots.some((s) => s.sourceLabel)
      ? `
  <footer class="dm-footer">
    ${lastUpdatedMs ? `<p><strong>Last updated:</strong> ${escapeHtml(new Date(lastUpdatedMs).toLocaleString())}</p>` : ""}
    ${slots.some((s) => s.sourceLabel) ? `<p><strong>Data sources:</strong> ${slots.map((s) => s.sourceLabel).filter(Boolean).join("; ")}</p>` : ""}
    <p>Exported from Loom — local-first data storytelling</p>
  </footer>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
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
