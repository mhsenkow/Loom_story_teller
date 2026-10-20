/**
 * Standards Web Push from a Cloudflare Worker using only WebCrypto.
 *
 * - VAPID (RFC 8292): ES256 JWT in `Authorization: vapid t=<jwt>, k=<publicKey>`.
 * - Message encryption (RFC 8291) with the `aes128gcm` content coding (RFC 8188):
 *   a single record, rs = 4096, padding delimiter 0x02.
 *
 * No npm dependencies; runs on Workers and Node 20+ (globalThis.crypto.subtle).
 */

export interface PushSubscriptionJSON {
  endpoint: string;
  /** base64url-encoded user-agent keys from `PushSubscription.toJSON()`. */
  keys: { p256dh: string; auth: string };
}

export interface VapidKeys {
  /** base64url uncompressed P-256 point (65 bytes, leading 0x04). */
  publicKey: string;
  /** EC P-256 private JWK with d, x, y. */
  privateJwk: JsonWebKey;
  /** "mailto:..." or an https URL identifying the sender. */
  subject: string;
}

export type PushUrgency = "very-low" | "low" | "normal" | "high";

/** Largest JSON payload (UTF-8 bytes) accepted before encryption. */
export const MAX_PAYLOAD_BYTES = 3800;
/** Record size advertised in the aes128gcm header. */
export const RECORD_SIZE = 4096;
/** VAPID JWT lifetime (RFC 8292 caps it at 24h). */
export const VAPID_JWT_TTL_SECS = 12 * 60 * 60;

const enc = new TextEncoder();

// ---------- byte helpers ----------

/** Copy into a fresh ArrayBuffer-backed array (keeps WebCrypto BufferSource typing happy). */
function bytes(src: ArrayLike<number> | ArrayBuffer): Uint8Array<ArrayBuffer> {
  const view = src instanceof ArrayBuffer ? new Uint8Array(src) : src;
  const out = new Uint8Array(view.length);
  out.set(view);
  return out;
}

function concat(...parts: ArrayLike<number>[]): Uint8Array<ArrayBuffer> {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function base64UrlEncode(data: ArrayLike<number> | ArrayBuffer): string {
  const u8 = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  let bin = "";
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- crypto helpers ----------

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

/** Strip fields that would conflict with the usage we import a JWK for. */
function cleanJwk(jwk: JsonWebKey, withPrivate: boolean): JsonWebKey {
  const out: JsonWebKey = { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y };
  if (withPrivate) out.d = jwk.d;
  return out;
}

function assertP256Point(raw: Uint8Array, what: string): void {
  if (raw.length !== 65 || raw[0] !== 0x04) {
    throw new Error(`${what} must be a 65-byte uncompressed P-256 point`);
  }
}

// ---------- VAPID ----------

/** Generate a VAPID key pair (store privateJwk as a Worker secret; ship publicKey to clients). */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateJwk: JsonWebKey }> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const raw = (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  return { publicKey: base64UrlEncode(raw), privateJwk: cleanJwk(jwk, true) };
}

/** `Authorization` header value: `vapid t=<ES256 JWT>, k=<publicKey>`. */
export async function vapidAuthHeader(
  endpoint: string,
  keys: VapidKeys,
  nowSecs: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  if (!keys.privateJwk?.d) throw new Error("VAPID private JWK is missing d");
  if (!/^(mailto:|https:\/\/)/i.test(keys.subject)) {
    throw new Error("VAPID subject must be a mailto: or https: URL");
  }
  const aud = new URL(endpoint).origin;
  const header = { typ: "JWT", alg: "ES256" };
  const claims = { aud, exp: Math.floor(nowSecs) + VAPID_JWT_TTL_SECS, sub: keys.subject };
  const signingInput =
    base64UrlEncode(enc.encode(JSON.stringify(header))) +
    "." +
    base64UrlEncode(enc.encode(JSON.stringify(claims)));
  const key = await crypto.subtle.importKey(
    "jwk",
    cleanJwk(keys.privateJwk, true),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  // WebCrypto returns the raw r||s (64 bytes) form, which is exactly what JWS ES256 wants.
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(signingInput));
  return `vapid t=${signingInput}.${base64UrlEncode(sig)}, k=${keys.publicKey}`;
}

// ---------- RFC 8291 encryption ----------

/**
 * Encrypt `payload` for `sub` (RFC 8291, aes128gcm single record).
 * Output: salt(16) || rs(uint32 BE) || idlen(1)=65 || as_public(65) || ciphertext.
 * `opts.salt` / `opts.asKeyPair` exist for deterministic tests (RFC 8291 Appendix A).
 */
export async function encryptPayload(
  sub: PushSubscriptionJSON,
  payload: Uint8Array,
  opts: { salt?: Uint8Array; asKeyPair?: CryptoKeyPair } = {},
): Promise<Uint8Array> {
  if (payload.length > MAX_PAYLOAD_BYTES) {
    throw new Error(`Push payload is ${payload.length} bytes; limit is ${MAX_PAYLOAD_BYTES}`);
  }
  const uaPublic = base64UrlDecode(sub.keys.p256dh);
  assertP256Point(uaPublic, "Subscription p256dh");
  const authSecret = base64UrlDecode(sub.keys.auth);
  if (authSecret.length !== 16) throw new Error("Subscription auth secret must be 16 bytes");

  const salt = opts.salt ? bytes(opts.salt) : crypto.getRandomValues(new Uint8Array(16));
  if (salt.length !== 16) throw new Error("Salt must be 16 bytes");

  const asPair =
    opts.asKeyPair ??
    ((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, [
      "deriveBits",
    ])) as CryptoKeyPair);
  const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", asPair.publicKey)) as ArrayBuffer);

  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    // workers-types names the ECDH peer key `$public`; the runtime (and DOM lib) use `public`.
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, asPair.privateKey, 256),
  );

  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const plaintext = concat(payload, [0x02]); // last (and only) record delimiter
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aesKey, plaintext),
  );

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, RECORD_SIZE, false);
  return concat(salt, rs, [asPublic.length], asPublic, ciphertext);
}

// ---------- endpoint guard ----------

const EXACT_HOSTS = new Set(["fcm.googleapis.com", "web.push.apple.com"]);
const SUFFIX_HOSTS = [".push.services.mozilla.com", ".notify.windows.com", ".push.apple.com"];

/** SSRF guard: https only, default port, no credentials, known push services only. */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== "443") return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (EXACT_HOSTS.has(host)) return true;
  return SUFFIX_HOSTS.some((suffix) => host.endsWith(suffix) && host.length > suffix.length);
}

// ---------- send ----------

/**
 * Encrypt `data` (JSON) and POST it to the subscription's push service.
 * `gone` is true on 404/410 — the subscription expired and should be deleted.
 * Throws for a disallowed endpoint, an oversize payload, or malformed keys.
 */
export async function sendWebPush(
  sub: PushSubscriptionJSON,
  data: unknown,
  keys: VapidKeys,
  opts: { ttl?: number; urgency?: PushUrgency; fetchImpl?: typeof fetch } = {},
): Promise<{ ok: boolean; status: number; gone: boolean }> {
  if (!isAllowedPushEndpoint(sub.endpoint)) {
    throw new Error("Push endpoint is not an allowed push service");
  }
  const payload = enc.encode(JSON.stringify(data) ?? "null");
  if (payload.length > MAX_PAYLOAD_BYTES) {
    throw new Error(`Push payload is ${payload.length} bytes; limit is ${MAX_PAYLOAD_BYTES}`);
  }
  const body = await encryptPayload(sub, payload);
  const ttl = Math.max(0, Math.floor(opts.ttl ?? 24 * 60 * 60));
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(sub.endpoint, {
    method: "POST",
    headers: {
      TTL: String(ttl),
      Urgency: opts.urgency ?? "normal",
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      Authorization: await vapidAuthHeader(sub.endpoint, keys),
    },
    body: bytes(body),
    redirect: "manual",
    // One slow push service must not stall the whole cron run.
    signal: AbortSignal.timeout(8000),
  });
  // Drain/cancel so the connection is released in Workers.
  try {
    await res.body?.cancel();
  } catch {
    /* ignore */
  }
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
}
