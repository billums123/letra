// Generate one-shot sound effects via the ElevenLabs Sound Effects API.
//
//   npm run sfx:generate            — fetch any missing clip
//   npm run sfx:generate -- --force — regenerate every clip
//   npm run sfx:list                — print what would be generated
//
// Outputs land in public/audio/sfx/<id>.mp3. The runtime loads each
// clip into an AudioBuffer the first time it plays — see
// src/audio/sfxClips.ts.

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
