// Generate one-shot sound effects via the ElevenLabs Sound Effects API.
//
//   npm run sfx:generate            — fetch any missing clip
//   npm run sfx:generate -- --force — regenerate every clip
//   npm run sfx:list                — print what would be generated
//
// Outputs land in public/audio/sfx/<id>.mp3. The runtime loads each
// clip into an AudioBuffer the first time it plays — see the clip
// pools in src/audio/sfx.ts.
//
// HEADS UP: the firework-* and alien-wave-* ids below no longer match
// what the game loads. Those cues were later replaced by hand-picked
// files (firework-burst-1..3, alien-1..4), so generating them writes
// clips nothing reads. The specs are kept for reference — if you run
// this, delete the unreferenced outputs afterwards rather than
// shipping dead weight in dist/ (mp3s aren't precached — they're
// runtime-cached on first hit — so nothing ever fetches these).
// Cross-check what the runtime actually loads against:
//   grep -o '/audio/sfx/[a-z0-9-]*\.\(mp3\|ogg\)' src/audio/sfx.ts

import { config as loadEnv } from "dotenv";
import { promises as fs } from "node:fs";
import path from "node:path";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SFX_DIR = path.join(ROOT, "public", "audio", "sfx");

const ELEVEN_API_KEY = process.env.ELEVENLABS_API_KEY;
const ARGS = process.argv.slice(2);
const FORCE = ARGS.includes("--force");
const LIST_ONLY = ARGS.includes("--list");

type Spec = {
  id: string;
  prompt: string;
  durationSeconds: number;
  // 0..1 — higher hews tighter to the prompt and ignores genre / style
  // expectations. 0.3 is a reasonable default per ElevenLabs docs.
  promptInfluence?: number;
};

const SFX: Spec[] = [
  {
    // Rocket-going-up whoosh. Short, fizzy, with a faint pitch sweep
    // upward so it reads as motion. We keep it dry so it can layer
    // cleanly over the celebration music.
    id: "firework-launch",
    prompt:
      "Quick fireworks rocket launching upward into the sky. " +
      "Sharp tssss whoosh with a fizzing crackle trail and a subtle " +
      "rising whistle pitch. Short, punchy, no music, no voice.",
    durationSeconds: 0.7,
    promptInfluence: 0.4,
  },
  {
    // The pop + crackle. Slightly longer so the after-crackle has room
    // to ring out without bleeding into the next firework.
    id: "firework-burst",
    prompt:
      "A single firework exploding in the night sky. Loud crisp " +
      "BOOM thump followed by glittery crackling sparkle tails. " +
      "Bright cheerful celebratory firework, NOT a war or gun shot. " +
      "No music, no voice.",
    durationSeconds: 1.6,
    promptInfluence: 0.4,
  },
  // Five cute alien greeting sounds. Triggered when the player runs
  // into a moon-biome alien and it waves; runtime picks one at
  // random. Each one has its own personality so consecutive bumps
  // don't feel repetitive.
  {
    id: "alien-wave-1",
    prompt:
      "Cute friendly cartoon alien greeting noise. A short happy " +
      "'boop bee-doo!' chirp with a rising playful pitch. Bubbly, " +
      "warm, kid-friendly. No words, no scary growl, no music.",
    durationSeconds: 0.9,
    promptInfluence: 0.45,
  },
  {
    id: "alien-wave-2",
    prompt:
      "Cute alien hello sound — a soft warbling 'wah-doo-wee' " +
      "warble, like a small creature waving and saying hi. Bright, " +
      "friendly, slightly synthy. No words, no music, kid-safe.",
    durationSeconds: 1.0,
    promptInfluence: 0.45,
  },
  {
    id: "alien-wave-3",
    prompt:
      "Cute happy alien giggle. A soft chirpy bubbly laugh, like a " +
      "tiny extraterrestrial creature giggling at meeting a friend. " +
      "Bright, warm, cartoony, kid-friendly. No words, no music.",
    durationSeconds: 1.0,
    promptInfluence: 0.45,
  },
  {
    id: "alien-wave-4",
    prompt:
      "Cute alien greeting beep — a short cheerful 'bleep-blorp!' " +
      "two-note chirp, descending then rising. Bouncy, friendly, " +
      "synth-toy character. No words, no scary tones, no music.",
    durationSeconds: 0.8,
    promptInfluence: 0.45,
  },
  {
    id: "alien-wave-5",
    prompt:
      "Cute alien excited squeak. A bright bubbly 'boi-oing!' " +
      "rising squeal, like a happy little space creature surprised " +
      "to see you. Cartoony, kid-friendly, warm and playful. No " +
      "words, no music, no scary sounds.",
    durationSeconds: 0.9,
    promptInfluence: 0.45,
  },
  // ── Volcano eruption (ocean + jungle biomes) ──────────────────────
  // Three-beat sequence: the rumble plays the moment the boat is
  // swallowed by the sea cave, then one of the two booms fires as the
  // avatar is launched. Two boom variants so repeat eruptions — and a
  // kid WILL do this twenty times in a row — don't feel canned.
  {
    id: "volcano-rumble",
    prompt:
      "Deep low earth rumble building up before a volcano erupts. " +
      "Sub-bass ground shaking growl, gravel trembling, swelling " +
      "steadily louder. Adventurous and exciting, NOT scary, no " +
      "screaming, no music, no voice.",
    // The eruption state machine holds `rumbling` for 1.0s; a slightly
    // longer clip lets the tail bleed under the boom instead of
    // cutting off dead.
    durationSeconds: 1.6,
    promptInfluence: 0.5,
  },
  {
    id: "volcano-boom-1",
    prompt:
      "Big cartoon volcano erupting. Huge deep KABOOM explosion of " +
      "lava, then a whooshing blast of air rushing upward and " +
      "bubbling molten rock spraying out. Playful adventure-movie " +
      "energy, NOT a bomb or gunshot, no music, no voice.",
    durationSeconds: 2.5,
    promptInfluence: 0.45,
  },
  {
    id: "volcano-boom-2",
    prompt:
      "Volcano eruption blast. Thick low BOOM followed by a long " +
      "rising whoosh as something is launched high into the sky, " +
      "with crackling lava spatter falling back down. Fun and " +
      "cartoony, NOT scary or violent, no music, no voice.",
    durationSeconds: 2.5,
    promptInfluence: 0.45,
  },
  // ── Water splash (ocean biome) ────────────────────────────────────
  // Fires when the launched avatar lands back in the sea. Three
  // variants picked at random per splashdown.
  {
    id: "splash-1",
    prompt:
      "Big cannonball splash into water. Heavy KERPLOOSH as " +
      "something lands hard in the sea, water bursting upward then " +
      "droplets pattering back down. Fun, bright, cartoony. No " +
      "music, no voice.",
    durationSeconds: 1.3,
    promptInfluence: 0.45,
  },
  {
    id: "splash-2",
    prompt:
      "Playful splash landing in the ocean. A deep gloopy plunge " +
      "into water followed by fizzing bubbles and a light spray of " +
      "droplets. Warm, cheerful, kid-friendly. No music, no voice.",
    durationSeconds: 1.3,
    promptInfluence: 0.45,
  },
  {
    id: "splash-3",
    prompt:
      "Cartoon water splash. Quick sploosh plop into the sea with a " +
      "bubbly gurgle underneath and sparkling droplet patter. " +
      "Bouncy and light-hearted. No music, no voice.",
    durationSeconds: 1.2,
    promptInfluence: 0.45,
  },
  // ── Little splashes ───────────────────────────────────────────────
  // A much lighter set for the small, frequent water events — fish
  // arcing out and dropping back in, lava bombs hitting the sea. The
  // big splash-N clips above are far too heavy for these: they fire
  // every few seconds, so they have to stay small enough to sit under
  // the music rather than punch through it.
  {
    id: "splash-small-1",
    prompt:
      "A small fish jumping out of water and plopping back in. Light " +
      "quick 'ploop' with a couple of tiny droplet plips after it. " +
      "Gentle, cute, close-up, quiet. No music, no voice.",
    durationSeconds: 0.8,
    promptInfluence: 0.45,
  },
  {
    id: "splash-small-2",
    prompt:
      "Tiny water plop, like a pebble dropping into a calm pond. Soft " +
      "bloop with a short bubbly ripple tail. Delicate and quiet, " +
      "close-up. No music, no voice.",
    durationSeconds: 0.7,
    promptInfluence: 0.45,
  },
  // ── Lava quenching in the sea ─────────────────────────────────────
  // Lava bombs landing in open water. A plain water plop is wrong here
  // — the moment is molten rock hitting cold seawater, so it wants the
  // steam flash and crackle on top of the splash.
  {
    id: "lava-hiss-1",
    prompt:
      "Red hot molten lava hitting cold seawater. A sharp steam HISS " +
      "and fizzing sizzle bursting up, with a wet splash underneath " +
      "and crackling as the rock quenches. Short, punchy, exciting, " +
      "not scary. Steam and water only — absolutely NO metallic clang, " +
      "NO ringing metal, NO bell or gong, NO clank. No music, no voice.",
    durationSeconds: 1.1,
    promptInfluence: 0.5,
  },
  {
    id: "lava-hiss-2",
    prompt:
      "A glowing lump of lava plunging into the ocean. Quick splash " +
      "followed by a loud steam hiss and bubbling fizz, with a few " +
      "sharp crackles of cooling rock. Punchy and dramatic, " +
      "kid-friendly. Steam and water only — absolutely NO metallic " +
      "clang, NO ringing metal, NO bell or gong. No music, no voice.",
    durationSeconds: 1.1,
    promptInfluence: 0.5,
  },
  {
    id: "lava-hiss-3",
    prompt:
      "Molten rock quenching in water. Splash then a rush of steam, " +
      "sizzling and popping as it cools, tailing off into bubbles. " +
      "Crisp, close-up, playful. No music, no voice.",
    durationSeconds: 1.0,
    promptInfluence: 0.5,
  },
  {
    id: "splash-small-3",
    prompt:
      "Light playful water plip. A small quick splish as something " +
      "little breaks the surface of the sea, with a faint fizz of " +
      "bubbles. Soft, gentle, kid-friendly. No music, no voice.",
    durationSeconds: 0.7,
    promptInfluence: 0.45,
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

async function generateOne(spec: Spec): Promise<void> {
  if (!ELEVEN_API_KEY) {
    throw new Error(
      "ELEVENLABS_API_KEY is not set. Add it to .env.local before running."
    );
  }
  const url = "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128";
  const body = {
    text: spec.prompt,
    duration_seconds: spec.durationSeconds,
    prompt_influence: spec.promptInfluence ?? 0.3,
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": ELEVEN_API_KEY,
      "content-type": "application/json",
      accept: "audio/mpeg",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "<no body>");
    throw new Error(`ElevenLabs ${res.status} for "${spec.id}": ${text.slice(0, 300)}`);
  }
  const arrayBuf = await res.arrayBuffer();
  const out = path.join(SFX_DIR, `${spec.id}.mp3`);
  await fs.writeFile(out, Buffer.from(arrayBuf));
}

async function main(): Promise<void> {
  await fs.mkdir(SFX_DIR, { recursive: true });
  if (LIST_ONLY) {
    console.log(`Would generate ${SFX.length} clips:`);
    for (const s of SFX) console.log(`  ${s.id.padEnd(18)} | ${s.durationSeconds}s`);
    return;
  }
  if (!ELEVEN_API_KEY) {
    console.error("ELEVENLABS_API_KEY is not set; aborting.");
    process.exit(1);
  }
  let made = 0;
  let skipped = 0;
  let failed = 0;
  for (const spec of SFX) {
    const out = path.join(SFX_DIR, `${spec.id}.mp3`);
    if (!FORCE && (await exists(out))) {
      console.log(`· skip ${spec.id} (cached)`);
      skipped++;
      continue;
    }
    try {
      console.log(`… ${spec.id} — generating ${spec.durationSeconds}s…`);
      await generateOne(spec);
      console.log(`✓ ${spec.id}`);
      made++;
    } catch (err) {
      console.error(`✗ ${spec.id}: ${(err as Error).message}`);
      failed++;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log(`\nDone. Generated ${made}, skipped ${skipped}, failed ${failed}.`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
