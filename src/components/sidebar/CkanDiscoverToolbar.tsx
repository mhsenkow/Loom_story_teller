"use client";

import { useId } from "react";
import type { DataGovSortKey } from "@/lib/tauri";
import { DATA_GOV_ROW_OPTIONS, DATA_GOV_SORT_OPTIONS } from "./shared";

export function CkanDiscoverToolbar({
  queryDraft,
  onQueryDraftChange,
  onSearch,
  sort,
  onSortChange,
  rowLimit,
  onRowLimitChange,
  localFilter,
  onLocalFilterChange,
  loading,
}: {
  queryDraft: string;
  onQueryDraftChange: (s: string) => void;
  onSearch: () => void;
  sort: DataGovSortKey;
  onSortChange: (s: DataGovSortKey) => void;
  rowLimit: (typeof DATA_GOV_ROW_OPTIONS)[number];
  onRowLimitChange: (n: (typeof DATA_GOV_ROW_OPTIONS)[number]) => void;
  localFilter: string;
  onLocalFilterChange: (s: string) => void;
  loading: boolean;
}) {
  const searchId = useId();
  const sortId = useId();
  const maxId = useId();
  const filterId = useId();
  return (
    <div className="space-y-2 px-1 mb-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSearch();
        }}
        className="space-y-0.5"
      >
        <label htmlFor={searchId} className="text-2xs text-loom-muted">
          Search catalog
        </label>
        <div className="flex gap-1.5 mt-0.5">
          <input
            id={searchId}
            type="search"
            value={queryDraft}
            onChange={(e) => onQueryDraftChange(e.target.value)}
            placeholder="Keywords, agency, topic…"
            className="loom-input flex-1 min-w-0 text-xs py-1.5"
            disabled={loading}
            enterKeyHint="search"
          />
          <button type="submit" className="loom-btn-primary text-2xs px-2.5 py-1.5 shrink-0" disabled={loading}>
            Search
          </button>
        </div>
      </form>
      <div className="flex flex-wrap gap-2 items-end">
        <div className="min-w-0 flex-1 sm:flex-initial">
          <label htmlFor={sortId} className="text-2xs text-loom-muted block mb-0.5">
            Sort
          </label>
          <select
            id={sortId}
            value={sort}
            onChange={(e) => onSortChange(e.target.value as DataGovSortKey)}
            className="loom-input w-full sm:w-[11rem] text-xs py-1.5"
            disabled={loading}
          >
            {DATA_GOV_SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={maxId} className="text-2xs text-loom-muted block mb-0.5">
            Max results
          </label>
          <select
            id={maxId}
            value={rowLimit}
            onChange={(e) => onRowLimitChange(Number(e.target.value) as (typeof DATA_GOV_ROW_OPTIONS)[number])}
            className="loom-input text-xs py-1.5 w-full sm:w-[5.5rem]"
            disabled={loading}
          >
            {DATA_GOV_ROW_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor={filterId} className="text-2xs text-loom-muted">
          Filter this page
        </label>
        <input
          id={filterId}
          type="search"
          value={localFilter}
          onChange={(e) => onLocalFilterChange(e.target.value)}
          placeholder="Match title or publisher (instant)"
          className="loom-input w-full text-xs py-1.5 mt-0.5"
        />
      </div>
    </div>
  );
}
