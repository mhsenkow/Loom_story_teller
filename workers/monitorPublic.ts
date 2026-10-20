// =================================================================
// Loom Worker — public monitor pages (`/w/<id>`)
// =================================================================
// A device can publish its always-on monitors as a read-only status
// page, an RSS feed of moments (plug into Slack's RSS app, Zapier,
// IFTTT, any reader), and per-moment SVG cards. Only what the device
// chose to make public is shown: monitor names, rules, values,
// statuses, and moments — never the webhook, push endpoints, or token.
// =================================================================

import type { CloudBundle } from "./monitorCron";
import { describeRule, fmtValue } from "../src/lib/monitoring/engine";
import { describeSchedule } from "../src/lib/monitoring/schedule";
import { MOMENT_DARK, momentSvg, momentText, type Moment } from "../src/lib/monitoring/moments";
import { SOURCE_BY_KIND } from "../src/lib/sourceRegistry";
import type { CheckRecord } from "../src/lib/monitoring/types";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function isPublicId(id: string): boolean {
  return /^[a-f0-9]{16}$/.test(id);
}

function spark(checks: CheckRecord[]): string {
  const pts = checks.filter((c) => c.value != null).slice(-60);
  if (pts.length < 2) return `<svg viewBox="0 0 240 40" class="spark"><text x="0" y="24" fill="${MOMENT_DARK.muted}" font-size="11">Collecting history…</text></svg>`;
  const vals = pts.map((c) => c.value as number);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (lo === hi) { lo -= 1; hi += 1; }
  const x = (i: number) => (i / (pts.length - 1)) * 236 + 2;
  const y = (v: number) => 38 - ((v - lo) / (hi - lo)) * 34;
  const d = pts.map((c, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(c.value as number).toFixed(1)}`).join("");
  const dots = pts.map((c, i) => (c.status === "firing" ? `<circle cx="${x(i).toFixed(1)}" cy="${y(c.value as number).toFixed(1)}" r="2.5" fill="${MOMENT_DARK.alert}"/>` : "")).join("");
  return `<svg viewBox="0 0 240 40" class="spark" aria-hidden="true"><path d="${d}" fill="none" stroke="${MOMENT_DARK.line}" stroke-width="1.5"/>${dots}</svg>`;
}

const STATUS: Record<string, [string, string]> = {
  ok: ["OK", "#3fbf7f"], firing: ["Alert", "#f2555a"], breach: ["Confirming", "#f5a524"], expected: ["Expected", "#9a9aa8"],
  "no-data": ["No data", "#9a9aa8"], error: ["Can't read", "#f5a524"],
};

export function publicPageHtml(b: CloudBundle, id: string, origin: string): string {
  const title = esc(b.public?.title ?? "Loom monitors");
  const cards = b.monitors.map((m) => {
    const checks = b.checks[m.id] ?? [];
    const last = checks[checks.length - 1];
    const [label, color] = STATUS[last?.status ?? ""] ?? ["Waiting", "#9a9aa8"];
    const feed = SOURCE_BY_KIND[m.metric.source]?.label ?? m.metric.source;
    return `<article class="card"><header><span class="dot" style="background:${color}"></span><h2>${esc(m.name)}</h2><span class="val">${esc(fmtValue(last?.value, m.metric.unit))}</span></header>
<p class="meta">${esc(feed)} · ${esc(describeRule(m.rule, m.metric.unit))} · ${esc(describeSchedule(m.schedule))}</p>${spark(checks)}
<p class="status" style="color:${color}">${label}${last ? ` · ${esc(last.reason)}` : ""}</p></article>`;
  }).join("\n");
  // Same-origin image paths: the page's CSP only allows `img-src 'self'`.
  const moments = (b.moments ?? []).slice(0, 12).map((mo) => `<a class="moment" id="${esc(mo.id)}" href="/w/${id}/m/${encodeURIComponent(mo.id)}.svg"><img loading="lazy" src="/w/${id}/m/${encodeURIComponent(mo.id)}.svg" alt="${esc(momentText(mo))}"/></a>`).join("\n");
  const firing = b.monitors.filter((m) => b.checks[m.id]?.at(-1)?.status === "firing").length;
  const headline = firing ? `${firing} alert${firing === 1 ? "" : "s"} right now` : "All quiet";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Loom</title><meta name="description" content="${esc(headline)} — live monitors on open data, by Loom.">
<meta property="og:title" content="${title}"><meta property="og:description" content="${esc(headline)}">
<link rel="alternate" type="application/rss+xml" title="${title}" href="${origin}/w/${id}/feed.xml">
<meta http-equiv="refresh" content="300">
<style>
:root{color-scheme:dark;--bg:${MOMENT_DARK.bg};--text:${MOMENT_DARK.text};--muted:${MOMENT_DARK.muted};--border:${MOMENT_DARK.grid};--accent:${MOMENT_DARK.line}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,sans-serif}
main{max-width:960px;margin:0 auto;padding:24px 16px 48px}h1{font-size:28px;margin:0 0 4px}.sub{color:var(--muted);margin:0 0 24px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
.card{border:1px solid var(--border);border-radius:10px;padding:14px}.card header{display:flex;align-items:center;gap:8px}
.card h2{font-size:15px;margin:0;flex:1}.val{font:600 15px ui-monospace,monospace}.dot{width:9px;height:9px;border-radius:50%}
.meta{color:var(--muted);font-size:12px;margin:6px 0}.spark{width:100%;height:40px}.status{font-size:13px;margin:6px 0 0}
h3{margin:32px 0 12px;font-size:16px}.moments{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}
.moment img{width:100%;border-radius:10px;border:1px solid var(--border);display:block}
footer{margin-top:40px;color:var(--muted);font-size:13px}a{color:var(--accent)}
</style></head><body><main>
<h1>${title}</h1><p class="sub">${esc(headline)} · updated ${esc(new Date(b.updatedAt).toUTCString())} · checks every 5 minutes</p>
<div class="grid">${cards || "<p>No monitors yet.</p>"}</div>
${moments ? `<h3>Moments</h3><div class="moments">${moments}</div>` : ""}
<footer><a href="${origin}/w/${id}/feed.xml">RSS feed</a> · Made with <a href="${origin}/">Loom</a>: watch any live open-data feed and get told when it matters.</footer>
</main></body></html>`;
}

export function publicFeedXml(b: CloudBundle, id: string, origin: string): string {
  const title = esc(b.public?.title ?? "Loom monitors");
  const items = (b.moments ?? []).slice(0, 30).map((mo: Moment) => {
    const link = `${origin}/w/${id}#${encodeURIComponent(mo.id)}`;
    const img = `${origin}/w/${id}/m/${encodeURIComponent(mo.id)}.svg`;
    const desc = `<p>${esc(mo.reason)}</p>${mo.decision ? `<p>Plan: ${esc(mo.decision)}</p>` : ""}<p><img src="${img}" alt="${esc(mo.monitorName)}"/></p>`;
    return `<item><title>${esc(`${mo.monitorName}: ${fmtValue(mo.value, mo.unit)}`)}</title><link>${link}</link><guid isPermaLink="false">${esc(mo.id)}</guid><pubDate>${new Date(mo.at).toUTCString()}</pubDate><category>${esc(mo.feedLabel)}</category><description><![CDATA[${desc}]]></description><enclosure url="${img}" type="image/svg+xml" length="0"/></item>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${title}</title><link>${origin}/w/${id}</link><atom:link href="${origin}/w/${id}/feed.xml" rel="self" type="application/rss+xml"/><description>Alerts from live open-data monitors, by Loom.</description><lastBuildDate>${new Date(b.updatedAt).toUTCString()}</lastBuildDate>${items}</channel></rss>`;
}

export function publicMomentSvg(b: CloudBundle, momentId: string): string | null {
  const mo = (b.moments ?? []).find((m) => m.id === momentId);
  return mo ? momentSvg(mo, { palette: MOMENT_DARK }) : null;
}
