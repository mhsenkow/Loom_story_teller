"use client";

import { useEffect, useRef, useState } from "react";
import { useLoomStore } from "@/lib/store";

export function PromptDialog() {
    const { promptDialog, setPromptDialog } = useLoomStore();
    const [value, setValue] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (promptDialog) {
            setValue(promptDialog.defaultValue);
            setTimeout(() => {
                inputRef.current?.focus();
                inputRef.current?.select();
            }, 50);
        }
    }, [promptDialog]);

    if (!promptDialog) return null;

    const handleConfirm = () => {
        const result = promptDialog.onConfirm(value) as void | Promise<unknown>;
        if (typeof result === "object" && result != null && typeof (result as Promise<unknown>).then === "function") {
            (result as Promise<unknown>).then(() => setPromptDialog(null));
        } else {
            setPromptDialog(null);
        }
    };

    const handleCancel = () => {
        promptDialog.onConfirm(null);
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
                <h3 className="text-sm font-semibold text-loom-text">{promptDialog.title}</h3>
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
                    <button
                        type="button"
                        onClick={handleCancel}
                        className="loom-btn-ghost px-3 py-1.5 text-xs"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleConfirm}
                        className="loom-btn-primary px-3 py-1.5 text-xs"
                    >
                        OK
                    </button>
                </div>
            </div>
        </div>
    );
}
