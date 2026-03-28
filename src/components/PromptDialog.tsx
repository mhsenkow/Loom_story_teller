// =================================================================
// PromptDialog — Modal text input (Zustand-driven)
// =================================================================
// `setPromptDialog({ title, defaultValue, onConfirm })` opens this UI.
// Inner form is keyed per open so defaultValue resets without effects.
// =================================================================

"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useLoomStore } from "@/lib/store";

type PromptDialogConfig = NonNullable<ReturnType<typeof useLoomStore.getState>["promptDialog"]>;

function PromptDialogForm({
  dialog,
  setPromptDialog,
}: {
  dialog: PromptDialogConfig;
  setPromptDialog: (v: PromptDialogConfig | null) => void;
}) {
  const [value, setValue] = useState(dialog.defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 50);
    return () => window.clearTimeout(t);
  }, []);

  const handleConfirm = () => {
    const result = dialog.onConfirm(value) as void | Promise<unknown>;
    if (typeof result === "object" && result != null && typeof (result as Promise<unknown>).then === "function") {
      (result as Promise<unknown>).then(() => setPromptDialog(null));
    } else {
      setPromptDialog(null);
    }
  };

  const handleCancel = () => {
    dialog.onConfirm(null);
    setPromptDialog(null);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 overflow-hidden"
      onClick={handleCancel}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="loom-card max-w-sm w-full p-4 space-y-4 shadow-2xl border-loom-border bg-loom-surface rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-loom-text">{dialog.title}</h3>
        <input
          ref={inputRef}
          type="text"
          className="loom-input w-full px-3 py-2 text-xs"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleConfirm();
            } else if (e.key === "Escape") {
              e.preventDefault();
              handleCancel();
            }
          }}
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={handleCancel} className="loom-btn-ghost px-3 py-1.5 text-xs">
            Cancel
          </button>
          <button type="button" onClick={handleConfirm} className="loom-btn-primary px-3 py-1.5 text-xs">
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

export function PromptDialog() {
  const { promptDialog, setPromptDialog } = useLoomStore();
  const genRef = useRef(0);
  const prevDialogRef = useRef<typeof promptDialog>(undefined);

  if (promptDialog !== prevDialogRef.current) {
    if (promptDialog) {
      genRef.current += 1;
    }
    prevDialogRef.current = promptDialog;
  }

  if (!promptDialog) return null;

  return <PromptDialogForm key={genRef.current} dialog={promptDialog} setPromptDialog={setPromptDialog} />;
}
