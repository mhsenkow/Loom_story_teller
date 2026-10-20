// Worker transforms for the 2026-10 keyless batch (workers/extraSources.ts) →
// browser parser (parseColumnar). Fixtures are shared with sources_tests.rs.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  arxivRows,
  bgpRows,
  blueskyRows,
  bookRows,
  chicagoCrimeRows,
  faaMinutes,
  faaRows,
  fdaRows,
  fedSpendingRows,
  fireballRows,
  githubEventRows,
  gutenbergAuthor,
  iodaRows,
  lobbyingRows,
  nycInspectionRows,
  nycParkingRows,
  powerballRows,
  satelliteRows,
  vehicleRecallRows,
  type Columnar,
} from "../../../workers/extraSources";
import { SOURCE_DEFS, type SourceKind } from "../sourceRegistry";
import { parseSourceRows } from "../webStreams";

const ROOT = resolve(__dirname, "../../..");
const text = (n: string) => readFileSync(resolve(ROOT, `src-tauri/tests/fixtures/sources/${n}`), "utf8");
const fx = (n: string) => JSON.parse(text(n));

/** Transform → JSON round trip → web parser; returns rows keyed by column name. */
function parsed(kind: SourceKind, body: Columnar): Record<string, unknown>[] {
  const def = SOURCE_DEFS.find((d) => d.kind === kind)!;
  expect(body.columns).toEqual(def.columns);
  const rows = parseSourceRows(kind, JSON.parse(JSON.stringify(body)));
  return rows.map((r) => Object.fromEntries(def.columns.map((c, i) => [c, r[i]])));
}

describe("extraSources transforms", () => {
  it("fireballs: signed lat/lon and UTC timestamps", () => {
    const [r] = parsed("fireballs", fireballRows(fx("fireballs.json")));
    expect(r).toMatchObject({ ts: "2026-10-04T03:14:45.000Z", latitude: -41.8, longitude: -173.1, altitude_km: 26.9, velocity_kms: 13.8, energy_e10j: 5.4, impact_kt: 0.18 });
  });

  it("satellites: derived orbit numbers and object type", () => {
    const rows = parsed("satellites", satelliteRows(fx("satellites.json")));
    expect(rows[0]).toMatchObject({ norad_id: 694, name: "ATLAS CENTAUR 2", object_type: "Payload", launch_year: 1963 });
    expect(rows[0]!.period_min).toBeCloseTo(101.92, 1);
    expect(rows[0]!.apogee_km as number).toBeGreaterThan(rows[0]!.perigee_km as number);
    expect(rows.some((r) => r.object_type === "Rocket body")).toBe(true);
  });

  it("internet_outages: countries only, newest first, drop %", () => {
    const rows = parsed("internet_outages", iodaRows(fx("ioda.json")));
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.country !== "AS1234")).toBe(true);
    const fi = rows.find((r) => r.country_code === "FI")!;
    expect(fi.drop_pct).toBe(24.2);
    expect(String(rows[0]!.ts) >= String(rows[1]!.ts)).toBe(true);
  });

  it("faa_delays: every status kind from XML", () => {
    const rows = parsed("faa_delays", faaRows(text("faa.xml")));
    const by = Object.fromEntries(rows.map((r) => [r.airport, r]));
    expect(by.SFO).toMatchObject({ status_type: "Ground delay", avg_delay_min: 63, max_delay_min: 121, reason: "low ceilings & wind" });
    expect(by.EWR).toMatchObject({ status_type: "Ground stop" });
    expect(by.EGE).toMatchObject({ status_type: "Arrival delay", min_delay_min: 31, max_delay_min: 45, trend: "Increasing" });
    expect(by.SNA).toMatchObject({ status_type: "Closure" });
    expect(rows[0]!.updated).toBe("2026-10-20T16:22:47.000Z");
    expect(faaMinutes("2 hours")).toBe(120);
  });

  it("lobbying: org names, amount, unique issue codes, no people", () => {
    const body = lobbyingRows(fx("lda.json"));
    expect(JSON.stringify(body)).not.toContain("someone");
    const [r] = parsed("lobbying", body);
    expect(r).toMatchObject({ registrant: "WILLIAMS AND JENSEN, PLLC", client: "NORFOLK SOUTHERN CORPORATION", client_state: "VA", amount_usd: 60000, amount_kind: "income", filing_period: "third quarter", posted: "2026-10-20T16:22:37.000Z" });
    expect(r!.n_issues).toBe(String(r!.issue_codes).split(",").length);
  });

  it("fda_recalls: merges categories, dedupes, ISO dates", () => {
    const rows = parsed("fda_recalls", fdaRows([fx("fda_food.json"), fx("fda_drug.json"), fx("fda_food.json")]));
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ product_type: "Food", report_date: "2026-10-07" });
    expect(new Set(rows.map((r) => r.product_type))).toEqual(new Set(["Food", "Drugs"]));
  });

  it("vehicle_recalls: yes/no flags and counts", () => {
    const [r] = parsed("vehicle_recalls", vehicleRecallRows(fx("nhtsa.json")));
    expect(r).toMatchObject({ nhtsa_id: "26V680000", report_date: "2026-10-16", potentially_affected: 3686, park_outside: false, do_not_drive: false });
  });

  it("arxiv: entries, primary category, author counts", () => {
    const rows = parsed("arxiv", arxivRows([text("arxiv.xml"), text("arxiv.xml")]));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: "2610.26863v1", primary_category: "cs.LG", field: "Computer science", published: "2026-10-19T17:59:59.000Z" });
    expect(rows[0]!.n_authors as number).toBeGreaterThan(0);
    expect(rows[0]!.n_categories as number).toBeGreaterThanOrEqual(1);
  });

  it("github_events: no actor logins", () => {
    const body = githubEventRows(fx("github_events.json"));
    expect(JSON.stringify(body)).not.toContain("someone");
    expect(parsed("github_events", body)[0]).toMatchObject({ event_type: "Push", repo: "e-X-plorer/ai-workshop-start", is_org: false });
  });

  it("books: both sites ranked", () => {
    const rows = parsed("books", bookRows(fx("openlibrary.json"), fx("gutendex.json")));
    expect(rows[0]).toMatchObject({ site: "Open Library", rank: 1, title: "Atomic Habits", language: "en", editions: 42 });
    expect(rows[2]).toMatchObject({ site: "Project Gutenberg", rank: 1, author: "Jane Austen", downloads: 190246 });
    expect(gutenbergAuthor("Shelley, Mary Wollstonecraft (1797-1851)")).toBe("Mary Wollstonecraft Shelley");
  });

  it("city feeds parse Socrata rows", () => {
    expect(parsed("nyc_inspections", nycInspectionRows(fx("nyc_inspections.json")))[0]).toMatchObject({ restaurant: "FISH CHEEKS", borough: "Manhattan", score: 0, inspection_date: "2026-10-17T00:00:00.000Z" });
    expect(parsed("chicago_crime", chicagoCrimeRows(fx("chicago_crime.json")))[0]).toMatchObject({ primary_type: "MOTOR VEHICLE THEFT", arrest: false, ts: "2026-10-12T00:00:00.000Z" });
    const parking = parsed("nyc_parking", nycParkingRows([{ summons_number: "1", issue_date: "2025-07-27T00:00:00.000", fine_amount: "180", state: "NY", plate: "ABC123" }, { summons_number: "2", issue_date: "70/40/2000" }]));
    expect(parking[0]).toMatchObject({ issue_date: "2025-07-27", fine_amount: 180, plate_state: "NY" });
    expect(parking[1]!.issue_date).toBeNull();
    expect(JSON.stringify(parking)).not.toContain("ABC123");
  });

  it("powerball and fed_spending", () => {
    expect(parsed("powerball", powerballRows(fx("powerball.json")))[0]).toMatchObject({ draw_date: "2026-10-19", yr: 2026, n1: 8, n5: 48, powerball: 23, multiplier: 4 });
    const [t] = parsed("fed_spending", fedSpendingRows(fx("usaspending.json")));
    expect(t).toMatchObject({ abbreviation: "TREAS", fiscal_year: 2026 });
    expect(t!.pct_of_total).toBeCloseTo(24.609, 2);
  });

  it("bluesky: counts by language and hashtag, never text or DIDs", () => {
    const post = (lang: string, tags: string[]) =>
      JSON.stringify({
        did: "did:plc:secret",
        kind: "commit",
        commit: { operation: "create", collection: "app.bsky.feed.post", record: { text: "private words", langs: [lang], facets: tags.map((tag) => ({ features: [{ $type: "app.bsky.richtext.facet#tag", tag }] })) } },
      });
    const msgs = [post("en", ["Art"]), post("en-US", ["art", "art"]), post("ja", []), "{bad", JSON.stringify({ kind: "identity" })];
    const body = blueskyRows(msgs, 5, Date.parse("2026-10-20T16:24:30Z"));
    const s = JSON.stringify(body);
    expect(s).not.toContain("private words");
    expect(s).not.toContain("did:plc");
    const rows = parsed("bluesky", body);
    expect(rows[0]).toMatchObject({ dimension: "total", posts: 3, posts_per_min: 36, ts: "2026-10-20T16:24:00.000Z" });
    expect(rows.find((r) => r.dimension === "language" && r.key === "en")!.posts).toBe(2);
    expect(rows.find((r) => r.dimension === "hashtag")!).toMatchObject({ key: "#art", posts: 2 });
  });

  it("bgp: announcements by origin, both directions by prefix length", () => {
    const upd = (path: unknown[], ann: string[], wd: string[]) =>
      JSON.stringify({ type: "ris_message", data: { type: "UPDATE", path, announcements: ann.length ? [{ next_hop: "x", prefixes: ann }] : [], withdrawals: wd } });
    const msgs = [upd([1, 2, 3], ["10.0.0.0/24", "10.0.1.0/24"], []), upd([], [], ["10.9.0.0/24", "2001:db8::/32"]), upd([4, 3], ["2001:db8::/48"], [])];
    const rows = parsed("bgp", bgpRows(msgs, 5, Date.parse("2026-10-20T16:24:30Z")));
    expect(rows[0]).toMatchObject({ dimension: "total", announcements: 3, withdrawals: 2 });
    expect(rows.find((r) => r.key === "AS3")!.announcements).toBe(3);
    expect(rows.find((r) => r.key === "IPv4 /24")).toMatchObject({ announcements: 2, withdrawals: 1 });
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });
});
