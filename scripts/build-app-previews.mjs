#!/usr/bin/env node
// =================================================================
// Build App Store preview videos (Apple-spec H.264 + AAC)
// =================================================================
// Specs: https://developer.apple.com/help/app-store-connect/reference/app-information/app-preview-specifications/
// - 15–30s, ≤30fps, H.264 High ≤ Level 4.0, AAC stereo ~256kbps, ~10–12 Mbps
// - Use Apple’s smaller accepted sizes so Level 4.0 stays valid
// =================================================================

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const JOBS = [
  {
    name: "iphone67",
    dir: "ios/store/screenshots/iphone67",
    out: "ios/store/preview-iphone67.mp4",
    w: 886,
    h: 1920,
    files: ["01-chart.png", "02-dive.png", "03-explorer.png", "04-query.png", "05-map.png", "06-phone.png"],
  },
  {
    name: "ipad13",
    dir: "ios/store/screenshots/ipad13",
    out: "ios/store/preview-ipad13.mp4",
    w: 1200,
    h: 1600,
    files: ["01-chart.png", "02-dive.png", "03-explorer.png", "04-query.png", "05-map.png", "06-phone.png"],
  },
  {
    name: "mac16x10",
    dir: "macos/store/screenshots/mac16x10",
    out: "macos/store/preview-mac.mp4",
    w: 1920,
    h: 1080,
    files: ["01-chart.png", "02-dive.png", "03-explorer.png", "04-query.png", "05-map.png"],
  },
];

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} failed (${r.status})`);
}

function buildJob(job) {
  const absDir = path.join(ROOT, job.dir);
  const out = path.join(ROOT, job.out);
  const inputs = job.files.map((f) => path.join(absDir, f)).filter((p) => fs.existsSync(p));
  if (inputs.length < 3) throw new Error(`${job.name}: need ≥3 screenshots in ${job.dir}`);

  // ≥15s total (Apple minimum)
  const hold = Math.max(2.6, 15.2 / inputs.length);

  const args = ["-y"];
  for (const p of inputs) {
    args.push("-loop", "1", "-t", hold.toFixed(2), "-i", p);
  }
  args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100");

  const n = inputs.length;
  const parts = [];
  for (let i = 0; i < n; i++) {
    parts.push(
      `[${i}:v]scale=${job.w}:${job.h}:force_original_aspect_ratio=decrease,pad=${job.w}:${job.h}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30,format=yuv420p[v${i}]`,
    );
  }
  parts.push(`${inputs.map((_, i) => `[v${i}]`).join("")}concat=n=${n}:v=1:a=0[vout]`);

  args.push(
    "-filter_complex",
    parts.join(";"),
    "-map",
    "[vout]",
    "-map",
    `${n}:a`,
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-level",
    "4.0",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "30",
    "-b:v",
    "10M",
    "-maxrate",
    "12M",
    "-bufsize",
    "20M",
    "-c:a",
    "aac",
    "-b:a",
    "256k",
    "-ac",
    "2",
    "-ar",
    "44100",
    "-shortest",
    "-movflags",
    "+faststart",
    "-tag:v",
    "avc1",
    out,
  );

  console.log(`→ ${job.out} (${n} shots × ${hold.toFixed(2)}s, ${job.w}x${job.h})`);
  run("ffmpeg", args);
  const probe = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", out],
    { encoding: "utf8" },
  );
  console.log(`  ${Math.round(fs.statSync(out).size / 1024)} KB · ${Number(probe.stdout).toFixed(1)}s`);
}

for (const job of JOBS) buildJob(job);
console.log("done");
