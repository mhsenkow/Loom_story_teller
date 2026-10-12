// =================================================================
// focusTrap — focusable elements and tab cycling for modal overlays
// =================================================================

export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function getFocusableElements(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1 && el.offsetParent !== null,
  );
}

/** Move focus to the next/previous focusable node inside `root`, wrapping at edges. */
export function trapTabKey(root: HTMLElement, e: KeyboardEvent): boolean {
  if (e.key !== "Tab") return false;
  const focusable = getFocusableElements(root);
  if (focusable.length === 0) {
    e.preventDefault();
    return true;
  }
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  const active = document.activeElement as HTMLElement | null;
  if (e.shiftKey) {
    if (active === first || !root.contains(active)) {
      e.preventDefault();
      last.focus();
    }
  } else if (active === last || !root.contains(active)) {
    e.preventDefault();
    first.focus();
  }
  return true;
}
