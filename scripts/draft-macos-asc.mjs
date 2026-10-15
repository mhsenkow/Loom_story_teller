#!/usr/bin/env node
// Draft Mac App Store Connect listing for Loom Storyteller (version 1.0).
// Fills localization + review notes, creates MAC screenshot set, uploads shots.
import crypto from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEY_ID = process.env.APPLE_API_KEY_ID || "397A4HMVSU";
const ISSUER = process.env.APPLE_API_ISSUER || "69a6de78-8ab8-47e3-e053-5b8c7c11a4d1";
const KEY = fs.readFileSync(
  path.join(process.env.HOME, `.appstoreconnect/private_keys/AuthKey_${KEY_ID}.p8`),
);
const MAC_VER = "01292adc-feb5-4704-a085-e1228c055e90";
const MAC_LOC = "6e80eeef-5a9c-4766-89b5-47620e4cc301";
const REVIEW_ID = "dcd216e3-bd18-48d5-ac83-33be866f8028";
const SHOT_DIR = path.join(ROOT, "macos/store/screenshots/mac16x10");

const DESCRIPTION = `Loom turns interesting data into charts you can actually read — and share.

On Mac you get the full Loom desktop:

• Link a folder of CSV / Parquet and explore with DuckDB SQL
• Live feeds — earthquakes, aircraft, Wikipedia edits, crypto, weather, and more
• Chart suggestions that fit your columns, plus Dive for filters without writing SQL
• High-density scatter when WebGPU is available
• Share — PNG for Stories / Square / Wide, or a link that reopens the chart

Open a local folder, load a CSV, or tap a curated pack / open-data catalog. No account required.

This App Store build is a one-time paid download ($4.95) with no in-app purchases and no login. The same storytelling surface also runs at loom.ibm.io and on iPhone / iPad.`;

const PROMO =
  "Folder + DuckDB on Mac, live quakes/flights/Wikipedia, or a CSV. Chart it and share. Paid download; your files stay local.";

const KEYWORDS = "data,chart,csv,sql,duckdb,visualization,productivity,earthquake,flights,wikipedia";

const REVIEW_NOTES = `PURPOSE: Loom Storyteller helps people turn open/live data (or local CSV/Parquet) into readable charts they can share on Mac. Same product surface as loom.ibm.io, with desktop DuckDB + folder mount. Target: curious users, students, journalists, light analytics — not enterprise-only.

NO LOGIN. No account registration or deletion. No UGC social posting / reporting flows.

PAID MODEL: One-time App Store purchase ($4.95). No In-App Purchases. All features available after download.

HOW TO REVIEW:
1) Launch Loom
2) Tap “What’s interesting right now” OR Data & sources → Earthquakes / Wikipedia (or Link a folder with sample CSVs)
3) Chart appears; optional Edit encoding/look; optional Query with DuckDB
4) Share → export PNG

EXTERNAL SERVICES: Cloudflare Worker catalog/proxy at loom.ibm.io; public upstreams the user selects (USGS, Wikipedia, Open-Meteo/NWS, flights, crypto, etc.). No auth vendors. No ads/analytics SDKs. Local files stay on device via DuckDB.

REGIONS: Same features worldwide; live feeds need network to their public APIs.

REGULATED/PROTECTED: Not a regulated industry app. Public open data + user-chosen local files; third-party content rights declared.

Privacy: https://loom.ibm.io/privacy
Icon: woven loom cube mark (RGB 1024, no alpha).`;

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}
function token() {
  const now = Math.floor(Date.now() / 1000);
  const h = b64url(JSON.stringify({ alg: "ES256", kid: KEY_ID, typ: "JWT" }));
  const p = b64url(
    JSON.stringify({ iss: ISSUER, iat: now, exp: now + 1200, aud: "appstoreconnect-v1" }),
  );
  const data = `${h}.${p}`;
  return `${data}.${b64url(crypto.sign("sha256", Buffer.from(data), { key: KEY, dsaEncoding: "ieee-p1363" }))}`;
}
function api(method, pathname, body) {
  const bodyStr = body !== undefined ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.appstoreconnect.apple.com",
        path: pathname,
        method,
        headers: {
          Authorization: `Bearer ${token()}`,
          Accept: "application/json",
          ...(bodyStr
            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(bodyStr) }
            : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let json = null;
          try {
            json = data ? JSON.parse(data) : null;
          } catch {
            json = { raw: data };
          }
          resolve({ status: res.statusCode, json });
        });
      },
    );
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function upload(url, method, headers, buf) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method,
        headers: { ...headers, "Content-Length": buf.length },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, data }));
      },
    );
    req.on("error", reject);
    req.write(buf);
    req.end();
  });
}

function ok(label, r) {
  const fine = r.status >= 200 && r.status < 300;
  console.log(`[${fine ? "OK" : "FAIL"}] ${label} → ${r.status}`);
  if (!fine) console.log(JSON.stringify(r.json, null, 2).slice(0, 1000));
  return fine;
}

async function main() {
  // Version attributes
  const ver = await api("PATCH", `/v1/appStoreVersions/${MAC_VER}`, {
    data: {
      type: "appStoreVersions",
      id: MAC_VER,
      attributes: {
        copyright: "2026 Michael Senkow",
        releaseType: "AFTER_APPROVAL",
        usesIdfa: false,
      },
    },
  });
  ok("PATCH version (copyright / IDFA / release)", ver);

  const loc = await api("PATCH", `/v1/appStoreVersionLocalizations/${MAC_LOC}`, {
    data: {
      type: "appStoreVersionLocalizations",
      id: MAC_LOC,
      attributes: {
        description: DESCRIPTION,
        keywords: KEYWORDS,
        marketingUrl: "https://loom.ibm.io",
        supportUrl: "https://github.com/mhsenkow/Loom_story_teller",
        promotionalText: PROMO,
        // whatsNew is locked until a prior live version exists
      },
    },
  });
  ok("PATCH en-US localization", loc);

  const review = await api("PATCH", `/v1/appStoreReviewDetails/${REVIEW_ID}`, {
    data: {
      type: "appStoreReviewDetails",
      id: REVIEW_ID,
      attributes: {
        contactFirstName: "Michael",
        contactLastName: "Senkow",
        contactPhone: "+19062814672",
        contactEmail: "mhsenkow@gmail.com",
        demoAccountRequired: false,
        notes: REVIEW_NOTES,
      },
    },
  });
  ok("PATCH review notes", review);

  // Screenshot set
  let setId = null;
  const existing = await api("GET", `/v1/appStoreVersionLocalizations/${MAC_LOC}/appScreenshotSets`);
  ok("GET screenshot sets", existing);
  const macSet = (existing.json?.data || []).find(
    (s) => s.attributes?.screenshotDisplayType === "APP_DESKTOP",
  );
  if (macSet) {
    setId = macSet.id;
    console.log("Reusing screenshot set", setId);
  } else {
    const created = await api("POST", `/v1/appScreenshotSets`, {
      data: {
        type: "appScreenshotSets",
        attributes: { screenshotDisplayType: "APP_DESKTOP" },
        relationships: {
          appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: MAC_LOC } },
        },
      },
    });
    ok("POST APP_DESKTOP screenshot set", created);
    setId = created.json?.data?.id;
  }
  if (!setId) throw new Error("No screenshot set id");

  const files = fs
    .readdirSync(SHOT_DIR)
    .filter((f) => f.endsWith(".png"))
    .sort();
  for (const file of files) {
    const filePath = path.join(SHOT_DIR, file);
    const buf = fs.readFileSync(filePath);
    const reserve = await api("POST", `/v1/appScreenshots`, {
      data: {
        type: "appScreenshots",
        attributes: { fileName: file, fileSize: buf.length },
        relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: setId } } },
      },
    });
    if (!ok(`Reserve ${file}`, reserve)) continue;
    const shotId = reserve.json.data.id;
    const ops = reserve.json.data.attributes.uploadOperations || [];
    for (const op of ops) {
      const chunk = buf.subarray(op.offset, op.offset + op.length);
      const headers = Object.fromEntries((op.requestHeaders || []).map((h) => [h.name, h.value]));
      const up = await upload(op.url, op.method, headers, chunk);
      console.log(`  upload chunk ${op.offset}+${op.length} → ${up.status}`);
    }
    const commit = await api("PATCH", `/v1/appScreenshots/${shotId}`, {
      data: {
        type: "appScreenshots",
        id: shotId,
        attributes: {
          uploaded: true,
          sourceFileChecksum: crypto.createHash("md5").update(buf).digest("hex"),
        },
      },
    });
    ok(`Commit ${file}`, commit);
  }

  // Final readback
  const finalLoc = await api("GET", `/v1/appStoreVersionLocalizations/${MAC_LOC}`);
  const shots = await api("GET", `/v1/appScreenshotSets/${setId}/appScreenshots`);
  console.log("\n=== DRAFT READY ===");
  console.log("description length:", (finalLoc.json?.data?.attributes?.description || "").length);
  console.log("keywords:", finalLoc.json?.data?.attributes?.keywords);
  console.log("promo:", finalLoc.json?.data?.attributes?.promotionalText);
  console.log(
    "screenshots:",
    (shots.json?.data || []).map((s) => `${s.attributes?.fileName}:${s.attributes?.assetDeliveryState?.state}`),
  );
  console.log("\nStill needed before Submit:");
  console.log("- Attach a Mac App Store–signed build (not Developer ID DMG)");
  console.log("- Confirm App Privacy nutrition labels in ASC web UI");
  console.log("- Then create review submission when ready");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
