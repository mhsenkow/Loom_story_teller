# Data library

The library is the workspace for keeping and finding datasets. The existing Explorer remains the table viewer. This separation makes it possible to manage data without losing the current chart.

## Information architecture

- **My data:** files in the current folder, hydrated browser uploads, and recently opened datasets. Search names and source descriptions, filter by origin, sort by recent use or name. Samples are labeled separately from personal files.
- **Collections:** a named intent that can mix datasets and saved charts. Each one lasts 3, 6, or 9 months from the last time you open it, add to it, or change its span, or it can be set to keep going. Untouched timed ones are dropped. A piece is shown as broken when that dataset or chart is no longer on the device. Source opens the original page; Explore opens the dataset or chart in Loom. Hearts, spark marks, and curious notes are separate filters and are not a collection.
- **Combinations:** named recipes referencing two sources and their matching fields. Lineage, join behavior, and refresh policy are visible before opening.
- **Discover:** feeds and curated packs, Socrata, TidyTuesday, US and UK catalogs, and external portals. A collection picker mounts one catalog at a time; government results initially render 12 cards with an explicit Show more action. Remote catalog searches do not run while browsing personal data.
- **Add data:** a task reached from My data or Collections, retaining the existing import, folder-link, URL and demo flows.

A single masthead combines library navigation and the back/expand controls. Each page header reads as one sentence, in the same pattern as chart discovery: “Discover. showing live feeds in all topics from anywhere, updated at any cadence, by Featured.” Digest, directory, and bookmarks are icons beside Find something to chart. My data reads “finding anything in all types by recently opened.” Cards scroll between that header and a persistent bottom search bar; filters support Escape and outside-click dismissal. Responsive card grids prioritize the dataset name, origin, description, row count when known, bookmark and Open. Digest and Directory use the same source cards. Details disclose source descriptions, known fields and locations without creating another navigation level. Selection is distinct from opening: two checkboxes enable Combine. On narrow surfaces, controls stack, the navigation becomes a two-column grid, and primary targets remain 44px. The wide library hides the chart inspector and preview footer.

## Connected combinations: first release

Choose primary and lookup sources, load their fields, select one matching field on each side, and preview. The lookup field must be unique among nonblank keys. Duplicate lookup keys are rejected rather than multiplying primary records. Keys use trimmed, case-sensitive textual equality; numeric `1` and string `"1"` match, but `"01"`, `"1"`, country aliases and date formats are not normalized. Null and empty keys never match. A left join retains unmatched primary rows with empty lookup fields; an inner join excludes them.

Preview reports matched and unmatched primary records, missing keys, unmatched examples and partial input coverage, with five sample output rows. Inputs use the existing loading budgets; output allocation is capped at one million cells. The `left_` and `right_` prefixes identify the input owning each column without introducing dotted field paths into chart encodings. A valid match preview and a name are required to save.

A recipe stores **source references and operations**, never result rows. Opening it reads current feed buffers (starting feeds if necessary), re-fetches remote CSVs, or reads the latest on-device file copy. Web feeds identified as stale or failing are rejected with a retry message. Feed refresh follows the source's own cadence; this is not a forced upstream poll. Desktop input loading uses the existing IPC inspect path with up to 30,000 rows. Wikipedia may need time to collect events before a combination can open.

The result opens in Explorer and can be charted, exported or analyzed in Dive. It is a snapshot from that open operation. Reopen from Combinations or Recent to refresh. There is no background job, continuous recomputation, nested recipe execution, arbitrary SQL, multi-column join or aggregation in this release. SQL on a combined result requires exporting CSV and opening it on desktop. Workspace backups carry recipes, but chart links do not reconstruct combination lineage.

## Storage and architecture

- `dataLibrary.ts`: serializable `LibraryAsset` and `DataCombination` models, parsing, inventory merging, protected upload paths, exact lookup engine.
- `store/dataLibrarySlice.ts`: library metadata and section selection in the existing Zustand store.
- `dataLibraryRuntime.ts`: read inputs through typed Tauri/web loaders and activate results through `datasetPipeline`.
- `HydrateStore`: versioned `loom-data-library` localStorage envelope, cross-tab adoption and storage failure reporting.
- `sourcePrefs`: the existing bookmark state and persistence, shared with feed/discover controls.
- `webFileStore`: skip bookmarked uploads and recipe inputs during LRU eviction. The 24-entry limit becomes a soft limit if all entries are protected. Explicit deletion, browser storage clearing and quota failures can still remove data; recipes report missing input files and ask for re-import.
- `workspaceBackup`: optional backward-compatible library metadata; imports preserve current items on identity collisions. Dataset rows remain outside the backup; file dependencies appear in the manifest.

No Worker routes, Rust commands, server storage, SQL engine or global row cache were added. Desktop, browser and iOS use the same bounded TypeScript join engine. Browser and native source loaders retain their existing differences.

## Next increments

1. **Collections:** named groups of references for a project or topic, independent of recipes. Membership should not imply copying or joining data.
2. **Composite keys and grain checks:** support state + year, country + date, etc. Show uniqueness and coverage before offering aggregation or joins. Do not infer that two columns with similar names are semantically compatible.
3. **Grouped measures:** aggregate each source to a declared grain before joining; keep units and denominator choices visible. This enables per-capita metrics without misleading many-to-many results.
4. **Freshness and dependency status:** persist last successful evaluation metadata, input timestamps, schema changes and errors. Add explicit Refresh and opt-in refresh while open before scheduling background computation.
5. **Recipe editing and portable lineage:** version recipe changes, handle missing sources and schema drift, and add an explicit sharing contract. Cloud sync and public publishing need their own product semantics.

These build on the source IDs and metadata in `DATA_FEED_COLLECTIONS_PLAN.md`; this implementation does not claim completion of that plan's canonical join keys or metrics phases.
