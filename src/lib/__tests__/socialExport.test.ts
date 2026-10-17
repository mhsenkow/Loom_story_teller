// =================================================================
// Social export unit tests
// =================================================================

import { describe, it, expect } from "vitest";
import {
  SOCIAL_PRESETS,
  getSocialPreset,
  buildSocialCaption,
  linkedInShareHref,
  emailShareHref,
  facebookShareHref,
  slugifyFilename,
  threadsPostText,
  threadsShareHref,
  THREADS_TEXT_MAX,
  LINK_PREVIEW_SIZE,
} from "../socialExport";
import { buildZip, ZIP_UTF8_FLAG, zipDosDateTime } from "../zipStore";
import { LOOM_OG_IMG_TOKEN, LOOM_PAGE_URL_TOKEN, LOOM_SHARE_IMG_TOKEN, buildChartSharePageHtml } from "../dashboardMicrosite";

describe("socialExport", () => {
  it("includes platform presets with pixel targets", () => {
    const ig = getSocialPreset("ig-square");
    expect(ig.width).toBe(1080);
    expect(ig.height).toBe(1080);
    const stories = getSocialPreset("stories");
    expect(stories.width).toBe(1080);
    expect(stories.height).toBe(1920);
    expect(stories.safeZones).toBe(true);
    expect(SOCIAL_PRESETS.length).toBeGreaterThanOrEqual(6);
    expect(getSocialPreset("linkedin-og").width).toBe(LINK_PREVIEW_SIZE.width);
    expect(getSocialPreset("linkedin-og").height).toBe(LINK_PREVIEW_SIZE.height);
  });

  it("share page HTML uses stable image tokens for Worker rewrite", () => {
    const html = buildChartSharePageHtml({
      title: "Test",
      caption: "Test\nHow these series move together\nSource: quakes.csv",
      imageDataUrl: "data:image/jpeg;base64,abc",
      openUrl: "https://loom.ibm.io/#story=abc",
    });
    expect(html).toContain(LOOM_SHARE_IMG_TOKEN);
    expect(html).toContain(LOOM_OG_IMG_TOKEN);
    expect(html).toContain(LOOM_PAGE_URL_TOKEN);
    expect(html).toContain('og:image:type" content="image/jpeg"');
    expect(html).toContain('og:site_name" content="Loom"');
    expect(html).toContain("max-image-preview:large");
    expect(html).toContain('twitter:card" content="summary_large_image"');
    expect(html).toContain('twitter:image:alt"');
    expect(html).toContain("__LOOM_OEMBED_URL__");
    expect(html).toContain("How these series move together");
    expect(html).not.toContain("og:description\" content=\"Test");
    expect(html).toContain('og:url" content="__LOOM_PAGE_URL__"');
    expect(html).not.toContain("data:image/jpeg;base64,abc");
  });

  it("builds a paste-ready caption", () => {
    const text = buildSocialCaption({
      title: "Sales vs Region",
      subtitle: "Northeast leads",
      reason: "Clear categorical breakdown",
      source: "sales.csv",
      handle: "@loom",
    });
    expect(text).toContain("Sales vs Region");
    expect(text).toContain("Northeast leads");
    expect(text).toContain("Source: sales.csv");
    expect(text).toContain("@loom");
  });

  it("builds LinkedIn and Threads share URLs that fit each network", () => {
    const page = "https://loom.ibm.io/s/abc";
    expect(linkedInShareHref(page)).toBe(
      "https://www.linkedin.com/sharing/share-offsite/?url=https%3A%2F%2Floom.ibm.io%2Fs%2Fabc",
    );
    const threads = threadsShareHref("Quakes today", page);
    expect(threads.startsWith("https://www.threads.net/intent/post?text=")).toBe(true);
    const text = threadsPostText("Quakes today", page);
    expect(text).toContain("Quakes today");
    expect(text.endsWith(page)).toBe(true);
    expect(text.length).toBeLessThanOrEqual(THREADS_TEXT_MAX);
    const long = threadsPostText("x".repeat(800), page);
    expect(long.length).toBeLessThanOrEqual(THREADS_TEXT_MAX);
    expect(long.endsWith(page)).toBe(true);
    expect(facebookShareHref(page)).toBe(
      "https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Floom.ibm.io%2Fs%2Fabc",
    );
    const mail = emailShareHref("Quakes today", `Quakes today\n\n${page}`);
    expect(mail.startsWith("mailto:?")).toBe(true);
    const mailParams = new URLSearchParams(mail.slice("mailto:?".length));
    expect(mailParams.get("subject")).toBe("Quakes today");
    expect(mailParams.get("body")).toContain(page);
  });

  it("slugifies filenames safely", () => {
    expect(slugifyFilename("Hello World!!")).toBe("Hello_World");
    expect(slugifyFilename("")).toBe("loom-export");
    expect(slugifyFilename("Évolution des prix")).toBe("Evolution_des_prix");
    expect(slugifyFilename("東京")).toBe("東京");
  });
});

describe("zipStore", () => {
  it("builds a zip with local file headers", () => {
    const enc = new TextEncoder();
    const zip = buildZip([
      { name: "a.txt", data: enc.encode("hello") },
      { name: "b.txt", data: enc.encode("world") },
    ]);
    expect(zip.length).toBeGreaterThan(40);
    // Local file header signature PK\x03\x04
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
    expect(zip[2]).toBe(0x03);
    expect(zip[3]).toBe(0x04);
    const { dosDate } = zipDosDateTime(new Date("2026-10-07T14:05:00"));
    expect(dosDate).toBeGreaterThan(0);
    expect(zip[6]).toBe(ZIP_UTF8_FLAG & 0xff);
    expect(zip[7]).toBe((ZIP_UTF8_FLAG >> 8) & 0xff);
  });
});
