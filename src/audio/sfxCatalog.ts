// The one place that describes every sound effect in the game: what it
// is, what it sounds like, where it fires, and how it is produced.
//
// Two consumers read this:
//   - scripts/generate-sfx.ts, to know what to ask ElevenLabs for
//   - src/ui/SfxLab.tsx, the dev screen for auditioning and replacing
//     clips without touching the code
//
// Keeping it in one file is the point. The generator used to carry its
// own private list of prompts, which drifted out of step with what the
// runtime actually loaded — it kept writing clips nothing read, and
// nothing flagged it.
//
// A cue is either:
//   "synth"    — generated live with WebAudio oscillators and noise.
//                No asset. These are the chiptune-ish ones.
//   "recorded" — plays an mp3, falling back to a synth if the file is
//                missing or still decoding, so the game is never silent.
//
// `slots` are the files a recorded cue picks between at random. A synth
// cue has none until you generate some; adding files to `slots` is what
// promotes it, and the runtime picks them up on the next load.

export type SfxKind = "synth" | "recorded";

export type SfxCue = {
  id: string;
  label: string;
  // What it actually sounds like, in plain words.
  sounds: string;
  // Where it fires from.
  usedIn: string[];
  kind: SfxKind;
  // Recorded variants, as they appear under /audio/sfx/. Empty for a
  // pure synth cue.
  slots: string[];
  // Starting point for ElevenLabs. Editable in the lab; this is just
  // the default that loads into the box.
  prompt: string;
  durationSeconds: number;
  promptInfluence: number;
  // Name of the exported function in src/audio/sfx.ts, so the lab can
  // audition the cue exactly as the game plays it.
  play: string;
};

export const SFX_CATALOG: SfxCue[] = [
  {
    id: "chime",
    label: "Letter pickup",
    sounds:
      "Four recorded pickup chimes, rotated so the same one never plays twice running. Falls back to eight procedural jingles — a rising triad, a fairy-dust sparkle, a bouncy skip, a magic glissando, a Mario-ish coin, a major-7 stack, a bubbly bloop and a trumpet fanfare.",
    usedIn: ["Spell the Word", "Find the Alphabet", "Match the Sound", "Letter editor"],
    kind: "recorded",
    slots: ["chime-1.mp3", "chime-2.mp3", "chime-3.mp3", "chime-4.mp3"],
    prompt:
      "Bright happy chime for a small child collecting a letter in a " +
      "game. Short sparkling two-note bell with a warm sunny ring. " +
      "Rewarding and gentle, never harsh. No music, no voice.",
    durationSeconds: 0.8,
    promptInfluence: 0.45,
    play: "playChime",
  },
  {
    id: "kid-step",
    label: "Kid footstep",
    sounds:
      "One recorded footfall, played with wide pitch jitter so a walk cycle does not tick like a metronome. Falls back to a short sine blip.",
    usedIn: ["Kid avatar, once per footfall"],
    kind: "recorded",
    slots: ["kid-step-1.mp3"],
    prompt:
      "Soft cartoon footstep on grass. A single quiet padded thud, " +
      "light and bouncy, not a boot or a stomp. Very short. No music, " +
      "no voice.",
    durationSeconds: 0.4,
    promptInfluence: 0.45,
    play: "playKidStep",
  },
  {
    id: "car-putt",
    label: "Car putt",
    sounds:
      "A comic exhaust blurt — a low square-wave putt with a quick pitch drop, fired on top of the continuous motor loop.",
    usedIn: ["Car avatar, on throttle flourishes"],
    kind: "synth",
    slots: [],
    prompt:
      "Cartoon toy car exhaust putt. One short low blurting putt-putt " +
      "with a comic pitch drop. Silly and friendly. No music, no voice.",
    durationSeconds: 0.5,
    promptInfluence: 0.45,
    play: "playCarPutt",
  },
  {
    id: "woo",
    label: "Celebration flourish",
    sounds:
      "Three recorded flourishes, rotated. Falls back to a five-note rising arpeggio that jumps an octave at the top with a sparkle tail over it.",
    usedIn: [
      "Finishing a word",
      "Finishing a round",
      "Earning a trophy",
      "Volcano launch, timed for the apex",
    ],
    kind: "recorded",
    slots: ["woo-1.mp3", "woo-2.mp3", "woo-3.mp3"],
    prompt:
      "Short triumphant flourish for a small child completing " +
      "something. Bright rising sparkle with a cheerful lift at the " +
      "end, like a tiny fanfare. Warm and celebratory. No music bed, " +
      "no voice.",
    durationSeconds: 1.2,
    promptInfluence: 0.45,
    play: "playWoo",
  },
  {
    id: "firework-launch",
    label: "Firework launch",
    sounds:
      "A fizzy tssss whoosh with a rising two-oscillator whistle sweeping up through the audible range, so it reads as the shell climbing away.",
    usedIn: ["End-of-alphabet firework display, on each mortar"],
    kind: "synth",
    slots: [],
    prompt:
      "Quick fireworks rocket launching upward into the sky. Sharp " +
      "tssss whoosh with a fizzing crackle trail and a subtle rising " +
      "whistle pitch. Short, punchy, no music, no voice.",
    durationSeconds: 0.7,
    promptInfluence: 0.4,
    play: "playFireworkLaunch",
  },
  {
    id: "lava-pop",
    label: "Lava bomb pop",
    sounds:
      "Two recorded pops, rotated, still throttled to 120ms so a bomb fountain reads as texture rather than a drum roll. Falls back to a sine bloop with an occasional sizzle.",
    usedIn: ["Volcano bombs landing on rock or beach (ocean and jungle)"],
    kind: "recorded",
    slots: ["lava-pop-1.mp3", "lava-pop-2.mp3"],
    prompt:
      "Small blob of molten lava landing on rock. A short thick bloop " +
      "with a faint crackle of cooling. Close-up, quiet, playful. No " +
      "music, no voice.",
    durationSeconds: 0.5,
    promptInfluence: 0.5,
    play: "playLavaPop",
  },
  {
    id: "firework-burst",
    label: "Firework burst",
    sounds:
      "Recorded bangs, pitch-jittered. The fallback synth is a five-layer KABOOM: sub-bass drop, lowpassed body, mid attack, a feedback-delay tail for open-sky echo, and a sparkle crackle behind it.",
    usedIn: ["End-of-alphabet firework display, on each burst"],
    kind: "recorded",
    slots: ["firework-burst-1.mp3", "firework-burst-2.ogg", "firework-burst-3.ogg"],
    prompt:
      "A single firework exploding in the night sky. Loud crisp BOOM " +
      "thump followed by glittery crackling sparkle tails. Bright " +
      "cheerful celebratory firework, NOT a war or gun shot. No music, " +
      "no voice.",
    durationSeconds: 1.6,
    promptInfluence: 0.4,
    play: "playFireworkBurst",
  },
  {
    id: "alien-wave",
    label: "Alien hello",
    sounds:
      "Recorded cute chirps. The fallback is two or three short triangle-wave chirps with randomised pitch sweeps.",
    usedIn: ["Moon biome, when the kid bumps an alien and it waves"],
    kind: "recorded",
    slots: ["alien-1.mp3", "alien-2.mp3", "alien-3.mp3", "alien-4.mp3"],
    prompt:
      "Cute friendly cartoon alien greeting noise. A short happy 'boop " +
      "bee-doo!' chirp with a rising playful pitch. Bubbly, warm, " +
      "kid-friendly. No words, no scary growl, no music.",
    durationSeconds: 0.9,
    promptInfluence: 0.45,
    play: "playAlienWave",
  },
  {
    id: "volcano-rumble",
    label: "Volcano rumble",
    sounds:
      "A building ground-shake. The fallback is a hard-lowpassed noise bed swelling over about a second with a groaning sub-bass wobble underneath — nearly inaudible on a tablet speaker, which is why this one is recorded.",
    usedIn: ["The moment the boat is swallowed by the sea cave"],
    kind: "recorded",
    slots: ["volcano-rumble.mp3"],
    prompt:
      "Deep low earth rumble building up before a volcano erupts. " +
      "Sub-bass ground shaking growl, gravel trembling, swelling " +
      "steadily louder. Adventurous and exciting, NOT scary, no " +
      "screaming, no music, no voice. Keep building the whole time — " +
      "no pause, no drop in the middle, no release at the end.",
    // Long enough to cover a mega wind-up (3.2s) without running out.
    // The boom cuts it off on a normal one, which is fine.
    durationSeconds: 3.6,
    promptInfluence: 0.5,
    play: "playVolcanoRumble",
  },
  {
    id: "volcano-boom",
    label: "Volcano eruption",
    sounds:
      "The blast itself. Three takes rotate for an ordinary eruption; volcano-boom-2 is held back and only plays on a mega launch. The fallback is a sub-bass punch, a lowpassed boom body and a rising detuned whoosh tracking the avatar skyward.",
    usedIn: ["The eruption that launches the avatar"],
    kind: "recorded",
    // volcano-boom-2 is deliberately NOT in the everyday rotation —
    // it is reserved for the mega launch, so the eruption that
    // throws the kid into space does not sound like the usual one.
    slots: [
      "volcano-boom-1.mp3",
      "volcano-boom-3.mp3",
      "volcano-boom-4.mp3",
      "volcano-boom-2.mp3",
    ],
    prompt:
      "Big cartoon volcano erupting. Huge deep KABOOM explosion of " +
      "lava, then a whooshing blast of air rushing upward and bubbling " +
      "molten rock spraying out. Playful adventure-movie energy, NOT a " +
      "bomb or gunshot, no music, no voice.",
    durationSeconds: 2.5,
    promptInfluence: 0.45,
    play: "playVolcanoBoom",
  },
  {
    id: "splash",
    label: "Big splashdown",
    sounds:
      "The payoff when a launched avatar hits the sea. The fallback is a noise burst through a falling lowpass, a bloop underneath, and a patter of droplet blips.",
    usedIn: ["Avatar landing in the water after a volcano launch"],
    kind: "recorded",
    slots: ["splash-1.mp3", "splash-2.mp3", "splash-3.mp3"],
    prompt:
      "Big cannonball splash into water. Heavy KERPLOOSH as something " +
      "lands hard in the sea, water bursting upward then droplets " +
      "pattering back down. Fun, bright, cartoony. No music, no voice.",
    durationSeconds: 1.3,
    promptInfluence: 0.45,
    play: "playSplash",
  },
  {
    id: "splash-small",
    label: "Little splash",
    sounds:
      "The quiet cousin, for water events that fire every few seconds. Throttled to 110ms so a school of fish can't stack them into a wash.",
    usedIn: ["Fish jumping out and dropping back in"],
    kind: "recorded",
    slots: ["splash-small-1.mp3", "splash-small-2.mp3", "splash-small-3.mp3"],
    prompt:
      "A small fish jumping out of water and plopping back in. Light " +
      "quick 'ploop' with a couple of tiny droplet plips after it. " +
      "Gentle, cute, close-up, quiet. No music, no voice.",
    durationSeconds: 0.8,
    promptInfluence: 0.45,
    play: "playSmallSplash",
  },
  {
    id: "lava-hiss",
    label: "Lava quench",
    sounds:
      "Molten rock hitting cold seawater — splash plus a steam flash and crackle. The fallback is a wet plop with a high-passed steam swell over it.",
    usedIn: ["Volcano bombs landing in open water"],
    kind: "recorded",
    slots: ["lava-hiss-1.mp3", "lava-hiss-2.mp3", "lava-hiss-3.mp3"],
    prompt:
      "Red hot molten lava hitting cold seawater. A sharp steam HISS " +
      "and fizzing sizzle bursting up, with a wet splash underneath " +
      "and crackling as the rock quenches. Short, punchy, exciting, " +
      "not scary. Steam and water only — absolutely NO metallic clang, " +
      "NO ringing metal, NO bell or gong, NO clank. No music, no voice.",
    durationSeconds: 1.1,
    promptInfluence: 0.5,
    play: "playLavaSplash",
  },
];

export function getCue(id: string): SfxCue | undefined {
  return SFX_CATALOG.find((c) => c.id === id);
}
