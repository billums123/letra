// Generate the Letra title wordmark and the single-letter "L" app
// icon via OpenAI's image API. Style brief matches the chubby 3D
// cartoon letter characters in the games (see scripts/generate-icons
// for the shared style brief language).
//
//   npm run logo:generate            — fetch missing only
//   npm run logo:generate -- --force — regenerate every output
//
// Outputs land in public/:
//   public/letra-title.png  — full "Letra" wordmark, transparent BG
//   public/letra-icon.png   — single chubby cartoon "L" character
//                             for the favicon / app shortcut.

import { config as loadEnv } from "dotenv";
import { promises as fs } from "node:fs";
import path from "node:path";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PUBLIC_DIR = path.join(ROOT, "public");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ARGS = process.argv.slice(2);
const FORCE = ARGS.includes("--force");
const LIST_ONLY = ARGS.includes("--list");

type LogoSpec = {
  id: string;
  filename: string;
  size: "1024x1024" | "1536x1024" | "1024x1536";
  prompt: string;
};

// Shared style framing — same language as the menu-card icon
// generator so the title and the icons live in the same world.
const STYLE_FRAMING =
  "Charming 3D-rendered children's storybook illustration in the " +
  "exact style of cute chubby cartoon letter characters with big " +
  "expressive eyes, tiny noodle arms with simple rounded mitten " +
  "hands, little stubby legs, simple smiley mouths, pink cheek " +
  "blush dots, and soft rounded chunky bevelled edges. Saturated " +
  "friendly pre-K colours. Soft global illumination, subtle " +
  "floor-contact shadow only. Crisp clean PNG with a fully " +
  "TRANSPARENT background — no solid fill, no card, no frame. " +
  "Designed for ages 3-6.";

// Reusable language for the case-picker letter quartets — keeps the
// three pickers (uppercase, lowercase, mixed) visually aligned.
const QUARTET_FRAMING =
  "Four chubby cartoon letter characters standing in a happy row " +
  "left-to-right with even spacing, each rendered as its own " +
  "character with two big friendly eyes, a wide smiley mouth, two " +
  "pink cheek blush dots, two tiny mitten arms with rounded hands, " +
  "and two stubby legs. Each letter wears a chunky thick white " +
  "outline. Slight bouncy tilt, glossy soft 3D bevelled forms. A " +
  "few sparkly star confetti dots float between them. Wide " +
  "horizontal composition. Reading order is strict — exactly the " +
  "four characters described, in that exact order, no extra " +
  "letters, no other words, no logos, no brand marks. ";

const LOGOS: LogoSpec[] = [
  {
    id: "case-uppercase",
    filename: "case-uppercase.png",
    size: "1536x1024",
    prompt:
      "Four uppercase letter characters spelling 'A B C D' (capital " +
      "A, capital B, capital C, capital D). Pink A, orange B, yellow " +
      "C, green D. " +
      QUARTET_FRAMING +
      STYLE_FRAMING,
  },
  {
    id: "case-lowercase",
    filename: "case-lowercase.png",
    size: "1536x1024",
    prompt:
      "Four lowercase letter characters spelling 'a b c d' (lowercase " +
      "a, lowercase b, lowercase c, lowercase d — NOT capitals). " +
      "Pink a, orange b, yellow c, green d. " +
      QUARTET_FRAMING +
      STYLE_FRAMING,
  },
  {
    id: "case-mixed",
    filename: "case-mixed.png",
    size: "1536x1024",
    // Phrasing kept deliberately close to the lowercase entry — the
    // model returns a transparent PNG for that prompt reliably, but
    // earlier wordier "mixed" prompts kept slipping a coloured
    // gradient behind the characters.
    prompt:
      "Four lowercase-and-capital letter characters spelling 'a B c D' " +
      "(lowercase a, capital B, lowercase c, capital D — NOT all " +
      "capitals, NOT all lowercase). Pink a, orange B, yellow c, " +
      "green D. " +
      QUARTET_FRAMING +
      STYLE_FRAMING,
  },
  {
    id: "letra-title",
    filename: "letra-title.png",
    // Wide aspect for the menu header. The wordmark currently lives
    // in a 720x240 viewBox (3:1) but gpt-image-1 only supports
    // 1024x1024, 1536x1024 (~3:2), and 1024x1536. Take the widest.
    size: "1536x1024",
    prompt:
      "The word 'Letra' spelled out as five chubby cartoon letter " +
      "characters standing in a happy row: a pink L, an orange e, a " +
      "yellow t, a green r, and a teal a. Each letter is its own " +
      "character — big friendly eyes, tiny mitten arms, little legs, " +
      "smiling, slight bouncy tilt, glossy soft 3D bevelled forms. " +
      "Each letter wears a chunky thick white outline. The lowercase " +
      "letters sit at x-height with their tops below the uppercase " +
      "L's cap. A few sparkly star confetti dots float between them. " +
      "Clear horizontal arrangement reading L-e-t-r-a left to right, " +
      "no extra letters, no other words, no logos, no brand marks. " +
      "Wide horizontal composition. " +
      STYLE_FRAMING,
  },
  {
    id: "letra-icon",
    filename: "letra-icon.png",
    size: "1024x1024",
    prompt:
      "A single chubby cartoon letter L character. The L is bright " +
      "pink-coral, glossy, with soft rounded chunky bevelled edges. " +
      "Two big friendly cartoon eyes near the top of the vertical " +
      "stem with little white shine highlights and dark pupils, a " +
      "wide smiley mouth, two pink cheek blush dots, two tiny noodle " +
      "arms with rounded mitten hands waving cheerfully, two stubby " +
      "feet at the base. Centered, square 1:1 composition, fills " +
      "the frame edge-to-edge. " +
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

async function generateOne(logo: LogoSpec): Promise<void> {
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
      prompt: logo.prompt,
      n: 1,
      size: logo.size,
      background: "transparent",
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "<no body>");
    throw new Error(`OpenAI ${res.status} for "${logo.id}": ${text.slice(0, 400)}`);
  }
  const json = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
  const item = json.data?.[0];
  if (!item) throw new Error(`OpenAI returned no data for "${logo.id}"`);

  let buf: Buffer | null = null;
  if (item.b64_json) {
    buf = Buffer.from(item.b64_json, "base64");
  } else if (item.url) {
    const fetched = await fetch(item.url);
    if (!fetched.ok) throw new Error(`Failed to download image for "${logo.id}": HTTP ${fetched.status}`);
    buf = Buffer.from(await fetched.arrayBuffer());
  }
  if (!buf) throw new Error(`OpenAI returned neither b64_json nor url for "${logo.id}"`);

  const out = path.join(PUBLIC_DIR, logo.filename);
  await fs.writeFile(out, buf);
}

async function main(): Promise<void> {
  await fs.mkdir(PUBLIC_DIR, { recursive: true });

  if (LIST_ONLY) {
    console.log(`Would generate ${LOGOS.length} logos:`);
    for (const l of LOGOS) console.log(`  ${l.id.padEnd(14)} → ${l.filename} (${l.size})`);
    return;
  }

  if (!OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is not set; aborting.");
    process.exit(1);
  }

  let made = 0;
  let skipped = 0;
  let failed = 0;
  for (const logo of LOGOS) {
    const out = path.join(PUBLIC_DIR, logo.filename);
    if (!FORCE && (await exists(out))) {
      console.log(`· skip ${logo.id} (cached)`);
      skipped++;
      continue;
    }
    try {
      console.log(`… ${logo.id} — generating (${logo.size})…`);
      await generateOne(logo);
      console.log(`✓ ${logo.id} → public/${logo.filename}`);
      made++;
    } catch (err) {
      console.error(`✗ ${logo.id}: ${(err as Error).message}`);
      failed++;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`\nDone. Generated ${made}, skipped ${skipped}, failed ${failed}.`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
