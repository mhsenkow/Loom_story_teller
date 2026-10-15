// =================================================================
// SqlEditor — lazy CodeMirror 6 + column autocomplete (LOOM-215)
// =================================================================

"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { sql } from "@codemirror/lang-sql";
import { autocompletion, completeFromList } from "@codemirror/autocomplete";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import type { ColumnInfo } from "@/lib/store";
import { sqlIdent } from "@/lib/dive";

const CodeMirror = dynamic(() => import("@uiw/react-codemirror").then((m) => m.default), {
  ssr: false,
  loading: () => (
    <div className="loom-input font-mono text-xs min-h-24 w-full animate-pulse bg-loom-elevated/40" aria-hidden />
  ),
});

// Editor chrome + syntax colors from the app's theme tokens, so every Loom theme
// (dark, light, high-contrast…) gets a readable editor — the CodeMirror default
// is a white light theme that showed as a bright box in dark mode.
const loomEditorTheme = EditorView.theme({
  "&": { backgroundColor: "var(--loom-elevated)", color: "var(--loom-text)" },
  ".cm-content": { caretColor: "var(--loom-accent)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--loom-accent)" },
  "&.cm-focused": { outline: "none" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "color-mix(in srgb, var(--loom-accent) 30%, transparent)",
  },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--loom-text) 5%, transparent)" },
  ".cm-placeholder": { color: "var(--loom-muted)" },
  ".cm-tooltip": {
    backgroundColor: "var(--loom-surface)",
    color: "var(--loom-text)",
    border: "1px solid var(--loom-border)",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "color-mix(in srgb, var(--loom-accent) 25%, transparent)",
    color: "var(--loom-text)",
  },
});

const loomHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [t.keyword, t.operatorKeyword, t.modifier], color: "var(--loom-accent-text, var(--loom-accent))", fontWeight: "600" },
    { tag: [t.string, t.special(t.string)], color: "var(--loom-success)" },
    { tag: [t.number, t.bool, t.null], color: "var(--loom-warning-text, var(--loom-warning))" },
    { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--loom-muted)", fontStyle: "italic" },
    { tag: [t.name, t.propertyName, t.typeName, t.className], color: "var(--loom-text)" },
    { tag: [t.operator, t.punctuation, t.bracket], color: "var(--loom-label, var(--loom-muted))" },
  ]),
);

export type SqlEditorProps = {
  value: string;
  onChange: (v: string) => void;
  onRun?: () => void;
  activeTable: string;
  columnStats: ColumnInfo[];
  placeholder?: string;
  describedBy?: string;
};

export function SqlEditor({
  value,
  onChange,
  onRun,
  activeTable,
  columnStats,
  placeholder,
  describedBy,
}: SqlEditorProps) {
  const extensions = useMemo(() => {
    const tables = [activeTable];
    const columns = (columnStats ?? []).map((c) => c.name);
    const columnItems = columns.flatMap((name) => {
      const quoted = sqlIdent(name);
      return [
        { label: quoted, type: "property" },
        { label: name, type: "property" },
      ];
    });
    const tableItems = tables.map((tbl) => ({ label: tbl, type: "class" }));
    return [
      loomEditorTheme,
      loomHighlight,
      sql({ schema: Object.fromEntries(tables.map((tbl) => [tbl, columns])) }),
      autocompletion({
        override: [completeFromList([...tableItems, ...columnItems])],
      }),
    ];
  }, [activeTable, columnStats]);

  return (
    <CodeMirror
      value={value}
      theme="none"
      height="160px"
      className="loom-input font-mono text-xs min-h-24 max-h-[50vh] w-full overflow-hidden rounded-md border border-loom-border"
      basicSetup={{ lineNumbers: false, foldGutter: false }}
      extensions={extensions}
      onChange={onChange}
      placeholder={placeholder}
      aria-describedby={describedBy}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          onRun?.();
        }
        if (e.key === "Tab") {
          e.preventDefault();
          onChange(`${value}  `);
        }
      }}
    />
  );
}
