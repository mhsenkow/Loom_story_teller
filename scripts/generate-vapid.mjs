#!/usr/bin/env node
// Generate VAPID keys for always-on monitor browser push (workers/webPush.ts).
// Prints the wrangler commands to store them as Worker secrets; nothing is written to disk.
//   node scripts/generate-vapid.mjs
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const priv = JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d });
console.log("Run these from the repo root (each prompts for the value):\n");
console.log("  npx wrangler secret put VAPID_PUBLIC_KEY");
console.log(`    → ${b64url(raw)}\n`);
console.log("  npx wrangler secret put VAPID_PRIVATE_JWK");
console.log(`    → ${priv}\n`);
console.log("  npx wrangler secret put VAPID_SUBJECT");
console.log("    → mailto:you@example.com   (or https://loom.ibm.io)\n");
console.log("Keep the private JWK secret. Rotating keys invalidates existing browser subscriptions.");
