// =================================================================
// Community votes + comments — rules, SQLite store, and HTTP routes
// =================================================================
// The store runs over real SQLite (node:sqlite) through the same SqlLike
// surface the Durable Object provides, so tallies, caps and report-to-hide
// are exercised against actual SQL. The route tests drive SocialService,
// which is what the Durable Object wraps.
// =================================================================

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  LIMITS,
  REPORTS_TO_HIDE,
  canonicalLink,
  checkComment,
  checkName,
  defaultName,
  hashNetwork,
  hashVoter,
  networkPrefix,
  validKey,
} from "../socialCore";
import { SocialStore, wilsonLower, type SqlLike } from "../socialStore";
import { SocialService } from "../socialService";
import { handleSocial, type SocialBackend } from "../socialRoutes";
import { recipeKeyFromLinkPayload } from "../../src/lib/socialRecipe";

function sqliteShim(): SqlLike {
  const db = new DatabaseSync(":memory:");
  return {
    exec<T>(query: string, ...bindings: unknown[]) {
      const stmt = db.prepare(query);
      const rows = /^\s*(SELECT|WITH)/i.test(query)
        ? (stmt.all(...(bindings as never[])) as T[])
        : (stmt.run(...(bindings as never[])), [] as T[]);
      return { toArray: () => rows.map((r) => ({ ...(r as object) }) as T) };
    },
  };
}

const COLUMNS = ["id", "place", "magnitude", "depth", "status", "ts"];
const encode = (payload: unknown) => `chart=${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
const decode = (link: string) => JSON.parse(Buffer.from(link.slice(6), "base64url").toString("utf8"));
const recipe = (extra: Record<string, unknown> = {}, top: Record<string, unknown> = {}) => ({
  v: 1,
  src: "stream://usgs",
  ...top,
  c: { k: "bar", x: "place", y: "magnitude", a: "max", ...extra },
});
/** A canonical link and the key it hashes to, as the routes would store them. */
const canon = (extra: Record<string, unknown> = {}) => canonicalLink(encode(recipe(extra)), "usgs", COLUMNS)!;
const KEY = canon().key;
const LINK = { link: canon().link };
const NO_LINK = { link: null };
const net = (name: string) => [`${name}-today`, `${name}-yesterday`];

describe("socialCore rules", () => {
  it("accepts item keys shaped like <kind>:<hash> only", () => {
    expect(validKey("usgs:abc123")).toBe(true);
    expect(validKey("USGS:abc")).toBe(false);
    expect(validKey("usgs:abc;drop")).toBe(false);
    expect(validKey("x".repeat(41) + ":a")).toBe(false);
  });

  it("cleans and checks comments", () => {
    expect(checkComment("  wow​   look at BRL  ")).toEqual({ ok: true, text: "wow look at BRL" });
    expect(checkComment("a").ok).toBe(false);
    expect(checkComment("x".repeat(401)).ok).toBe(false);
    expect(checkComment("see https://spam.example")).toMatchObject({ ok: false, error: "Links aren’t allowed in comments." });
    for (const spam of ["buy at cheapcoins.xyz now", "evil.shop/win", "join t.me/pumpgroup", "go to bit.do/x", "visit evil.dev today"]) {
      expect(checkComment(spam).ok, spam).toBe(false);
    }
    // A missing space after a full stop is not a link.
    expect(checkComment("Great chart.Next one please").ok).toBe(true);
    expect(checkComment("THIS IS THE BEST CHART I HAVE EVER SEEN").ok).toBe(false);
    expect(checkComment("niceeeeeeeeeeeeeeeeee").ok).toBe(false);
    expect(checkComment("kys").ok).toBe(false);
    // A tall column of line breaks collapses to one line.
    const tall = checkComment(Array.from({ length: 40 }, () => "a").join("\n\n"));
    expect(tall.ok && tall.text.includes("\n")).toBe(false);
  });

  it("checks display names, including official-sounding ones", () => {
    expect(checkName("")).toEqual({ ok: true, text: "" });
    expect(checkName("  Ada  Lovelace ")).toEqual({ ok: true, text: "Ada Lovelace" });
    for (const bad of ["admin", "admin.", "Loom Team", "Official Loom", "Loom Support", "<script>", "x".repeat(25)]) {
      expect(checkName(bad).ok, bad).toBe(false);
    }
  });

  it("rebuilds chart links from validated parts and drops everything else", () => {
    const dirty = encode(
      recipe(
        { ti: "USGS confirms M9 tomorrow", st: "free crypto at evil.shop", tf: ["place"], emv: { a: "x" } },
        { h: "kys losers", u: "https://evil.example/x.csv", pn: [{ note: "call 555-0100" }], vo: { titleFontSize: 99 }, bs: "stacked" },
      ),
    );
    const out = canonicalLink(dirty, "usgs", COLUMNS)!;
    expect(decode(out.link)).toEqual({ v: 1, src: "stream://usgs", bs: "stacked", c: { k: "bar", x: "place", y: "magnitude", a: "max" } });
    expect(out.link).not.toMatch(/evil|kys|555/);
    // The key is the recipe's own hash, so the app and the server agree on it.
    expect(out.key).toBe(recipeKeyFromLinkPayload("usgs", decode(out.link)));
  });

  it("refuses links for other feeds, files, unknown columns and odd settings", () => {
    expect(canonicalLink(encode(recipe()), "hn", COLUMNS)).toBeNull();
    expect(canonicalLink(encode({ ...recipe(), src: "file:payroll.csv" }), "usgs", COLUMNS)).toBeNull();
    expect(canonicalLink(encode(recipe({ y: "free_crypto_at_evil_shop" })), "usgs", COLUMNS)).toBeNull();
    expect(canonicalLink(encode(recipe({ a: "median; drop" })), "usgs", COLUMNS)).toBeNull();
    expect(canonicalLink(encode(recipe({ tn: 100000 })), "usgs", COLUMNS)).toBeNull();
    expect(canonicalLink(encode(recipe({ k: "not a kind!" })), "usgs", COLUMNS)).toBeNull();
    expect(canonicalLink("chart=!!!", "usgs", COLUMNS)).toBeNull();
    expect(canonicalLink(undefined, "usgs", COLUMNS)).toBeNull();
  });

  it("hashes voters and networks without exposing them", async () => {
    const a = await hashVoter("device-token-0000000001", "p");
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toContain("device");
    expect(await hashVoter("device-token-0000000001", "other")).not.toBe(a);
    const day1 = await hashNetwork("203.0.113.9", Date.UTC(2026, 10, 11, 12), "p");
    const day2 = await hashNetwork("203.0.113.9", Date.UTC(2026, 10, 12, 12), "p");
    expect(day1).not.toBe(day2);
    expect(defaultName(a)).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });

  it("treats every address in one IPv6 /64 as the same network", async () => {
    expect(networkPrefix("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2");
    expect(networkPrefix("2001:0db8:0001:0002:bbbb:cccc:dddd:eeee")).toBe("2001:db8:1:2");
    expect(networkPrefix("2001:db8::1")).toBe("2001:db8:0:0");
    expect(networkPrefix("198.51.100.7")).toBe("198.51.100.7");
    const now = Date.UTC(2026, 10, 11);
    expect(await hashNetwork("2001:db8:1:2::1", now, "p")).toBe(await hashNetwork("2001:db8:1:2:ffff::9", now, "p"));
    expect(await hashNetwork("2001:db8:1:3::1", now, "p")).not.toBe(await hashNetwork("2001:db8:1:2::1", now, "p"));
  });
});

describe("SocialStore", () => {
  it("counts one vote per device and lets people change or clear it", () => {
    const s = new SocialStore(sqliteShim());
    s.vote(KEY, "v1", net("n1"), 1, LINK, 1000);
    s.vote(KEY, "v1", net("n1"), 1, NO_LINK, 1001);
    s.vote(KEY, "v2", net("n2"), 1, NO_LINK, 1002);
    expect(s.item(KEY)).toMatchObject({ up: 2, down: 0, kind: "usgs", link: LINK.link });
    s.vote(KEY, "v1", net("n1"), -1, NO_LINK, 1003);
    expect(s.item(KEY)).toMatchObject({ up: 1, down: 1 });
    s.vote(KEY, "v1", net("n1"), 0, NO_LINK, 1004);
    expect(s.item(KEY)).toMatchObject({ up: 1, down: 0 });
    expect(s.myVote(KEY, "v1")).toBe(0);
    expect(s.myVote(KEY, "v2")).toBe(1);
  });

  it("only creates an entry from a real vote or comment that carries its link", () => {
    const s = new SocialStore(sqliteShim());
    // Asking to clear a vote that doesn't exist creates nothing.
    expect(s.vote(KEY, "v1", net("n1"), 0, LINK, 1000).ok).toBe(true);
    expect(s.item(KEY)).toBeNull();
    // A vote on a key nobody has described is refused.
    expect(s.vote("usgs:junk1", "v1", net("n1"), 1, NO_LINK, 1001)).toMatchObject({ ok: false, status: 400 });
    expect(s.comment("usgs:junk1", "v1", net("n1"), "", "hello there", NO_LINK, 1002)).toMatchObject({ ok: false, status: 400 });
    expect(s.item("usgs:junk1")).toBeNull();
  });

  it("limits how many new charts one network can add in a day", () => {
    const s = new SocialStore(sqliteShim());
    for (let i = 0; i < LIMITS.newItemsPerDayPerNetwork; i++) {
      expect(s.vote(`usgs:k${i}`, `v${i}`, net("flood"), 1, LINK, 1000 + i).ok).toBe(true);
    }
    expect(s.vote("usgs:onemore", "vx", net("flood"), 1, LINK, 5000)).toMatchObject({ ok: false, status: 429 });
    expect(s.vote("usgs:onemore", "vy", net("elsewhere"), 1, LINK, 5001).ok).toBe(true);
  });

  it("caps how many devices on one network can move a chart, even across midnight", () => {
    const s = new SocialStore(sqliteShim());
    const evening = Date.UTC(2026, 10, 11, 23, 59);
    for (let i = 0; i < LIMITS.votersPerNetworkPerItem; i++) {
      expect(s.vote(KEY, `v${i}`, ["net-day1", "net-day0"], 1, LINK, evening + i).ok).toBe(true);
    }
    // Two minutes later it is a new UTC day: today's hash is new, yesterday's is the old one.
    const afterMidnight = evening + 120_000;
    expect(s.vote(KEY, "v-extra", ["net-day2", "net-day1"], 1, NO_LINK, afterMidnight)).toMatchObject({ ok: false, status: 429 });
    expect(s.item(KEY)!.up).toBe(LIMITS.votersPerNetworkPerItem);
    // A different network still counts.
    expect(s.vote(KEY, "v-other", net("other"), 1, NO_LINK, afterMidnight + 1).ok).toBe(true);
  });

  it("hides a comment only when reports come from different networks", () => {
    const s = new SocialStore(sqliteShim());
    const posted = s.comment(KEY, "author", net("n0"), "", "Big one near Fiji", LINK, 5000);
    expect(posted.ok).toBe(true);
    const id = posted.ok ? posted.value.id : "";
    expect(posted.ok && posted.value.name).toBe(defaultName("author"));
    expect(s.item(KEY)!.comments).toBe(1);
    expect(s.thread(KEY, "author").comments[0]).toMatchObject({ body: "Big one near Fiji", own: true });
    expect(s.thread(KEY, "someone").comments[0]!.own).toBe(false);
    expect(s.report(id, "author", net("n0"))).toMatchObject({ ok: false });

    // Ten throwaway IDs on one network are one voice — also across midnight.
    for (let i = 0; i < 10; i++) s.report(id, `sock${i}`, i % 2 ? ["mob-day2", "mob-day1"] : ["mob-day1", "mob-day0"], 6000 + i);
    expect(s.thread(KEY, null).comments).toHaveLength(1);

    for (let i = 1; i < REPORTS_TO_HIDE; i++) s.report(id, `r${i}`, net(`rn${i}`), 7000 + i);
    expect(s.thread(KEY, null).comments).toHaveLength(0);
    expect(s.item(KEY)!.comments).toBe(0);
  });

  it("lets authors, and only authors, delete their comments", () => {
    const s = new SocialStore(sqliteShim());
    const posted = s.comment(KEY, "author", net("n0"), "Ada", "Second thought", LINK, 7000);
    expect(posted.ok && posted.value.name).toBe("Ada");
    const id = posted.ok ? posted.value.id : "";
    expect(s.deleteOwn(id, "someone-else").ok).toBe(false);
    expect(s.deleteOwn(id, "author").ok).toBe(true);
    expect(s.item(KEY)!.comments).toBe(0);
  });

  it("rate-limits bursts of comments and refuses exact repeats", () => {
    const s = new SocialStore(sqliteShim());
    expect(s.comment(KEY, "a", net("n"), "", "first", LINK, 1000).ok).toBe(true);
    expect(s.comment(KEY, "a", net("n"), "", "first", NO_LINK, 1001)).toMatchObject({ ok: false, status: 409 });
    for (let i = 0; i < LIMITS.commentsPer10MinPerDevice - 1; i++) s.comment(KEY, "a", net("n"), "", `more ${i}`, NO_LINK, 1002 + i);
    expect(s.comment(KEY, "a", net("n"), "", "one too many", NO_LINK, 1100)).toMatchObject({ ok: false, status: 429 });
  });

  it("summarizes favorites, least liked, discussion and recent comments", () => {
    const s = new SocialStore(sqliteShim());
    const now = Date.UTC(2026, 10, 11);
    for (let i = 0; i < 6; i++) s.vote("usgs:good", `g${i}`, net(`gn${i}`), 1, LINK, now + i);
    s.vote("hn:lucky", "l0", net("ln0"), 1, LINK, now);
    for (let i = 0; i < 4; i++) s.vote("fx:meh", `m${i}`, net(`mn${i}`), -1, LINK, now + i);
    s.comment("fx:meh", "c1", net("cn"), "", "Axis is confusing", NO_LINK, now + 10);
    const sum = s.summary(now + 20);
    expect(sum.favorites.map((i) => i.key)).toEqual(["usgs:good", "hn:lucky"]);
    expect(sum.leastLiked[0]!.key).toBe("fx:meh");
    expect(sum.discussed[0]!.key).toBe("fx:meh");
    expect(sum.counts["fx:meh"]).toEqual([0, 4, 1]);
    expect(sum.latest["fx:meh"]!.body).toBe("Axis is confusing");
    expect(sum.recent[0]).toMatchObject({ body: "Axis is confusing", link: LINK.link });
    // Nothing a client typed besides comments and names is in the summary.
    expect(Object.keys(sum.favorites[0]!).sort()).toEqual(["active", "comments", "down", "key", "kind", "link", "up"]);
  });

  it("keeps one hash secret for good", () => {
    const s = new SocialStore(sqliteShim());
    const first = s.pepper();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(s.pepper("a different seed later")).toBe(first);
    expect(new SocialStore(sqliteShim()).pepper("seeded")).toBe("seeded");
  });

  it("ranks many positive votes above a lucky single vote", () => {
    expect(wilsonLower(20, 2)).toBeGreaterThan(wilsonLower(1, 0));
    expect(wilsonLower(0, 0)).toBe(0);
  });
});

describe("social routes", () => {
  const ORIGIN = "https://loom.ibm.io";
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const columnsFor = (kind: string) => (kind === "usgs" ? COLUMNS : null);
  const deps = (backend: SocialBackend | null, originOk = true, ip = "198.51.100.7") => ({ backend, reply, originOk, ip, columnsFor });
  const post = (path: string, body: unknown) =>
    new Request(`${ORIGIN}${path}`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const u = (p: string) => new URL(`${ORIGIN}${p}`);
  const voter = "AbCdEfGhIjKlMnOpQrSt12";
  const setup = () => {
    const store = new SocialStore(sqliteShim());
    return { store, service: new SocialService(store) };
  };

  it("votes, comments, and reads a thread end to end", async () => {
    const { store, service } = setup();
    const vote = await handleSocial(post("/api/social/vote", { key: KEY, voter, value: 1, link: encode(recipe()) }), u("/api/social/vote"), deps(service));
    expect(vote.status).toBe(200);
    expect(store.item(KEY)).toMatchObject({ up: 1, link: LINK.link });

    const comment = await handleSocial(post("/api/social/comment", { key: KEY, voter, body: "Nice map", name: "Ada" }), u("/api/social/comment"), deps(service));
    expect(comment.status).toBe(200);

    const thread = await handleSocial(post("/api/social/thread", { key: KEY, voter }), u("/api/social/thread"), deps(service));
    const body = (await thread.json()) as { myVote: number; comments: { name: string; own: boolean }[] };
    expect(body.myVote).toBe(1);
    expect(body.comments[0]).toMatchObject({ name: "Ada", own: true });

    // Neither the device token nor the address reaches storage.
    const dump = JSON.stringify([store.summary(), store.thread(KEY, null)]);
    expect(dump).not.toContain(voter);
    expect(dump).not.toContain("198.51.100.7");
  });

  it("refuses foreign origins, bad input, unknown feeds and links in comments", async () => {
    const { service } = setup();
    expect((await handleSocial(post("/api/social/vote", { key: KEY, voter, value: 1 }), u("/api/social/vote"), deps(service, false))).status).toBe(403);
    expect((await handleSocial(post("/api/social/vote", { key: KEY, voter, value: 5 }), u("/api/social/vote"), deps(service))).status).toBe(400);
    expect((await handleSocial(post("/api/social/vote", { key: KEY, value: 1 }), u("/api/social/vote"), deps(service))).status).toBe(400);
    expect((await handleSocial(post("/api/social/vote", { key: "notafeed:abc", voter, value: 1 }), u("/api/social/vote"), deps(service))).status).toBe(400);
    const spam = await handleSocial(post("/api/social/comment", { key: KEY, voter, body: "visit www.spam.example", link: encode(recipe()) }), u("/api/social/comment"), deps(service));
    expect(spam.status).toBe(400);
  });

  it("stores no client text: titles, pins and URLs in a link never reach other people", async () => {
    const { store, service } = setup();
    const dirty = encode(recipe({ ti: "M9 will hit LA tomorrow", st: "evil.shop" }, { h: "kys losers", u: "https://evil.example", pn: [{ t: "spam" }] }));
    const res = await handleSocial(post("/api/social/vote", { key: KEY, voter, value: 1, link: dirty, title: "also ignored" }), u("/api/social/vote"), deps(service));
    expect(res.status).toBe(200);
    expect(JSON.stringify(store.summary())).not.toMatch(/M9|evil|kys|spam|ignored/);
  });

  it("cleans links saved before the server rebuilt them, on the way out and on the next vote", async () => {
    const { store, service } = setup();
    const dirty = encode(recipe({ ti: "M9 will hit LA tomorrow" }, { h: "kys losers" }));
    // An entry written by the earlier code, which stored the client's link as sent.
    store.vote(KEY, "old-voter", net("n0"), 1, { link: dirty }, 1000);
    expect(store.item(KEY)?.link).toBe(dirty);

    const summary = await handleSocial(new Request(`${ORIGIN}/api/social/summary`), u("/api/social/summary"), deps(service));
    expect(JSON.stringify(await summary.json())).not.toMatch(/M9|kys/);
    const thread = await handleSocial(post("/api/social/thread", { key: KEY, voter }), u("/api/social/thread"), deps(service));
    expect((await thread.json()) as { item: { link: string } }).toMatchObject({ item: { link: LINK.link } });

    await handleSocial(post("/api/social/vote", { key: KEY, voter, value: 1, link: encode(recipe()) }), u("/api/social/vote"), deps(service));
    expect(store.item(KEY)?.link).toBe(LINK.link);
  });

  it("won't create an entry from a link for a different chart, or with no vote", async () => {
    const { store, service } = setup();
    // A valid public-feed link, but its recipe doesn't hash to the claimed key.
    const wrong = await handleSocial(post("/api/social/vote", { key: "usgs:popular1", voter, value: 1, link: encode(recipe()) }), u("/api/social/vote"), deps(service));
    expect(wrong.status).toBe(400);
    expect(store.item("usgs:popular1")).toBeNull();
    // value 0 never creates or annotates anything.
    const zero = await handleSocial(post("/api/social/vote", { key: KEY, voter, value: 0, link: encode(recipe()) }), u("/api/social/vote"), deps(service));
    expect(zero.status).toBe(200);
    expect(store.item(KEY)).toBeNull();
  });

  it("counts one IPv6 household once however many addresses it uses", async () => {
    const { store, service } = setup();
    let accepted = 0;
    for (let i = 0; i < 20; i++) {
      const res = await handleSocial(
        post("/api/social/vote", { key: KEY, voter: `Device${String(i).padStart(18, "0")}`, value: -1, link: encode(recipe()) }),
        u("/api/social/vote"),
        deps(service, true, `2001:db8:1:2::${(i + 1).toString(16)}`),
      );
      if (res.status === 200) accepted++;
    }
    // Twenty addresses, one /64: only the per-network allowance counts.
    expect(accepted).toBe(LIMITS.votersPerNetworkPerItem);
    expect(store.item(KEY)!.down).toBe(accepted);
  });

  it("serves a summary without a voter, and says when community is off", async () => {
    const { service } = setup();
    const res = await handleSocial(new Request(`${ORIGIN}/api/social/summary`), u("/api/social/summary"), deps(service));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ counts: {}, favorites: [] });
    const off = await handleSocial(new Request(`${ORIGIN}/api/social/summary`), u("/api/social/summary"), deps(null));
    expect(off.status).toBe(503);
  });
});
