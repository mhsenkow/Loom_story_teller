#!/usr/bin/env node
import fs from "node:fs";

const DOC = new URL("../docs/LOOM_700_IMPROVEMENTS_2026-10-12.md", import.meta.url);

/** @type {Record<string, string>} */
const NOTES = {
  "198": "Policy in `docs/BROWSER_JSON_FLATTEN.md`.",
  "278": "Inventory in `docs/LOCAL_DATA_CONTROLS.md`.",
  "458": "Design in `docs/OFFLINE_CACHING.md`.",
  "466": "CSS upgrade notes in `DEPENDENCY_AUDIT_2026-10-12.md`.",
  "477": "Leading-null anomaly index tests in `smartAnalytics.test.ts`.",
  "478": "`chartPaletteContrast.test.ts`.",
  "479": "`creativeRenderers.test.ts` recording context smoke.",
  "481": "`themeContrast.test.ts` on `THEME_UI` tokens.",
  "486": "TZ cases in `dateFormat.test.ts` + `zonedTime.test.ts`.",
  "487": "Extended `dashboardMicrosite.test.ts`.",
  "488": "Round-trip + corrupt JSON in `persist.test.ts` + `persistValidation.test.ts`.",
  "489": "Behavior tests in `store.test.ts`.",
  "490": "`webStreamsResilience.test.ts` + lifecycle helpers.",
  "492": "Expanded `discoverStories.test.ts`.",
  "493": "`sniffCsvDelimiter` in `mock-data.test.ts`.",
  "494": "Anti-pattern guards in `recommendations.test.ts`.",
  "495": "`webHydration.test.ts` staged cache hydrate.",
  "497": "`docs/PARSER_COVERAGE_INVENTORY.md`.",
  "500": "`workerSourceRegistryParity.test.ts`.",
  "502": "Procedure in `docs/screenshots/README.md`.",
  "504": "`@vitest/coverage-v8`, `npm run test:coverage`.",
  "505": "Join keys in `geoMaps.test.ts` / `geoAtlas`.",
  "506": "Privacy + logging in `public/privacy.html`.",
  "510": "`make check` runs check-worker + test.",
  "513": "README + DOCS capability/deployment links.",
  "514": "Rendering pipeline corrected in DOCS.md.",
  "515": "Verification table in DOCS.md § Testing.",
  "516": "Lockfile policy in `docs/DEPLOYMENT_GATES.md`.",
  "520": "Performance budgets + AGENTS checklist.",
  "531": "`docs/ADVISORY_TRIAGE.md`.",
  "542": "Dead branches removed in `ChartView.tsx`.",
  "616": "`docs/CAPABILITY_MATRIX.md`.",
  "642": "Extension parity in `webFormats.test.ts`.",
  "651": "`docs/UPDATE_CHANNELS.md`.",
  "665": "`prettier` devDependency + `npm run fmt`.",
  "670": "`docs/DEPLOYMENT_GATES.md`.",
  "672": "Hostile `vo` in `chartLink.test.ts`.",
  "675": "`chartLooksTicks.test.ts`.",
  "676": "Malformed `#dive=` in `dive.test.ts`.",
  "677": "`webSharedLink.test.ts`.",
  "679": "ZIP in `socialExport.test.ts`.",
  "683": "`docs/MOBILE_ARCHIVE_TEST.md`.",
  "684": "`webgpuShader.test.ts`.",
  "686": "`staticExportSmoke.test.ts`.",
  "687": "Journey budgets in `docs/PERFORMANCE_BUDGETS.md`.",
  "692": "Changelog copy + `changelog.test.ts`.",
  "698": "`docs/PERFORMANCE_BUDGETS.md`.",
  "699": "AGENTS.md feature checklist.",
  "601": "`webStorageResilience.dom.test.ts` + fake-indexeddb DOM harness.",
};

let text = fs.readFileSync(DOC, "utf8");
text = text.replace(/^\[x\] \]/gm, "- [x]");
const marked = [];
for (const [id, note] of Object.entries(NOTES)) {
  const anchor = `<a id="loom-${id}"></a>`;
  const start = text.indexOf(anchor);
  if (start === -1) continue;
  const chunk = text.slice(start, start + 1500);
  if (!chunk.includes("- [ ]")) continue;
  if (chunk.includes("Completed (2026-10-12)")) continue;
  const m = chunk.match(/\n- \[ \] \*\*P[123]/);
  if (!m || m.index === undefined) continue;
  const abs = start + m.index + 1;
  text = `${text.slice(0, abs + 3)}x${text.slice(abs + 4)}`;
  const lineEnd = text.indexOf("\n", abs) + 1;
  text = `${text.slice(0, lineEnd)}- **Completed (2026-10-12):** ${note}\n${text.slice(lineEnd)}`;
  marked.push(`LOOM-${id}`);
}
fs.writeFileSync(DOC, text);
console.log(`Marked ${marked.length}:`, marked.join(", "));
