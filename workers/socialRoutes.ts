// =================================================================
// socialRoutes — /api/social/* for community votes and comments
// =================================================================
//   GET  /api/social/summary   counts + favorites / least liked / discussed
//                              + recent comments (edge-cached ~20 s)
//   POST /api/social/thread    { key, voter? }               → item, comments, myVote
//   POST /api/social/vote      { key, voter, value, link? }
//   POST /api/social/comment   { key, voter, body, name?, link? }
//   POST /api/social/report    { id, voter }
//   POST /api/social/delete    { id, voter }                 (own comments only)
//
// Every POST needs an approved browser Origin (or the native shells' hosts)
// and carries the device's random voter token in the body — never a URL or
// header. The token and the network address are hashed inside the Durable
// Object before anything is stored.
//
// The only client text other people ever see is a comment and its display
// name. A chart's link is rebuilt from validated parts (known feed, real
// column names, enumerated settings) and must hash to the item's key.
// =================================================================

import {
  canonicalLink,
  checkComment,
  checkName,
  kindOfKey,
  validCommentId,
  validKey,
  validVote,
  validVoter,
} from "./socialCore";
import type { ItemMeta, SocialItem, SocialResult, SocialSummary } from "./socialStore";

type Reply<T> = T | Promise<T>;

/** The RPC surface the routes use (the SocialHub stub, or a SocialService in tests). */
export interface SocialBackend {
  summary(): Reply<SocialSummary>;
  thread(key: string, voter: string | null): Reply<unknown>;
  vote(key: string, voter: string, ip: string, value: -1 | 0 | 1, meta: ItemMeta): Reply<SocialResult<unknown>>;
  comment(key: string, voter: string, ip: string, name: string, body: string, meta: ItemMeta): Reply<SocialResult<unknown>>;
  report(id: string, voter: string, ip: string): Reply<SocialResult<unknown>>;
  deleteOwn(id: string, voter: string): Reply<SocialResult<unknown>>;
}

export interface SocialRouteDeps {
  backend: SocialBackend | null;
  /** JSON response with the right CORS headers for this request. */
  reply: (body: unknown, status?: number, extraHeaders?: Record<string, string>) => Response;
  originOk: boolean;
  ip: string;
  /** Column names of a live feed, or null when the feed isn't one Loom serves. */
  columnsFor: (kind: string) => readonly string[] | null;
  cache?: Cache;
  waitUntil?: (p: Promise<unknown>) => void;
}

const SUMMARY_CACHE_KEY = "https://loom-social.internal/summary/v3";
const SUMMARY_TTL_SECS = 20;
const MAX_BODY = 8 * 1024;

/**
 * Re-checks a stored link on the way out, so entries saved before links were
 * rebuilt server-side never hand readers text a client wrote.
 */
function servedLink(link: string | null | undefined, key: string, columnsFor: SocialRouteDeps["columnsFor"]): string | null {
  if (!link) return null;
  const kind = kindOfKey(key);
  const columns = columnsFor(kind);
  if (!columns) return null;
  const canon = canonicalLink(link, kind, columns);
  return canon && canon.key === key ? canon.link : null;
}

function servedSummary(summary: SocialSummary, columnsFor: SocialRouteDeps["columnsFor"]): SocialSummary {
  const item = (i: SocialItem): SocialItem => ({ ...i, link: servedLink(i.link, i.key, columnsFor) });
  return {
    ...summary,
    favorites: summary.favorites.map(item),
    leastLiked: summary.leastLiked.map(item),
    discussed: summary.discussed.map(item),
    recent: summary.recent.map((c) => ({ ...c, link: servedLink(c.link, c.key, columnsFor) })),
  };
}

function unwrap(res: SocialResult<unknown>, reply: SocialRouteDeps["reply"]): Response {
  return res.ok ? reply(res.value) : reply({ error: res.error }, res.status);
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const len = Number(request.headers.get("Content-Length") ?? 0);
  if (len > MAX_BODY) return null;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return null;
    const v: unknown = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function handleSocial(request: Request, url: URL, deps: SocialRouteDeps): Promise<Response> {
  const { backend, reply } = deps;
  const path = url.pathname.replace(/\/+$/, "");
  if (!backend) return reply({ error: "Community isn’t available right now." }, 503);

  if (path === "/api/social/summary" && request.method === "GET") {
    const hit = await deps.cache?.match(SUMMARY_CACHE_KEY).catch(() => undefined);
    if (hit) return reply(await hit.json(), 200, { "Cache-Control": `public, max-age=${SUMMARY_TTL_SECS}` });
    const summary = servedSummary(await backend.summary(), deps.columnsFor);
    const put = deps.cache?.put(
      SUMMARY_CACHE_KEY,
      new Response(JSON.stringify(summary), {
        headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${SUMMARY_TTL_SECS}` },
      }),
    );
    if (put) deps.waitUntil?.(put.catch(() => {}));
    return reply(summary, 200, { "Cache-Control": `public, max-age=${SUMMARY_TTL_SECS}` });
  }

  if (request.method !== "POST") return reply({ error: "Not found" }, 404);
  if (!deps.originOk) return reply({ error: "Forbidden origin" }, 403);
  const body = await readJson(request);
  if (!body) return reply({ error: "That request was too large or unreadable." }, 400);

  const voter = validVoter(body.voter) ? body.voter : null;

  /** A chart on a feed Loom serves, plus its link when that link rebuilds exactly this item. */
  const target = (): { key: string; meta: ItemMeta } | null => {
    if (!validKey(body.key)) return null;
    const kind = kindOfKey(body.key);
    const columns = deps.columnsFor(kind);
    if (!columns) return null;
    const canon = canonicalLink(body.link, kind, columns);
    return { key: body.key, meta: { link: canon && canon.key === body.key ? canon.link : null } };
  };

  if (path === "/api/social/thread") {
    const t = target();
    if (!t) return reply({ error: "Unknown chart." }, 400);
    const thread = (await backend.thread(t.key, voter)) as { item?: SocialItem | null } & Record<string, unknown>;
    if (thread?.item) thread.item = { ...thread.item, link: servedLink(thread.item.link, thread.item.key, deps.columnsFor) };
    return reply(thread);
  }

  if (!voter) return reply({ error: "Missing device id — reload and try again." }, 400);

  if (path === "/api/social/vote") {
    const t = target();
    if (!t || !validVote(body.value)) return reply({ error: "Unknown chart or vote." }, 400);
    return unwrap(await backend.vote(t.key, voter, deps.ip, body.value, t.meta), reply);
  }

  if (path === "/api/social/comment") {
    const t = target();
    if (!t) return reply({ error: "Unknown chart." }, 400);
    const text = checkComment(body.body);
    if (!text.ok) return reply({ error: text.error }, 400);
    const name = checkName(body.name);
    if (!name.ok) return reply({ error: name.error }, 400);
    return unwrap(await backend.comment(t.key, voter, deps.ip, name.text, text.text, t.meta), reply);
  }

  if (path === "/api/social/report") {
    if (!validCommentId(body.id)) return reply({ error: "Unknown comment." }, 400);
    return unwrap(await backend.report(body.id, voter, deps.ip), reply);
  }

  if (path === "/api/social/delete") {
    if (!validCommentId(body.id)) return reply({ error: "Unknown comment." }, 400);
    return unwrap(await backend.deleteOwn(body.id, voter), reply);
  }

  return reply({ error: "Not found" }, 404);
}
