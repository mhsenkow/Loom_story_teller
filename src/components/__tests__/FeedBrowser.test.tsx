// Sidebar feed browser: hide → card disappears → "Show" restores it; ♥ lifts within a group.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FeedBrowser } from "../sidebar/FeedBrowser";
import { useLoomStore } from "@/lib/store";
import { emptySourcePreferences } from "@/lib/sourcePreferences";
import { SOURCE_BY_KIND } from "@/lib/sourceRegistry";

beforeEach(() => useLoomStore.getState().setSourcePrefs(emptySourcePreferences()));
afterEach(() => {
  cleanup();
  useLoomStore.getState().setSourcePrefs(emptySourcePreferences());
});

const card = (ref: string) => document.querySelector(`[data-source-ref="${ref}"]`);
const groupRefs = (group: string) =>
  [...document.querySelectorAll(`[data-feed-group="${group}"] [data-source-ref]`)].map((el) => el.getAttribute("data-source-ref"));

describe("FeedBrowser", () => {
  it("hides a feed from its menu and brings it back from the hidden chip", () => {
    render(<FeedBrowser renderPack={(p) => <div data-source-ref={`pack:${p.id}`}>{p.title}</div>} />);
    const label = SOURCE_BY_KIND.crypto.label;
    expect(card("feed:crypto")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: `More for ${label}` }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Hide source" }));
    expect(card("feed:crypto")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "1 hidden · Show" }));
    expect(card("feed:crypto")).not.toBeNull();
  });

  it("loving lifts a card to the top of its group and Save adds a Saved group", () => {
    render(<FeedBrowser renderPack={(p) => <div data-source-ref={`pack:${p.id}`}>{p.title}</div>} />);
    const space = groupRefs("space");
    const last = space[space.length - 1]!;
    const kind = last.slice(5) as keyof typeof SOURCE_BY_KIND;
    fireEvent.click(screen.getByRole("button", { name: `Love ${SOURCE_BY_KIND[kind].label}` }));
    expect(groupRefs("space")[0]).toBe(last);
    expect(screen.getByRole("option", { name: "For you" })).toBeInTheDocument();
    act(() => useLoomStore.getState().toggleSavedSource("feed:hn"));
    expect(groupRefs("saved")).toEqual(["feed:hn"]);
  });

  it("searches feeds and packs together", () => {
    render(<FeedBrowser renderPack={(p) => <div data-source-ref={`pack:${p.id}`}>{p.title}</div>} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search feeds and packs" }), { target: { value: "earthquake" } });
    expect(card("feed:usgs")).not.toBeNull();
    expect(card("feed:crypto")).toBeNull();
  });
});
