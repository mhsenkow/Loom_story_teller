// =================================================================
// SqlEditor — lazy CodeMirror 6 + column autocomplete (LOOM-215)
// =================================================================

"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { sql } from "@codemirror/lang-sql";
import { autocompletion, completeFromList } from "@codemirror/autocomplete";
import type { ColumnInfo } from "@/lib/store";
import { sqlIdent } from "@/lib/dive";

const CodeMirror = dynamic(() => import("@uiw/react-codemirror").then((m) => m.default), {
  ssr: false,
  loading: () => (
    <div className="loom-input font-mono text-xs min-h-24 w-full animate-pulse bg-loom-elevated/40" aria-hidden />
  ),
});

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
    const tableItems = tables.map((t) => ({ label: t, type: "class" }));
    return [
      sql({ schema: Object.fromEntries(tables.map((t) => [t, columns])) }),
      autocompletion({
        override: [completeFromList([...tableItems, ...columnItems])],
      }),
    ];
  }, [activeTable, columnStats]);

  return (
    <CodeMirror
      value={value}
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
