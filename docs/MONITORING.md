# Monitoring: alerts, schedules, and always-on checks

Monitoring in Loom answers one question: **should someone do something now?** A chart you have to keep looking at isn't monitoring. Neither is a red line that nobody acts on.

This page explains the design (why it works the way it does) and the mechanics (where the code lives).

## Principles (from user feedback)

> "Temperature is just one of many metrics on the scorecard … Just because it's out of range doesn't automatically mean it's unexpected or something is wrong … Monitoring has to be tied to decision making."

| Feedback | What Loom does |
|---|---|
| One metric isn't the whole picture | **Scorecards** group monitors, such as temperature, humidity and AQI under "City heat health". A scorecard shows the worst current status of its members. |
| Out of range ≠ wrong | Rules come in five kinds. Only **Unusual for now** claims something is abnormal, and it judges against the *same hour* or *weekday and hour* when the data has cycles. |
| Rule out expected or deliberate causes | **Expected windows** (one-off, or recurring weekdays and hours) record checks but never alert. Reviewing an alert as *Expected* or *Done on purpose* can learn a window automatically. |
| Tie it to decisions | Every monitor must say **"If this fires, I will …"**. Every alert asks **"What happened?"** (acted, expected, deliberate, false alarm, no action). Each card then reports the share of alerts that led to action and calls a monitor *noisy* when that share stays low. |

## Anatomy of a monitor

```
metric    feed + calculation (latest / avg / max / p95 / count / …) + filters + lookback window
rule      threshold · range · change % · anomaly (robust z, seasonal) · stale feed
confirm   N consecutive breaching checks before an alert opens (debounce flapping)
expected  windows that suppress alerts
schedule  every N min · daily HH:MM · weekly · 5-field cron (local time)
notify    in-app banner · system notification · reminder cooldown · quiet hours
decision  required text; shown in notifications and the review inbox
cloud     optional "Always on": evaluated by the Worker cron, delivered to a webhook
```

### What "anomaly" means

`evaluateRule` in [`src/lib/monitoring/engine.ts`](../src/lib/monitoring/engine.ts) works in five steps:

1. Checks that fall inside an expected window are recorded as `expected` and never alert.
2. The baseline is the median of the last *N* earlier checks. Checks marked expected, errored or empty are skipped. With `seasonal: hour` (or `weekday-hour`), only checks from the same hour (or the same weekday and hour) count. The value being tested is never part of its own baseline.
3. The score is `0.6745 · |x − median| / MAD`, a robust z-score, so one past spike doesn't widen the band.
4. Sensitivity sets the score cut-off: 2.5 (sensitive), 3.5 (balanced) or 5 (conservative). This matches the chart Analyze card.
5. There must be at least five comparable checks first. Until then the card says "Learning normal: k/5".

### Alert lifecycle

`runCheck` returns a `CheckRecord` with one of these statuses: `ok`, `breach` (confirming), `firing`, `expected`, `no-data` or `error`.

- An alert opens on the first `firing` check.
- Each further firing check updates `peakValue`.
- The alert closes on the first `ok` check.
- A reminder is sent when the cooldown has passed and the alert hasn't been acknowledged. Quiet hours suppress system notifications but still record the check.
- Reviewing an alert acknowledges it, which stops reminders.

## From a chart, and back

- **Monitor this chart** (bell in the chart's side toolbar, on live feeds) and **Alert me when this happens** (Analyze → Anomaly detection) both call `createChartMonitorDraft` in `monitoring/chartBridge.ts`. `fromChart.ts` maps the active chart into a draft:
  - The feed comes from `stream://<kind>`.
  - When x is time, the measure is y with the chart's aggregate. Otherwise it's the numeric size or color field, and if there isn't one, a row count. Latitude and longitude are never used.
  - The lookback comes from the rolling window on daily feeds, otherwise from the chart's time window.
  - Anomaly rings become the "unusual" rule with the same sensitivity.
  - The chart's `chart=` link is stored on the monitor.
- Cards ("Open chart" / "Chart feed") and alerts ("See it on …") call `openMonitorChart`. It opens the feed and hands the link to `setChartLink`, so `ChartLinkSync` restores that exact chart.
- The chart's bell shows as pressed when the open feed already has monitors.

## Seeing the number before you watch it

- `monitoring/backfill.ts`: `metricSeries` replays a metric over the feed rows already loaded (up to 72 evenly spaced moments, each using only rows known at that time). `simulate` runs the real `runCheck` over that series, so the editor and cards can say "would have alerted N times in the last 2 days".
- `MonitorPreviewChart` draws the series, rule lines you can drag (or move with arrow keys), range bands, the anomaly "normal" band (baseline ± sensitivity · MAD / 0.6745, from `CheckRecord.spread`) and simulated alerts.
- New monitors and feed / column changes take their limits from the data (98th percentile for a limit, 5th–95th for a range).
- `monitoring/suggest.ts` builds suggestions for the open feed: its main measures with data-driven limits, unusual row counts for event feeds, and a feed-went-quiet check. Together with "This chart" they show first in Monitor.
- `monitorRefLines` (chartBridge) draws enabled threshold and range monitors on charts of the same feed whose y is the monitored column, as `🔔 ▲ name` reference lines.
- A check whose lookback window has no rows is `ok` ("Nothing in the last 1 h"), not `no-data`.

## Where checks run

| Runtime | How |
|---|---|
| Desktop (macOS) | `MonitorRunner` → `runner.ts`, with a 20s tick while the app is open. Feeds are read through `sourceSnapshot` (DuckDB). Notifications use `tauri-plugin-notification`. |
| Web | Same runner, reading the in-browser buffers. Browsers throttle hidden tabs, so schedules can slip. Notifications use the Web Notifications API. |
| iOS shell | Same as web, with native notifications through the Tauri plugin. |
| **Always on** | The Worker cron `*/5 * * * *` ([`workers/monitorCron.ts`](../workers/monitorCron.ts)) runs while the app is closed. It fetches feeds through the same cached `/api/source/<kind>` path and parses them with `parseSourceRows`, so values match the app. Alerts are POSTed to ntfy, Slack, Discord or a JSON webhook. |

### Always-on details

- The app generates a random device secret (`loom-monitor-device` in localStorage) and sends it as `Authorization: Bearer`. KV keys use `mon:<sha256(secret)>`, so the secret itself is never stored.
- `POST /api/monitors` uploads the device's always-on monitors, webhook and alert acknowledgements. `GET` returns their history and alerts. `DELETE` removes everything for the device. `POST /api/monitors/test-webhook` sends a test alert. Uploads are rate limited through the KV limiter.
- Limits:
  - 20 monitors per device.
  - Interval schedules are clamped to at least 15 minutes.
  - 200 checks of history and 100 alerts per device.
  - The bundle expires after 45 days without a sync.
  - KV is written only for devices that had something due.
- Webhooks must be HTTPS, must pass `ssrfGuard`, and Slack/Discord URLs must be on their official hosts. Redirects are not followed.
- The app skips always-on monitors in its local tick and pulls their results every 60s while visible (`mergeCloudResults`). Local reviews win over cloud state.

## Files

| File | Role |
|---|---|
| `src/lib/monitoring/types.ts` | Monitor, rule, schedule, check and alert types |
| `src/lib/monitoring/engine.ts` | Metric, rules, expected windows, `runCheck`, usefulness (pure) |
| `src/lib/monitoring/schedule.ts` | Next-run math, cron parser |
| `src/lib/monitoring/templates.ts` | Starter monitors, each with a decision |
| `src/lib/monitoring/runner.ts` | In-app scheduler |
| `src/lib/monitoring/notify.ts` | System notifications (Tauri / Web) |
| `src/lib/monitoring/storage.ts` | localStorage persistence, JSON export/import |
| `src/lib/monitoring/cloudSync.ts` | Device token, webhook config, push and pull |
| `src/lib/store/monitorSlice.ts` | Zustand slice |
| `src/components/MonitorView.tsx`, `monitor/*` | Inbox, scorecards, editor, sparkline, always-on panel |
| `src/components/MonitorRunner.tsx` | Hydrate, save, schedule, cloud sync |
| `workers/monitorCron.ts` | Cron evaluation, KV bundle, webhook delivery |

Tests: `src/lib/__tests__/monitoring.test.ts` and `workers/__tests__/monitorCron.test.ts`.

## Not yet

- Compound rules ("temperature high **and** humidity high"). Scorecards group metrics today but don't combine their conditions.
- Monitors on your own datasets or saved SQL. Feeds only, for now.
- Email delivery: Cloudflare Email Service would fit the Worker.
- Sharing a scorecard between people: today monitors are per device; use Export/Import to move them.
