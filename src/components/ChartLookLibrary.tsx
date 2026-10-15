"use client";

// Personal visual presets, available across datasets and saved on this device.
import { useState } from "react";
import { useLoomStore } from "@/lib/store";
import { MAX_CUSTOM_CHART_LOOKS } from "@/lib/customChartLooks";

export function ChartLookLibrary() {
  const looks = useLoomStore((s) => s.customChartLooks);
  const save = useLoomStore((s) => s.saveCustomChartLook);
  const apply = useLoomStore((s) => s.applyCustomChartLook);
  const remove = useLoomStore((s) => s.removeCustomChartLook);
  const [name, setName] = useState("");
  const replaces = looks.some(
    (look) => look.name.toLowerCase() === name.trim().toLowerCase(),
  );
  return (
    <div className="space-y-2">
      <p className="text-2xs text-loom-muted">
        Save this look to reuse on any chart. Styles only; data and fields stay
        with each chart.
      </p>
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (save(name)) setName("");
        }}
      >
        <input
          aria-label="Look name"
          placeholder="Name this look…"
          maxLength={64}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="loom-input min-w-0 flex-1 text-xs min-h-9 px-2"
        />
        <button
          type="submit"
          disabled={!name.trim()}
          className="loom-btn-primary min-h-9 px-2 text-2xs disabled:opacity-40"
        >
          {replaces ? "Update look" : "Save look"}
        </button>
      </form>
      {replaces && (
        <p role="status" className="text-2xs text-loom-muted">
          Saving replaces your existing “{name.trim()}” look.
        </p>
      )}
      {!looks.length && (
        <p className="text-2xs text-loom-muted">
          Your favorite looks will appear here.
        </p>
      )}
      {looks.map((look) => (
        <div
          key={look.id}
          className="flex gap-1 rounded-md border border-loom-border items-center px-1"
        >
          <button
            type="button"
            onClick={() => apply(look.id)}
            className="flex-1 min-w-0 min-h-9 px-1.5 text-left text-xs text-loom-text hover:text-loom-accent"
            title={`Apply ${look.name} look`}
          >
            <span className="block truncate">{look.name}</span>
          </button>
          <button
            type="button"
            onClick={() => save(look.name)}
            aria-label={`Update ${look.name} from current style`}
            title="Replace with the current chart style"
            className="loom-btn-ghost min-h-9 px-1.5 text-2xs"
          >
            Update
          </button>
          <button
            type="button"
            onClick={() => remove(look.id)}
            aria-label={`Remove ${look.name} look`}
            className="loom-btn-ghost min-h-9 min-w-9 text-loom-muted"
          >
            ×
          </button>
        </div>
      ))}
      <p className="text-2xs text-loom-muted">
        On this device · {looks.length}/{MAX_CUSTOM_CHART_LOOKS} saved looks
      </p>
    </div>
  );
}
