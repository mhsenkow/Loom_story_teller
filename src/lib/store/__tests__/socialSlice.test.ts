// Community vote state: optimistic, one request per chart, and never
// overwritten by a slower or older response.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLoomStore } from "../index";
import { resetSocialRuntime } from "../socialSlice";

const KEY = "usgs:abc123";
type Handler = (path: string, body: Record<string, unknown>) => { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>;

function mockApi(handler: Handler) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      calls.push({ path: url, body });
      const res = await handler(url, body);
      return new Response(JSON.stringify(res.body), { status: res.status ?? 200, headers: { "Content-Type": "application/json" } });
    }),
  );
  return calls;
}

const item = (up: number, down: number, comments = 0) => ({ key: KEY, kind: "usgs", link: null, up, down, comments, active: 1 });
const summary = (counts: [number, number, number], generatedAt: number) => ({
  generatedAt,
  counts: { [KEY]: counts },
  latest: {},
  favorites: [],
  leastLiked: [],
  discussed: [],
  recent: [],
});
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  resetSocialRuntime();
  useLoomStore.setState({ socialSummary: null, socialVotes: {}, socialThreads: {}, socialStatus: "idle", socialEnabled: true, toastMessage: null } as never);
});
afterEach(() => vi.unstubAllGlobals());

describe("castSocialVote", () => {
  it("moves the arrow and tally at once, then takes the server's tally", async () => {
    mockApi(() => ({ body: { item: item(8, 1), myVote: 1 } }));
    const done = useLoomStore.getState().castSocialVote(KEY, 1, { link: "chart=x" });
    expect(useLoomStore.getState().socialVotes[KEY]).toBe(1);
    expect(useLoomStore.getState().socialSummary?.counts[KEY]).toEqual([1, 0, 0]);
    await done;
    expect(useLoomStore.getState().socialSummary?.counts[KEY]).toEqual([8, 1, 0]);
  });

  it("sends one request at a time and collapses quick taps to the last choice", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const calls = mockApi(async (_p, body) => {
      if (calls.length === 1) await gate;
      const v = body.value as -1 | 0 | 1;
      return { body: { item: item(v === 1 ? 1 : 0, v === -1 ? 1 : 0), myVote: v } };
    });
    const s = useLoomStore.getState();
    const first = s.castSocialVote(KEY, 1, {});
    void s.castSocialVote(KEY, -1, {});
    void s.castSocialVote(KEY, 0, {});
    void s.castSocialVote(KEY, -1, {});
    expect(calls).toHaveLength(1);
    release();
    await first;
    await flush();
    expect(calls.map((c) => c.body.value)).toEqual([1, -1]);
    expect(useLoomStore.getState().socialVotes[KEY]).toBe(-1);
    expect(useLoomStore.getState().socialSummary?.counts[KEY]).toEqual([0, 1, 0]);
  });

  it("rolls back to the last confirmed vote when the server refuses, however many taps were queued", async () => {
    mockApi(() => ({ status: 429, body: { error: "Lots of votes on this chart from your network today — yours wasn’t counted." } }));
    const s = useLoomStore.getState();
    const first = s.castSocialVote(KEY, 1, {});
    void s.castSocialVote(KEY, -1, {});
    await first;
    await flush();
    const after = useLoomStore.getState();
    expect(after.socialVotes[KEY]).toBeUndefined();
    expect(after.socialSummary?.counts[KEY]).toEqual([0, 0, 0]);
    expect(after.toastMessage).toMatch(/wasn’t counted/);
  });
});

describe("responses that race a vote", () => {
  it("a thread read that started before the vote landed doesn't unlight the arrow", async () => {
    let releaseVote!: () => void;
    const voteGate = new Promise<void>((r) => (releaseVote = r));
    mockApi(async (path) => {
      if (path.endsWith("/vote")) {
        await voteGate;
        return { body: { item: item(4, 0), myVote: 1 } };
      }
      // The thread was read before the vote was applied.
      return { body: { item: item(3, 0), comments: [], myVote: 0 } };
    });
    const s = useLoomStore.getState();
    const voting = s.castSocialVote(KEY, 1, {});
    await s.loadSocialThread(KEY);
    expect(useLoomStore.getState().socialVotes[KEY]).toBe(1);
    releaseVote();
    await voting;
    expect(useLoomStore.getState().socialVotes[KEY]).toBe(1);
    expect(useLoomStore.getState().socialSummary?.counts[KEY]).toEqual([4, 0, 0]);
  });

  it("an older cached summary doesn't undo a confirmed vote", async () => {
    const votedAt = Date.now();
    mockApi((path) =>
      path.endsWith("/vote")
        ? { body: { item: item(4, 0), myVote: 1 } }
        : { body: summary([3, 0, 0], votedAt - 15_000) },
    );
    await useLoomStore.getState().castSocialVote(KEY, 1, {});
    await useLoomStore.getState().loadSocialSummary({ force: true });
    expect(useLoomStore.getState().socialSummary?.counts[KEY]).toEqual([4, 0, 0]);
  });

  it("a newer summary does replace what this device knew", async () => {
    mockApi((path) =>
      path.endsWith("/vote")
        ? { body: { item: item(4, 0), myVote: 1 } }
        : { body: summary([9, 2, 1], Date.now() + 60_000) },
    );
    await useLoomStore.getState().castSocialVote(KEY, 1, {});
    await useLoomStore.getState().loadSocialSummary({ force: true });
    expect(useLoomStore.getState().socialSummary?.counts[KEY]).toEqual([9, 2, 1]);
  });
});
