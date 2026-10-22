#!/usr/bin/env node
// =================================================================
// Prepare Loom App Icon appearance themes (Any / Dark / Tinted)
// =================================================================
// Source: brand/loom-icon-1024.png (canonical woven cube mark)
// Writes dark + tinted variants into ios/store + Cap AppIcon.appiconset
// and updates Contents.json. Run `npx tauri icon brand/loom-icon-1024.png`
// afterward to refresh desktop / Android sizes.
// =================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "brand", "loom-icon-1024.png");

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error("Missing", SRC);
    process.exit(1);
  }

  const darkPath = path.join(ROOT, "brand", "loom-icon-1024-dark.png");
  const tintPath = path.join(ROOT, "brand", "loom-icon-1024-tinted.png");

  // Dark: same mark (already dark UI chrome)
  await sharp(SRC)
    .flatten({ background: { r: 14, g: 14, b: 16 } })
    .png({ compressionLevel: 9 })
    .toFile(darkPath);

  // Tinted: grayscale template for iOS Home Screen tinting
  await sharp(SRC)
    .grayscale()
    .modulate({ brightness: 1.08 })
    .flatten({ background: { r: 28, g: 28, b: 30 } })
    .png({ compressionLevel: 9 })
    .toFile(tintPath);

  const destinations = [
    ["ios/store/AppIcon-1024.png", SRC],
    ["ios/store/AppIcon-1024-dark.png", darkPath],
    ["ios/store/AppIcon-1024-tinted.png", tintPath],
    ["ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png", SRC],
    ["ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024-dark.png", darkPath],
    ["ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024-tinted.png", tintPath],
    ["ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png", SRC],
  ];
  for (const [rel, from] of destinations) {
    const to = path.join(ROOT, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    console.log("wrote", rel);
  }

  const contents = {
    images: [
      {
        filename: "AppIcon-1024.png",
        idiom: "universal",
        platform: "ios",
        size: "1024x1024",
      },
      {
        appearances: [{ appearance: "luminosity", value: "dark" }],
        filename: "AppIcon-1024-dark.png",
        idiom: "universal",
        platform: "ios",
        size: "1024x1024",
      },
      {
        appearances: [{ appearance: "luminosity", value: "tinted" }],
        filename: "AppIcon-1024-tinted.png",
        idiom: "universal",
        platform: "ios",
        size: "1024x1024",
      },
    ],
    info: { author: "xcode", version: 1 },
  };
  fs.writeFileSync(
    path.join(ROOT, "ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json"),
    `${JSON.stringify(contents, null, 2)}\n`,
  );
  console.log("updated Cap AppIcon Contents.json (any / dark / tinted)");
  console.log("next: npx tauri icon brand/loom-icon-1024.png");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
