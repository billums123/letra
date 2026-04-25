// Pre-generate every audio clip Letra plays into public/audio/<id>.mp3.
//
// Why static? Two reasons:
//   1. The user wants ElevenLabs token usage minimized — we pay once during
//      build, not every time a kid walks over a letter.
//   2. Latency: pre-K kids will sit through about 0 milliseconds of waiting
//      before they tune out. Cached MP3s start instantly.
//
// Skips clips whose MP3 already exists, so re-runs are cheap. Pass --force to
// regenerate everything.

import { config as loadEnv } from "dotenv";
import { promises as fs } from "node:fs";
import path from "node:path";

// Match Vite's convention: load .env.local first (gitignored, takes precedence
// for personal keys), then fall back to .env. Either works.
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });
import { buildEntries, type AudioManifest, type AudioEntry, ALPHABET, LETTER_SOUND_TEXT, SPELL_WORDS } from "../src/audio/types.ts";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT_DIR = path.join(ROOT, "public", "audio");
const MANIFEST_PATH = path.join(OUT_DIR, "manifest.json");

const ELEVEN_API_KEY = process.env.ELEVENLABS_API_KEY;
// Default voice: "Rachel" — warm, friendly American voice that's well-suited
// for narration aimed at small kids. Override via env for personality.
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
const MODEL_ID = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";

const FORCE = process.argv.includes("--force");
const LIST_ONLY = process.argv.includes("--list");

async function exists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function generateOne(entry: AudioEntry) {
  if (!ELEVEN_API_KEY) {
    throw new Error(
      "ELEVENLABS_API_KEY is not set. Copy .env.example to .env and add your key."
    );
  }
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`;
  const body = {
    text: entry.text,
    model_id: MODEL_ID,
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0.4,
      use_speaker_boost: true,
    },
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
    throw new Error(`ElevenLabs ${res.status} for "${entry.id}": ${text.slice(0, 200)}`);
  }
  const arrayBuf = await res.arrayBuffer();
  const out = path.join(OUT_DIR, `${entry.id}.mp3`);
  await fs.writeFile(out, Buffer.from(arrayBuf));
  return out;
}

function buildManifest(): AudioManifest {
  const letters: AudioManifest["letters"] = {};
  for (const L of ALPHABET) {
    letters[L] = { name: `letter-${L}-name`, sound: `letter-${L}-sound` };
  }
  const prompts: Record<string, string> = {};
  for (const w of SPELL_WORDS) {
    prompts[`spell-${w.word}`] = `prompt-spell-${w.word}`;
    prompts[`spell-${w.word}-reveal`] = `reveal-spell-${w.word}`;
  }
  prompts["find-alphabet"] = "prompt-find-alphabet";
  prompts["sound-match"] = "prompt-sound-match";
  prompts["sound-match-replay"] = "prompt-sound-match-replay";
  return {
    voiceId: VOICE_ID,
    modelId: MODEL_ID,
    generatedAt: new Date().toISOString(),
    letters,
    prompts,
    celebrate: ["celebrate-1", "celebrate-2", "celebrate-3", "celebrate-4", "celebrate-5", "celebrate-6"],
    hints: { keepLooking: "hint-keep-looking", lookAround: "hint-look-around" },
    menu: {
      welcome: "menu-welcome",
      spell: "menu-spell",
      alphabet: "menu-alphabet",
      sounds: "menu-sounds",
      back: "menu-back",
    },
  };
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const entries = buildEntries();

  if (LIST_ONLY) {
    console.log(`Would generate ${entries.length} clips:`);
    for (const e of entries) console.log(`  ${e.id.padEnd(28)} | ${e.text}`);
    return;
  }

  // Validate that every letter has a sound — guard against typos.
  for (const L of ALPHABET) {
    if (!LETTER_SOUND_TEXT[L]) throw new Error(`No phonetic sound defined for ${L}`);
  }

  if (!ELEVEN_API_KEY) {
    console.warn(
      "WARN: ELEVENLABS_API_KEY not set. The runtime will fall back to Web Speech API.\n" +
        "      Writing manifest only so the game can still load."
    );
    await fs.writeFile(MANIFEST_PATH, JSON.stringify(buildManifest(), null, 2));
    return;
  }

  let made = 0;
  let skipped = 0;
  let failed = 0;
  for (const entry of entries) {
    const out = path.join(OUT_DIR, `${entry.id}.mp3`);
    if (!FORCE && (await exists(out))) {
      skipped++;
      continue;
    }
    try {
      await generateOne(entry);
      made++;
      console.log(`✓ ${entry.id} — ${JSON.stringify(entry.text).slice(0, 60)}`);
    } catch (err) {
      failed++;
      console.error(`✗ ${entry.id}: ${(err as Error).message}`);
    }
    // Light throttle: ElevenLabs allows plenty of concurrency on paid plans
    // but a 60ms pause keeps a free key inside the rate limit on first run.
    await new Promise((r) => setTimeout(r, 60));
  }
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(buildManifest(), null, 2));
  console.log(`\nDone. Generated ${made}, skipped ${skipped}, failed ${failed}.`);
  console.log(`Manifest written: ${path.relative(ROOT, MANIFEST_PATH)}`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
