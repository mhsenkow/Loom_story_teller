// =================================================================
// SuiteMenu — subtle waffle above the Preview footer
// =================================================================
// Same ibm.io tools grid as NeoSpace / wordcount. Floats just above
// the expandable Preview/Schema footer so it never fights the chrome.
// =================================================================

"use client";

import { useEffect, useRef, useState } from "react";

type SuiteTool = {
  id: string;
  label: string;
  blurb: string;
  href: string;
  current?: boolean;
};

type SuiteGroup = {
  id: string;
  label: string;
  tools: SuiteTool[];
};

const GROUPS: SuiteGroup[] = [
  {
    id: "think",
    label: "think",
    tools: [
      {
        id: "loom",
        label: "loom",
        blurb: "data · stories",
        href: "https://loom.ibm.io/",
        current: true,
      },
      {
        id: "bruh",
        label: "bruh",
        blurb: "ideas · paper",
        href: "https://bruh.ibm.io/",
      },
      {
        id: "notebook",
        label: "notebook",
        blurb: "cells · teach",
        href: "https://ibm.io/notebook/",
      },
      {
        id: "wordcount",
        label: "words",
        blurb: "count · draft",
        href: "https://ibm.io/wordcount/",
      },
    ],
  },
  {
    id: "connect",
    label: "connect",
    tools: [
      {
        id: "neospace",
        label: "neospace",
        blurb: "people · feed",
        href: "https://neospace.ibm.io/",
      },
      {
        id: "ibm",
        label: "ibm.io",
        blurb: "home · work",
        href: "https://ibm.io/",
      },
    ],
  },
];

export function SuiteMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current) return;
      if (e.target instanceof Node && rootRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <nav
      ref={rootRef}
      className={`suite-menu absolute right-[max(10px,var(--safe-right))] bottom-full mb-1 z-[55] flex flex-col-reverse items-end pointer-events-none text-loom-muted ${
        open ? "z-[80]" : ""
      }`}
      aria-label="ibm.io tools"
      style={{ fontFamily: "var(--font-ui, inherit)", fontSize: 11 }}
    >
      <button
        type="button"
        className="suite-menu-btn pointer-events-auto relative inline-flex items-center justify-center size-11 p-0 border-0 rounded-sm bg-transparent text-inherit cursor-pointer opacity-[0.42] transition-opacity hover:opacity-95 hover:text-loom-text focus-visible:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-loom-accent focus-visible:outline-offset-2"
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls="loomSuitePanel"
        aria-label="Tools"
        title="Tools"
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true" fill="currentColor" width="12" height="12">
          <rect x="1" y="1" width="3" height="3" rx=".4" />
          <rect x="8" y="1" width="3" height="3" rx=".4" />
          <rect x="1" y="8" width="3" height="3" rx=".4" />
          <rect x="8" y="8" width="3" height="3" rx=".4" />
        </svg>
      </button>

      {open && (
        <div
          id="loomSuitePanel"
          role="region"
          aria-label="Tools"
          className="pointer-events-auto mb-1 w-[min(292px,calc(100vw-24px))] max-h-[min(60vh,calc(100dvh-8rem))] overflow-auto overscroll-contain px-3 pt-3 pb-3.5 box-border rounded-sm border border-loom-border bg-loom-surface/96 shadow-loom-lg"
        >
          <p className="m-0 mb-3 px-1 text-[11px] leading-snug text-loom-muted">
            Instruments that help you think clearer.
          </p>

          {GROUPS.map((group) => (
            <section key={group.id} className="mb-3 last:mb-2" aria-label={group.label}>
              <span className="block px-1 pb-1.5 text-[9px] tracking-[0.12em] uppercase text-loom-muted opacity-75">
                {group.label}
              </span>
              <ul className="m-0 p-0 list-none grid grid-cols-2 gap-1">
                {group.tools.map((tool) => (
                  <li key={tool.id}>
                    <a
                      href={tool.href}
                      aria-current={tool.current ? "page" : undefined}
                      target={tool.current ? undefined : "_blank"}
                      rel={tool.current ? undefined : "noopener noreferrer"}
                      onClick={() => setOpen(false)}
                      className={`flex flex-col items-start gap-0.5 min-h-[52px] px-2 py-2 no-underline rounded-sm border transition-colors ${
                        tool.current
                          ? "text-loom-text border-loom-accent/55 bg-loom-accent/10"
                          : "text-loom-muted border-transparent hover:text-loom-text hover:bg-loom-elevated hover:border-loom-accent/40"
                      }`}
                    >
                      <span className="text-[13px] tracking-wide lowercase">{tool.label}</span>
                      <span className="text-[10px] opacity-75 leading-snug">{tool.blurb}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <a
            href="https://ibm.io/tools/"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="block mt-1 pt-2 px-1 text-[11px] tracking-wider lowercase no-underline text-loom-muted border-t border-loom-border hover:text-loom-accent"
          >
            all tools
          </a>
        </div>
      )}
    </nav>
  );
}
