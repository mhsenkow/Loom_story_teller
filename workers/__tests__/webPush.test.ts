import { describe, expect, it, vi } from "vitest";
import {
  base64UrlDecode,
  base64UrlEncode,
  encryptPayload,
  generateVapidKeys,
  isAllowedPushEndpoint,
  sendWebPush,
  vapidAuthHeader,
  type PushSubscriptionJSON,
  type VapidKeys,
} from "../webPush";

const enc = new TextEncoder();
const dec = new TextDecoder();

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  const key = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource }, key, len * 8));
}

/** User-agent side of RFC 8291 (independent of the module under test). */
async function uaDecrypt(
  body: Uint8Array,
  uaPrivate: CryptoKey,
  uaPublicRaw: Uint8Array<ArrayBuffer>,
  authSecret: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array> {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0, false);
  expect(rs).toBe(4096);
  const idlen = body[20];
  expect(idlen).toBe(65);
  const asPublic = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, uaPrivate, 256));
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublicRaw, asPublic);
  const ikm = await hkdf(authSecret, ecdh, keyInfo, 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aes, ciphertext));
  // Strip padding: last non-zero byte must be the 0x02 last-record delimiter.
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  expect(padded[end]).toBe(0x02);
  return padded.slice(0, end);
}

async function makeUa() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const pub = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const sub: PushSubscriptionJSON = {
    endpoint: "https://updates.push.services.mozilla.com/wpush/v2/abc",
    keys: { p256dh: base64UrlEncode(pub), auth: base64UrlEncode(auth) },
  };
  return { pair, pub, auth, sub };
}

/** Import a P-256 ECDH private key from raw d + uncompressed public point. */
async function importEcdhPrivate(d: string, publicRaw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      d,
      x: base64UrlEncode(publicRaw.slice(1, 33)),
      y: base64UrlEncode(publicRaw.slice(33, 65)),
    },
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
}

describe("encryptPayload", () => {
  it("round-trips through an independent RFC 8291 decryptor", async () => {
    const ua = await makeUa();
    const msg = enc.encode(JSON.stringify({ title: "Quake", body: "M5.2 near the coast", url: "/?monitor=c1" }));
    const body = await encryptPayload(ua.sub, msg);
    expect(body.length).toBe(16 + 4 + 1 + 65 + msg.length + 1 + 16);
    const out = await uaDecrypt(body, ua.pair.privateKey, ua.pub, ua.auth);
    expect(dec.decode(out)).toBe(dec.decode(msg));
  });

  it("uses a fresh salt and sender key per message", async () => {
    const ua = await makeUa();
    const a = await encryptPayload(ua.sub, enc.encode("hi"));
    const b = await encryptPayload(ua.sub, enc.encode("hi"));
    expect(base64UrlEncode(a.slice(0, 16))).not.toBe(base64UrlEncode(b.slice(0, 16)));
    expect(base64UrlEncode(a.slice(21, 86))).not.toBe(base64UrlEncode(b.slice(21, 86)));
  });

  it("rejects payloads over 3800 bytes and malformed keys", async () => {
    const ua = await makeUa();
    await expect(encryptPayload(ua.sub, new Uint8Array(3801))).rejects.toThrow(/limit/);
    await expect(
      encryptPayload({ ...ua.sub, keys: { ...ua.sub.keys, p256dh: "AAAA" } }, enc.encode("x")),
    ).rejects.toThrow(/p256dh/);
    await expect(
      encryptPayload({ ...ua.sub, keys: { ...ua.sub.keys, auth: "AAAA" } }, enc.encode("x")),
    ).rejects.toThrow(/auth/);
  });

  describe("RFC 8291 Appendix A test vector", () => {
    const plaintext = "When I grow up, I want to be a watermelon";
    const asPrivate = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw";
    const asPublic = "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
    const uaPrivate = "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94";
    const uaPublic = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
    const salt = "DGv6ra1nlYgDCS1FRnbzlw";
    const authSecret = "BTBZMqHH6r4Tts7J_aSIgg";
    const expected =
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN";

    const sub: PushSubscriptionJSON = {
      endpoint: "https://push.example.net/push/JzLQ3raZJfFBR0aqvOMsLrt54w4rJUsV",
      keys: { p256dh: uaPublic, auth: authSecret },
    };

    it("produces the exact RFC body with the fixed salt and sender key", async () => {
      const asPublicRaw = base64UrlDecode(asPublic);
      const asPair: CryptoKeyPair = {
        privateKey: await importEcdhPrivate(asPrivate, asPublicRaw),
        publicKey: await crypto.subtle.importKey("raw", asPublicRaw, { name: "ECDH", namedCurve: "P-256" }, true, []),
      };
      const body = await encryptPayload(sub, enc.encode(plaintext), { salt: base64UrlDecode(salt), asKeyPair: asPair });
      expect(base64UrlEncode(body)).toBe(expected);
    });

    it("the RFC body decrypts with the RFC user-agent key", async () => {
      const uaPublicRaw = base64UrlDecode(uaPublic);
      const uaKey = await importEcdhPrivate(uaPrivate, uaPublicRaw);
      const out = await uaDecrypt(base64UrlDecode(expected), uaKey, uaPublicRaw, base64UrlDecode(authSecret));
      expect(dec.decode(out)).toBe(plaintext);
    });
  });
});

describe("vapidAuthHeader", () => {
  it("emits a verifiable ES256 JWT with aud/exp/sub", async () => {
    const generated = await generateVapidKeys();
    expect(base64UrlDecode(generated.publicKey)).toHaveLength(65);
    const keys: VapidKeys = { ...generated, subject: "mailto:ops@example.com" };
    const now = 1_760_000_000;
    const header = await vapidAuthHeader("https://fcm.googleapis.com/fcm/send/xyz?x=1", keys, now);

    const m = /^vapid t=([^,]+), k=(.+)$/.exec(header);
    expect(m).not.toBeNull();
    const [, jwt, k] = m!;
    expect(k).toBe(keys.publicKey);

    const [h, p, s] = jwt.split(".");
    expect(JSON.parse(dec.decode(base64UrlDecode(h)))).toEqual({ typ: "JWT", alg: "ES256" });
    const claims = JSON.parse(dec.decode(base64UrlDecode(p)));
    expect(claims).toEqual({ aud: "https://fcm.googleapis.com", exp: now + 12 * 3600, sub: "mailto:ops@example.com" });

    const sig = base64UrlDecode(s);
    expect(sig).toHaveLength(64);
    const pub = await crypto.subtle.importKey(
      "raw",
      base64UrlDecode(keys.publicKey),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, sig, enc.encode(`${h}.${p}`));
    expect(ok).toBe(true);
  });

  it("rejects a bad subject", async () => {
    const generated = await generateVapidKeys();
    await expect(
      vapidAuthHeader("https://fcm.googleapis.com/x", { ...generated, subject: "ops@example.com" }),
    ).rejects.toThrow(/subject/);
  });
});

describe("sendWebPush", () => {
  async function setup() {
    const ua = await makeUa();
    const keys: VapidKeys = { ...(await generateVapidKeys()), subject: "https://loom.example" };
    return { ua, keys };
  }

  it("POSTs an encrypted body with the Web Push headers", async () => {
    const { ua, keys } = await setup();
    const fetchImpl = vi.fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(null, { status: 201 }));
    const data = { title: "Alert", n: 3 };
    const res = await sendWebPush(ua.sub, data, keys, { ttl: 600, urgency: "high", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(res).toEqual({ ok: true, status: 201, gone: false });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(ua.sub.endpoint);
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("TTL")).toBe("600");
    expect(headers.get("Urgency")).toBe("high");
    expect(headers.get("Content-Encoding")).toBe("aes128gcm");
    expect(headers.get("Content-Type")).toBe("application/octet-stream");
    expect(headers.get("Authorization")).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);

    const body = new Uint8Array(init?.body as Uint8Array);
    const plain = await uaDecrypt(body, ua.pair.privateKey, ua.pub, ua.auth);
    expect(JSON.parse(dec.decode(plain))).toEqual(data);
  });

  it("defaults TTL/urgency and reports gone on 410 and 404", async () => {
    const { ua, keys } = await setup();
    for (const status of [410, 404]) {
      const fetchImpl = vi.fn(async () => new Response("expired", { status }));
      const res = await sendWebPush(ua.sub, "x", keys, { fetchImpl: fetchImpl as unknown as typeof fetch });
      expect(res).toEqual({ ok: false, status, gone: true });
      const headers = new Headers((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].headers);
      expect(headers.get("TTL")).toBe("86400");
      expect(headers.get("Urgency")).toBe("normal");
    }
    const fetch429 = vi.fn(async () => new Response(null, { status: 429 }));
    expect(await sendWebPush(ua.sub, "x", keys, { fetchImpl: fetch429 as unknown as typeof fetch })).toEqual({
      ok: false,
      status: 429,
      gone: false,
    });
  });

  it("refuses disallowed endpoints and oversize payloads without fetching", async () => {
    const { ua, keys } = await setup();
    const fetchImpl = vi.fn(async () => new Response(null, { status: 201 }));
    const f = fetchImpl as unknown as typeof fetch;
    await expect(
      sendWebPush({ ...ua.sub, endpoint: "https://169.254.169.254/latest" }, {}, keys, { fetchImpl: f }),
    ).rejects.toThrow(/allowed/);
    await expect(sendWebPush(ua.sub, "x".repeat(4000), keys, { fetchImpl: f })).rejects.toThrow(/limit/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("isAllowedPushEndpoint", () => {
  it.each([
    "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
    "https://fcm.googleapis.com/fcm/send/abc:def",
    "https://wns2-by3p.notify.windows.com/w/?token=x",
    "https://web.push.apple.com/QK2x",
    "https://api.push.apple.com/3/device/abc",
    "https://FCM.googleapis.com:443/fcm/send/x",
  ])("allows %s", (url) => {
    expect(isAllowedPushEndpoint(url)).toBe(true);
  });

  it.each([
    "http://fcm.googleapis.com/fcm/send/x",
    "https://fcm.googleapis.com:8443/fcm/send/x",
    "https://user:pw@fcm.googleapis.com/fcm/send/x",
    "https://evil.com/fcm.googleapis.com",
    "https://fcm.googleapis.com.evil.com/x",
    "https://evilpush.apple.com/x",
    "https://push.apple.com/x",
    "https://notify.windows.com/x",
    "https://localhost/x",
    "https://127.0.0.1/x",
    "https://169.254.169.254/latest/meta-data",
    "not a url",
    "",
  ])("rejects %s", (url) => {
    expect(isAllowedPushEndpoint(url)).toBe(false);
  });
});
