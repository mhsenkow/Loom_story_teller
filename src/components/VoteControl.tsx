"use client";

// =================================================================
// VoteControl — ▲ score ▼ for a community chart, plus its comment count
// =================================================================
// Reads counts from the shared summary and this device's own vote; a tap
// votes optimistically (tap the lit arrow again to take the vote back).
// Renders nothing when community is turned off in Settings.
// =================================================================

import { useLoomStore } from "@/lib/store";
import { formatSocialCount } from "@/lib/socialRank";

type Props = {
  socialKey: string;
  /** `title` only labels the controls here; `link` lets the server create the entry on first use. */
  meta: { title: string; link?: string };
  /** "card" is compact for story cards; "stage" sits on the chart. */
  variant?: "card" | "stage";
  /** Show the 💬 count button that opens the thread. */
  showComments?: boolean;
  className?: string;
};

export function VoteControl({ socialKey, meta, variant = "card", showComments = true, className = "" }: Props) {
  const enabled = useLoomStore((s) => s.socialEnabled);
  const counts = useLoomStore((s) => s.socialSummary?.counts[socialKey]);
  const mine = useLoomStore((s) => s.socialVotes[socialKey] ?? 0);
  const cast = useLoomStore((s) => s.castSocialVote);
  const openThread = useLoomStore((s) => s.openSocialThread);
  if (!enabled) return null;

  const [up, down, comments] = counts ?? [0, 0, 0];
  const score = up - down;
  const vote = (value: 1 | -1) => (e: React.MouseEvent) => {
    e.stopPropagation();
    void cast(socialKey, mine === value ? 0 : value, { link: meta.link });
  };

  return (
    <div
      className={`social-votes ${className}`}
      data-variant={variant}
      role="group"
      aria-label={`Community votes for ${meta.title}`}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="social-vote-btn"
        data-dir="up"
        aria-pressed={mine === 1}
        aria-label={mine === 1 ? "Remove your upvote" : "Upvote — more like this"}
        title={mine === 1 ? "Remove your upvote" : "Upvote — show more charts like this"}
        onClick={vote(1)}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
          <path d="M8 3.5 13 10H3z" fill="currentColor" />
        </svg>
      </button>
      <span
        className="social-vote-score"
        data-sign={score > 0 ? "up" : score < 0 ? "down" : "zero"}
        title={`${up} up · ${down} down`}
        aria-label={`${up} up, ${down} down`}
      >
        {score > 0 ? formatSocialCount(score) : score < 0 ? `−${formatSocialCount(-score)}` : up + down > 0 ? "0" : "Vote"}
      </span>
      <button
        type="button"
        className="social-vote-btn"
        data-dir="down"
        aria-pressed={mine === -1}
        aria-label={mine === -1 ? "Remove your downvote" : "Downvote — fewer like this"}
        title={mine === -1 ? "Remove your downvote" : "Downvote — show fewer charts like this"}
        onClick={vote(-1)}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
          <path d="M8 12.5 3 6h10z" fill="currentColor" />
        </svg>
      </button>
      {showComments && (
        <button
          type="button"
          className="social-comment-btn"
          aria-label={comments ? `${comments} comment${comments === 1 ? "" : "s"} — open` : "Comment on this chart"}
          title={comments ? "Read and add comments" : "Be the first to comment"}
          onClick={(e) => {
            e.stopPropagation();
            openThread({ key: socialKey, title: meta.title, link: meta.link });
          }}
        >
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden>
            <path
              d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
          </svg>
          {comments > 0 && <span>{formatSocialCount(comments)}</span>}
        </button>
      )}
    </div>
  );
}
