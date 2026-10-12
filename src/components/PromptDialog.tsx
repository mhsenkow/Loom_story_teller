// =================================================================
// PromptDialog — Modal text input (Zustand-driven)
// =================================================================
// `setPromptDialog({ title, defaultValue, onConfirm })` opens this UI.
// Inner form is keyed per open so defaultValue resets without effects.
// =================================================================

"use client";

import { useId, useRef, useState } from "react";
import { useLoomStore } from "@/lib/store";
import { Dialog } from "@/components/ui/Dialog";

type PromptDialogConfig = NonNullable<ReturnType<typeof useLoomStore.getState>["promptDialog"]>;

function PromptDialogForm({
  dialog,
  setPromptDialog,
}: {
  dialog: PromptDialogConfig;
  setPromptDialog: (v: PromptDialogConfig | null) => void;
}) {
  const [value, setValue] = useState(dialog.defaultValue ?? "");
  const confirmOnly = dialog.defaultValue === undefined;
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

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
    <Dialog
      open
      onClose={handleCancel}
      labelledBy={titleId}
      initialFocusRef={dialog.defaultValue !== undefined ? inputRef : undefined}
      zIndex={100}
      panelClassName="max-w-sm p-4 sm:p-5 space-y-4"
    >
      <h3 id={titleId} className="text-sm font-semibold text-loom-text tracking-tight">
        {dialog.title}
      </h3>
      {dialog.message ? (
        <p className="text-xs text-loom-muted leading-relaxed">{dialog.message}</p>
      ) : null}
      {dialog.defaultValue !== undefined ? (
        <>
          <label htmlFor={`${titleId}-input`} className="sr-only">
            {dialog.title}
          </label>
          <input
            ref={inputRef}
            id={`${titleId}-input`}
            type="text"
            className="loom-input w-full px-3 py-2 text-xs"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleConfirm();
              }
            }}
          />
        </>
      ) : null}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={handleCancel} className="loom-btn-ghost px-3 py-1.5 text-xs">
          Cancel
        </button>
        <button type="button" onClick={() => { if (confirmOnly) dialog.onConfirm(""); else handleConfirm(); }} className="loom-btn-primary px-3 py-1.5 text-xs">
          {dialog.confirmLabel ?? "OK"}
        </button>
      </div>
    </Dialog>
  );
}

export function PromptDialog() {
  const promptDialog = useLoomStore((s) => s.promptDialog);
  const setPromptDialog = useLoomStore((s) => s.setPromptDialog);
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
