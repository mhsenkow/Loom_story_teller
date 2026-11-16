#!/usr/bin/env node
// =================================================================
// Upload App Store screenshots (incl. 06) + app preview videos
// =================================================================
// iOS: APP_IPHONE_67 + APP_IPAD_PRO_3GEN_129 screenshots & previews
// Mac: APP_DESKTOP screenshots + DESKTOP preview
// Requires versions in PREPARE_FOR_SUBMISSION / DEVELOPER_REJECTED.
// =================================================================

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

const IOS_LOC = "66c0bd99-1223-4fb7-8ae6-3aac279ff4d7";
const MAC_LOC = "6e80eeef-5a9c-4766-89b5-47620e4cc301";

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
  if (!fine) console.log(JSON.stringify(r.json, null, 2).slice(0, 1200));
  return fine;
}

async function ensureScreenshotSet(locId, displayType) {
  const existing = await api("GET", `/v1/appStoreVersionLocalizations/${locId}/appScreenshotSets`);
  const found = (existing.json?.data || []).find(
    (s) => s.attributes?.screenshotDisplayType === displayType,
  );
  if (found) return found.id;
  const created = await api("POST", `/v1/appScreenshotSets`, {
    data: {
      type: "appScreenshotSets",
      attributes: { screenshotDisplayType: displayType },
      relationships: {
        appStoreVersionLocalization: {
          data: { type: "appStoreVersionLocalizations", id: locId },
        },
      },
    },
  });
  ok(`Create screenshot set ${displayType}`, created);
  return created.json?.data?.id;
}

async function ensurePreviewSet(locId, previewType) {
  const existing = await api("GET", `/v1/appStoreVersionLocalizations/${locId}/appPreviewSets`);
  const found = (existing.json?.data || []).find((s) => s.attributes?.previewType === previewType);
  if (found) return found.id;
  const created = await api("POST", `/v1/appPreviewSets`, {
    data: {
      type: "appPreviewSets",
      attributes: { previewType },
      relationships: {
        appStoreVersionLocalization: {
          data: { type: "appStoreVersionLocalizations", id: locId },
        },
      },
    },
  });
  ok(`Create preview set ${previewType}`, created);
  return created.json?.data?.id;
}

async function existingNames(setId, kind) {
  // kind: appScreenshots | appPreviews
  const r = await api("GET", `/v1/${kind === "shot" ? "appScreenshotSets" : "appPreviewSets"}/${setId}/${kind === "shot" ? "appScreenshots" : "appPreviews"}`);
  const map = new Map();
  for (const x of r.json?.data || []) {
    map.set(x.attributes?.fileName, x);
  }
  return map;
}

async function uploadAsset({ setId, filePath, kind }) {
  const fileName = path.basename(filePath);
  const buf = fs.readFileSync(filePath);
  const type = kind === "shot" ? "appScreenshots" : "appPreviews";
  const rel = kind === "shot" ? "appScreenshotSet" : "appPreviewSet";
  const relType = kind === "shot" ? "appScreenshotSets" : "appPreviewSets";

  const reserve = await api("POST", `/v1/${type}`, {
    data: {
      type,
      attributes: { fileName, fileSize: buf.length },
      relationships: { [rel]: { data: { type: relType, id: setId } } },
    },
  });
  if (!ok(`Reserve ${fileName}`, reserve)) return null;
  const id = reserve.json.data.id;
  for (const op of reserve.json.data.attributes.uploadOperations || []) {
    const chunk = buf.subarray(op.offset, op.offset + op.length);
    const headers = Object.fromEntries((op.requestHeaders || []).map((h) => [h.name, h.value]));
    const up = await upload(op.url, op.method, headers, chunk);
    console.log(`  chunk ${op.offset}+${op.length} → ${up.status}`);
  }
  const commit = await api("PATCH", `/v1/${type}/${id}`, {
    data: {
      type,
      id,
      attributes: {
        uploaded: true,
        sourceFileChecksum: crypto.createHash("md5").update(buf).digest("hex"),
      },
    },
  });
  ok(`Commit ${fileName}`, commit);
  return id;
}

async function deleteAllShots(setId) {
  const have = await existingNames(setId, "shot");
  for (const [file, row] of have) {
    const del = await api("DELETE", `/v1/appScreenshots/${row.id}`);
    console.log(`deleted shot ${file} → ${del.status}`);
  }
}

async function uploadMissingShots(setId, dir, files, { replace = false } = {}) {
  if (replace) await deleteAllShots(setId);
  const have = await existingNames(setId, "shot");
  for (const file of files) {
    if (!replace && have.has(file) && have.get(file).attributes?.assetDeliveryState?.state === "COMPLETE") {
      console.log(`skip shot ${file} (COMPLETE)`);
      continue;
    }
    await uploadAsset({ setId, filePath: path.join(dir, file), kind: "shot" });
  }
}

async function uploadPreview(setId, filePath) {
  const have = await existingNames(setId, "preview");
  const file = path.basename(filePath);
  const existing = have.get(file);
  if (existing?.attributes?.assetDeliveryState?.state === "COMPLETE") {
    console.log(`skip preview ${file} (COMPLETE)`);
    return;
  }
  // Replace failed previews
  if (existing) {
    await api("DELETE", `/v1/appPreviews/${existing.id}`);
    console.log(`deleted old preview ${file}`);
  }
  await uploadAsset({ setId, filePath, kind: "preview" });
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const replaceIos = args.has("--replace-ios");
  const iosOnly = args.has("--ios-only") || replaceIos;
  const replacePreviews = args.has("--replace-previews") || replaceIos;

  // iPhone screenshots + preview
  const iphoneSet = await ensureScreenshotSet(IOS_LOC, "APP_IPHONE_67");
  await uploadMissingShots(
    iphoneSet,
    path.join(ROOT, "ios/store/screenshots/iphone67"),
    ["01-chart.png", "02-dive.png", "03-explorer.png", "04-query.png", "05-map.png", "06-phone.png"],
    { replace: replaceIos },
  );
  const iphonePrev = await ensurePreviewSet(IOS_LOC, "IPHONE_67");
  if (replacePreviews) {
    const have = await existingNames(iphonePrev, "preview");
    for (const [file, row] of have) {
      await api("DELETE", `/v1/appPreviews/${row.id}`);
      console.log(`deleted preview ${file}`);
    }
  }
  await uploadPreview(iphonePrev, path.join(ROOT, "ios/store/preview-iphone67.mp4"));

  // iPad
  const ipadSet = await ensureScreenshotSet(IOS_LOC, "APP_IPAD_PRO_3GEN_129");
  await uploadMissingShots(
    ipadSet,
    path.join(ROOT, "ios/store/screenshots/ipad13"),
    ["01-chart.png", "02-dive.png", "03-explorer.png", "04-query.png", "05-map.png", "06-phone.png"],
    { replace: replaceIos },
  );
  const ipadPrev = await ensurePreviewSet(IOS_LOC, "IPAD_PRO_3GEN_129");
  if (replacePreviews) {
    const have = await existingNames(ipadPrev, "preview");
    for (const [file, row] of have) {
      await api("DELETE", `/v1/appPreviews/${row.id}`);
      console.log(`deleted preview ${file}`);
    }
  }
  await uploadPreview(ipadPrev, path.join(ROOT, "ios/store/preview-ipad13.mp4"));

  if (!iosOnly) {
    // Mac
    const macSet = await ensureScreenshotSet(MAC_LOC, "APP_DESKTOP");
    await uploadMissingShots(
      macSet,
      path.join(ROOT, "macos/store/screenshots/mac16x10"),
      ["01-chart.png", "02-dive.png", "03-explorer.png", "04-query.png", "05-map.png"],
    );
    const macPrev = await ensurePreviewSet(MAC_LOC, "DESKTOP");
    await uploadPreview(macPrev, path.join(ROOT, "macos/store/preview-mac.mp4"));
  }

  console.log("\nMedia upload pass complete. Poll ASC for COMPLETE states before resubmit.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
