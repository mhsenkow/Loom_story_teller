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
    <div className="library-sentence">
      <form
        className="library-sentence-phrase"
        onSubmit={(e) => {
          e.preventDefault();
          onSearch();
        }}
      >
        <span className="library-sentence-lead">searching</span>
        <label htmlFor={searchId}>
          <span className="sr-only">Search catalog</span>
          <input
            id={searchId}
            type="search"
            value={queryDraft}
            onChange={(e) => onQueryDraftChange(e.target.value)}
            placeholder="keywords"
            disabled={loading}
            enterKeyHint="search"
          />
        </label>
        <button
          type="submit"
          className="discover-icon-button"
          disabled={loading}
          aria-label="Search catalog"
        >
          <SearchIcon />
        </button>
      </form>
      <span className="library-sentence-phrase">
        <span aria-hidden>by</span>
        <label htmlFor={sortId}>
          <span className="sr-only">Sort</span>
          <select
            id={sortId}
            value={sort}
            onChange={(e) => onSortChange(e.target.value as DataGovSortKey)}
            disabled={loading}
          >
            {DATA_GOV_SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </span>
      <span className="library-sentence-phrase">
        <span aria-hidden>up to</span>
        <label htmlFor={maxId}>
          <span className="sr-only">Max results</span>
          <select
            id={maxId}
            value={rowLimit}
            onChange={(e) =>
              onRowLimitChange(
                Number(e.target.value) as (typeof DATA_GOV_ROW_OPTIONS)[number],
              )
            }
            disabled={loading}
          >
            {DATA_GOV_ROW_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </span>
      <span className="library-sentence-phrase">
        <span aria-hidden>matching</span>
        <label htmlFor={filterId}>
          <span className="sr-only">Filter this page</span>
          <input
            id={filterId}
            type="search"
            value={localFilter}
            onChange={(e) => onLocalFilterChange(e.target.value)}
            placeholder="this page"
          />
        </label>
      </span>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}
