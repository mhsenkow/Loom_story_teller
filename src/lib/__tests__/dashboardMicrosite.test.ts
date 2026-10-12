import { describe, expect, it } from "vitest";
import {
  buildChartSharePageHtml,
  buildDashboardMicrositeHtml,
  formatMicrositeTimestamp,
  LOOM_OG_IMG_TOKEN,
} from "../dashboardMicrosite";

describe("dashboardMicrosite HTML escaping", () => {
  it("escapes source labels in the footer data-sources line", () => {
    const html = buildDashboardMicrositeHtml({
      dashboardName: "Test",
      lastUpdatedMs: null,
      slots: [
        {
          label: "Chart",
          viewType: "chart",
          snapshotDataUrl: null,
          sourceLabel: `<script>alert(1)</script>.csv`,
        },
      ],
    });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toMatch(/Data sources:<\/strong>\s*&lt;script&gt;/);
  });

  it("uses hosted og:image token for data URLs", () => {
    const html = buildDashboardMicrositeHtml({
      dashboardName: "Dash",
      lastUpdatedMs: Date.UTC(2026, 9, 7, 14, 5),
      ogImageDataUrl: "data:image/png;base64,abc",
      slots: [{ label: "A", viewType: "chart", snapshotDataUrl: null }],
    });
    expect(html).toContain(`og:image" content="${LOOM_OG_IMG_TOKEN}"`);
    expect(html).not.toContain("data:image/png");
  });

  it("formats timestamps with a time zone name", () => {
    const text = formatMicrositeTimestamp(Date.UTC(2026, 9, 7, 18, 5));
    expect(text.length).toBeGreaterThan(8);
    expect(text).toMatch(/2026/);
  });

  it("escapes dashboard name, slot labels, and caption (LOOM-487)", () => {
    const html = buildDashboardMicrositeHtml({
      dashboardName: `Evil "><img src=x onerror=alert(1)>`,
      caption: `<b>not bold</b>`,
      lastUpdatedMs: null,
      slots: [
        {
          label: `Label '"><svg/onload=alert(1)>`,
          viewType: "chart",
          snapshotDataUrl: null,
          sourceLabel: "safe.csv",
        },
      ],
    });
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain("&quot;&gt;&lt;img");
    expect(html).toContain("&lt;svg");
  });

  it("escapes share page title and openUrl", () => {
    const html = buildChartSharePageHtml({
      title: `T "><script>`,
      caption: "c",
      imageDataUrl: "",
      openUrl: `https://loom.ibm.io/?q='"><script>`,
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
