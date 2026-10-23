"use client";

// =================================================================
// SourcePrefControls — ♥ Love / 🔖 Save buttons + Less / Hide overflow
// =================================================================
// Shared by sidebar feed cards, curated packs and Discover story cards.
// On discovery cards the cluster rests in a light quaternary state and
// comes forward on hover. Elsewhere the buttons stay visible. The overflow
// panel covers its card (`absolute inset-0` in the nearest positioned
// ancestor) unless the card CSS anchors it to the action cluster.
// =================================================================

import { useEffect, useId, useRef, useState } from "react";
import { useLoomStore } from "@/lib/store";
import { assetForFile, type LibraryAsset } from "@/lib/dataLibrary";
import { collectionAlive, holdingCollection, spanLabel } from "@/lib/collections";
import { refForPath } from "@/lib/sourceRef";
import type { SourceRef } from "@/lib/sourceRef";
import type { SourcePrefEntry } from "@/lib/sourcePreferences";

const EMPTY: SourcePrefEntry = {};

export function useSourcePref(ref: SourceRef): SourcePrefEntry {
  return useLoomStore((s) => s.sourcePrefs.entries[ref] ?? EMPTY);
}

const ICON_BTN =
  "inline-flex items-center justify-center shrink-0 rounded border text-xs leading-none min-w-7 h-7 max-md:min-h-9 max-md:min-w-9 transition-colors";

export function LoveButton({ sourceRef, label, className = "" }: { sourceRef: SourceRef; label: string; className?: string }) {
  const entry = useSourcePref(sourceRef);
  const reactToSource = useLoomStore((s) => s.reactToSource);
  const on = entry.reaction === "love";
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? `Loved ${label} — tap to undo` : `Love ${label}`}
      title={on ? "Loved — shows up first in Discover and here" : "Love this source"}
      onClick={(e) => {
        e.stopPropagation();
        reactToSource(sourceRef, on ? null : "love");
      }}
      className={`${ICON_BTN} ${on ? "border-loom-accent bg-loom-accent/15 text-loom-accent" : "border-loom-border text-loom-muted hover:text-loom-text hover:bg-loom-elevated"} ${className}`}
    >
      <span aria-hidden>{on ? "♥" : "♡"}</span>
    </button>
  );
}

export function SaveButton({ sourceRef, label, asset, className = "" }: { sourceRef: SourceRef; label: string; asset?: LibraryAsset; className?: string }) {
  const collections = useLoomStore((s) => s.dataLibrary.collections);
  const on = !!holdingCollection(collections, sourceRef);
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? `In a collection — ${label}` : `Collect ${label}`}
      title={on ? "In a collection — it leaves if you don’t come back" : "Add to a collection"}
      onClick={(e) => {
        e.stopPropagation();
        const state = useLoomStore.getState();
        const living = state.dataLibrary.collections.filter((c) => collectionAlive(c));
        const holding = living.filter((c) => c.pieces.some((p) => p.kind === "data" && p.ref === sourceRef));
        if (holding.length) {
          for (const c of holding) state.removeCollectionPiece(c.id, `data:${sourceRef}`);
          state.setToast(`Removed ${label} from its collection.`);
          return;
        }
        const file = [state.selectedFile, ...state.files, ...state.recentFiles].find(f => f && refForPath(f.path, f) === sourceRef);
        if (asset || file) state.rememberLibraryAsset(asset ?? assetForFile(file!));
        const piece = { kind: "data" as const, ref: sourceRef, name: label };
        const latest = [...living].sort((a, b) => b.touchedAt - a.touchedAt)[0];
        if (latest) {
          state.addCollectionPiece(latest.id, piece);
          state.setToast(
            latest.span === 0
              ? `${label} joined “${latest.intent}”. That collection keeps going.`
              : `${label} joined “${latest.intent}” for ${spanLabel(latest.span)} from today.`,
          );
        } else {
          state.createCollection({ intent: label, span: 3, pieces: [piece] });
          state.setToast(`${label} is a collection for 3 months. Open Collections to add a chart or keep it longer.`);
        }
      }}
      className={`${ICON_BTN} ${on ? "border-loom-accent bg-loom-accent/15 text-loom-accent" : "border-loom-border text-loom-muted hover:text-loom-text hover:bg-loom-elevated"} ${className}`}
    >
      <svg aria-hidden width="12" height="12" viewBox="0 0 24 24" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <path d="M6 3h12v18l-6-4-6 4z" />
      </svg>
    </button>
  );
}

export type SourcePrefAction = "love" | "spark" | "ask" | "less" | "hide" | "save";

/**
 * "⋯" trigger + an actions panel that covers the nearest positioned ancestor.
 * Each action toggles (Love ↔ Unlove, Less ↔ Undo less, Hide ↔ Unhide).
 */
export function SourcePrefMenu({
  sourceRef,
  label,
  actions,
  className = "",
  triggerClassName = "",
}: {
  sourceRef: SourceRef;
  label: string;
  actions: SourcePrefAction[];
  className?: string;
  triggerClassName?: string;
}) {
  const entry = useSourcePref(sourceRef);
  const reactToSource = useLoomStore((s) => s.reactToSource);
  const toggleSavedSource = useLoomStore((s) => s.toggleSavedSource);
  const setToast = useLoomStore((s) => s.setToast);
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    const onDown = (e: PointerEvent) => {
      if (panelRef.current?.contains(e.target as Node) || triggerRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const items: { key: SourcePrefAction; text: string; on: boolean; run: () => void }[] = actions.map((key) => {
    switch (key) {
      case "love": {
        const on = entry.reaction === "love";
        return { key, on, text: on ? "Loved ♥ — undo" : "Love this source", run: () => reactToSource(sourceRef, on ? null : "love") };
      }
      case "spark": {
        const on = entry.reaction === "spark";
        return { key, on, text: on ? "Marked ✦ — undo" : "Mark ✦", run: () => reactToSource(sourceRef, on ? null : "spark") };
      }
      case "ask": {
        const on = entry.reaction === "ask";
        return { key, on, text: on ? "Curious ? — undo" : "Curious ?", run: () => reactToSource(sourceRef, on ? null : "ask") };
      }
      case "less": {
        const on = entry.reaction === "less";
        return {
          key,
          on,
          text: on ? "Showing less — undo" : "Less like this",
          run: () => {
            reactToSource(sourceRef, on ? null : "less");
            if (!on) setToast(`You'll see less of ${label}`);
          },
        };
      }
      case "hide": {
        const on = entry.reaction === "hide";
        return {
          key,
          on,
          text: on ? "Unhide source" : "Hide source",
          run: () => {
            reactToSource(sourceRef, on ? null : "hide");
            setToast(on ? `${label} is back` : `Hid ${label} — undo in Settings → Your sources`);
          },
        };
      }
      case "save":
      default: {
        const on = entry.saved === true;
        return { key, on, text: on ? "Saved 🔖 — remove" : "Save source", run: () => toggleSavedSource(sourceRef) };
      }
    }
  });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`More for ${label}`}
        title="Love, less, hide or save"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={`${ICON_BTN} border-loom-border text-loom-muted hover:text-loom-text hover:bg-loom-elevated ${triggerClassName}`}
      >
        <span aria-hidden>⋯</span>
      </button>
      {open && (
        <div
          ref={panelRef}
          id={menuId}
          role="menu"
          aria-label={`${label} preferences`}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              close();
            }
          }}
          onClick={(e) => e.stopPropagation()}
          className={`loom-menu absolute inset-0 z-20 flex flex-col justify-center gap-1 overflow-y-auto rounded-[inherit] p-2 ${className}`}
        >
          <p className="px-1 text-2xs text-loom-muted truncate">{label}</p>
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              onClick={() => {
                it.run();
                close();
              }}
              className={`w-full text-left text-xs px-2.5 min-h-9 rounded hover:bg-loom-elevated ${it.on ? "text-loom-accent" : "text-loom-text"}`}
            >
              {it.text}
            </button>
          ))}
          <button type="button" role="menuitem" onClick={close} className="w-full text-left text-xs px-2.5 min-h-9 rounded text-loom-muted hover:bg-loom-elevated">
            Cancel
          </button>
        </div>
      )}
    </>
  );
}
