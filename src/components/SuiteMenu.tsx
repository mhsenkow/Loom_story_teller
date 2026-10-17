// =================================================================
// SuiteMenu — search + waffle above the Preview footer
// =================================================================
// Glass command palette (⌘/Ctrl+K) sits beside the ibm.io tools grid.
// Floats just above Preview/Schema so it never fights the chrome.
// =================================================================

"use client";

import { useEffect, useRef, useState } from "react";
import { CommandPalette } from "@/components/CommandPalette";
import { useLoomStore } from "@/lib/store";
import { useIsMobile } from "@/lib/useMediaQuery";

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

/** Same quiet map as wordcount suite.js / NeoSpace SuiteMenu — think first. */
const GROUPS: SuiteGroup[] = [
  {
    id: "think",
    label: "think",
    tools: [
      {
        id: "bruh",
        label: "bruh",
        blurb: "ideas · paper",
        href: "https://bruh.ibm.io/",
      },
      {
        id: "loom",
        label: "loom",
        blurb: "data · stories",
        href: "https://loom.ibm.io/",
        current: true,
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
      {
        id: "neospace",
        label: "neospace",
        blurb: "people · feed",
        href: "https://neospace.ibm.io/",
      },
    ],
  },
  {
    id: "connect",
    label: "connect",
    tools: [
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
  const panelOpen = useLoomStore((s) => s.panelOpen);
  const isMobile = useIsMobile();
  const editingOnPhone = isMobile && panelOpen;
  const [open, setOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const rootRef = useRef<HTMLElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (editingOnPhone) setOpen(false);
  }, [editingOnPhone]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current) return;
      if (e.target instanceof Node && rootRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
      const t = e.target as HTMLInputElement | null;
      if (t?.tagName === "INPUT" && t.type === "password") return;
      e.preventDefault();
      setOpen(false);
      setPaletteOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
    <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    {!editingOnPhone && <nav
      ref={rootRef}
      className={`suite-menu absolute right-[max(10px,var(--safe-right))] bottom-full mb-1 z-[55] flex flex-col-reverse items-end pointer-events-none text-loom-muted ${
        open ? "z-[80]" : ""
      }`}
      aria-label="ibm.io tools"
      style={{ fontFamily: "var(--font-ui, inherit)", fontSize: 11 }}
    >
      <div className="pointer-events-auto flex items-center gap-0.5">
        <button
          ref={searchRef}
          type="button"
          className="suite-menu-btn relative inline-flex items-center justify-center size-11 p-0 border-0 rounded-sm bg-transparent text-inherit cursor-pointer opacity-70 transition-opacity hover:opacity-95 hover:text-loom-text focus-visible:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-loom-accent focus-visible:outline-offset-2"
          aria-label="Search and commands"
          title="Search · commands (⌘K)"
          onClick={() => {
            setOpen(false);
            setPaletteOpen(true);
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.7" />
            <path d="M16 16l4.5 4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </button>
        <button
          ref={toggleRef}
          type="button"
          className="suite-menu-btn relative inline-flex items-center justify-center size-11 p-0 border-0 rounded-sm bg-transparent text-inherit cursor-pointer opacity-70 transition-opacity hover:opacity-95 hover:text-loom-text focus-visible:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-loom-accent focus-visible:outline-offset-2"
          aria-expanded={open}
          aria-haspopup="dialog"
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
      </div>

      {open && (
        <div
          id="loomSuitePanel"
          role="region"
          aria-label="Tools"
          className="loom-menu pointer-events-auto mb-1 w-[min(292px,calc(100vw-24px))] max-h-[min(60vh,calc(100dvh-8rem))] overflow-auto overscroll-contain px-3 pt-3 pb-3.5 box-border rounded-sm"
        >
          <p className="m-0 mb-3 px-1 text-2xs leading-snug text-loom-label">
            Instruments that help you think clearer.
          </p>

          {GROUPS.map((group) => (
            <section key={group.id} className="mb-3 last:mb-2" aria-label={group.label}>
              <span className="block px-1 pb-1.5 text-2xs tracking-[0.12em] uppercase text-loom-label">
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
                          : "text-loom-text border-transparent hover:bg-loom-surface hover:border-loom-accent/40"
                      }`}
                    >
                      <span className="text-sm tracking-wide lowercase">{tool.label}</span>
                      <span className="text-2xs text-loom-label leading-snug">{tool.blurb}</span>
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
            className="block mt-1 pt-2 px-1 text-2xs tracking-wider lowercase no-underline text-loom-label border-t border-loom-border hover:text-loom-accent"
          >
            all tools
          </a>
        </div>
      )}
    </nav>}
    </>
  );
}
