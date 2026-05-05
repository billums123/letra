// Resize + recompress every menu / trophy / icon PNG so they decode
// fast at startup. The OpenAI image API returns ~1024-1536px PNGs
// weighing 1.3-2.4 MB each; we display them at 150-360 CSS px, so
// most of those pixels and bytes are pure waste.
//
//   npm run images:optimize
//
// Strategy:
//   - resize to max ~720px on the long edge (covers retina up to ~360 CSS)
//   - re-encode PNG at the highest sensible compression level
//   - preserve transparent backgrounds (every image needs alpha)
//
// Originals are backed up under public/_originals/ on first run so
// repeating the script idempotently won't degrade quality.

import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PUBLIC = path.join(ROOT, "public");
const BACKUP = path.join(PUBLIC, "_originals");

type Spec = {
  rel: string;          // path relative to public/
  maxLong: number;      // max long-edge in CSS pixels × 2 for retina
  // Extra transparent padding to add BEFORE the resize step, expressed
  // as a fraction of the smaller side. gpt-image-1 reliably clips the
  // case-picker characters' arms/legs/edges right against the canvas;
  // padding here gives the rendered tile guaranteed breathing room
  // and re-centres the group regardless of the model's framing.
  padFraction?: { x: number; y: number };
};

const SPECS: Spec[] = [
  // Title is the largest hero image, displayed up to 260 CSS px tall.
  // Aspect is 3:2 (~390 CSS px wide), so 1536 covers ~4× retina without
  // upscaling beyond what the original asset gave us.
  { rel: "letra-title.png", maxLong: 1536 },
  // Square favicon — small target footprint.
  { rel: "letra-icon.png", maxLong: 256 },
  // Wide case-picker tiles, displayed up to 150 CSS px tall. The
  // gpt-image-1 source consistently lets characters touch (or clip
  // through) the canvas edges no matter how the prompt yells about
  // margins, so we extend the canvas with transparent padding before
  // resize. 18% on the sides recovers any clipped arms/legs and
  // visually centres the group inside the tile.
  { rel: "case-uppercase.png", maxLong: 720, padFraction: { x: 0.18, y: 0.10 } },
  { rel: "case-lowercase.png", maxLong: 720, padFraction: { x: 0.18, y: 0.10 } },
  { rel: "case-mixed.png", maxLong: 720, padFraction: { x: 0.18, y: 0.10 } },
  // Game-card icons, displayed up to 180 CSS px square.
  { rel: "icons/spell-word.png", maxLong: 360 },
  { rel: "icons/find-alphabet.png", maxLong: 360 },
  { rel: "icons/match-sound.png", maxLong: 360 },
  // Trophy badges — shelf renders them small; full lab view is ~250.
  { rel: "trophies/alphabet-upper.png", maxLong: 500 },
  { rel: "trophies/alphabet-lower.png", maxLong: 500 },
  { rel: "trophies/alphabet-mixed.png", maxLong: 500 },
  { rel: "trophies/sound-match.png", maxLong: 500 },
  { rel: "trophies/spell-bus.png", maxLong: 500 },
  { rel: "trophies/spell-cat.png", maxLong: 500 },
  { rel: "trophies/spell-dog.png", maxLong: 500 },
  { rel: "trophies/spell-pig.png", maxLong: 500 },
  { rel: "trophies/spell-sun.png", maxLong: 500 },
  { rel: "trophies/word-wizard.png", maxLong: 500 },
];

async function backup(rel: string): Promise<void> {
  const src = path.join(PUBLIC, rel);
  const dest = path.join(BACKUP, rel);
  try {
    await fs.access(dest);
    return; // already backed up
  } catch {
    // not backed up yet — copy from src
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
}

async function optimize(spec: Spec): Promise<{ before: number; after: number }> {
  const abs = path.join(PUBLIC, spec.rel);
  const before = (await fs.stat(abs)).size;
  await backup(spec.rel);
  let pipe = sharp(path.join(BACKUP, spec.rel));
  if (spec.padFraction) {
    // Extend the source canvas with transparent pixels before resize
    // so any character that hugs the edge in the AI render still has
    // visual breathing room in the final tile.
    const meta = await pipe.metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    const padX = Math.round(w * spec.padFraction.x);
    const padY = Math.round(h * spec.padFraction.y);
    pipe = sharp(path.join(BACKUP, spec.rel)).extend({
      top: padY,
      bottom: padY,
      left: padX,
      right: padX,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
  }
  // Resize keeping aspect ratio; sharp's "inside" fit only shrinks if
  // larger than maxLong. Re-encode PNG with max compression effort and
  // palette quantization — cuts ~70% on these chunky-character pieces
  // without visible quality loss.
  const buf = await pipe
    .resize({
      width: spec.maxLong,
      height: spec.maxLong,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png({ compressionLevel: 9, palette: true, quality: 92, effort: 10 })
    .toBuffer();
  await fs.writeFile(abs, buf);
  const after = buf.length;
  return { before, after };
}

async function main() {
  let totalBefore = 0;
  let totalAfter = 0;
  for (const spec of SPECS) {
    try {
      const { before, after } = await optimize(spec);
      totalBefore += before;
      totalAfter += after;
      const pct = Math.round((1 - after / before) * 100);
      console.log(
        `${spec.rel.padEnd(40)} ${(before / 1024).toFixed(0).padStart(5)} KB → ${(after / 1024).toFixed(0).padStart(5)} KB  (-${pct}%)`,
      );
    } catch (err) {
      console.error(`✗ ${spec.rel}: ${(err as Error).message}`);
    }
  }
  const pct = Math.round((1 - totalAfter / totalBefore) * 100);
  console.log(
    `\nTotal: ${(totalBefore / 1024 / 1024).toFixed(2)} MB → ${(totalAfter / 1024 / 1024).toFixed(2)} MB  (-${pct}%)`,
  );
  console.log(`Originals backed up under public/_originals/.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
