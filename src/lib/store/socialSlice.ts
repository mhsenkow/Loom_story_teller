// =================================================================
// socialSlice — community votes and comments (no login)
// =================================================================
// Holds the shared summary (counts, favorites, recent comments), this
// device's own votes, open comment threads, and display preferences.
//
// Votes are optimistic and serialized per chart: arrows and counts move
// at once, only one request per chart is in flight, quick taps collapse
// to the last choice, and a refusal rolls back to what the server last
// confirmed (with its message as a toast). What this device just did
// outranks an older cached summary, so counts never flicker backwards.
// The device token, name and votes persist via socialIdentity.
// =================================================================

import type { StateCreator } from "zustand";
import type { LoomState } from "./types";
import {
  defaultSocialName,
  readSocialEnabled,
  readSocialName,
  readSocialVotes,
  resetSocialIdentity,
  writeSocialEnabled,
  writeSocialName,
  writeSocialVotes,
  type Vote,
} from "../socialIdentity";
import {
  deleteSocialComment,
  fetchSocialSummary,
  fetchSocialThread,
  reportSocialComment,
  sendSocialComment,
  sendSocialVote,
  type SocialComment,
  type SocialMeta,
  type SocialSummary,
} from "../socialApi";

export interface SocialThreadState {
  comments: SocialComment[];
  loading: boolean;
  error: string | null;
}

export interface SocialState {
  socialSummary: SocialSummary | null;
  socialStatus: "idle" | "loading" | "ready" | "offline";
  socialVotes: Record<string, Vote>;
  socialThreads: Record<string, SocialThreadState>;
  /** Item whose comments sheet is open (the title is local; the link creates the entry on first use). */
  socialOpen: { key: string; title: string; link?: string } | null;
  socialName: string;
  socialEnabled: boolean;
  loadSocialSummary: (opts?: { force?: boolean }) => Promise<void>;
  castSocialVote: (key: string, value: Vote, meta: SocialMeta) => Promise<void>;
  openSocialThread: (target: { key: string; title: string; link?: string }) => void;
  closeSocialThread: () => void;
  loadSocialThread: (key: string) => Promise<void>;
  postSocialComment: (key: string, body: string, meta: SocialMeta) => Promise<boolean>;
  reportSocialComment: (key: string, id: string) => Promise<void>;
  deleteSocialComment: (key: string, id: string) => Promise<void>;
  setSocialName: (name: string) => void;
  setSocialEnabled: (on: boolean) => void;
  resetSocialIdentity: () => void;
}

type Tuple = [number, number, number];
type Latest = SocialSummary["latest"][string];

const SUMMARY_FRESH_MS = 30_000;
let summaryInflight: Promise<void> | null = null;
let summaryLoadedAt = 0;

/** Per-chart vote pipeline: what the server last confirmed, and what the person wants now. */
const voteFlow = new Map<string, { confirmed: Vote; desired: Vote; meta: SocialMeta; busy: boolean }>();
/** What this device knows first-hand (from its own writes), newer than any cached summary. */
const firstHand = new Map<string, { at: number; counts?: Tuple; latest?: Latest | null }>();

/** Test hook: forget in-flight votes and first-hand counts. */
export function resetSocialRuntime(): void {
  voteFlow.clear();
  firstHand.clear();
  summaryInflight = null;
  summaryLoadedAt = 0;
}

export const socialInitialState = {
  socialSummary: null as SocialSummary | null,
  socialStatus: "idle" as SocialState["socialStatus"],
  socialVotes: {} as Record<string, Vote>,
  socialThreads: {} as Record<string, SocialThreadState>,
  socialOpen: null as SocialState["socialOpen"],
  socialName: "",
  socialEnabled: true,
};

/** Read device-local community prefs once the browser is available (HydrateStore). */
export function hydrateSocialState(): Partial<SocialState> {
  return { socialVotes: readSocialVotes(), socialName: readSocialName(), socialEnabled: readSocialEnabled() };
}

const emptySummary = (): SocialSummary => ({ generatedAt: 0, counts: {}, latest: {}, favorites: [], leastLiked: [], discussed: [], recent: [] });

/** Lay first-hand knowledge over a summary that was generated before it. */
function withFirstHand(summary: SocialSummary): SocialSummary {
  if (!firstHand.size) return summary;
  const counts = { ...summary.counts };
  const latest = { ...summary.latest };
  for (const [key, known] of firstHand) {
    if (summary.generatedAt >= known.at) {
      firstHand.delete(key);
      continue;
    }
    if (known.counts) counts[key] = known.counts;
    if (known.latest === null) delete latest[key];
    else if (known.latest) latest[key] = known.latest;
  }
  return { ...summary, counts, latest };
}

export const createSocialSlice: StateCreator<LoomState, [], [], Omit<SocialState, keyof typeof socialInitialState>> = (set, get) => {
  const tupleOf = (key: string): Tuple => get().socialSummary?.counts[key] ?? [0, 0, 0];

  const setCounts = (key: string, counts: Tuple, confirmed: boolean, latest?: Latest | null) => {
    const base = get().socialSummary ?? emptySummary();
    const nextLatest = { ...base.latest };
    if (latest === null) delete nextLatest[key];
    else if (latest) nextLatest[key] = latest;
    set({ socialSummary: { ...base, counts: { ...base.counts, [key]: counts }, latest: nextLatest } });
    if (confirmed) {
      const prev = firstHand.get(key);
      firstHand.set(key, { at: Date.now(), counts, latest: latest === undefined ? prev?.latest : latest });
    }
  };

  /** Show `value` as this device's vote and move the displayed tally to match. */
  const showVote = (key: string, value: Vote) => {
    const shown = get().socialVotes[key] ?? 0;
    if (shown === value) return;
    const votes = { ...get().socialVotes };
    if (value === 0) delete votes[key];
    else votes[key] = value;
    writeSocialVotes(votes);
    set({ socialVotes: votes });
    const [up, down, comments] = tupleOf(key);
    const du = (value === 1 ? 1 : 0) - (shown === 1 ? 1 : 0);
    const dd = (value === -1 ? 1 : 0) - (shown === -1 ? 1 : 0);
    setCounts(key, [Math.max(0, up + du), Math.max(0, down + dd), comments], false);
  };

  return {
    loadSocialSummary: async ({ force } = {}) => {
      if (!get().socialEnabled) return;
      if (!force && Date.now() - summaryLoadedAt < SUMMARY_FRESH_MS && get().socialSummary) return;
      if (summaryInflight) return summaryInflight;
      if (!get().socialSummary) set({ socialStatus: "loading" });
      summaryInflight = (async () => {
        try {
          const summary = withFirstHand(await fetchSocialSummary());
          summaryLoadedAt = Date.now();
          // Keep optimistic tallies for votes still on their way.
          const counts = { ...summary.counts };
          for (const [key, flow] of voteFlow) if (flow.busy) counts[key] = tupleOf(key);
          set({ socialSummary: { ...summary, counts }, socialStatus: "ready" });
        } catch {
          set({ socialStatus: get().socialSummary ? "ready" : "offline" });
        } finally {
          summaryInflight = null;
        }
      })();
      return summaryInflight;
    },

    castSocialVote: async (key, value, meta) => {
      let flow = voteFlow.get(key);
      if (!flow) {
        flow = { confirmed: get().socialVotes[key] ?? 0, desired: value, meta, busy: false };
        voteFlow.set(key, flow);
      }
      flow.desired = value;
      flow.meta = meta;
      showVote(key, value);
      if (flow.busy) return;
      flow.busy = true;
      try {
        while (flow.desired !== flow.confirmed) {
          const want = flow.desired;
          try {
            const res = await sendSocialVote(key, want, flow.meta);
            flow.confirmed = res.myVote;
            // The server's tally is the truth for this chart; re-apply any newer tap on top.
            setCounts(key, [res.item.up, res.item.down, res.item.comments], true);
            const votes = { ...get().socialVotes };
            if (res.myVote === 0) delete votes[key];
            else votes[key] = res.myVote;
            writeSocialVotes(votes);
            set({ socialVotes: votes });
            if (flow.desired !== flow.confirmed) showVote(key, flow.desired);
          } catch (e) {
            flow.desired = flow.confirmed;
            showVote(key, flow.confirmed);
            get().setToast(e instanceof Error ? e.message : "Couldn’t save your vote — try again.");
          }
        }
      } finally {
        flow.busy = false;
        voteFlow.delete(key);
      }
    },

    openSocialThread: (target) => {
      set({ socialOpen: target });
      void get().loadSocialThread(target.key);
    },

    closeSocialThread: () => set({ socialOpen: null }),

    loadSocialThread: async (key) => {
      const cur = get().socialThreads[key];
      set({ socialThreads: { ...get().socialThreads, [key]: { comments: cur?.comments ?? [], loading: true, error: null } } });
      try {
        const thread = await fetchSocialThread(key);
        // A vote on its way knows better than a thread read that raced it.
        if (!voteFlow.get(key)?.busy) {
          const votes = { ...get().socialVotes };
          if (thread.myVote) votes[key] = thread.myVote;
          else delete votes[key];
          writeSocialVotes(votes);
          set({ socialVotes: votes });
          if (thread.item) setCounts(key, [thread.item.up, thread.item.down, thread.item.comments], true);
        }
        set({ socialThreads: { ...get().socialThreads, [key]: { comments: thread.comments, loading: false, error: null } } });
      } catch (e) {
        set({
          socialThreads: {
            ...get().socialThreads,
            [key]: { comments: cur?.comments ?? [], loading: false, error: e instanceof Error ? e.message : "Couldn’t load comments." },
          },
        });
      }
    },

    postSocialComment: async (key, body, meta) => {
      const name = get().socialName || defaultSocialName();
      try {
        const comment = await sendSocialComment(key, body, name, meta);
        const cur = get().socialThreads[key];
        set({ socialThreads: { ...get().socialThreads, [key]: { comments: [comment, ...(cur?.comments ?? [])], loading: false, error: null } } });
        const [up, down, comments] = tupleOf(key);
        setCounts(key, [up, down, comments + 1], true, { name: comment.name, body: comment.body, at: comment.at });
        return true;
      } catch (e) {
        get().setToast(e instanceof Error ? e.message : "Couldn’t post that — try again.");
        return false;
      }
    },

    reportSocialComment: async (key, id) => {
      try {
        const res = await reportSocialComment(id);
        if (res.hidden) {
          const cur = get().socialThreads[key];
          if (cur) set({ socialThreads: { ...get().socialThreads, [key]: { ...cur, comments: cur.comments.filter((c) => c.id !== id) } } });
        }
        get().setToast("Thanks — reported. Comments reported from several places are hidden.");
      } catch (e) {
        get().setToast(e instanceof Error ? e.message : "Couldn’t send that report — try again.");
      }
    },

    deleteSocialComment: async (key, id) => {
      try {
        await deleteSocialComment(id);
        const cur = get().socialThreads[key];
        const left = cur ? cur.comments.filter((c) => c.id !== id) : [];
        if (cur) set({ socialThreads: { ...get().socialThreads, [key]: { ...cur, comments: left } } });
        const [up, down, comments] = tupleOf(key);
        const newest = left[0];
        setCounts(key, [up, down, Math.max(0, comments - 1)], true, newest ? { name: newest.name, body: newest.body, at: newest.at } : null);
        get().setToast("Comment deleted");
      } catch (e) {
        get().setToast(e instanceof Error ? e.message : "Couldn’t delete that — try again.");
      }
    },

    setSocialName: (name) => {
      writeSocialName(name);
      set({ socialName: name.trim().slice(0, 24) });
    },

    setSocialEnabled: (on) => {
      writeSocialEnabled(on);
      set({ socialEnabled: on, socialOpen: on ? get().socialOpen : null });
      if (on) void get().loadSocialSummary({ force: true });
    },

    resetSocialIdentity: () => {
      resetSocialIdentity();
      voteFlow.clear();
      set({ socialVotes: {}, socialName: "", socialThreads: {} });
    },
  };
};
