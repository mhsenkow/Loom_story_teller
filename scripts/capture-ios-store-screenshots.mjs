#!/usr/bin/env node
// =================================================================
// Capture accurate iPhone / iPad App Store screenshots (mobile layout)
// =================================================================
// Opens portable #chart= / #dive= links at real phone/tablet viewports
// (not desktop UI stretched into a tall frame). Defaults to the live
// site so /api/source/* feeds resolve. Fresh browser context per shot.
//
// Usage:
//   node scripts/capture-ios-store-screenshots.mjs
//   LOOM_SHOT_BASE=http://127.0.0.1:3456 node …   # local out/ + serve
// =================================================================

import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "out");
const PORT = Number(process.env.LOOM_SHOT_PORT || 3456);
const BASE = (process.env.LOOM_SHOT_BASE || "https://loom.ibm.io").replace(/\/$/, "");
const LOCAL = BASE.includes("127.0.0.1") || BASE.includes("localhost");

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

const CHART_BAR = b64url({
  v: 1,
  src: "mock://sales.csv",
  c: { k: "bar", x: "city", y: "revenue", a: "sum", ti: "Revenue by city", st: "total revenue, grouped" },
});
const CHART_UNITS = b64url({
  v: 1,
  src: "mock://sales.csv",
  c: { k: "bar", x: "product", y: "units", a: "sum", ti: "Units sold by product", st: "total units, grouped" },
});
const CHART_SCATTER = b64url({
  v: 1,
  src: "mock://scatter.csv",
  c: { k: "scatter", x: "x", y: "y", ti: "Scatter demo", st: "density at a glance" },
});
const CHART_QUAKE = b64url({
  v: 1,
  src: "stream://usgs",
  c: {
    k: "geoPoints",
    x: "longitude",
    y: "latitude",
    c: "mag_type",
    s: "magnitude",
    ti: "Earthquakes",
    st: "past day · USGS",
  },
});
const DIVE_WIKI = b64url({
  v: 1,
  src: "stream://wiki",
  query: {
    timeColumn: "ts",
    range: "1h",
    start: "",
    end: "",
    bucket: "auto",
    fill: "auto",
    compare: "none",
    filters: [],
    groupBy: ["wiki"],
    metrics: [{ agg: "count", column: null }],
    limit: 10,
    orderBy: 0,
    orderDir: "desc",
    hits: true,
    derived: [],
    columns: null,
    view: "timeseries",
  },
});

const DEVICES = {
  iphone67: {
    dir: path.join(ROOT, "ios/store/screenshots/iphone67"),
    viewport: { width: 430, height: 932 },
    deviceScaleFactor: 3,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  },
  ipad13: {
    dir: path.join(ROOT, "ios/store/screenshots/ipad13"),
    viewport: { width: 1032, height: 1376 },
    deviceScaleFactor: 2,
    userAgent:
      "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  },
};

async function waitHttp(url, ms = 60_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      await new Promise((resolve, reject) => {
        http
          .get(url, (res) => {
            res.resume();
            res.statusCode && res.statusCode < 500 ? resolve() : reject(new Error(String(res.statusCode)));
          })
          .on("error", reject);
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error(`Server not up: ${url}`);
}

async function dismissChrome(page) {
  await page.keyboard.press("Escape").catch(() => {});
  const notes = page.getByRole("dialog").filter({ has: page.getByText("New in Loom", { exact: true }) });
  if (await notes.isVisible().catch(() => false)) {
    await notes.getByRole("button", { name: "Close", exact: true }).click({ timeout: 2000 }).catch(() => {});
  }
  const detail = page.getByRole("dialog", { name: "Detail panel", exact: true });
  if (await detail.isVisible().catch(() => false)) {
    await detail.getByRole("button", { name: "Close", exact: true }).click({ timeout: 2000 }).catch(() => {});
  }
  if (await page.getByText("Encoding", { exact: true }).first().isVisible().catch(() => false)) {
    await page
      .getByRole("button", { name: /Open chart panel|Toggle detail panel/i })
      .first()
      .click({ timeout: 2000 })
      .catch(() => {});
  }
}

async function captureOne(browser, cfg, file, hash, after) {
  const context = await browser.newContext({
    viewport: cfg.viewport,
    deviceScaleFactor: cfg.deviceScaleFactor,
    isMobile: true,
    hasTouch: true,
    userAgent: cfg.userAgent,
    colorScheme: "dark",
  });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("loom-discover-v1", "1");
      localStorage.setItem("loom-whats-new-seen", "2026-10-15c");
      sessionStorage.setItem("loom-suggestions-rail", "0");
    } catch {
      /* ignore */
    }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  try {
    const url = `${BASE}/?shot=${Date.now()}${hash.startsWith("#") ? hash : `#${hash}`}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(600);
    await dismissChrome(page);
    if (after) await after(page);
    await dismissChrome(page);
    await page.waitForTimeout(400);
    const out = path.join(cfg.dir, file);
    await page.screenshot({ path: out, fullPage: false, type: "png" });
    console.log(`  wrote ${path.relative(ROOT, out)} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
  } finally {
    await context.close();
  }
}

async function captureDevice(name, cfg) {
  console.log(`\n→ ${name} ${cfg.viewport.width}×${cfg.viewport.height}@${cfg.deviceScaleFactor} @ ${BASE}`);
  fs.mkdirSync(cfg.dir, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  await captureOne(browser, cfg, "01-chart.png", `#chart=${CHART_BAR}`, async (page) => {
    await page
      .getByRole("button", { name: "Share chart", exact: true })
      .waitFor({ state: "visible", timeout: 25_000 })
      .catch(() => {});
    await page.waitForTimeout(1200);
  });

  await captureOne(browser, cfg, "02-dive.png", `#dive=${DIVE_WIKI}`, async (page) => {
    await page.keyboard.press("4");
    await page.waitForTimeout(4500);
  });

  await captureOne(browser, cfg, "03-explorer.png", `#chart=${CHART_BAR}`, async (page) => {
    await page.keyboard.press("1");
    await page.waitForTimeout(1000);
  });

  // Cap/web has no DuckDB SQL — Discover is the honest App Store story.
  await captureOne(browser, cfg, "04-query.png", `#chart=${CHART_BAR}`, async (page) => {
    await page.evaluate(() => {
      try {
        localStorage.removeItem("loom-discover-v1");
      } catch {
        /* ignore */
      }
      window.dispatchEvent(new Event("loom-discover"));
    });
    await page.locator("#onboarding-title").waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(2500);
  });

  await captureOne(browser, cfg, "05-map.png", `#chart=${CHART_QUAKE}`, async (page) => {
    await page.waitForTimeout(6500);
    const ok = await page.locator("canvas").first().isVisible().catch(() => false);
    if (!ok) {
      console.log("  quake map empty — falling back to scatter");
      await page.goto(`${BASE}/?shot=${Date.now()}#chart=${CHART_SCATTER}`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForTimeout(1500);
      await dismissChrome(page);
    }
  });

  await captureOne(browser, cfg, "06-phone.png", `#chart=${CHART_UNITS}`, async (page) => {
    await page
      .getByRole("button", { name: "Share chart", exact: true })
      .waitFor({ state: "visible", timeout: 25_000 })
      .catch(() => {});
    await page.waitForTimeout(1200);
  });

  await browser.close();
}

async function main() {
  let serve = null;
  if (LOCAL) {
    if (!fs.existsSync(path.join(OUT, "index.html"))) {
      console.error("Missing out/ — run npm run build first");
      process.exit(1);
    }
    serve = spawn("npx", ["serve", "out", "-s", "-l", String(PORT)], { cwd: ROOT, stdio: "ignore" });
    await waitHttp(`http://127.0.0.1:${PORT}`);
  }
  try {
    for (const [name, cfg] of Object.entries(DEVICES)) {
      await captureDevice(name, cfg);
    }
    console.log("\nDone. Review PNGs under ios/store/screenshots/");
    console.log("  node scripts/build-app-previews.mjs");
    console.log("  node scripts/upload-store-media.mjs --replace-ios");
  } finally {
    if (serve) serve.kill("SIGTERM");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
