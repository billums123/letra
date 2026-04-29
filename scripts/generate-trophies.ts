// Generate trophy icons via OpenAI's image API.
//
//   npm run trophies:generate            — fetch missing trophies only
//   npm run trophies:generate -- --force — regenerate every trophy
//   npm run trophies:generate -- --only=cat,dog — regen specific ids
//
// Outputs land in public/trophies/<id>.png. The trophy shelf reads them
// by URL — drop the file and the UI picks it up on the next reload.
//
// Style brief: trophies live in the same chubby-3D-cartoon world as the
// menu icons, but each one sits on a small gold-and-white podium and
// has a celebratory "you won this!" feel — sparkles, ribbon, gold trim.
// Transparent PNG so the shelf tile colour shows through.

import { config as loadEnv } from "dotenv";
import { promises as fs } from "node:fs";
import path from "node:path";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const TROPHIES_DIR = path.join(ROOT, "public", "trophies");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ARGS = process.argv.slice(2);
const FORCE = ARGS.includes("--force");
const LIST_ONLY = ARGS.includes("--list");
const ONLY = (() => {
  const flag = ARGS.find((a) => a.startsWith("--only="));
  if (!flag) return null;
  return new Set(flag.slice("--only=".length).split(",").map((s) => s.trim()).filter(Boolean));
})();

type TrophySpec = {
  id: string;
  prompt: string;
};

// Shared style framing — kept in one place so every trophy feels like
// it lives in the same display case. Matches the chubby cartoon letter
// characters used elsewhere in the game, but always seated on a small
// gold-and-white glossy podium plinth so the shelf reads as "trophies"
// rather than a random gallery of stickers.
const STYLE_FRAMING =
  "Polished 3D children's-storybook trophy in the same chubby cartoon " +
  "world as cute letter characters with big expressive eyes, tiny " +
  "noodle arms, simple smiley mouths, and soft rounded edges. " +
  "The subject is sitting on a small glossy gold-and-white podium " +
  "plinth (a short cylindrical pedestal with a thin gold band — " +
  "absolutely no text, no engraved letters, no plaque, no numbers " +
  "anywhere on the plinth or trophy). " +
  "Soft Pixar-style global illumination, gentle bevels, saturated " +
  "friendly colours, a faint sparkle or two floating around the " +
  "subject for celebration. " +
  // Tight framing keeps the trophy legible at shelf-tile size.
  "The subject + plinth fill the frame edge-to-edge — at least 90% " +
  "of the canvas occupied, almost no empty padding, no border, no " +
  "vignette. Square 1:1 composition. NO text labels, NO captions, " +
  "NO logos, NO plaques, NO engraved words, NO signs anywhere in " +
  "the image (letter-shaped trophy SUBJECTS are allowed only when " +
  "explicitly described as the subject in the prompt). " +
  "Crisp clean PNG with a fully TRANSPARENT background — no solid " +
  "fill, no card, no frame. Designed for ages 3-6.";

const TROPHIES: TrophySpec[] = [
  // ── Find-the-Alphabet: per-case stackable trophies ───────────────
  {
    id: "alphabet-upper",
    // Complete A→Z in UPPERCASE (stacks per completion).
    prompt:
      "A chubby cartoon UPPERCASE letter A character — bold, big, " +
      "blocky proportions — rendered as a shiny gold trophy with " +
      "soft bevels, two big friendly eyes, a wide proud smile, and " +
      "tiny noodle arms held up triumphantly. A small jeweled gold " +
      "crown sits on top of the letter. The letter sits on the " +
      "small glossy gold-and-white podium. (The letter A IS the " +
      "trophy subject — show it clearly.) " +
      STYLE_FRAMING,
  },
  {
    id: "alphabet-lower",
    // Complete a→z in lowercase (stacks per completion).
    prompt:
      "A chubby cartoon LOWERCASE letter a character — soft rounded " +
      "double-storey shape — rendered in glossy mint-green and " +
      "sky-blue, with two big friendly eyes and a sweet smile, " +
      "tiny noodle arms. A single sparkling gold star floats just " +
      "above where the tittle would be. The letter sits on the " +
      "small glossy gold-and-white podium. (The lowercase letter a " +
      "IS the trophy subject — show it clearly.) " +
      STYLE_FRAMING,
  },
  {
    id: "alphabet-mixed",
    // Complete A→Z in mixed case (stacks per completion).
    prompt:
      "Two chubby cartoon letter characters standing side by side " +
      "facing the camera: an UPPERCASE letter A on the left and a " +
      "LOWERCASE letter a on the right, both with big friendly eyes " +
      "and big smiling faces. They are doing a HIGH-FIVE — the A's " +
      "right inner arm and the a's left inner arm meet up high " +
      "between them, palms touching at the top. Their other (outer) " +
      "arms hang at their sides or wave hello to the camera. " +
      "Both characters stand upright, both feet on the podium, " +
      "facing forward — strictly a kid-friendly best-friends pose, " +
      "no arms around each other's backs, no rear contact, no " +
      "embracing, only a clean high-five gesture. Rainbow-marbled " +
      "candy-stripe finish on each letter. Confetti and sparkles " +
      "above their high-five. The letter pair sits on the small " +
      "glossy gold-and-white podium. (The two letters ARE the " +
      "trophy subject — show them clearly.) " +
      STYLE_FRAMING,
  },

  // ── Spell-the-Word: per-word stackable trophies ──────────────────
  {
    id: "spell-cat",
    // Spell CAT.
    prompt:
      "A round chubby smiling cartoon orange tabby cat curled into a " +
      "soft sleeping ball, eyes squinted happy, a glossy gold winner's " +
      "ribbon draped diagonally across its body with three little " +
      "white paw-print shapes embossed on the ribbon. The cat sits on " +
      "the small glossy gold-and-white podium. " +
      STYLE_FRAMING,
  },
  {
    id: "spell-dog",
    // Spell DOG.
    prompt:
      "A wiggly cartoon golden-brown puppy with floppy ears and a " +
      "wagging tail, sitting up proud, holding a shiny gold bone-shaped " +
      "medal in its mouth, the medal hanging from a red ribbon around " +
      "the puppy's neck. Tongue lolling, happy expression. The puppy " +
      "sits on the small glossy gold-and-white podium. " +
      STYLE_FRAMING,
  },
  {
    id: "spell-sun",
    // Spell SUN.
    prompt:
      "A smiling cartoon sun character with chunky pointed rays, warm " +
      "yellow-orange gradient, big happy eyes and a gentle smile, " +
      "rosy cheeks. The sun perches on top of a small fluffy white " +
      "cloud, and the cloud rests on the small glossy gold-and-white " +
      "podium. Soft golden glow radiating outward. " +
      STYLE_FRAMING,
  },
  {
    id: "spell-bus",
    // Spell BUS.
    prompt:
      "A tiny chubby cartoon yellow school bus with big friendly " +
      "round headlights for eyes, a cheerful grille smile, and a " +
      "single sparkly gold star sticker on the door. Squat and cute, " +
      "slight cartoon proportions. The bus sits on the small glossy " +
      "gold-and-white podium. " +
      STYLE_FRAMING,
  },
  {
    id: "spell-pig",
    // Spell PIG.
    prompt:
      "A pink cartoon piggy-bank pig with a curly tail, snout, and " +
      "smiling closed eyes, a coin slot on top of its back from which " +
      "a few shiny gold stars are tumbling out. Glossy ceramic " +
      "finish. The pig sits on the small glossy gold-and-white " +
      "podium. " +
      STYLE_FRAMING,
  },

  // ── Sound Match: stackable trophy ────────────────────────────────
  {
    id: "sound-match",
    // Match 10 letter sounds (stacks every +10 matches).
    prompt:
      "A chubby cartoon ear character (peach-pink, soft and rounded) " +
      "with two big friendly eyes and a happy smile, cupped slightly " +
      "to listen. A single bright sparkly cartoon eighth-note " +
      "musical note glows just inside the curve of the ear, and a " +
      "single shiny gold star sparkles above. Soft sound-wave arcs " +
      "radiate gently outward. The ear sits on the small glossy " +
      "gold-and-white podium. " +
      STYLE_FRAMING,
  },

  // ── Completion-milestone trophy ──────────────────────────────────
  {
    id: "word-wizard",
    // 25 total Spell-the-Word completions (any words). The single
    // tier-up trophy in v1 — a magical "you've spelled a LOT of
    // words" mastery reward.
    prompt:
      "A chubby cartoon book character with a big smiling face on its " +
      "cover, wearing a tall pointed deep-purple wizard's hat with " +
      "tiny yellow stars, holding a glowing magic wand in one little " +
      "noodle arm. Three sparkles swirl around it. The wizard book " +
      "sits on the small glossy gold-and-white podium. Magical, " +
      "advanced-mastery feel. " +
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

async function generateOne(trophy: TrophySpec): Promise<void> {
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
      prompt: trophy.prompt,
      n: 1,
      size: "1024x1024",
      // Transparent background so shelf tile colour shows through.
      background: "transparent",
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "<no body>");
    throw new Error(`OpenAI ${res.status} for "${trophy.id}": ${text.slice(0, 400)}`);
  }
  const json = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
  const item = json.data?.[0];
  if (!item) throw new Error(`OpenAI returned no data for "${trophy.id}"`);

  let buf: Buffer | null = null;
  if (item.b64_json) {
    buf = Buffer.from(item.b64_json, "base64");
  } else if (item.url) {
    const fetched = await fetch(item.url);
    if (!fetched.ok) throw new Error(`Failed to download image for "${trophy.id}": HTTP ${fetched.status}`);
    buf = Buffer.from(await fetched.arrayBuffer());
  }
  if (!buf) throw new Error(`OpenAI returned neither b64_json nor url for "${trophy.id}"`);

  const out = path.join(TROPHIES_DIR, `${trophy.id}.png`);
  await fs.writeFile(out, buf);
}

async function main(): Promise<void> {
  await fs.mkdir(TROPHIES_DIR, { recursive: true });

  const list = ONLY
    ? TROPHIES.filter((t) => ONLY.has(t.id) || ONLY.has(t.id.replace(/^spell-/, "")))
    : TROPHIES;

  if (LIST_ONLY) {
    console.log(`Would generate ${list.length} trophies:`);
    for (const t of list) console.log(`  ${t.id.padEnd(18)}`);
    return;
  }

  if (!OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is not set; aborting.");
    process.exit(1);
  }

  let made = 0;
  let skipped = 0;
  let failed = 0;
  for (const trophy of list) {
    const out = path.join(TROPHIES_DIR, `${trophy.id}.png`);
    if (!FORCE && (await exists(out))) {
      console.log(`· skip ${trophy.id} (cached)`);
      skipped++;
      continue;
    }
    try {
      console.log(`… ${trophy.id} — generating…`);
      await generateOne(trophy);
      console.log(`✓ ${trophy.id}`);
      made++;
    } catch (err) {
      console.error(`✗ ${trophy.id}: ${(err as Error).message}`);
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
