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
  {
    id: "portal-dive",
    label: "Sun portal",
    sounds:
      "Driving into one of the pools of ocean set in the sun's surface: water closing over the boat, then a falling swoop as it drops through. Two takes rotate. Falls back to a bandpassed noise swallow with a tone sliding down two octaves.",
    usedIn: ["The sun — entering a portal home"],
    kind: "recorded",
    slots: ["portal-dive-1.mp3", "portal-dive-2.mp3"],
    prompt:
      "Magical water portal swallowing something. A quick gulping " +
      "whoosh of water closing over, then a shimmering downward swoop " +
      "as it falls through to somewhere else. Bright, wondrous and " +
      "friendly for a small child. No music, no voice.",
    durationSeconds: 1.4,
    promptInfluence: 0.4,
    play: "playPortalDive",
  },
  {
    id: "sun-touchdown",
    label: "Landing on the sun",
    sounds:
      "The moment the avatar sets down on the star: a soft low thump with the roar of the surface swelling up around it. Two takes rotate. Falls back to a sine thump under a slow noise swell.",
    usedIn: ["The sun — arriving after a mega eruption"],
    kind: "recorded",
    slots: ["sun-touchdown-1.mp3", "sun-touchdown-2.mp3"],
    prompt:
      "Landing softly on the surface of a huge burning star. A warm " +
      "muffled thump on touchdown, then a deep roaring swell of fire " +
      "and solar wind rising around you and settling. Awe-struck and " +
      "warm, not scary. No music, no voice.",
    durationSeconds: 2.2,
    promptInfluence: 0.4,
    play: "playSunTouchdown",
  },
  {
    id: "tornado-suck",
    label: "Waterspout",
    sounds:
      "The tornado on the ocean getting hold of the boat and hauling it up — a rising roar of moving air over a climbing low howl. Two takes rotate. Falls back to a swelling bandpassed noise bed with a filtered saw underneath.",
    usedIn: ["The ocean — driving into the waterspout, and the climb to Saturn or Jupiter"],
    kind: "recorded",
    slots: ["tornado-suck-1.mp3", "tornado-suck-2.mp3"],
    prompt:
      "A huge waterspout picking something up. A deep roar of rushing " +
      "wind and spray building and building, spinning, lifting away " +
      "into the sky. Exciting and adventurous for a small child, not " +
      "frightening. No music, no voice.",
    durationSeconds: 3.0,
    promptInfluence: 0.4,
    play: "playTornado",
  },
  {
    id: "saturn-touchdown",
    label: "Landing on Saturn",
    sounds:
      "Setting down on cloud tops: soft, wide and windy, where the star's arrival was a thump and a roar. Two takes rotate. Falls back to a noise swell through a closing lowpass.",
    usedIn: ["Saturn — arriving after a trip up the waterspout"],
    kind: "recorded",
    slots: ["saturn-touchdown-1.mp3", "saturn-touchdown-2.mp3"],
    prompt:
      "Landing gently on the cloud tops of a huge gas giant. A soft " +
      "billowing whoomph settling into wide slow high-altitude wind. " +
      "Vast, calm and full of wonder. No music, no voice.",
    durationSeconds: 2.2,
    promptInfluence: 0.4,
    play: "playSaturnTouchdown",
  },
  {
    id: "jupiter-touchdown",
    label: "Landing on Jupiter",
    sounds:
      "The same cloud tops as Saturn with a planet's worth of mass under them: a wider, longer wind swell with a sub-bass settle beneath it. Two takes rotate. Falls back to a noise swell through a closing lowpass over a sine sliding from 76Hz to 31Hz.",
    usedIn: ["Jupiter — arriving after a trip up the waterspout"],
    kind: "recorded",
    slots: ["jupiter-touchdown-1.mp3", "jupiter-touchdown-2.mp3"],
    prompt:
      "Landing on the cloud tops of an enormous gas giant. A huge " +
      "soft billowing whoomph with a deep bass rumble underneath, " +
      "settling into vast slow high-altitude wind. Immense, calm and " +
      "full of wonder. No music, no voice.",
    durationSeconds: 2.8,
    promptInfluence: 0.4,
    play: "playJupiterTouchdown",
  },
  {
    id: "thunder",
    label: "Thunder on Jupiter",
    sounds:
      "A storm in the cloud tops cracking. Proximity-based and delayed: the flash comes first and the sound crosses the sky at 200 units a second, so a distant strike rumbles a beat later and quieter. Three takes rotate, because thunder repeats often enough that a pair starts to sound like a loop. Falls back to a bright highpassed crack over a low roll that stumbles on its way down.",
    usedIn: ["Jupiter — lightning in the Great Red Spot and the white ovals"],
    kind: "recorded",
    slots: ["thunder-1.mp3", "thunder-2.mp3", "thunder-3.mp3"],
    prompt:
      "A single deep roll of thunder heard from a distance across a " +
      "vast open sky. A soft crack then a long low rumble fading " +
      "away. Big and rolling, not sharp or frightening. No rain, no " +
      "music, no voice.",
    durationSeconds: 3.0,
    promptInfluence: 0.4,
    play: "playThunder",
  },
  {
    id: "fuel-step",
    label: "A letter into the tank",
    sounds:
      "One collected letter arriving at the volcano. Pitched by how full the tank is, so three pickups in a row are a rising major figure that resolves on the third — the kid hears they are getting somewhere without being told. Synth only: the pitch has to track the count, and a sampled chime shifted three semitones sounds like a sampled chime shifted three semitones.",
    usedIn: ["The ocean — collecting a letter, which charges the volcano and the waterspout"],
    kind: "synth",
    slots: [],
    prompt:
      "A short bright chime, one clear bell note, warm and encouraging. " +
      "No music, no voice.",
    durationSeconds: 1.0,
    promptInfluence: 0.4,
    play: "playFuelStep",
  },
  {
    id: "fuel-ready",
    label: "The volcano is charged",
    sounds:
      "The tank just filled: the next trip into the crater goes to the sun. A furnace coming up to heat under a bright rising sparkle. Two takes rotate. Falls back to a bandpassed noise swell over a sine climbing an octave.",
    usedIn: ["The ocean — the third letter lands"],
    kind: "recorded",
    slots: ["fuel-ready-1.mp3", "fuel-ready-2.mp3"],
    prompt:
      "A deep warm rumble swelling up under a bright rising sparkle, " +
      "like a furnace coming up to heat and something magical getting " +
      "ready to launch. Triumphant and inviting for a small child. No " +
      "music, no voice.",
    durationSeconds: 2.2,
    promptInfluence: 0.4,
    play: "playFuelReady",
  },
  {
    id: "shrug",
    label: "The waterspout bops you away",
    sounds:
      "Turning up at the funnel with an empty tank. Deliberately not a failure noise — no buzzer, no descending trombone — because the kid has done nothing wrong, they just have not collected anything yet. A rubbery boing that lands somewhere cheerful. Two takes rotate. Falls back to a sine dipping and springing straight back up under a fast wobble.",
    usedIn: ["The ocean — driving into the waterspout with no letters banked"],
    kind: "recorded",
    slots: ["shrug-1.mp3", "shrug-2.mp3"],
    prompt:
      "A soft comical rubbery boing, like a cartoon character bouncing " +
      "gently off something springy. Playful and friendly, not a buzzer " +
      "or a failure sound. No music, no voice.",
    durationSeconds: 1.0,
    promptInfluence: 0.4,
    play: "playShrug",
  },
  {
    id: "forge-hum",
    label: "The volcano, filling",
    sounds:
      "A low bed under everything that deepens as letters go into the tank — the pitch drops and the noise beneath it opens up, so it reads as more weight rather than more volume. It is how a kid who is not looking at the volcano still knows something is building. Silent while off-world.",
    usedIn: ["The ocean — always, scaled by how charged the volcano is"],
    kind: "synth",
    slots: [],
    prompt:
      "A very low continuous rumbling hum, like a distant furnace under " +
      "a mountain. Steady and calm. No music, no voice.",
    durationSeconds: 4.0,
    promptInfluence: 0.4,
    play: "setForgeHum",
  },
  {
    id: "tornado-ambience",
    label: "Waterspout, from a distance",
    sounds:
      "A looping bed of wind that fades up as the boat gets near the funnel and away again as it leaves. Low-passed hard and capped low, so it is weather behind everything else rather than on top of it. Falls back to a brown-noise loop through a wandering resonant band, crossfaded end to end so the loop point vanishes.",
    usedIn: ["The ocean — proximity to the waterspout"],
    kind: "recorded",
    slots: ["tornado-ambience-1.mp3"],
    prompt:
      "Steady distant roar of a tornado. Deep continuous rushing wind, " +
      "even and unbroken with no gusts or peaks, no thunder, no " +
      "debris, no music, no voice. Recorded from far away.",
    durationSeconds: 6,
    promptInfluence: 0.35,
    play: "setTornadoAmbience",
  },
  {
    id: "whirlpool-suck",
    label: "Whirlpool",
    sounds:
      "The whirlpool taking hold of the boat and pulling it under — a swelling rush of water closing over, with a tone sliding away underneath it. Two takes rotate. Falls back to a noise bed through a closing lowpass over a falling triangle.",
    usedIn: ["The ocean — driving into the whirlpool, and the dive to the sea floor"],
    kind: "recorded",
    slots: ["whirlpool-suck-1.mp3", "whirlpool-suck-2.mp3"],
    prompt:
      "A huge whirlpool pulling something under. Rushing swirling " +
      "water gathering and closing over, then dropping away into the " +
      "deep. Exciting and adventurous for a small child, not " +
      "frightening, no screaming, no music, no voice.",
    durationSeconds: 3.0,
    promptInfluence: 0.4,
    play: "playWhirlpool",
  },
  {
    id: "underwater-ambience",
    label: "Under the sea",
    sounds:
      "A looping bed that plays the whole time the avatar is on the sea floor. Low-passed hard and capped low. Falls back to a very smooth brown-noise loop, crossfaded end to end so the loop point vanishes.",
    usedIn: ["The sea floor"],
    kind: "recorded",
    slots: ["underwater-ambience-1.mp3"],
    prompt:
      "Calm underwater ambience, heard from deep below the surface. " +
      "Muffled low water hum, soft and continuous and even, with a " +
      "few distant bubbles. No music, no voice, no whale song.",
    durationSeconds: 8,
    promptInfluence: 0.35,
    play: "setUnderwaterAmbience",
  },
];

export function getCue(id: string): SfxCue | undefined {
  return SFX_CATALOG.find((c) => c.id === id);
}
