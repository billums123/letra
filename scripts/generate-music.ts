// Generate background-music tracks via the ElevenLabs Music API.
//
//   npm run music:generate            — fetch any missing track
//   npm run music:generate -- --force — regenerate every track
//
// Tracks land in public/audio/music/<id>.mp3. The runtime then loads
// them as AudioBuffers and crossfade-loops them — see src/audio/music.ts.
//
// Cost note: at ~30s per track and 4 tracks, this is a one-shot per
// composition tweak. Don't wire this into a watcher.

import { config as loadEnv } from "dotenv";
import { promises as fs } from "node:fs";
import path from "node:path";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const MUSIC_DIR = path.join(ROOT, "public", "audio", "music");

const ELEVEN_API_KEY = process.env.ELEVENLABS_API_KEY;
const ARGS = process.argv.slice(2);
const FORCE = ARGS.includes("--force");
const LIST_ONLY = ARGS.includes("--list");

type Track = {
  id: string;
  name: string;
  // Sent verbatim to ElevenLabs. Keep mood + instrumentation explicit
  // and lean on "consistent throughout / no fade in or out / no intro
  // or outro" so the model leaves the head and tail at the same energy
  // — the crossfade in the runtime player covers any small mismatch.
  prompt: string;
};

const TRACKS: Track[] = [
  {
    id: "menu-theme",
    name: "Letra Theme",
    prompt:
      "Cheerful instrumental children's theme song in a bright major key. " +
      "Friendly bouncing melody played on toy piano and soft synth bells, " +
      "warm bass, light hand claps and shaker. Welcoming, playful, " +
      "inviting energy that loops endlessly under a kids' learning game " +
      "menu. Consistent tempo and energy throughout. No vocals. " +
      "No intro or outro, no fade in or fade out — same intensity at " +
      "the beginning, middle, and end so the clip can loop seamlessly.",
  },
  {
    id: "sunny-walk",
    name: "Sunny Walk",
    prompt:
      "Upbeat instrumental children's gameplay music with a sunny " +
      "walking-tempo groove around 118 BPM. Plucky ukulele or marimba " +
      "melody in C major, warm bass, soft drum kit with a steady backbeat. " +
      "Playful, encouraging, consistently energetic from start to finish. " +
      "No vocals. No intro or outro, no fade in or fade out — the head " +
      "and tail of the clip should be at the same energy so it loops " +
      "seamlessly.",
  },
  {
    id: "letter-hop",
    name: "Letter Hop",
    prompt:
      "Bouncy syncopated instrumental children's music around 130 BPM. " +
      "Hopping toy-piano melody, soft synth pads, plucky bass, light " +
      "drums with playful kick patterns. Whimsical and jumpy, like " +
      "characters skipping along. Consistent energy throughout. No " +
      "vocals. No intro or outro, no fade in or fade out — same " +
      "intensity at the start and end so the clip loops seamlessly.",
  },
  {
    id: "adventure",
    name: "Adventure",
    prompt:
      "Heroic uplifting instrumental children's adventure music around " +
      "108 BPM. Sweeping pizzicato strings or marimba melody in G major, " +
      "warm pad chords, gentle drums. Encouraging and a touch epic, " +
      "appropriate for a pre-K kid exploring a friendly 3D world. " +
      "Consistent energy from start to finish. No vocals. No intro or " +
      "outro, no fade in or fade out — same intensity at the start and " +
      "end so the clip loops seamlessly.",
  },
];

async function exists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function generateOne(track: Track) {
  if (!ELEVEN_API_KEY) {
    throw new Error(
      "ELEVENLABS_API_KEY is not set. Copy .env.example to .env and add your key."
    );
  }
  const url = "https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128";
  const body = {
    prompt: track.prompt,
    music_length_ms: 30000,
    model_id: "music_v1",
    force_instrumental: true,
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
    throw new Error(`ElevenLabs ${res.status} for "${track.id}": ${text.slice(0, 300)}`);
  }
  const arrayBuf = await res.arrayBuffer();
  const out = path.join(MUSIC_DIR, `${track.id}.mp3`);
  await fs.writeFile(out, Buffer.from(arrayBuf));
}

async function main() {
  await fs.mkdir(MUSIC_DIR, { recursive: true });

  if (LIST_ONLY) {
    console.log(`Would generate ${TRACKS.length} tracks:`);
    for (const t of TRACKS) console.log(`  ${t.id.padEnd(14)} | ${t.name}`);
    return;
  }

  if (!ELEVEN_API_KEY) {
    console.error("ELEVENLABS_API_KEY is not set; aborting.");
    process.exit(1);
  }

  let made = 0;
  let skipped = 0;
  let failed = 0;
  for (const t of TRACKS) {
    const out = path.join(MUSIC_DIR, `${t.id}.mp3`);
    if (!FORCE && (await exists(out))) {
      console.log(`· skip ${t.id} (cached)`);
      skipped++;
      continue;
    }
    try {
      console.log(`… ${t.id} — composing 30s…`);
      await generateOne(t);
      console.log(`✓ ${t.id}`);
      made++;
    } catch (err) {
      console.error(`✗ ${t.id}: ${(err as Error).message}`);
      failed++;
    }
    // Music API takes a while; a small pause keeps us inside any rate limit.
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`\nDone. Generated ${made}, skipped ${skipped}, failed ${failed}.`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
