// Generate the menu game-card icons via OpenAI's image API.
//
//   npm run icons:generate            — fetch missing icons only
//   npm run icons:generate -- --force — regenerate every icon
//
// Outputs land in public/icons/<id>.png. The MainMenu reads them by
// URL — drop the file and the menu picks it up on the next reload.
//
// Style brief: each icon should feel like it belongs in the same
// world as the chubby cartoony 3D letter characters in the games —
// soft shadows, friendly faces, saturated pre-K colours, transparent
// background so the menu card colour shows through.

import { config as loadEnv } from "dotenv";
import { promises as fs } from "node:fs";
import path from "node:path";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ICONS_DIR = path.join(ROOT, "public", "icons");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ARGS = process.argv.slice(2);
const FORCE = ARGS.includes("--force");
const LIST_ONLY = ARGS.includes("--list");

type IconSpec = {
  id: string;
  prompt: string;
};

// Shared style framing — kept in one place so all three icons share a
// consistent look. The art direction matches the in-game chubby 3D
// letter characters: bevelled forms, soft lighting, friendly faces,
// PNG with a transparent background so each menu card's pastel
// colour shows through behind the icon.
const STYLE_FRAMING =
  "Charming 3D-rendered children's storybook illustration in the " +
  "exact style of cute chubby cartoon letter characters with big " +
  "expressive eyes, tiny noodle arms, simple smiley mouths, and " +
  "soft rounded edges. Saturated friendly colours. Soft global " +
  "illumination, subtle floor-contact shadow only. " +
  // Tight framing keeps the icon legible when displayed small (96px " +
  // tile on phones). Anything more padded reads as a tiny subject " +
  // floating in a square of empty space.
  "The subject is centered and FILLS the frame edge-to-edge — at " +
  "least 90% of the canvas occupied, almost no empty padding around " +
  "the character, no border or vignette. Square 1:1 composition. " +
  "No text, no captions, no logos. Crisp clean PNG with a fully " +
  "TRANSPARENT background — no solid fill, no card, no frame. " +
  "Designed for ages 3-6.";

const ICONS: IconSpec[] = [
  {
    id: "spell-word",
    // Subtitle on the card is "Find the missing pet" — the game has
    // the kid spell short words like CAT and DOG. A peeking kitten
    // reads as both "pet" and "find me!".
    prompt:
      "A roly-poly cartoon kitten with huge sparkly eyes peeking " +
      "playfully out from behind a giant chubby letter C, only the " +
      "top of the kitten's head, ears, and curious eyes visible. " +
      "The letter C is a cute character itself with a friendly face. " +
      "Three soft pastel paw prints float around them. Joyful, " +
      "inviting, playful 'where did the pet go' mood. " +
      STYLE_FRAMING,
  },
  {
    id: "find-alphabet",
    // Subtitle: "A all the way to Z". Show a happy parade of three
    // letters in alphabetical order so the concept reads instantly.
    prompt:
      "Three chubby cartoon letter characters (the letters A, B, and " +
      "C) walking in a cheerful parade from left to right, each with " +
      "a different bright colour (red, orange, sunny yellow), each " +
      "with two big friendly eyes and a happy smile, little arms " +
      "swinging, little legs mid-step. They feel like they're on " +
      "an adventure together. Tiny floating sparkles trail behind " +
      "them. " +
      STYLE_FRAMING,
  },
  {
    id: "match-sound",
    // Subtitle: "Hear it, find it". A letter character cupping its
    // hand to its ear, listening, with cute musical notes drifting
    // out from somewhere off-frame to suggest sound.
    prompt:
      "A chubby cartoon letter S character (rich teal blue) in a " +
      "playful listening pose with one little arm cupped behind its " +
      "ear, head tilted, a wide attentive smile, big curious eyes. " +
      "Three tiny sparkly musical notes (eighth notes) and a couple " +
      "of soft sound-wave arcs float toward its ear from the upper " +
      "right of the frame. Delighted 'I hear something!' mood. " +
      STYLE_FRAMING,
  },
];

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function generateOne(icon: IconSpec): Promise<void> {
  if (!OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to .env.local before running."
    );
  }
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      authorization: `Bearer ${OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-image-1",
      prompt: icon.prompt,
      n: 1,
      size: "1024x1024",
      // Transparent background so the menu card's colour shows
      // through behind the character.
      background: "transparent",
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "<no body>");
    throw new Error(`OpenAI ${res.status} for "${icon.id}": ${text.slice(0, 400)}`);
  }
  const json = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
  const item = json.data?.[0];
  if (!item) throw new Error(`OpenAI returned no data for "${icon.id}"`);

  let buf: Buffer | null = null;
  if (item.b64_json) {
    buf = Buffer.from(item.b64_json, "base64");
  } else if (item.url) {
    const fetched = await fetch(item.url);
    if (!fetched.ok) throw new Error(`Failed to download image for "${icon.id}": HTTP ${fetched.status}`);
    buf = Buffer.from(await fetched.arrayBuffer());
  }
  if (!buf) throw new Error(`OpenAI returned neither b64_json nor url for "${icon.id}"`);

  const out = path.join(ICONS_DIR, `${icon.id}.png`);
  await fs.writeFile(out, buf);
}

async function main(): Promise<void> {
  await fs.mkdir(ICONS_DIR, { recursive: true });

  if (LIST_ONLY) {
    console.log(`Would generate ${ICONS.length} icons:`);
    for (const i of ICONS) console.log(`  ${i.id.padEnd(14)}`);
    return;
  }

  if (!OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is not set; aborting.");
    process.exit(1);
  }

  let made = 0;
  let skipped = 0;
  let failed = 0;
  for (const icon of ICONS) {
    const out = path.join(ICONS_DIR, `${icon.id}.png`);
    if (!FORCE && (await exists(out))) {
      console.log(`· skip ${icon.id} (cached)`);
      skipped++;
      continue;
    }
    try {
      console.log(`… ${icon.id} — generating…`);
      await generateOne(icon);
      console.log(`✓ ${icon.id}`);
      made++;
    } catch (err) {
      console.error(`✗ ${icon.id}: ${(err as Error).message}`);
      failed++;
    }
    // Mild pause keeps us comfortably under the rate limit.
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`\nDone. Generated ${made}, skipped ${skipped}, failed ${failed}.`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
