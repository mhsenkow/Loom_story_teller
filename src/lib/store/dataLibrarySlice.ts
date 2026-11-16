// Shared library metadata. Collections are ephemeral intents; source marks stay in sourcePrefs.
import type { LoomState } from "./types";
import type { StoreApi } from "zustand";
import {
  emptyDataLibrary,
  parseDataLibrary,
  type DataLibrary,
  type LibraryAsset,
  type DataCombination,
  type LibrarySection,
} from "../dataLibrary";
import {
  collectionAlive,
  touchCollection,
  type CollectionPiece,
  type CollectionSpan,
  type DataCollection,
} from "../collections";
import { catalogEntryFor } from "../sourceCatalog";

function collectionId(): string {
  return `col-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export interface DataLibrarySlice {
  dataLibrary: DataLibrary;
  librarySection: LibrarySection;
  setLibrarySection: (section: LibrarySection) => void;
  rememberLibraryAsset: (asset: LibraryAsset) => void;
  saveCombination: (recipe: DataCombination) => void;
  removeCombination: (id: string) => void;
  createCollection: (input: {
    intent: string;
    span: CollectionSpan;
    pieces?: CollectionPiece[];
  }) => string;
  touchLibraryCollection: (id: string) => void;
  addCollectionPiece: (id: string, piece: CollectionPiece) => void;
  removeCollectionPiece: (id: string, key: string) => void;
  removeCollection: (id: string) => void;
  setCollectionSpan: (id: string, span: CollectionSpan) => void;
  renameCollection: (id: string, intent: string) => void;
  /** Drop expired collections and fold old bookmarks once. */
  refreshCollections: () => void;
}
export const dataLibraryInitialState = {
  dataLibrary: emptyDataLibrary(),
  librarySection: "mine" as LibrarySection,
};
export function createDataLibrarySlice(
  set: StoreApi<LoomState>["setState"],
): DataLibrarySlice {
  return {
    ...dataLibraryInitialState,
    setLibrarySection: (librarySection) => set({ librarySection }),
    rememberLibraryAsset: (asset) =>
      set((s) => ({
        dataLibrary: parseDataLibrary({
          ...s.dataLibrary,
          assets: [
            asset,
            ...s.dataLibrary.assets.filter((a) => a.ref !== asset.ref),
          ],
        }),
      })),
    saveCombination: (recipe) =>
      set((s) => ({
        dataLibrary: parseDataLibrary({
          ...s.dataLibrary,
          combinations: [
            recipe,
            ...s.dataLibrary.combinations.filter((c) => c.id !== recipe.id),
          ],
        }),
      })),
    removeCombination: (id) =>
      set((s) => ({
        dataLibrary: {
          ...s.dataLibrary,
          combinations: s.dataLibrary.combinations.filter((c) => c.id !== id),
        },
      })),
    createCollection: (input) => {
      const id = collectionId();
      const now = Date.now();
      const next: DataCollection = {
        id,
        intent: input.intent.trim().slice(0, 120) || "Untitled",
        span: input.span,
        createdAt: now,
        touchedAt: now,
        pieces: input.pieces ?? [],
      };
      set((s) => ({
        dataLibrary: parseDataLibrary({
          ...s.dataLibrary,
          collections: [next, ...s.dataLibrary.collections],
        }),
      }));
      return id;
    },
    touchLibraryCollection: (id) =>
      set((s) => ({
        dataLibrary: {
          ...s.dataLibrary,
          collections: s.dataLibrary.collections.map((c) =>
            c.id === id ? touchCollection(c) : c,
          ),
        },
      })),
    addCollectionPiece: (id, piece) =>
      set((s) => ({
        dataLibrary: {
          ...s.dataLibrary,
          collections: s.dataLibrary.collections.map((c) => {
            if (c.id !== id) return c;
            const key = piece.kind === "data" ? piece.ref : piece.id;
            const exists = c.pieces.some((p) =>
              p.kind === piece.kind && (p.kind === "data" ? p.ref : p.id) === key,
            );
            return touchCollection({
              ...c,
              pieces: exists ? c.pieces : [...c.pieces, piece].slice(0, 24),
            });
          }),
        },
      })),
    removeCollectionPiece: (id, key) =>
      set((s) => ({
        dataLibrary: {
          ...s.dataLibrary,
          collections: s.dataLibrary.collections.map((c) =>
            c.id === id
              ? touchCollection({
                  ...c,
                  pieces: c.pieces.filter((p) =>
                    (p.kind === "data" ? `data:${p.ref}` : `chart:${p.id}`) !== key,
                  ),
                })
              : c,
          ),
        },
      })),
    removeCollection: (id) =>
      set((s) => ({
        dataLibrary: {
          ...s.dataLibrary,
          collections: s.dataLibrary.collections.filter((c) => c.id !== id),
        },
      })),
    setCollectionSpan: (id, span) =>
      set((s) => ({
        dataLibrary: {
          ...s.dataLibrary,
          collections: s.dataLibrary.collections.map((c) =>
            c.id === id ? touchCollection({ ...c, span }) : c,
          ),
        },
      })),
    renameCollection: (id, intent) =>
      set((s) => ({
        dataLibrary: {
          ...s.dataLibrary,
          collections: s.dataLibrary.collections.map((c) =>
            c.id === id
              ? touchCollection({ ...c, intent: intent.trim().slice(0, 120) || c.intent })
              : c,
          ),
        },
      })),
    refreshCollections: () =>
      set((s) => {
        const now = Date.now();
        let collections = s.dataLibrary.collections.filter((c) => collectionAlive(c, now));
        let foldedBookmarks = s.dataLibrary.foldedBookmarks;
        if (!foldedBookmarks) {
          const pieces: CollectionPiece[] = [];
          for (const [ref, pref] of Object.entries(s.sourcePrefs.entries)) {
            if (!pref.saved) continue;
            const name =
              catalogEntryFor(ref)?.label ||
              s.dataLibrary.assets.find((a) => a.ref === ref)?.name ||
              ref.split("/").pop() ||
              ref;
            pieces.push({ kind: "data", ref, name });
          }
          if (pieces.length) {
            collections = [
              {
                id: "from-bookmarks",
                intent: "From bookmarks",
                span: 6,
                createdAt: now,
                touchedAt: now,
                pieces: pieces.slice(0, 24),
              },
              ...collections.filter((c) => c.id !== "from-bookmarks"),
            ];
          }
          foldedBookmarks = true;
        }
        return {
          dataLibrary: { ...s.dataLibrary, collections, foldedBookmarks },
        };
      }),
  };
}
