"use client";

// =================================================================
// CommunitySettings — how you appear, and whether you see the community
// =================================================================

import { useState } from "react";
import { useLoomStore } from "@/lib/store";
import { defaultSocialName } from "@/lib/socialIdentity";

export function CommunitySettings() {
  const enabled = useLoomStore((s) => s.socialEnabled);
  const name = useLoomStore((s) => s.socialName);
  const setEnabled = useLoomStore((s) => s.setSocialEnabled);
  const setName = useLoomStore((s) => s.setSocialName);
  const reset = useLoomStore((s) => s.resetSocialIdentity);
  const setToast = useLoomStore((s) => s.setToast);
  const [draft, setDraft] = useState(name);
  const fallback = defaultSocialName();

  return (
    <div>
      <h3 className="text-sm font-semibold text-loom-text mb-1">Community</h3>
      <p className="text-2xs text-loom-muted mb-2">
        Vote on charts and leave comments — no account needed. Loom keeps a random ID on this device so your vote counts
        once; comments are public. Charts made from your own files are never shared.
      </p>
      <label className="flex items-center gap-2 cursor-pointer mb-3">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="rounded border-loom-border accent-loom-accent"
        />
        <span className="text-xs text-loom-text">Show votes and comments</span>
      </label>
      {enabled && (
        <>
          <label htmlFor="community-display-name" className="block text-2xs text-loom-muted mb-1">
            Name on your comments
          </label>
          <div className="flex items-center gap-2 mb-2">
            <input
              id="community-display-name"
              className="loom-input text-xs py-1.5 px-2 flex-1 min-w-0"
              value={draft}
              maxLength={24}
              placeholder={fallback}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setName(draft);
                  setToast(draft.trim() ? `You’ll post as ${draft.trim()}` : `You’ll post as ${fallback}`);
                }
              }}
            />
            <button
              type="button"
              className="loom-btn-ghost text-xs py-1.5 px-3 border border-loom-border"
              disabled={draft.trim() === name}
              onClick={() => {
                setName(draft);
                setToast(draft.trim() ? `You’ll post as ${draft.trim()}` : `You’ll post as ${fallback}`);
              }}
            >
              Save
            </button>
          </div>
          <button
            type="button"
            className="text-2xs text-loom-muted hover:text-loom-text underline underline-offset-2"
            onClick={() => {
              if (!window.confirm("Start fresh as a new device? Your past votes and comments stay, but this device won’t be linked to them any more.")) return;
              reset();
              setDraft("");
              setToast("You’re starting fresh in the community");
            }}
          >
            Start fresh with a new device ID
          </button>
        </>
      )}
    </div>
  );
}
