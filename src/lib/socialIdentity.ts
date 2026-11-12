// =================================================================
// socialIdentity — a device, not an account
// =================================================================
// Community features need no login. This device keeps a random token so
// its vote counts once (the server stores only a salted hash), an optional
// display name, its own votes (so arrows stay lit offline), and whether
// community content is shown at all. Everything lives in localStorage and
// every access is guarded: private windows simply start fresh.
// =================================================================

const VOTER_KEY = "loom-social-voter";
const NAME_KEY = "loom-social-name";
const VOTES_KEY = "loom-social-votes";
const OFF_KEY = "loom-social-off";
const MAX_VOTES_KEPT = 2000;

export type Vote = -1 | 0 | 1;

function read(key: string): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode / quota — community still works for this visit */
  }
}

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let memoVoter: string | null = null;

/** This device's random community token (created on first use). */
export function socialVoter(): string {
  if (memoVoter) return memoVoter;
  const stored = read(VOTER_KEY);
  memoVoter = stored && /^[A-Za-z0-9_-]{16,64}$/.test(stored) ? stored : randomToken();
  if (memoVoter !== stored) write(VOTER_KEY, memoVoter);
  return memoVoter;
}

/** Start over as a new, unlinked device: new token, no name, no remembered votes. */
export function resetSocialIdentity(): void {
  memoVoter = randomToken();
  write(VOTER_KEY, memoVoter);
  write(NAME_KEY, null);
  write(VOTES_KEY, null);
}

const ADJ = ["Amber", "Brisk", "Calm", "Coral", "Dusky", "Fern", "Golden", "Hazel", "Indigo", "Jade", "Keen", "Lunar", "Mossy", "Navy", "Olive", "Plum", "Quiet", "Rosy", "Sage", "Teal", "Umber", "Vivid", "Wry", "Zesty"];
const NOUN = ["Badger", "Comet", "Crane", "Dune", "Falcon", "Fjord", "Gecko", "Heron", "Ibis", "Kestrel", "Lynx", "Marten", "Newt", "Orca", "Otter", "Petrel", "Quokka", "Raven", "Stoat", "Tern", "Vole", "Wren", "Yak", "Zebu"];

/** Friendly default name for a token — "Teal Heron". */
export function defaultSocialName(token = socialVoter()): string {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) h = Math.imul(h ^ token.charCodeAt(i), 16777619);
  const n = h >>> 0;
  return `${ADJ[n % ADJ.length]} ${NOUN[Math.floor(n / ADJ.length) % NOUN.length]}`;
}

export function readSocialName(): string {
  return (read(NAME_KEY) ?? "").slice(0, 24);
}

export function writeSocialName(name: string): void {
  write(NAME_KEY, name.trim() ? name.trim().slice(0, 24) : null);
}

export function readSocialVotes(): Record<string, Vote> {
  try {
    const raw = JSON.parse(read(VOTES_KEY) ?? "{}") as Record<string, unknown>;
    const out: Record<string, Vote> = {};
    for (const [k, v] of Object.entries(raw)) if (v === 1 || v === -1) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

export function writeSocialVotes(votes: Record<string, Vote>): void {
  const entries = Object.entries(votes).filter(([, v]) => v !== 0);
  write(VOTES_KEY, JSON.stringify(Object.fromEntries(entries.slice(-MAX_VOTES_KEPT))));
}

export function readSocialEnabled(): boolean {
  return read(OFF_KEY) !== "1";
}

export function writeSocialEnabled(on: boolean): void {
  write(OFF_KEY, on ? null : "1");
}
