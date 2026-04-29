// Pre-generate every audio clip Letra plays into public/audio/<voice>/<id>.mp3.
//
// Why static + per-voice?
//   1. The user wants ElevenLabs token usage minimized — we pay once during
//      build, not every time a kid walks over a letter.
//   2. Latency: pre-K kids will sit through about 0 milliseconds of waiting
//      before they tune out. Cached MP3s start instantly.
//   3. Multiple voices can coexist — you can generate the same script with
//      different voices and switch between them in-app without
//      regenerating anything that already exists.
//
// CLIs:
//   audio:generate                  — generate the voice in env vars
//   audio:generate -- --force       — regenerate every clip even if cached
//   audio:generate -- --list        — show what would be generated
//   audio:generate-all              — refresh every voice already in the
//                                     voices.json registry, generating only
//                                     missing clips per voice (cheap idempotent
//                                     way to back-fill new clip ids)
//   audio:archive -- --name "Rachel" --voice-id 21m00Tcm4TlvDq8ikWAM
//                                   — move flat /audio/*.mp3 + manifest into
//                                     /audio/<slug>/ and add to voices.json

import { config as loadEnv } from "dotenv";
import { promises as fs } from "node:fs";
import path from "node:path";
import { buildEntries, type AudioManifest, type AudioEntry, type VoicesRegistry, type VoiceRegistryEntry, ALPHABET, LETTER_SOUND_TEXT, SPELL_WORDS } from "../src/audio/types.ts";

// Match Vite's convention: load .env.local first, then .env.
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PUBLIC_AUDIO = path.join(ROOT, "public", "audio");
const VOICES_REGISTRY_PATH = path.join(PUBLIC_AUDIO, "voices.json");

const ELEVEN_API_KEY = process.env.ELEVENLABS_API_KEY;
// Default voice: "Rachel" — warm, friendly American voice that's well-suited
// for narration aimed at small kids. Override via env for personality.
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
const VOICE_NAME = process.env.ELEVENLABS_VOICE_NAME || "Default";
const MODEL_ID = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";

const ARGS = process.argv.slice(2);
const FORCE = ARGS.includes("--force");
const LIST_ONLY = ARGS.includes("--list");
const MODE_ARCHIVE = ARGS.includes("--archive");
const MODE_GENERATE_ALL = ARGS.includes("--generate-all");

function getArg(name: string): string | undefined {
  const idx = ARGS.indexOf(name);
  return idx >= 0 ? ARGS[idx + 1] : undefined;
}

// Slugs are url-safe lowercase. Falls back to "voice-<short-id>" when no
// name is provided.
function toSlug(name: string, fallback: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  if (cleaned.length > 0) return cleaned;
  return `voice-${fallback.slice(0, 6).toLowerCase()}`;
}

async function exists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function loadRegistry(): Promise<VoicesRegistry> {
  if (!(await exists(VOICES_REGISTRY_PATH))) return { voices: [] };
  try {
    const raw = await fs.readFile(VOICES_REGISTRY_PATH, "utf8");
    const parsed = JSON.parse(raw) as VoicesRegistry;
    if (parsed && Array.isArray(parsed.voices)) return parsed;
  } catch {
    // fall through
  }
  return { voices: [] };
}

async function saveRegistry(reg: VoicesRegistry) {
  await fs.mkdir(PUBLIC_AUDIO, { recursive: true });
  await fs.writeFile(VOICES_REGISTRY_PATH, JSON.stringify(reg, null, 2));
}

async function upsertRegistryEntry(entry: VoiceRegistryEntry) {
  const reg = await loadRegistry();
  const idx = reg.voices.findIndex((v) => v.slug === entry.slug);
  if (idx >= 0) reg.voices[idx] = { ...reg.voices[idx], ...entry };
  else reg.voices.push(entry);
  // Ensure exactly one voice carries isDefault — keep the first one if
  // none does.
  const hasDefault = reg.voices.some((v) => v.isDefault);
  if (!hasDefault && reg.voices.length > 0) reg.voices[0].isDefault = true;
  await saveRegistry(reg);
}

async function generateOne(entry: AudioEntry, voiceId: string, modelId: string, outPath: string) {
  if (!ELEVEN_API_KEY) {
    throw new Error(
      "ELEVENLABS_API_KEY is not set. Copy .env.example to .env and add your key."
    );
  }
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`;
  const body = {
    text: entry.text,
    model_id: entry.modelId ?? modelId,
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
  await fs.writeFile(outPath, Buffer.from(arrayBuf));
}

function buildManifest(voiceId: string, modelId: string): AudioManifest {
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
    voiceId,
    modelId,
    generatedAt: new Date().toISOString(),
    letters,
    prompts,
    celebrate: ["celebrate-1", "celebrate-2", "celebrate-3", "celebrate-4", "celebrate-5", "celebrate-6"],
    hints: [
      "hint-keep-looking",
      "hint-look-around",
      "hint-i-believe",
      "hint-where-could-it-be",
      "hint-keep-going",
    ],
    wrongNudge: [
      "wrong-close",
      "wrong-almost",
      "wrong-keep-looking",
      "wrong-different",
      "wrong-try-again",
    ],
    menu: {
      welcome: "menu-welcome",
      spell: "menu-spell",
      alphabet: "menu-alphabet",
      sounds: "menu-sounds",
      back: "menu-back",
    },
  };
}

// Generate every clip for a single voice into public/audio/<slug>/. Returns
// counts so callers can summarise.
async function generateVoice(voice: { slug: string; name: string; voiceId: string; modelId: string }, opts: { force: boolean }) {
  const voiceDir = path.join(PUBLIC_AUDIO, voice.slug);
  await fs.mkdir(voiceDir, { recursive: true });
  const entries = buildEntries();
  let made = 0;
  let skipped = 0;
  let failed = 0;
  for (const entry of entries) {
    const out = path.join(voiceDir, `${entry.id}.mp3`);
    if (!opts.force && (await exists(out))) {
      skipped++;
      continue;
    }
    try {
      await generateOne(entry, voice.voiceId, voice.modelId, out);
      made++;
      console.log(`✓ [${voice.name}] ${entry.id} — ${JSON.stringify(entry.text).slice(0, 60)}`);
    } catch (err) {
      failed++;
      console.error(`✗ [${voice.name}] ${entry.id}: ${(err as Error).message}`);
    }
    // Light throttle keeps a free key inside its rate limit.
    await new Promise((r) => setTimeout(r, 60));
  }
  // Per-voice manifest
  await fs.writeFile(
    path.join(voiceDir, "manifest.json"),
    JSON.stringify(buildManifest(voice.voiceId, voice.modelId), null, 2)
  );
  // Update registry
  await upsertRegistryEntry({
    slug: voice.slug,
    name: voice.name,
    voiceId: voice.voiceId,
    modelId: voice.modelId,
    generatedAt: new Date().toISOString(),
  });
  return { made, skipped, failed };
}

// Move existing flat /audio/*.mp3 + manifest.json into /audio/<slug>/ and
// register it. Useful one-shot for the very first multi-voice migration.
async function archiveFlat(args: { name: string; voiceId?: string; modelId?: string }) {
  const slug = toSlug(args.name, args.voiceId ?? "voice");
  const targetDir = path.join(PUBLIC_AUDIO, slug);
  if (await exists(targetDir)) {
    throw new Error(`Refusing to archive: ${targetDir} already exists. Pick a different --name.`);
  }
  await fs.mkdir(targetDir, { recursive: true });
  const all = await fs.readdir(PUBLIC_AUDIO).catch(() => [] as string[]);
  let moved = 0;
  for (const name of all) {
    if (name === "voices.json" || name === slug) continue;
    if (!name.endsWith(".mp3") && name !== "manifest.json") continue;
    const src = path.join(PUBLIC_AUDIO, name);
    const stat = await fs.stat(src);
    if (!stat.isFile()) continue;
    await fs.rename(src, path.join(targetDir, name));
    moved++;
  }

  // Try to read voiceId/modelId from the moved manifest if not provided.
  let voiceId = args.voiceId;
  let modelId = args.modelId;
  const manifestPath = path.join(targetDir, "manifest.json");
  if (await exists(manifestPath)) {
    try {
      const raw = JSON.parse(await fs.readFile(manifestPath, "utf8")) as AudioManifest;
      voiceId = voiceId ?? raw.voiceId;
      modelId = modelId ?? raw.modelId;
    } catch {
      // ignore
    }
  }
  await upsertRegistryEntry({
    slug,
    name: args.name,
    voiceId: voiceId ?? "",
    modelId: modelId ?? "eleven_multilingual_v2",
    generatedAt: new Date().toISOString(),
  });
  console.log(`Archived ${moved} files into public/audio/${slug}/ as voice "${args.name}".`);
}

async function main() {
  await fs.mkdir(PUBLIC_AUDIO, { recursive: true });

  if (MODE_ARCHIVE) {
    const name = getArg("--name");
    if (!name) {
      console.error("Usage: npm run audio:archive -- --name \"Rachel\" [--voice-id <id>] [--model-id <id>]");
      process.exit(1);
    }
    await archiveFlat({ name, voiceId: getArg("--voice-id"), modelId: getArg("--model-id") });
    return;
  }

  if (LIST_ONLY) {
    const entries = buildEntries();
    console.log(`Would generate ${entries.length} clips:`);
    for (const e of entries) console.log(`  ${e.id.padEnd(28)} | ${e.text}`);
    return;
  }

  for (const L of ALPHABET) {
    if (!LETTER_SOUND_TEXT[L]) throw new Error(`No phonetic sound defined for ${L}`);
  }

  if (!ELEVEN_API_KEY) {
    console.warn(
      "WARN: ELEVENLABS_API_KEY not set. Skipping generation but writing a stub registry so the runtime falls back to Web Speech."
    );
    await saveRegistry(await loadRegistry());
    return;
  }

  if (MODE_GENERATE_ALL) {
    // Refresh every voice in the registry. Useful when buildEntries()
    // grows new clip ids and you want every voice to back-fill.
    const reg = await loadRegistry();
    if (reg.voices.length === 0) {
      console.error("voices.json is empty — generate at least one voice first.");
      process.exit(1);
    }
    console.log(`Refreshing ${reg.voices.length} voice${reg.voices.length === 1 ? "" : "s"}…`);
    for (const v of reg.voices) {
      const { made, skipped, failed } = await generateVoice(v, { force: FORCE });
      console.log(`  ${v.name}: generated ${made}, skipped ${skipped}, failed ${failed}`);
    }
    return;
  }

  const slug = toSlug(VOICE_NAME, VOICE_ID);
  console.log(`Generating voice "${VOICE_NAME}" (slug: ${slug}, voiceId: ${VOICE_ID}, model: ${MODEL_ID})…`);
  const { made, skipped, failed } = await generateVoice(
    { slug, name: VOICE_NAME, voiceId: VOICE_ID, modelId: MODEL_ID },
    { force: FORCE }
  );
  console.log(`\nDone. Generated ${made}, skipped ${skipped}, failed ${failed}.`);
  console.log(`Output: public/audio/${slug}/`);
  console.log(`Registry: ${path.relative(ROOT, VOICES_REGISTRY_PATH)}`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
