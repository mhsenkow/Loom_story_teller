// =================================================================
// SegThumb — sliding selection pill for every .loom-seg
// =================================================================
// One listener for the whole app. The pill measures the pressed item
// and springs between options, so segmented controls don't each need
// their own indicator. First placement skips the transition.
// =================================================================

"use client";

import { useEffect } from "react";

const ACTIVE = '[aria-pressed="true"], [aria-current="page"], [data-active="true"]';

function place(seg: HTMLElement) {
  let thumb = seg.querySelector<HTMLElement>(":scope > .loom-seg-thumb");
  const fresh = !thumb;
  if (!thumb) {
    thumb = document.createElement("span");
    thumb.className = "loom-seg-thumb";
    thumb.setAttribute("aria-hidden", "true");
    seg.prepend(thumb);
  }
  const active = seg.querySelector<HTMLElement>(ACTIVE);
  // classList.add always writes `class`, which the observer watches — guard it or sync loops forever.
  if (!seg.classList.contains("loom-seg-tracked")) seg.classList.add("loom-seg-tracked");
  if (!active) {
    thumb.style.opacity = "0";
    return;
  }
  if (fresh) thumb.style.transition = "none";
  thumb.style.opacity = "1";
  thumb.style.width = `${active.offsetWidth}px`;
  thumb.style.height = `${active.offsetHeight}px`;
  thumb.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
  if (fresh) requestAnimationFrame(() => { thumb!.style.transition = ""; });
}

/** Mount once. Keeps every segmented control's selection pill in place. */
export function SegThumb() {
  useEffect(() => {
    let queued = false;
    const resize = new ResizeObserver(() => { schedule(); });
    function sync() {
      document.querySelectorAll<HTMLElement>(".loom-seg").forEach((seg) => {
        place(seg);
        resize.observe(seg);
      });
    }
    function schedule() {
      if (queued) return;
      queued = true;
      // A frame, not a microtask: the browser still gets to paint if anything re-triggers us.
      requestAnimationFrame(() => {
        queued = false;
        sync();
      });
    }
    sync();
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-pressed", "aria-current", "data-active", "class"],
    });
    window.addEventListener("resize", schedule);
    return () => {
      mo.disconnect();
      resize.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, []);
  return null;
}
