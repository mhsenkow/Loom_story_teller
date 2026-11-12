// =================================================================
// socialApi — talk to /api/social on the Worker
// =================================================================
// Same Worker on every platform: same-origin on the web, absolute URL in
// the native shells (apiUrl). The device token rides in POST bodies only.
// Errors come back as plain sentences from the server, ready for a toast.
// =================================================================

import { apiUrl } from "./openDataCatalog";
import { socialVoter, type Vote } from "./socialIdentity";

export interface SocialItem {
  key: string;
  kind: string;
  /** Canonical chart link rebuilt by the server — never client text. */
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
  /** The chart's canonical link (recent comments), to open or describe it. */
  link?: string | null;
}

export interface SocialSummary {
  generatedAt: number;
  counts: Record<string, [number, number, number]>;
  latest: Record<string, { name: string; body: string; at: number }>;
  favorites: SocialItem[];
  leastLiked: SocialItem[];
  discussed: SocialItem[];
  recent: SocialComment[];
}

export interface SocialThread {
  item: SocialItem | null;
  comments: SocialComment[];
  myVote: Vote;
}

/** What the server needs to create an entry the first time: the chart's own link. */
export interface SocialMeta {
  link?: string;
}

const OFFLINE = "Community isn’t reachable right now — try again in a moment.";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), { ...init, signal: init?.signal ?? AbortSignal.timeout(8_000) });
  } catch {
    throw new Error(OFFLINE);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* fall through */
  }
  if (!res.ok) {
    const msg = body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : "";
    throw new Error(msg || OFFLINE);
  }
  return body as T;
}

const post = <T>(path: string, payload: Record<string, unknown>) =>
  call<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, voter: socialVoter() }),
  });

/** The server caches the summary for a few seconds; skip the browser's own copy on top of that. */
export const fetchSocialSummary = () => call<SocialSummary>("/api/social/summary", { cache: "no-store" });

export const fetchSocialThread = (key: string) => post<SocialThread>("/api/social/thread", { key });

export const sendSocialVote = (key: string, value: Vote, meta: SocialMeta) =>
  post<{ item: SocialItem; myVote: Vote }>("/api/social/vote", { key, value, link: meta.link });

export const sendSocialComment = (key: string, body: string, name: string, meta: SocialMeta) =>
  post<SocialComment>("/api/social/comment", { key, body, name, link: meta.link });

export const reportSocialComment = (id: string) => post<{ hidden: boolean }>("/api/social/report", { id });

export const deleteSocialComment = (id: string) => post<{ deleted: true }>("/api/social/delete", { id });
