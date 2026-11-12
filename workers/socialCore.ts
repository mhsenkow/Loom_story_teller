// =================================================================
// socialCore — rules for community votes and comments (no login)
// =================================================================
// Pure helpers shared by the SocialHub Durable Object and its HTTP
// routes: input validation, light moderation, link canonicalization and
// hashing. Nothing here touches storage, so it is cheap to test.
//
// Identity: each device sends a random voter token in the POST body.
// The server only ever stores a peppered SHA-256 of it, plus a
// daily-salted hash of the network prefix for per-network caps. No
// accounts, no emails, no raw IPs.
//
// Nothing a client writes is shown to other people except comment text
// and display names, which pass the filters below. Chart links are
// rebuilt here from validated parts, so they cannot carry free text.
// =================================================================

import { recipeKeyFromLinkPayload } from "../src/lib/socialRecipe";

/** Item key: `<source kind>:<recipe hash>` — e.g. `usgs:k3j9x0`. */
const KEY_RE = /^[a-z0-9_]{1,40}:[a-z0-9]{1,16}$/;
const VOTER_RE = /^[A-Za-z0-9_-]{16,64}$/;
const LINK_RE = /^chart=[A-Za-z0-9_-]{8,6000}$/;
const COMMENT_ID_RE = /^c[a-z0-9]{6,24}$/;

export const COMMENT_MIN = 2;
export const COMMENT_MAX = 400;
export const NAME_MAX = 24;
/** Reports from this many different networks hide a comment. */
export const REPORTS_TO_HIDE = 3;

export const LIMITS = {
  /** Votes a device can cast per hour (all charts). */
  votesPerHour: 120,
  /** Votes one network can cast per hour, across all its devices. */
  votesPerHourPerNetwork: 300,
  /** Distinct devices on one network that count toward a single chart per day. */
  votersPerNetworkPerItem: 4,
  /** Charts one network can add to the community per day. */
  newItemsPerDayPerNetwork: 40,
  commentsPer10MinPerDevice: 4,
  commentsPerHourPerNetwork: 12,
  reportsPerHourPerDevice: 20,
  reportsPerHourPerNetwork: 30,
} as const;

export function validKey(v: unknown): v is string {
  return typeof v === "string" && KEY_RE.test(v);
}

export function validVoter(v: unknown): v is string {
  return typeof v === "string" && VOTER_RE.test(v);
}

export function validCommentId(v: unknown): v is string {
  return typeof v === "string" && COMMENT_ID_RE.test(v);
}

export function validVote(v: unknown): v is -1 | 0 | 1 {
  return v === -1 || v === 0 || v === 1;
}

/** Strip control characters and collapse runs of whitespace (keeps a few newlines). */
export function cleanText(raw: string): string {
  const text = raw
    .normalize("NFC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  // A short comment has no use for a tall column of line breaks.
  return text.split("\n").length > 6 ? text.replace(/\s*\n+\s*/g, " ") : text;
}

/** Short, mild blocklist — the report button and rate limits do the rest. */
const BLOCKED = [
  /\bn[i1!]gg(?:a|er)s?\b/i,
  /\bf[a@]gg?(?:ot)?s?\b/i,
  /\bk[i1]ke\b/i,
  /\bsp[i1]c\b/i,
  /\bch[i1]nk\b/i,
  /\btr[a@]nn(?:y|ie)s?\b/i,
  /\bretard(?:ed|s)?\b/i,
  /\bkill\s+yourself\b/i,
  /\bkys\b/i,
];

const TLDS =
  "com|net|org|io|ly|gg|co|xyz|ru|cn|me|app|link|info|biz|top|site|online|shop|store|dev|club|live|pro|vip|win|bet|tv|cc|uk|de|fr|ai|sh|page|click|fun|icu|work|world|today|life|cash|money|news|blog";
/** Anything that reads as a link: schemes, www, name.tld, or name.word/path. */
const LINKISH = new RegExp(
  `(https?:\\/\\/|www\\.|\\b[a-z0-9-]+\\.(?:${TLDS})\\b|\\b[a-z0-9-]+\\.[a-z]{2,}\\/|@[a-z0-9_]{2,}\\.[a-z]{2,})`,
  "i",
);

/** Words that would make a name look official. */
const RESERVED_NAME = /\b(loom|admin|administrator|moderator|mod|staff|official|support|team|system)\b/i;

export type TextCheck = { ok: true; text: string } | { ok: false; error: string };

export function checkComment(raw: unknown): TextCheck {
  if (typeof raw !== "string") return { ok: false, error: "Write a comment first." };
  const text = cleanText(raw);
  if (text.length < COMMENT_MIN) return { ok: false, error: "Write a little more first." };
  if (text.length > COMMENT_MAX) return { ok: false, error: `Keep comments under ${COMMENT_MAX} characters.` };
  if (LINKISH.test(text)) return { ok: false, error: "Links aren’t allowed in comments." };
  if (BLOCKED.some((re) => re.test(text))) return { ok: false, error: "That comment can’t be posted. Try rewording it." };
  if (/(.)\1{11,}/u.test(text)) return { ok: false, error: "That looks like spam. Try rewording it." };
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 24 && letters === letters.toUpperCase()) {
    return { ok: false, error: "Please don’t write in all caps." };
  }
  return { ok: true, text };
}

/** Display names: letters, numbers, spaces and a little punctuation. Empty means "use the default". */
export function checkName(raw: unknown): TextCheck {
  if (raw == null || raw === "") return { ok: true, text: "" };
  if (typeof raw !== "string") return { ok: false, error: "Pick a different name." };
  const text = cleanText(raw).replace(/\s+/g, " ");
  if (text.length > NAME_MAX) return { ok: false, error: `Names can be up to ${NAME_MAX} characters.` };
  if (!/^[\p{L}\p{N} ._'-]*$/u.test(text)) return { ok: false, error: "Names can use letters, numbers, spaces, and . _ ' -" };
  if (LINKISH.test(text) || BLOCKED.some((re) => re.test(text)) || RESERVED_NAME.test(text)) {
    return { ok: false, error: "Pick a different name." };
  }
  return { ok: true, text };
}

/** Source kind from an item key. */
export function kindOfKey(key: string): string {
  return key.slice(0, key.indexOf(":"));
}

// ---- chart links -----------------------------------------------------

const AGGS = new Set(["sum", "mean", "count", "min", "max"]);
const WINDOWS = new Set(["1h", "6h", "24h", "7d", "30d", "90d", "1y"]);
const KIND_ID = /^[A-Za-z][A-Za-z0-9]{1,23}$/;
/** Compact link keys that must name a real column of the feed. */
const FIELD_KEYS = ["x", "y", "c", "s", "z", "r", "y2", "t", "tr", "twf"] as const;

function b64urlJson(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Rebuild a client's `chart=` link from validated parts only: the feed, a chart
 * kind id, column names that exist on that feed, and a few enumerated settings.
 * Titles, subtitles, pins, visual overrides, URLs and anything else are dropped,
 * so the stored link cannot carry text for other people to see. Returns the
 * canonical link and the item key its recipe hashes to, or null when the link
 * is absent, malformed, for another feed, or names an unknown column.
 */
export function canonicalLink(raw: unknown, kind: string, columns: readonly string[]): { link: string; key: string } | null {
  if (typeof raw !== "string" || !LINK_RE.test(raw)) return null;
  let json: Record<string, unknown>;
  try {
    const b64 = raw.slice(6).replace(/-/g, "+").replace(/_/g, "/");
    const parsed: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    json = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  if (json.src !== `stream://${kind}`) return null;
  const c = json.c;
  if (!c || typeof c !== "object" || Array.isArray(c)) return null;
  const src = c as Record<string, unknown>;
  const cols = new Set(columns);
  const out: Record<string, unknown> = {};

  if (typeof src.k !== "string" || !KIND_ID.test(src.k)) return null;
  out.k = src.k;
  for (const f of FIELD_KEYS) {
    const v = src[f];
    if (v == null || v === "") continue;
    if (typeof v !== "string" || !cols.has(v)) return null;
    out[f] = v;
  }
  if (!out.x) return null;
  if (src.a != null) {
    if (typeof src.a !== "string" || !AGGS.has(src.a)) return null;
    out.a = src.a;
  }
  if (src.tw != null && src.tw !== "all") {
    if (typeof src.tw !== "string" || !WINDOWS.has(src.tw)) return null;
    out.tw = src.tw;
  }
  if (src.tn != null) {
    if (typeof src.tn !== "number" || !Number.isInteger(src.tn) || src.tn < 1 || src.tn > 500) return null;
    out.tn = src.tn;
  }
  if (src.sn === "index100" || src.sn === "zscore") out.sn = src.sn;
  if (src.rw === 7 || src.rw === 30) out.rw = src.rw;
  if (src.wm === "compare" || src.wm === "grid") out.wm = src.wm;
  if (src.bm === "rank" || src.bm === "delta") out.bm = src.bm;
  if (src.ys === "log" || src.ys === "symlog") out.ys = src.ys;
  if (src.ah === true) out.ah = true;

  const payload: { v: 1; src: string; bs?: string; c: Record<string, unknown> } = { v: 1, src: `stream://${kind}`, c: out };
  if (json.bs === "stacked" || json.bs === "percent") payload.bs = json.bs;
  const key = recipeKeyFromLinkPayload(kind, payload);
  if (!key) return null;
  return { link: `chart=${b64urlJson(JSON.stringify(payload))}`, key };
}

// ---- hashing ---------------------------------------------------------

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Stored voter id: peppered so the table can't be matched to device tokens. */
export async function hashVoter(voter: string, pepper = ""): Promise<string> {
  return (await sha256Hex(`loom-social-v1|${pepper}|${voter}`)).slice(0, 32);
}

/** One home or office: the whole IPv4 address, or the /64 an IPv6 address sits in. */
export function networkPrefix(ip: string): string {
  if (!ip.includes(":")) return ip;
  const [head = "", tail = ""] = ip.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...left, ...new Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":");
}

/** Network hash that changes every UTC day — enough for daily caps, useless for tracking. */
export async function hashNetwork(ip: string, now = Date.now(), pepper = ""): Promise<string> {
  const day = new Date(now).toISOString().slice(0, 10);
  return (await sha256Hex(`loom-net-v1|${pepper}|${day}|${networkPrefix(ip)}`)).slice(0, 24);
}

/** Friendly default name from a voter hash — "Teal Heron". Same device, same name. */
const ADJ = ["Amber", "Brisk", "Calm", "Coral", "Dusky", "Fern", "Golden", "Hazel", "Indigo", "Jade", "Keen", "Lunar", "Mossy", "Navy", "Olive", "Plum", "Quiet", "Rosy", "Sage", "Teal", "Umber", "Vivid", "Wry", "Zesty"];
const NOUN = ["Badger", "Comet", "Crane", "Dune", "Falcon", "Fjord", "Gecko", "Heron", "Ibis", "Kestrel", "Lynx", "Marten", "Newt", "Orca", "Otter", "Petrel", "Quokka", "Raven", "Stoat", "Tern", "Vole", "Wren", "Yak", "Zebu"];

export function defaultName(voterHash: string): string {
  const n = parseInt(voterHash.slice(0, 8), 16) || 0;
  return `${ADJ[n % ADJ.length]} ${NOUN[Math.floor(n / ADJ.length) % NOUN.length]}`;
}
