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
  BLUESKY_TEXT_MAX,
  blueskyShareHref,
  clipPostText,
  mastodonShareHref,
  normalizeMastodonServer,
  STORY_SAFE,
  STORY_SIZE,
  storySafeRect,
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

describe("Bluesky, Mastodon and post clipping", () => {
  const page = "https://loom.ibm.io/s/abc123";

  it("keeps the link and clips the caption to the network's limit", () => {
    const text = clipPostText("y".repeat(1000), page, BLUESKY_TEXT_MAX);
    expect([...text].length).toBeLessThanOrEqual(BLUESKY_TEXT_MAX);
    expect(text.endsWith(page)).toBe(true);
    expect(text).toContain("…");
    expect(clipPostText("Short", page, 300)).toBe(`Short\n\n${page}`);
    // Emoji count as one character, never split in half.
    expect(clipPostText("📈".repeat(400), page, 300)).not.toMatch(/\uD83D$/);
  });

  it("builds the Bluesky compose intent with caption and link", () => {
    const href = blueskyShareHref("Quakes today", page);
    expect(href.startsWith("https://bsky.app/intent/compose?text=")).toBe(true);
    expect(decodeURIComponent(href.split("text=")[1]!)).toBe(`Quakes today\n\n${page}`);
  });

  it("normalizes whatever people type as their Mastodon server", () => {
    expect(normalizeMastodonServer("mastodon.social")).toBe("mastodon.social");
    expect(normalizeMastodonServer(" https://Hachyderm.io/home ")).toBe("hachyderm.io");
    expect(normalizeMastodonServer("@me@fosstodon.org")).toBe("fosstodon.org");
    expect(normalizeMastodonServer("me@mstdn.social")).toBe("mstdn.social");
    expect(normalizeMastodonServer("not a server")).toBeNull();
    expect(normalizeMastodonServer("localhost")).toBeNull();
    expect(normalizeMastodonServer("javascript:alert(1)")).toBeNull();
    expect(mastodonShareHref("mastodon.social", "Hi", page)).toBe(
      `https://mastodon.social/share?text=${encodeURIComponent(`Hi\n\n${page}`)}`,
    );
  });
});

describe("Instagram story framing", () => {
  it("keeps a 4:5 chart inside the story safe band, centered", () => {
    const r = storySafeRect(1080, 1350);
    expect(r.y).toBeGreaterThanOrEqual(STORY_SAFE.top);
    expect(r.y + r.height).toBeLessThanOrEqual(STORY_SIZE.height - STORY_SAFE.bottom);
    expect(r.x).toBeGreaterThanOrEqual(STORY_SAFE.side);
    expect(Math.abs(r.x * 2 + r.width - STORY_SIZE.width)).toBeLessThanOrEqual(1);
    expect(r.width / r.height).toBeCloseTo(1080 / 1350, 2);
    // Nearly full width: the band is about as tall as a 4:5 render.
    expect(r.width).toBeGreaterThan(950);
  });
});


describe("link-card share targets", () => {
  it("reads auto titles as headlines and names the source", async () => {
    const { shareHeadline } = await import("../socialExport");
    expect(shareHeadline("name sized by total", "pokemon.csv")).toBe("Name sized by total · pokemon");
    expect(shareHeadline("peak_players by genre", null)).toBe("Peak players by genre");
    // Source already in the title: don't repeat it.
    expect(shareHeadline("Pokemon totals", "pokemon.csv")).toBe("Pokemon totals");
    expect(shareHeadline("", "")).toBe("Loom chart");
  });

  it("builds X, Reddit, WhatsApp and Telegram composers with the link", async () => {
    const { xShareHref, redditShareHref, whatsappShareHref, telegramShareHref } = await import("../socialExport");
    const url = "https://loom.ibm.io/s/abc123";
    const x = new URL(xShareHref("A".repeat(400), url));
    expect(x.hostname).toBe("x.com");
    expect(x.searchParams.get("url")).toBe(url);
    // Room for X's fixed 23-char link weight plus a separator.
    expect([...(x.searchParams.get("text") ?? "")].length).toBeLessThanOrEqual(280 - 23 - 2);
    expect(new URL(redditShareHref("Title", url)).searchParams.get("url")).toBe(url);
    expect(decodeURIComponent(whatsappShareHref("Hi", url))).toContain(`Hi\n\n${url}`);
    expect(new URL(telegramShareHref("Hi", url)).searchParams.get("url")).toBe(url);
  });
});
