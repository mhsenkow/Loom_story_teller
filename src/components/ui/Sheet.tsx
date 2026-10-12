// =================================================================
// Sheet — side / bottom drawer overlay (LOOM-280, LOOM-402)
// =================================================================

"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { trapTabKey, FOCUSABLE_SELECTOR } from "@/lib/focusTrap";
import { useKeyboardBottomInset } from "@/lib/useVisualViewport";

export type SheetProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** `left` = data sidebar; `bottom` = detail panel sheet. */
  side?: "left" | "bottom";
  labelledBy?: string;
  ariaLabel?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  zIndex?: number;
  className?: string;
  panelClassName?: string;
  /** id for aria-controls from toggles */
  panelId?: string;
};

export function Sheet({
  open,
  onClose,
  children,
  side = "bottom",
  labelledBy,
  ariaLabel,
  initialFocusRef,
  zIndex = 40,
  className = "",
  panelClassName = "",
  panelId,
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const keyboardInset = useKeyboardBottomInset();

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

  if (!open) return null;

  const isLeft = side === "left";

  return (
    <>
      <button
        type="button"
        className={`fixed inset-0 loom-overlay animate-fade-in ${className}`}
        style={{ zIndex: zIndex - 5 }}
        aria-label="Close"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        id={panelId}
        role="dialog"
        aria-modal="true"
        {...(labelledBy ? { "aria-labelledby": labelledBy } : {})}
        {...(ariaLabel ? { "aria-label": ariaLabel } : {})}
        className={`fixed flex flex-col bg-loom-surface border-loom-border shadow-loom-lg outline-none ${
          isLeft
            ? "inset-y-0 left-0 z-40 w-[min(100vw-2.5rem,20rem)] border-r max-h-dvh"
            : "inset-x-0 bottom-0 z-40 w-full border-t rounded-t-2xl max-h-[min(88dvh,44rem)] animate-slide-up"
        } ${panelClassName}`}
        style={{
          zIndex,
          paddingBottom: "var(--safe-bottom)",
          marginBottom: !isLeft && keyboardInset > 0 ? keyboardInset : undefined,
          maxHeight: !isLeft && keyboardInset > 0 ? `min(88dvh, calc(100dvh - ${keyboardInset}px))` : undefined,
        }}
        tabIndex={-1}
      >
        {children}
      </div>
    </>
  );
}
