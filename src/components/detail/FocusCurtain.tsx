// Full-height reading column. Dims the workspace so a complex explanation can be read top to bottom.
"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FOCUSABLE_SELECTOR, trapTabKey } from "@/lib/focusTrap";

export function FocusCurtain({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const panelRef = useRef<HTMLElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      (panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? panelRef.current)?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (panelRef.current) trapTabKey(panelRef.current, event);
    };
    window.addEventListener("keydown", onKeyDown, true);
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown, true);
      root.style.overflow = overflow;
    };
  }, [open]);

  useEffect(() => {
    if (open) return;
    const previous = restoreRef.current;
    if (previous && document.contains(previous)) previous.focus();
  }, [open]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="loom-focus-curtain fixed inset-0 z-[180]">
      <button type="button" className="loom-focus-scrim absolute inset-0" aria-label="Close explanation" onClick={onClose} />
      <aside ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="loom-focus-title" tabIndex={-1} className="loom-focus-panel absolute inset-y-0 right-0 flex w-full max-w-[28rem] flex-col border-l border-loom-border bg-loom-bg pt-[var(--safe-top)] pb-[var(--safe-bottom)]">
        <header className="flex items-center gap-3 border-b border-loom-border px-5 py-4">
          <p className="sr-only">Forecast explanation</p>
          <h2 id="loom-focus-title" className="flex-1 text-base font-semibold">{title}</h2>
          <button type="button" className="loom-btn-ghost min-h-8 min-w-8" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}
