// Shared audio manifest types — used by both the generation script and the
// runtime player. Keeping them in one place avoids the manifest going stale.

export type LetterClip = {
  name: string; // letter name, e.g. "A"
  sound: string; // phonetic sound, e.g. "ah"
};

export type AudioManifest = {
  voiceId: string;
  modelId: string;
  generatedAt: string;
  letters: Record<string, LetterClip>; // keys uppercase A-Z
  prompts: Record<string, string>;
  celebrate: string[];
  hints: Record<string, string>;
  menu: Record<string, string>;
};

// Top-level registry at /audio/voices.json. Lets the runtime enumerate
// every voice that's been generated, switch between them, and lets the
// generation script know which voices to refresh when new clip ids are
// added to buildEntries() later.
export type VoiceRegistryEntry = {
  // Slug used as the audio subdirectory name and as the persisted
  // selection id. Lowercase alphanumerics + dashes.
  slug: string;
  // Friendly name shown in the UI (e.g. "Rachel").
  name: string;
  // ElevenLabs voice id passed to the API.
  voiceId: string;
  // Model id used to generate this voice's clips.
  modelId: string;
  // Last time this voice was (re)generated. Helpful for debugging.
  generatedAt: string;
  // First voice in the registry is the runtime default; this flag is
  // only meaningful when the user has explicitly chosen a default.
  isDefault?: boolean;
};

export type VoicesRegistry = {
  voices: VoiceRegistryEntry[];
};

export type AudioEntry = {
  id: string;
  // Text fed to ElevenLabs / read by Web Speech as a fallback.
  text: string;
  // SSML-like phonetic hint for letter sounds. Used when speaking via Web Speech.
  speakAs?: string;
  // Optional ElevenLabs model override. Some clips use SSML phoneme tags,
  // which only work on phoneme-aware models (eleven_flash_v2,
  // eleven_english_v1). Most clips stick with the default multilingual_v2
  // for the warmer voice timbre.
  modelId?: string;
};

// Single source of truth for what gets generated. The script and the runtime
// both import this so a clip is never accidentally referenced without
// existing in the manifest.
export const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

// Phonetic sounds for each letter. Most are plain consonant/vowel sounds. We
// stay deliberately on the soft-vowel side (short A as in "apple", short E as
// in "egg") because that is the convention pre-K curricula start with.
export const LETTER_SOUND_TEXT: Record<string, string> = {
  A: "ah", B: "buh", C: "kuh", D: "duh", E: "eh", F: "fff",
  G: "guh", H: "huh", I: "ih", J: "juh", K: "kuh", L: "lll",
  M: "mmm", N: "nnn", O: "oh", P: "puh", Q: "kw", R: "rrr",
  S: "sss", T: "tuh", U: "uh", V: "vvv", W: "wuh", X: "ks",
  Y: "yuh", Z: "zzz",
};

// What ElevenLabs is told to *say* for each letter name. For most letters,
// passing the bare glyph ("A", "B", …) makes the TTS read it correctly. A few
// letters come out wrong (numbers vs letters, the model picking a sound
// instead of a name, etc.) so we override those with explicit phonetic text.
// Add to or change this map and re-run `npm run audio:generate -- --force`
// (or delete just the affected `letter-X-name.mp3` files and re-run without
// --force) to update.
export const LETTER_NAME_TEXT: Record<string, string> = {
  A: "ay",
  E: "eee",
  I: "eye",
  K: "Kay",
  O: "oh",
  U: "yoo",
  V: "veee",
  W: "double you",
  Y: "why",
  Z: "zee",
};

// Letters that need explicit IPA pronunciation via SSML <phoneme> tags. These
// clips use a phoneme-aware model (eleven_flash_v2) — the multilingual model
// silently ignores phoneme tags. Per ElevenLabs docs, IPA and CMU Arpabet are
// both accepted; we use IPA because it's more readable.
//
// To add a new override: pick the IPA from a phoneme chart (or just paste the
// character — æ, ɪ, oʊ, etc.), wrap with the visible glyph as the ph fallback.
export const LETTER_NAME_PHONEME: Record<string, string> = {
  A: "æ", // short-a as in "apple"
  V: "viː", // standard /viː/ — long-E vowel after the V
};

// Phonics-style letter SOUNDS. Used in the sound-match game and as the
// follow-up audio when a letter is collected. Vowels are the short
// pre-K-curriculum versions (apple, egg, igloo, octopus, umbrella). Most
// stops are taught with a tiny schwa attached because pure /b/ /k/ /d/
// can't really be vocalised on their own; continuants (F, L, M, N, R, S,
// V, Z) are bare since they can be sustained.
export const LETTER_SOUND_PHONEME: Record<string, string> = {
  A: "æ",      // apple
  B: "bə",     // "buh"
  C: "kə",     // hard C, "kuh"
  D: "də",     // "duh"
  E: "ɛ",      // egg
  F: "fːː",    // sustained /f/
  G: "ɡə",     // hard G, "guh"
  H: "hə",     // "huh"
  I: "ɪ",      // igloo
  J: "dʒə",    // "juh"
  K: "kə",     // "kuh"
  L: "lːː",    // sustained /l/
  M: "mːː",    // sustained /m/
  N: "nːː",    // sustained /n/
  O: "ɑ",      // octopus (American short O)
  P: "pə",     // "puh"
  Q: "kwə",    // "kwuh"
  R: "ɹːː",    // sustained English /r/
  S: "sːː",    // sustained /s/
  T: "tə",     // "tuh"
  U: "ʌ",      // umbrella
  V: "vːː",    // sustained /v/
  W: "wə",     // "wuh"
  X: "ks",     // fox
  Y: "jə",     // "yuh"
  Z: "zːː",    // sustained /z/
};

const PHONEME_MODEL = "eleven_flash_v2";

function ssmlPhoneme(visible: string, ipa: string): string {
  return `<phoneme alphabet="ipa" ph="${ipa}">${visible}</phoneme>`;
}

export function letterNameText(letter: string): string {
  return LETTER_NAME_TEXT[letter] ?? letter;
}

// Spelling-game words. Each has a friendly intro line and the letters needed.
// Limit to 3-letter "CVC" words that pre-K kids see early in phonics.
export const SPELL_WORDS: { word: string; intro: string; reveal: string }[] = [
  { word: "CAT", intro: "Oh no! A cat went missing! Help me find the letters that spell C, A, T to find the cat!", reveal: "We found the cat!" },
  { word: "DOG", intro: "Where did our puppy go? Find the letters D, O, G and we will find the dog!", reveal: "There is the dog!" },
  { word: "SUN", intro: "It is so cloudy! Help bring back the sun by finding S, U, N!", reveal: "Hooray, the sun is back!" },
  { word: "BUS", intro: "We need to catch the bus! Find the letters B, U, S to bring it!", reveal: "All aboard the bus!" },
  { word: "PIG", intro: "Our friend the pig is hiding. Find P, I, G to call them out!", reveal: "Oink oink, the pig is here!" },
];

export function buildEntries(): AudioEntry[] {
  const entries: AudioEntry[] = [];

  // Letter names — said clearly with a friendly tone. Three tiers:
  //   1. Letters with a phoneme override (LETTER_NAME_PHONEME) get an SSML
  //      <phoneme> tag rendered on a phoneme-aware model.
  //   2. Letters with a text override (LETTER_NAME_TEXT) get that text on the
  //      default multilingual model (warmer voice).
  //   3. Everything else gets the bare glyph on the default model.
  for (const L of ALPHABET) {
    const ipa = LETTER_NAME_PHONEME[L];
    if (ipa) {
      entries.push({
        id: `letter-${L}-name`,
        text: ssmlPhoneme(L, ipa),
        speakAs: letterNameText(L),
        modelId: PHONEME_MODEL,
      });
    } else {
      const text = letterNameText(L);
      entries.push({ id: `letter-${L}-name`, text, speakAs: text });
    }
  }

  // Letter sounds — voiced as the phonetic blend. We use SSML phoneme tags
  // on the phoneme-aware flash_v2 model for every sound. The bare-text
  // approach was unreliable: "ah" landed on /ɑ/ instead of /æ/, "oh" on
  // long-O instead of short-O, etc. Phoneme tags pin the actual
  // articulation that pre-K phonics curricula teach.
  for (const L of ALPHABET) {
    const ipa = LETTER_SOUND_PHONEME[L] ?? LETTER_SOUND_TEXT[L];
    entries.push({
      id: `letter-${L}-sound`,
      text: ssmlPhoneme(L, ipa),
      speakAs: LETTER_SOUND_TEXT[L],
      modelId: PHONEME_MODEL,
    });
  }

  // Spell-the-word prompts and reveal lines.
  for (const w of SPELL_WORDS) {
    entries.push({ id: `prompt-spell-${w.word}`, text: w.intro });
    entries.push({ id: `reveal-spell-${w.word}`, text: w.reveal });
  }

  // Game prompts.
  // Spell out "Zee" so the TTS uses the American letter name. The bare "Z"
  // glyph was getting read as "Zed" (British). The rest of the prompt sounds
  // friendly enough as plain text.
  entries.push({ id: "prompt-find-alphabet", text: "Let's find the whole alphabet! Walk to each letter, in order, from A all the way to Zee!" });
  entries.push({ id: "prompt-sound-match", text: "Listen carefully. I will say a sound, and you find the letter that makes it!" });
  entries.push({ id: "prompt-sound-match-replay", text: "Listen again." });

  // Celebrations
  for (const [i, line] of [
    "You did it!",
    "Great job!",
    "Wonderful!",
    "Amazing!",
    "You are a star!",
    "Way to go!",
  ].entries()) {
    entries.push({ id: `celebrate-${i + 1}`, text: line });
  }

  // Hints
  entries.push({ id: "hint-keep-looking", text: "Keep looking! You can do it!" });
  entries.push({ id: "hint-look-around", text: "Look all around the world. The letter is hiding somewhere!" });

  // Menu
  entries.push({ id: "menu-welcome", text: "Welcome to Letra! Pick a game to start!" });
  entries.push({ id: "menu-spell", text: "Spell the word!" });
  entries.push({ id: "menu-alphabet", text: "Find the alphabet!" });
  entries.push({ id: "menu-sounds", text: "Match the sound!" });
  entries.push({ id: "menu-back", text: "Back to the main menu!" });

  return entries;
}

export function getCelebrateIds(manifest?: AudioManifest): string[] {
  if (manifest) return manifest.celebrate;
  return ["celebrate-1", "celebrate-2", "celebrate-3", "celebrate-4", "celebrate-5", "celebrate-6"];
}
