"use client";

// Explicit two-source lookup builder with a bounded, inspectable preview before saving.
import { useEffect, useRef, useState } from "react";
import { useLoomStore } from "@/lib/store";
import {
  combineData,
  type LibraryAsset,
  type CombinationResult,
  type DataCombination,
} from "@/lib/dataLibrary";
import { loadLibraryAsset } from "@/lib/dataLibraryRuntime";
import type { InspectResult } from "@/lib/tauri";

export function DataCombinationBuilder({
  assets,
  initialRefs = [],
  onClose,
}: {
  assets: LibraryAsset[];
  initialRefs?: string[];
  onClose: () => void;
}) {
  const [leftRef, setLeftRef] = useState(initialRefs[0] ?? "");
  const [rightRef, setRightRef] = useState(initialRefs[1] ?? "");
  const [loaded, setLoaded] = useState<{
    left: InspectResult;
    right: InspectResult;
  } | null>(null);
  const [leftKey, setLeftKey] = useState("");
  const [rightKey, setRightKey] = useState("");
  const [mode, setMode] = useState<"left" | "inner">("left");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<CombinationResult | null>(null);
  const generation = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const left = assets.find((a) => a.ref === leftRef),
    right = assets.find((a) => a.ref === rightRef);
  useEffect(() => {
    heading.current?.focus();
    return () => {
      generation.current = -1;
    };
  }, []);
  function resetInputs(side: "left" | "right", value: string) {
    generation.current++;
    if (side === "left") setLeftRef(value);
    else setRightRef(value);
    setLoaded(null);
    setPreview(null);
    setError("");
    setBusy(false);
    setLeftKey("");
    setRightKey("");
  }
  async function load() {
    if (!left || !right) return;
    const request = ++generation.current;
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      const [l, r] = await Promise.all([
        loadLibraryAsset(left),
        loadLibraryAsset(right),
      ]);
      if (request !== generation.current) return;
      if (!l.sample.rows.length || !r.sample.rows.length)
        throw new Error(
          "A source has no rows yet. Let it connect, then load the fields again.",
        );
      setLoaded({ left: l, right: r });
      // Suggest a shared column name, but require an explicit preview to validate uniqueness.
      const shared =
        l.sample.columns.find((c) => r.sample.columns.includes(c)) ?? "";
      setLeftKey(shared);
      setRightKey(shared);
    } catch (e) {
      if (request === generation.current)
        setError(
          e instanceof Error ? e.message : "Could not load the sources.",
        );
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }
  function inspect() {
    if (!loaded) return;
    setError("");
    try {
      setPreview(
        combineData(
          loaded.left.sample,
          loaded.right.sample,
          leftKey,
          rightKey,
          mode,
        ),
      );
    } catch (e) {
      setPreview(null);
      setError(
        e instanceof Error ? e.message : "Could not combine these fields.",
      );
    }
  }
  function save() {
    if (!preview || !left || !right || !name.trim()) return;
    const recipe: DataCombination = {
      id: crypto.randomUUID(),
      name: name.trim(),
      left,
      right,
      leftKey,
      rightKey,
      mode,
      createdAt: Date.now(),
    };
    useLoomStore.getState().saveCombination(recipe);
    useLoomStore
      .getState()
      .setToast(
        `Saved “${recipe.name}”. Reopening it reads its sources again.`,
      );
    onClose();
  }
  return (
    <section className="library-builder" aria-labelledby="combination-heading">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="library-eyebrow">New combination</p>
          <h2
            id="combination-heading"
            ref={heading}
            tabIndex={-1}
            className="text-lg font-semibold outline-none"
          >
            Bring two sources together
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="loom-btn-ghost min-h-11"
        >
          Cancel
        </button>
      </div>
      <p className="text-sm text-loom-muted">
        Keep the first source’s records and look up matching fields in the
        second. Saved combinations remember the connection; reopen to rebuild
        from the latest available rows.
      </p>
      <div className="library-builder-grid">
        {(["left", "right"] as const).map((side) => (
          <label key={side} className="space-y-2 text-xs font-medium">
            <span>
              {side === "left" ? "1. Primary data" : "2. Lookup data"}
            </span>
            <select
              className="loom-input w-full min-h-11"
              value={side === "left" ? leftRef : rightRef}
              onChange={(e) => resetInputs(side, e.target.value)}
            >
              <option value="">Choose a dataset…</option>
              {assets
                .filter((a) => !a.file?.path.startsWith("combination://"))
                .map((a) => (
                  <option
                    key={a.ref}
                    value={a.ref}
                    disabled={a.ref === (side === "left" ? rightRef : leftRef)}
                  >
                    {a.name}
                  </option>
                ))}
            </select>
          </label>
        ))}
      </div>
      <p className="text-xs text-loom-muted">
        Live feeds use their current buffers. Remote CSVs are fetched again.
        Uploads use the copy on this device. Matching is exact and
        case-sensitive, with surrounding spaces ignored.
      </p>
      <button
        type="button"
        className="loom-btn-ghost border border-loom-border min-h-11 self-start"
        disabled={!left || !right || busy}
        onClick={() => void load()}
      >
        {busy
          ? "Loading source fields…"
          : loaded
            ? "Reload sources"
            : "Load fields"}
      </button>
      {loaded && (
        <>
          <div className="library-builder-grid">
            {(["left", "right"] as const).map((side) => (
              <label key={side} className="space-y-2 text-xs font-medium">
                <span>
                  {side === "left"
                    ? "Match this primary field"
                    : "To this unique lookup field"}{" "}
                  · {loaded[side].sample.rows.length.toLocaleString()} loaded
                  rows
                </span>
                <select
                  className="loom-input w-full min-h-11"
                  value={side === "left" ? leftKey : rightKey}
                  onChange={(e) => {
                    if (side === "left") setLeftKey(e.target.value);
                    else setRightKey(e.target.value);
                    setPreview(null);
                  }}
                >
                  <option value="">Choose a field…</option>
                  {loaded[side].sample.columns.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <label className="text-xs space-y-2">
            <span>Unmatched primary records</span>
            <select
              className="loom-input w-full min-h-11"
              value={mode}
              onChange={(e) => {
                setMode(e.target.value as "left" | "inner");
                setPreview(null);
              }}
            >
              <option value="left">
                Keep them, with empty lookup fields (left join)
              </option>
              <option value="inner">Leave them out (inner join)</option>
            </select>
          </label>
          <button
            type="button"
            className="loom-btn-primary min-h-11 self-start"
            disabled={!leftKey || !rightKey || busy}
            onClick={inspect}
          >
            Preview match
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-loom-danger">
          {error}
        </p>
      )}
      {preview && (
        <div className="space-y-4 border-t border-loom-border pt-4">
          <p role="status" className="text-sm font-medium">
            {preview.matched.toLocaleString()} matched ·{" "}
            {preview.unmatched.toLocaleString()} unmatched ·{" "}
            {preview.sample.rows.length.toLocaleString()} result rows
          </p>
          {preview.missingKeys > 0 && (
            <p className="text-xs text-loom-muted">
              {preview.missingKeys} primary records have no matching key.
            </p>
          )}
          {preview.unmatchedExamples.length > 0 && (
            <p className="text-xs text-loom-muted">
              Unmatched examples: {preview.unmatchedExamples.join(", ")}
            </p>
          )}
          {preview.partial && (
            <p className="text-xs text-loom-warning-text">
              Partial input: this preview uses loaded rows, not the full source
              tables. Missing matches may exist outside these rows.
            </p>
          )}
          {preview.matched === 0 && (
            <p className="text-xs text-loom-warning-text">
              No keys matched. Check that both fields describe the same thing
              with the same spelling and units.
            </p>
          )}
          <div className="overflow-x-auto max-h-48 border border-loom-border rounded">
            <table className="text-xs whitespace-nowrap w-full">
              <caption className="text-left p-2 text-loom-muted">
                First 5 result rows
              </caption>
              <thead>
                <tr>
                  {preview.sample.columns.map((c) => (
                    <th key={c} className="text-left p-2 bg-loom-elevated">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.sample.rows.slice(0, 5).map((r, i) => (
                  <tr key={i}>
                    {r.map((c, j) => (
                      <td key={j} className="p-2 border-t border-loom-border">
                        {c == null ? "—" : String(c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="block text-xs space-y-2">
            <span>Combination name</span>
            <input
              className="loom-input w-full min-h-11"
              aria-label="Combination name"
              maxLength={120}
              placeholder="For example, stations with regional context"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={!name.trim() || preview.matched === 0}
            onClick={save}
            className="loom-btn-primary min-h-11"
          >
            Save combination
          </button>
          <p className="text-xs text-loom-muted">
            Saved on this device. This saves the recipe, not a frozen copy or a
            background refresh job.
          </p>
        </div>
      )}
    </section>
  );
}
