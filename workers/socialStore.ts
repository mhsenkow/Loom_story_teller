// =================================================================
// socialStore — votes, comments and reports in SQLite
// =================================================================
// Runs inside the SocialHub Durable Object (ctx.storage.sql) and in tests
// over node:sqlite through the same tiny `SqlLike` interface. Every public
// method is synchronous, so each call is one atomic step inside the DO.
// Callers pass hashes (socialService), never raw tokens or addresses.
// This layer enforces counts, one vote per device, per-network caps and
// report-to-hide. Items carry no client text: only a canonical chart link.
// =================================================================

import { LIMITS, REPORTS_TO_HIDE, defaultName, kindOfKey } from "./socialCore";

export interface SqlCursorLike<T> {
  toArray(): T[];
}
export interface SqlLike {
  exec<T = Record<string, unknown>>(query: string, ...bindings: unknown[]): SqlCursorLike<T>;
}

export interface SocialItem {
  key: string;
  kind: string;
  link: string | null;
  up: number;
  down: number;
  comments: number;
  active: number;
}

export interface SocialComment {
  id: string;
  key: string;
  name: string;
  body: string;
  at: number;
  own?: boolean;
  /** The chart's canonical link, so a reader can open or describe it. */
  link?: string | null;
}

export interface SocialSummary {
  generatedAt: number;
  /** Compact counts for every item with activity: key → [up, down, comments]. */
  counts: Record<string, [number, number, number]>;
  /** Latest visible comment per item (for card snippets). */
  latest: Record<string, { name: string; body: string; at: number }>;
  favorites: SocialItem[];
  leastLiked: SocialItem[];
  discussed: SocialItem[];
  recent: SocialComment[];
}

export type SocialResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

/** A link already rebuilt by socialCore.canonicalLink for this exact key, or null. */
export interface ItemMeta {
  link: string | null;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ITEM_COLS = `key, kind, link, up, down, comments, active`;

/** Lower bound of the Wilson interval (80%): rewards many positive votes over a lucky few. */
export function wilsonLower(up: number, down: number, z = 1.28): number {
  const n = up + down;
  if (!n) return 0;
  const p = up / n;
  return (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
}

export class SocialStore {
  private prunedAt = 0;

  constructor(private readonly sql: SqlLike) {
    sql.exec(`CREATE TABLE IF NOT EXISTS items (
      key TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', link TEXT,
      up INTEGER NOT NULL DEFAULT 0, down INTEGER NOT NULL DEFAULT 0, comments INTEGER NOT NULL DEFAULT 0,
      created INTEGER NOT NULL, active INTEGER NOT NULL)`);
    sql.exec(`CREATE INDEX IF NOT EXISTS items_active ON items (active)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS votes (
      key TEXT NOT NULL, voter TEXT NOT NULL, net TEXT NOT NULL, value INTEGER NOT NULL, at INTEGER NOT NULL,
      PRIMARY KEY (key, voter))`);
    sql.exec(`CREATE INDEX IF NOT EXISTS votes_net ON votes (key, net, at)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY, key TEXT NOT NULL, voter TEXT NOT NULL, net TEXT NOT NULL, name TEXT NOT NULL,
      body TEXT NOT NULL, at INTEGER NOT NULL, reports INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0)`);
    sql.exec(`CREATE INDEX IF NOT EXISTS comments_key ON comments (key, hidden, at)`);
    sql.exec(`CREATE INDEX IF NOT EXISTS comments_at ON comments (hidden, at)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS reports (
      comment TEXT NOT NULL, voter TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (comment, voter))`);
    // Added after the first release: which network a report came from.
    try {
      sql.exec(`ALTER TABLE reports ADD COLUMN net TEXT NOT NULL DEFAULT ''`);
    } catch {
      /* column already exists */
    }
    sql.exec(`CREATE TABLE IF NOT EXISTS events (
      voter TEXT NOT NULL, net TEXT NOT NULL, kind TEXT NOT NULL, at INTEGER NOT NULL)`);
    sql.exec(`CREATE INDEX IF NOT EXISTS events_voter ON events (voter, kind, at)`);
    sql.exec(`CREATE INDEX IF NOT EXISTS events_net ON events (net, kind, at)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
  }

  /**
   * The secret mixed into every hash. Created once (from `seed` when given,
   * else random) and then fixed for good, so a later config change can never
   * reset who voted for what.
   */
  pepper(seed?: string): string {
    const row = this.sql.exec<{ v: string }>(`SELECT v FROM meta WHERE k = 'pepper'`).toArray()[0];
    if (row?.v) return row.v;
    let value = seed?.trim() ?? "";
    if (!value) {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      value = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    this.sql.exec(`INSERT INTO meta (k, v) VALUES ('pepper', ?)`, value);
    return value;
  }

  // ---- reads ---------------------------------------------------------

  item(key: string): SocialItem | null {
    return this.sql.exec<SocialItem>(`SELECT ${ITEM_COLS} FROM items WHERE key = ?`, key).toArray()[0] ?? null;
  }

  myVote(key: string, voter: string): -1 | 0 | 1 {
    const row = this.sql.exec<{ value: number }>(`SELECT value FROM votes WHERE key = ? AND voter = ?`, key, voter).toArray()[0];
    return (row?.value ?? 0) as -1 | 0 | 1;
  }

  thread(key: string, voter: string | null, limit = 60): { item: SocialItem | null; comments: SocialComment[]; myVote: -1 | 0 | 1 } {
    const rows = this.sql
      .exec<SocialComment & { voter: string }>(
        `SELECT id, key, name, body, at, voter FROM comments WHERE key = ? AND hidden = 0 ORDER BY at DESC LIMIT ?`,
        key,
        limit,
      )
      .toArray();
    return {
      item: this.item(key),
      comments: rows.map(({ voter: v, ...c }) => ({ ...c, own: voter != null && v === voter })),
      myVote: voter ? this.myVote(key, voter) : 0,
    };
  }

  summary(now = Date.now()): SocialSummary {
    const counts: SocialSummary["counts"] = {};
    for (const r of this.sql
      .exec<{ key: string; up: number; down: number; comments: number }>(
        `SELECT key, up, down, comments FROM items WHERE up + down + comments > 0 ORDER BY active DESC LIMIT 4000`,
      )
      .toArray()) {
      counts[r.key] = [r.up, r.down, r.comments];
    }
    const latest: SocialSummary["latest"] = {};
    // SQLite returns the row holding MAX(at) for bare columns in an aggregate.
    for (const r of this.sql
      .exec<{ key: string; name: string; body: string; at: number }>(
        `SELECT key, name, body, MAX(at) AS at FROM comments WHERE hidden = 0 GROUP BY key ORDER BY at DESC LIMIT 600`,
      )
      .toArray()) {
      latest[r.key] = { name: r.name, body: r.body.slice(0, 160), at: r.at };
    }
    const favorites = this.sql
      .exec<SocialItem>(`SELECT ${ITEM_COLS} FROM items WHERE up > down ORDER BY up - down DESC, active DESC LIMIT 60`)
      .toArray()
      .sort((a, b) => wilsonLower(b.up, b.down) - wilsonLower(a.up, a.down) || b.up - a.up)
      .slice(0, 16);
    const leastLiked = this.sql
      .exec<SocialItem>(`SELECT ${ITEM_COLS} FROM items WHERE down > up ORDER BY down - up DESC, active DESC LIMIT 16`)
      .toArray();
    const discussed = this.sql
      .exec<SocialItem>(`SELECT ${ITEM_COLS} FROM items WHERE comments > 0 ORDER BY comments DESC, active DESC LIMIT 16`)
      .toArray();
    const recent = this.sql
      .exec<SocialComment>(
        `SELECT c.id, c.key, c.name, c.body, c.at, i.link FROM comments c JOIN items i ON i.key = c.key
         WHERE c.hidden = 0 AND c.at > ? ORDER BY c.at DESC LIMIT 24`,
        now - 14 * DAY,
      )
      .toArray()
      .map((c) => ({ ...c, body: c.body.slice(0, 200) }));
    return { generatedAt: now, counts, latest, favorites, leastLiked, discussed, recent };
  }

  // ---- writes --------------------------------------------------------

  /** `nets` are this network's hashes for today and yesterday (today first), so caps hold across midnight. */
  vote(key: string, voter: string, nets: readonly string[], value: -1 | 0 | 1, meta: ItemMeta, now = Date.now()): SocialResult<{ item: SocialItem; myVote: -1 | 0 | 1 }> {
    const net = nets[0] ?? "";
    const prev = this.myVote(key, voter);
    const existing = this.item(key);
    if (prev === value) {
      // Nothing to change — and never create an entry just by asking.
      return { ok: true, value: { item: existing ?? this.blank(key, now), myVote: prev } };
    }
    if (this.count("voter", voter, "vote", now - HOUR) >= LIMITS.votesPerHour || this.count("net", net, "vote", now - HOUR) >= LIMITS.votesPerHourPerNetwork) {
      return { ok: false, status: 429, error: "You’re voting very fast — take a breather and try again soon." };
    }
    if (prev === 0) {
      const marks = nets.map(() => "?").join(", ");
      const sameNet = this.sql
        .exec<{ n: number }>(`SELECT COUNT(*) AS n FROM votes WHERE key = ? AND net IN (${marks}) AND voter != ? AND at > ?`, key, ...nets, voter, now - DAY)
        .toArray()[0]?.n ?? 0;
      if (sameNet >= LIMITS.votersPerNetworkPerItem) {
        return { ok: false, status: 429, error: "Lots of votes on this chart from your network today — yours wasn’t counted." };
      }
    }
    const made = this.ensureItem(key, existing, meta, voter, net, now);
    if (!made.ok) return made;
    const up = (value === 1 ? 1 : 0) - (prev === 1 ? 1 : 0);
    const down = (value === -1 ? 1 : 0) - (prev === -1 ? 1 : 0);
    this.sql.exec(`UPDATE items SET up = MAX(0, up + ?), down = MAX(0, down + ?), active = ? WHERE key = ?`, up, down, now, key);
    if (value === 0) this.sql.exec(`DELETE FROM votes WHERE key = ? AND voter = ?`, key, voter);
    else
      this.sql.exec(
        `INSERT INTO votes (key, voter, net, value, at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (key, voter) DO UPDATE SET value = excluded.value, net = excluded.net, at = excluded.at`,
        key,
        voter,
        net,
        value,
        now,
      );
    this.event(voter, net, "vote", now);
    return { ok: true, value: { item: this.item(key)!, myVote: value } };
  }

  comment(key: string, voter: string, nets: readonly string[], name: string, body: string, meta: ItemMeta, now = Date.now()): SocialResult<SocialComment> {
    const net = nets[0] ?? "";
    if (this.count("voter", voter, "comment", now - 10 * 60_000) >= LIMITS.commentsPer10MinPerDevice) {
      return { ok: false, status: 429, error: "You’ve posted a few comments in a row — try again in a few minutes." };
    }
    if (this.count("net", net, "comment", now - HOUR) >= LIMITS.commentsPerHourPerNetwork) {
      return { ok: false, status: 429, error: "Lots of comments from your network this hour — try again later." };
    }
    const dupe = this.sql
      .exec<{ n: number }>(`SELECT COUNT(*) AS n FROM comments WHERE key = ? AND voter = ? AND body = ? AND at > ?`, key, voter, body, now - DAY)
      .toArray()[0]?.n ?? 0;
    if (dupe) return { ok: false, status: 409, error: "You already posted that here." };
    const made = this.ensureItem(key, this.item(key), meta, voter, net, now);
    if (!made.ok) return made;
    const id = `c${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const shown = name || defaultName(voter);
    this.sql.exec(
      `INSERT INTO comments (id, key, voter, net, name, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      key,
      voter,
      net,
      shown,
      body,
      now,
    );
    this.sql.exec(`UPDATE items SET comments = comments + 1, active = ? WHERE key = ?`, now, key);
    this.event(voter, net, "comment", now);
    return { ok: true, value: { id, key, name: shown, body, at: now, own: true } };
  }

  /** A comment hides once reports arrive from enough different networks — extra device IDs on one network don't add up. */
  report(commentId: string, voter: string, nets: readonly string[], now = Date.now()): SocialResult<{ hidden: boolean }> {
    const net = nets[0] ?? "";
    const row = this.sql.exec<{ key: string; voter: string; hidden: number }>(`SELECT key, voter, hidden FROM comments WHERE id = ?`, commentId).toArray()[0];
    if (!row) return { ok: false, status: 404, error: "That comment is gone." };
    if (row.voter === voter) return { ok: false, status: 400, error: "You can delete your own comment instead." };
    const already = this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM reports WHERE comment = ? AND voter = ?`, commentId, voter).toArray()[0]?.n ?? 0;
    if (already) return { ok: true, value: { hidden: !!row.hidden } };
    if (this.count("voter", voter, "report", now - HOUR) >= LIMITS.reportsPerHourPerDevice || this.count("net", net, "report", now - HOUR) >= LIMITS.reportsPerHourPerNetwork) {
      return { ok: false, status: 429, error: "Thanks — you’ve sent a lot of reports. Try again later." };
    }
    this.sql.exec(`INSERT INTO reports (comment, voter, at, net) VALUES (?, ?, ?, ?)`, commentId, voter, now, net);
    // Today's and yesterday's hash of one network are the same network.
    const others = nets.slice(1);
    const rows = this.sql.exec<{ net: string }>(`SELECT DISTINCT net FROM reports WHERE comment = ?`, commentId).toArray();
    const networks = new Set(rows.map((r) => (others.includes(r.net) ? net : r.net))).size;
    const hide = !row.hidden && networks >= REPORTS_TO_HIDE;
    this.sql.exec(`UPDATE comments SET reports = ?, hidden = ? WHERE id = ?`, networks, hide || row.hidden ? 1 : 0, commentId);
    if (hide) this.sql.exec(`UPDATE items SET comments = MAX(0, comments - 1) WHERE key = ?`, row.key);
    this.event(voter, net, "report", now);
    return { ok: true, value: { hidden: hide || !!row.hidden } };
  }

  deleteOwn(commentId: string, voter: string): SocialResult<{ deleted: true }> {
    const row = this.sql.exec<{ key: string; voter: string; hidden: number }>(`SELECT key, voter, hidden FROM comments WHERE id = ?`, commentId).toArray()[0];
    if (!row || row.voter !== voter) return { ok: false, status: 404, error: "That comment is gone." };
    this.sql.exec(`DELETE FROM comments WHERE id = ?`, commentId);
    this.sql.exec(`DELETE FROM reports WHERE comment = ?`, commentId);
    if (!row.hidden) this.sql.exec(`UPDATE items SET comments = MAX(0, comments - 1) WHERE key = ?`, row.key);
    return { ok: true, value: { deleted: true } };
  }

  // ---- helpers -------------------------------------------------------

  private blank(key: string, now: number): SocialItem {
    return { key, kind: kindOfKey(key), link: null, up: 0, down: 0, comments: 0, active: now };
  }

  /**
   * A new entry needs the canonical link that hashes to its key (so junk keys
   * can't be minted) and counts against the network's daily allowance.
   */
  private ensureItem(key: string, existing: SocialItem | null, meta: ItemMeta, voter: string, net: string, now: number): SocialResult<true> {
    if (existing) {
      // meta.link was rebuilt for this exact key, so it also replaces links saved before that rule.
      if (meta.link && existing.link !== meta.link) this.sql.exec(`UPDATE items SET link = ? WHERE key = ?`, meta.link, key);
      return { ok: true, value: true };
    }
    if (!meta.link) return { ok: false, status: 400, error: "This chart can’t be shared with the community yet." };
    if (this.count("net", net, "item", now - DAY) >= LIMITS.newItemsPerDayPerNetwork) {
      return { ok: false, status: 429, error: "Your network has added a lot of new charts today — try again tomorrow." };
    }
    this.sql.exec(`INSERT INTO items (key, kind, link, created, active) VALUES (?, ?, ?, ?, ?)`, key, kindOfKey(key), meta.link, now, now);
    this.event(voter, net, "item", now);
    return { ok: true, value: true };
  }

  private count(by: "voter" | "net", id: string, kind: string, since: number): number {
    return this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM events WHERE ${by} = ? AND kind = ? AND at > ?`, id, kind, since).toArray()[0]?.n ?? 0;
  }

  private event(voter: string, net: string, kind: string, now: number) {
    this.sql.exec(`INSERT INTO events (voter, net, kind, at) VALUES (?, ?, ?, ?)`, voter, net, kind, now);
    if (now - this.prunedAt > HOUR) {
      this.prunedAt = now;
      // Rate-limit history only needs a day, and network hashes on votes and
      // comments only matter for the daily caps: forget them after two days.
      this.sql.exec(`DELETE FROM events WHERE at < ?`, now - DAY);
      this.sql.exec(`UPDATE votes SET net = '' WHERE net != '' AND at < ?`, now - 2 * DAY);
      this.sql.exec(`UPDATE comments SET net = '' WHERE net != '' AND at < ?`, now - 2 * DAY);
    }
  }
}
