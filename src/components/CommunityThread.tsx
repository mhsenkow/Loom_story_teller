"use client";

// =================================================================
// CommunityThread — public comments on one community chart
// =================================================================
// Opens from any 💬 button (story cards, the chart stage, the community
// strip). No account: people post under a friendly device name they can
// change right here. Comments are plain text (no links), can be reported
// by others (several reports hide them) and deleted by their author.
// =================================================================

import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { VoteControl } from "@/components/VoteControl";
import { useLoomStore } from "@/lib/store";
import { defaultSocialName } from "@/lib/socialIdentity";
import { formatSocialAgo } from "@/lib/socialRank";

const MAX = 400;

export function CommunityThread() {
  const open = useLoomStore((s) => s.socialOpen);
  const enabled = useLoomStore((s) => s.socialEnabled);
  const thread = useLoomStore((s) => (s.socialOpen ? s.socialThreads[s.socialOpen.key] : undefined));
  const name = useLoomStore((s) => s.socialName);
  const close = useLoomStore((s) => s.closeSocialThread);
  const post = useLoomStore((s) => s.postSocialComment);
  const report = useLoomStore((s) => s.reportSocialComment);
  const remove = useLoomStore((s) => s.deleteSocialComment);
  const setName = useLoomStore((s) => s.setSocialName);
  const reload = useLoomStore((s) => s.loadSocialThread);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setDraft("");
    setEditingName(false);
  }, [open?.key]);

  if (!open || !enabled) return null;
  const shownName = name || defaultSocialName();
  const meta = { title: open.title, link: open.link };
  const serverMeta = { link: open.link };
  const comments = thread?.comments ?? [];
  const remaining = MAX - draft.length;

  const submit = async () => {
    const body = draft.trim();
    if (body.length < 2 || posting) return;
    setPosting(true);
    const ok = await post(open.key, body, serverMeta);
    setPosting(false);
    if (ok) setDraft("");
  };

  return (
    <Dialog open onClose={close} labelledBy="community-thread-title" initialFocusRef={inputRef} zIndex={220} panelClassName="community-thread">
      <header className="community-thread-head">
        <div className="min-w-0">
          <p className="community-kicker">Community</p>
          <h2 id="community-thread-title" className="community-thread-title">
            {open.title}
          </h2>
        </div>
        <button type="button" className="discover-icon-button" aria-label="Close comments" onClick={close}>
          ×
        </button>
      </header>

      <div className="community-thread-vote">
        <VoteControl socialKey={open.key} meta={meta} variant="stage" showComments={false} />
        <span className="text-2xs text-loom-muted">Votes decide which charts people see first.</span>
      </div>

      <form
        className="community-compose"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label htmlFor="community-draft" className="sr-only">
          Add a comment
        </label>
        <textarea aria-label="What do you notice in this chart?"
          id="community-draft"
          ref={inputRef}
          className="loom-input community-textarea"
          placeholder="What do you notice in this chart?"
          value={draft}
          maxLength={MAX}
          rows={3}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <div className="community-compose-row">
          {editingName ? (
            <span className="community-name-edit">
              <label htmlFor="community-name" className="sr-only">
                Your display name
              </label>
              <input aria-label="community name"
                id="community-name"
                className="loom-input text-xs py-1 px-2 w-36"
                value={nameDraft}
                maxLength={24}
                placeholder={defaultSocialName()}
                autoFocus
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    setName(nameDraft);
                    setEditingName(false);
                  }
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setEditingName(false);
                  }
                }}
              />
              <button
                type="button"
                className="loom-btn-ghost text-xs min-h-8 px-2"
                onClick={() => {
                  setName(nameDraft);
                  setEditingName(false);
                }}
              >
                Save
              </button>
            </span>
          ) : (
            <span className="text-2xs text-loom-muted">
              Posting as <strong className="text-loom-text font-medium">{shownName}</strong>{" "}
              <button
                type="button"
                className="text-loom-accent hover:underline"
                onClick={() => {
                  setNameDraft(name);
                  setEditingName(true);
                }}
              >
                change
              </button>
            </span>
          )}
          <span className="flex items-center gap-2">
            <span className="text-2xs text-loom-muted tabular-nums" aria-live="polite">
              {remaining < 60 ? `${remaining} left` : ""}
            </span>
            <button type="submit" className="loom-btn-primary text-xs min-h-9 px-3" disabled={draft.trim().length < 2 || posting}>
              {posting ? "Posting…" : "Post"}
            </button>
          </span>
        </div>
        <p className="text-2xs text-loom-muted">
          Comments are public. No account needed — Loom remembers this device so your vote counts once.
        </p>
      </form>

      <section className="community-comments" aria-label="Comments" aria-busy={thread?.loading || undefined}>
        {thread?.error && (
          <p className="community-empty">
            {thread.error}{" "}
            <button type="button" className="text-loom-accent hover:underline" onClick={() => void reload(open.key)}>
              Try again
            </button>
          </p>
        )}
        {!thread?.error && !comments.length && (
          <p className="community-empty">{thread?.loading ? "Loading comments…" : "No comments yet. Say what caught your eye."}</p>
        )}
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="community-comment">
              <p className="community-comment-meta">
                <strong>{c.name}</strong>
                <span aria-hidden> · </span>
                <time dateTime={new Date(c.at).toISOString()}>{formatSocialAgo(c.at)}</time>
                {c.own && <span className="community-you">you</span>}
              </p>
              <p className="community-comment-body">{c.body}</p>
              <div className="community-comment-actions">
                {c.own ? (
                  <button
                    type="button"
                    aria-label="Delete your comment"
                    onClick={() => {
                      if (window.confirm("Delete this comment? This can’t be undone.")) void remove(open.key, c.id);
                    }}
                  >
                    Delete
                  </button>
                ) : (
                  <button type="button" aria-label={`Report comment by ${c.name}`} onClick={() => void report(open.key, c.id)}>
                    Report
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </Dialog>
  );
}
