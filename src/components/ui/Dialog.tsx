// =================================================================
// Dialog — accessible modal overlay (LOOM-280)
// =================================================================
// Focus trap, Escape, focus restore, labelledby/describedby.
// =================================================================

"use client";

import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { trapTabKey, getFocusableElements, FOCUSABLE_SELECTOR } from "@/lib/focusTrap";
import { useKeyboardBottomInset } from "@/lib/useVisualViewport";

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Visible title id — pass to a heading inside children. */
  labelledBy?: string;
  describedBy?: string;
  /** Fallback when no labelledBy heading exists. */
  ariaLabel?: string;
  /** Focus this element on open; otherwise first focusable in the panel. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** z-index layer (default 100). */
  zIndex?: number;
  className?: string;
  panelClassName?: string;
  /** Bottom sheet on small screens (default true). */
  sheetOnMobile?: boolean;
};

export function Dialog({
  open,
  onClose,
  children,
  labelledBy,
  describedBy,
  ariaLabel,
  initialFocusRef,
  zIndex = 100,
  className = "",
  panelClassName = "",
  sheetOnMobile = true,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const keyboardInset = useKeyboardBottomInset();
  const fallbackLabelId = useId();
  const labelProps = labelledBy
    ? { "aria-labelledby": labelledBy }
    : ariaLabel
      ? { "aria-label": ariaLabel }
      : { "aria-labelledby": fallbackLabelId };

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const t = window.requestAnimationFrame(() => {
      const target =
        initialFocusRef?.current ??
        panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
        panelRef.current;
      target?.focus();
    });
    return () => window.cancelAnimationFrame(t);
  }, [open, initialFocusRef]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      const panel = panelRef.current;
      if (panel && trapTabKey(panel, e)) return;
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  useEffect(() => {
    if (open) return;
    const prev = restoreFocusRef.current;
    if (prev && typeof prev.focus === "function" && document.contains(prev)) {
      prev.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const sheet =
    sheetOnMobile !== false
      ? "items-end sm:items-center p-0 sm:p-4 rounded-t-2xl sm:rounded-xl mb-[var(--safe-bottom)] sm:mb-0 animate-slide-up"
      : "items-center p-4 rounded-xl";

  return (
    <div
      className={`fixed inset-0 flex items-end sm:items-center justify-center loom-overlay animate-fade-in overflow-hidden ${className}`}
      style={{ zIndex }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      {...labelProps}
      {...(describedBy ? { "aria-describedby": describedBy } : {})}
    >
      {!labelledBy && !ariaLabel && (
        <span id={fallbackLabelId} className="sr-only">
          Dialog
        </span>
      )}
      <div
        ref={panelRef}
        className={`loom-card w-full shadow-loom-lg border border-loom-border bg-loom-surface ${sheet} ${panelClassName}`}
        style={{
          marginBottom: keyboardInset > 0 ? `max(var(--safe-bottom), ${keyboardInset}px)` : undefined,
        }}
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}

/** Focus the first focusable element inside a panel (for tests / callers). */
export function focusFirstInPanel(panel: HTMLElement | null): void {
  const list = getFocusableElements(panel);
  (list[0] ?? panel)?.focus();
}
