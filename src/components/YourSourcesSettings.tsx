"use client";

// =================================================================
// YourSourcesSettings — manage loved, saved, less-of and hidden sources
// =================================================================
// Settings → Your sources. Every change is undoable (one step) so a
// mis-tap on a phone never loses a hide or a love.
// =================================================================

import { useMemo, useState } from "react";
import { useLoomStore } from "@/lib/store";
import { catalogEntryFor } from "@/lib/sourceCatalog";
import { parseSourceRef, type SourceRef } from "@/lib/sourceRef";
import {
  explicitSourceRefs,
  setSourceReaction,
  toggleSourceSaved,
  type SourcePreferences,
  type SourceReaction,
} from "@/lib/sourcePreferences";

const REACTION_LABEL: Record<SourceReaction, string> = {
  love: "♥ Loved",
  spark: "✦ Marked",
  ask: "? Curious",
  less: "👎 Less",
  hide: "Hidden",
};
const REACTION_CLEAR: Record<SourceReaction, string> = {
  love: "Unlove",
  spark: "Unmark",
  ask: "Undo curious",
  less: "Undo less",
  hide: "Unhide",
};

function labelFor(ref: SourceRef): string {
  const entry = catalogEntryFor(ref);
  if (entry) return entry.label;
  const p = parseSourceRef(ref);
  if (!p) return ref;
  const tail = p.id.split("/").pop() || p.id;
  return p.scheme === "file" ? tail : `${tail} (${p.scheme})`;
}

const BTN = "text-2xs px-2 py-0.5 max-md:min-h-9 max-md:px-3 max-md:text-xs rounded border border-loom-border text-loom-muted hover:text-loom-text hover:bg-loom-elevated";

export function YourSourcesSettings() {
  const prefs = useLoomStore((s) => s.sourcePrefs);
  const setSourcePrefs = useLoomStore((s) => s.setSourcePrefs);
  const [undo, setUndo] = useState<{ prefs: SourcePreferences; text: string } | null>(null);
  const refs = useMemo(() => explicitSourceRefs(prefs), [prefs]);

  const apply = (next: SourcePreferences, text: string) => {
    setUndo({ prefs, text });
    setSourcePrefs(next);
  };

  return (
    <div data-testid="your-sources">
      <h3 className="text-sm font-semibold text-loom-text mb-1">Your sources</h3>
      <p className="text-2xs text-loom-muted mb-2">
        Feeds and packs you loved, saved, see less of, or hid. Loved sources rise in Discover, the sidebar and search; hidden ones disappear until you unhide them.
      </p>
      {undo && (
        <p className="flex items-center justify-between gap-2 text-2xs text-loom-text mb-2" role="status">
          <span className="min-w-0 truncate">{undo.text}</span>
          <button
            type="button"
            className={BTN}
            onClick={() => {
              setSourcePrefs(undo.prefs);
              setUndo(null);
            }}
          >
            Undo
          </button>
        </p>
      )}
      {refs.length === 0 ? (
        <p className="text-2xs text-loom-muted italic">Nothing yet — tap ♡ or 🔖 on a feed card, or “⋯” on a Discover story.</p>
      ) : (
        <ul className="space-y-1.5">
          {refs.map((ref) => {
            const e = prefs.entries[ref]!;
            const label = labelFor(ref);
            return (
              <li key={ref} className="flex items-center gap-2 border border-loom-border rounded-md px-2 py-1.5 bg-loom-surface/40">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-loom-text truncate" title={ref}>
                    {label}
                  </p>
                  <p className="text-2xs text-loom-muted">
                    {[e.reaction ? REACTION_LABEL[e.reaction] : null, e.saved ? "🔖 Saved" : null].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="flex flex-wrap justify-end gap-1 shrink-0">
                  {e.reaction && (
                    <button
                      type="button"
                      className={BTN}
                      aria-label={`${REACTION_CLEAR[e.reaction]} ${label}`}
                      onClick={() => apply(setSourceReaction(prefs, ref, null), `${REACTION_CLEAR[e.reaction!]}: ${label}`)}
                    >
                      {REACTION_CLEAR[e.reaction]}
                    </button>
                  )}
                  {e.saved && (
                    <button
                      type="button"
                      className={BTN}
                      aria-label={`Unsave ${label}`}
                      onClick={() => apply(toggleSourceSaved(prefs, ref), `Unsaved: ${label}`)}
                    >
                      Unsave
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
