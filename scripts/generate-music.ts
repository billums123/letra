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
  // Sent verbatim to ElevenLabs. The wording leans hard on
  // "perfect seamless loop / last note flows directly into first note /
  // identical energy at start and end" so the runtime can use native
  // AudioBufferSourceNode loop=true without crossfading. The model
  // doesn't always cooperate but matched head/tail energy is the
  // best we can ask for from generative music.
  prompt: string;
  // Override the default 30s clip length. Used by the dance-finale
  // track which is one full minute and pinned to a known BPM so the
  // letter choreography can lock to the beat.
  lengthMs?: number;
};

// Loop-friendly framing reused across every prompt — keeps the
// instructions consistent and easy to update in one place.
const LOOP_FRAMING =
  "This is a perfect seamless loop. The audio MUST end on the exact " +
  "same beat, chord, and energy that it begins on, so the very last " +
  "note flows directly into the very first note with no gap, no fade, " +
  "and no audible transition when the file plays back-to-back. " +
  "Absolutely NO intro buildup, NO outro ritardando, NO fade in, NO " +
  "fade out. Tempo is rock-steady from sample 1 to the final sample. " +
  "The opening downbeat and the final downbeat are interchangeable. " +
  "Instrumental only, no vocals.";

const TRACKS: Track[] = [
  {
    id: "menu-theme",
    name: "Letra Theme",
    prompt:
      "Cheerful welcoming children's menu theme in a bright major key. " +
      "Friendly bouncing melody played on toy piano and soft synth bells " +
      "over warm bass and light shaker. Inviting, playful, sunny. " +
      LOOP_FRAMING,
  },
  {
    id: "sunny-walk",
    name: "Sunny Walk",
    prompt:
      "Upbeat instrumental children's gameplay music with a sunny " +
      "walking-tempo groove around 118 BPM. Plucky ukulele or marimba " +
      "melody in C major, warm bass, soft drum kit with a steady backbeat. " +
      "Playful and encouraging. " +
      LOOP_FRAMING,
  },
  {
    id: "letter-hop",
    name: "Letter Hop",
    prompt:
      "Bouncy syncopated instrumental children's music around 130 BPM. " +
      "Hopping toy-piano melody, soft synth pads, plucky bass, light " +
      "drums with playful kick patterns. Whimsical and jumpy, like " +
      "characters skipping along. " +
      LOOP_FRAMING,
  },
  {
    id: "adventure",
    name: "Adventure",
    prompt:
      "Heroic uplifting instrumental children's adventure music around " +
      "108 BPM. Sweeping pizzicato strings or marimba melody in G major, " +
      "warm pad chords, gentle drums. Encouraging and a touch epic, " +
      "appropriate for a pre-K kid exploring a friendly 3D world. " +
      LOOP_FRAMING,
  },
  {
    id: "sky-park",
    name: "Sky Park",
    prompt:
      "Dreamy floating children's instrumental around 96 BPM. Soft " +
      "marimba arpeggios in F major, airy synth pad, gentle bass, " +
      "shimmery bell accents. Calm, curious, like wandering through a " +
      "cloud playground on a sunny afternoon. " +
      LOOP_FRAMING,
  },
  {
    id: "bouncy-castle",
    name: "Bouncy Castle",
    prompt:
      "Silly playful children's instrumental around 122 BPM. Boingy " +
      "synth-bass leads, plucky ukulele, kazoo-like melody, soft toms " +
      "and tambourine. Goofy, light, mischievous — like a cartoon " +
      "rabbit hopping around. D major. " +
      LOOP_FRAMING,
  },
  {
    // Plays after the kid finds the whole alphabet. The dance party
    // finale animates every letter on this track's beat — see
    // src/games/FindAlphabet.tsx. We pin BPM hard in the prompt so the
    // visual choreography (which assumes exactly 120 BPM) lines up,
    // and ask for a full minute so it carries the celebration without
    // an early loop point.
    id: "celebration",
    name: "Letter Party",
    lengthMs: 60000,
    prompt:
      "Joyful explosive children's birthday-party celebration music " +
      "at EXACTLY 120 BPM, rock-steady tempo from sample one to the " +
      "very end. Every quarter-note beat lands on a clear strong kick " +
      "drum so the rhythm is unmistakable. Big bouncy danceable " +
      "groove. Bright brass stabs, plucky synth lead melody, party " +
      "horns, hand claps on 2 and 4, marimba arpeggios, shimmery " +
      "bells. Major key, jubilant, confetti-in-the-air mood, the " +
      "kind of song you put on the moment a kid finishes their first " +
      "big achievement. Crystal clear danceable pulse throughout. " +
      LOOP_FRAMING,
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
    music_length_ms: track.lengthMs ?? 30000,
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
      console.log(`… ${t.id} — composing ${(t.lengthMs ?? 30000) / 1000}s…`);
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
