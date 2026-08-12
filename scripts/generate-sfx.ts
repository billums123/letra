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

// Specs come from the shared catalog (src/audio/sfxCatalog.ts), which
// is also what the SFX Lab dev screen reads. This file used to keep its
// own private list, and it drifted: it kept generating clips under
// names the runtime had stopped loading, and nothing flagged it.
//
// Only cues with slots are generated — a pure synth cue has no file to
// write. Each slot gets its own take so the variants differ.
import { SFX_CATALOG } from "../src/audio/sfxCatalog";

type Spec = {
  id: string;
  file: string;
  prompt: string;
  durationSeconds: number;
  promptInfluence: number;
};

const SFX: Spec[] = SFX_CATALOG.flatMap((cue) =>
  cue.slots
    // .ogg slots are hand-picked files, not generated ones.
    .filter((file) => file.endsWith(".mp3"))
    .map((file) => ({
      id: cue.id,
      file,
      prompt: cue.prompt,
      durationSeconds: cue.durationSeconds,
      promptInfluence: cue.promptInfluence,
    }))
);

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
    throw new Error(`ElevenLabs ${res.status} for "${spec.file}": ${text.slice(0, 300)}`);
  }
  const arrayBuf = await res.arrayBuffer();
  await fs.writeFile(path.join(SFX_DIR, spec.file), Buffer.from(arrayBuf));
}

async function main(): Promise<void> {
  await fs.mkdir(SFX_DIR, { recursive: true });
  if (LIST_ONLY) {
    console.log(`Would generate ${SFX.length} clips:`);
    for (const s of SFX) console.log(`  ${s.file.padEnd(24)} | ${s.durationSeconds}s`);
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
    const out = path.join(SFX_DIR, spec.file);
    if (!FORCE && (await exists(out))) {
      console.log(`· skip ${spec.file} (cached)`);
      skipped++;
      continue;
    }
    try {
      console.log(`… ${spec.file} — generating ${spec.durationSeconds}s…`);
      await generateOne(spec);
      console.log(`✓ ${spec.file}`);
      made++;
    } catch (err) {
      console.error(`✗ ${spec.file}: ${(err as Error).message}`);
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
