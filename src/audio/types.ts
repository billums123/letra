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
  hints: string[];
  // Gentle "not that letter" nudges for Find the Alphabet. Pool is
  // shuffled each contact so kids hear variety. Keeps the tone
  // upbeat — nothing reads as scolding.
  wrongNudge: string[];
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
// Every letter NAME gets an explicit IPA override. Letting any of them
// fall through to the multilingual model meant Marissa (and to a lesser
// extent Rachel) would slip into a non-English pronunciation for the
// first beat before snapping back to English — particularly noticeable
// on the consonants whose bare glyph also exists as a Spanish / Italian
// word (E, F, L, M, N, R, S). Pinning IPA here forces the phoneme-aware
// flash_v2 model and locks in the standard American letter name.
//
// IMPORTANT: this map is the LETTER NAME (what you say when reciting
// the alphabet — "ay, bee, see, dee…"), NOT the phonics SOUND
// (the noise the letter makes — /æ/, /b/, /k/, /d/…). Those live in
// LETTER_SOUND_PHONEME below.
export const LETTER_NAME_PHONEME: Record<string, string> = {
  A: "eɪ",       // "ay"
  B: "biː",      // "bee"
  C: "siː",      // "see"
  D: "diː",      // "dee"
  E: "iː",       // "ee"
  F: "ɛf",       // "ef"
  G: "dʒiː",     // "jee"
  H: "eɪtʃ",     // "aitch"
  I: "aɪ",       // "eye"
  J: "dʒeɪ",     // "jay"
  K: "keɪ",      // "kay"
  L: "ɛl",       // "el"
  M: "ɛm",       // "em"
  N: "ɛn",       // "en"
  O: "oʊ",       // "oh"
  P: "piː",      // "pee"
  Q: "kjuː",     // "kyoo"
  R: "ɑɹ",       // "ar" (American)
  S: "ɛs",       // "ess"
  T: "tiː",      // "tee"
  U: "juː",      // "you"
  V: "viː",      // "vee"
  W: "ˈdʌbəljuː", // "double-you"
  X: "ɛks",      // "ex"
  Y: "waɪ",      // "why"
  Z: "ziː",      // "zee" (American)
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
  F: "fː",     // sustained /f/
  G: "ɡə",     // hard G, "guh"
  H: "hə",     // "huh"
  I: "ɪ",      // igloo
  J: "dʒə",    // "juh"
  K: "kə",     // "kuh"
  L: "lː",     // sustained /l/
  M: "mː",     // sustained /m/
  N: "nː",     // sustained /n/
  O: "ɑ",      // octopus (American short O)
  P: "pə",     // "puh"
  Q: "kwə",    // "kwuh"
  R: "ɹː",     // sustained English /r/
  S: "sː",     // sustained /s/
  T: "tə",     // "tuh"
  U: "ʌ",      // umbrella
  V: "vː",     // sustained /v/
  W: "wə",     // "wuh"
  X: "ks",     // fox
  Y: "jə",     // "yuh"
  Z: "zː",     // sustained /z/
};

const PHONEME_MODEL = "eleven_flash_v2";

function ssmlPhoneme(visible: string, ipa: string): string {
  return `<phoneme alphabet="ipa" ph="${ipa}">${visible}</phoneme>`;
}

export function letterNameText(letter: string): string {
  return LETTER_NAME_TEXT[letter] ?? letter;
}

// Spelling-game words. Each has a friendly intro line and the letters needed.
// Mostly 3-letter CVC words pre-K kids see early in phonics; the runtime
// supports 2–10 letters (validated in the word builder), so simple sight
// words like TREE are fine too.
//
// Intro shape: brief scenario flavour → "Let's find the <word>" → the
// letters (for nouns), or "Let's spell <word>" → letters (for adjectives,
// verbs, or anything where "the <word>" sounds wrong). The directive
// ALWAYS names the word right before the letters so a 3-year-old hears
// "cat / C, A, T" back-to-back and binds the spelling to the word
// without a synonym or pronoun in between.
export const SPELL_WORDS: { word: string; intro: string; reveal: string }[] = [
  { word: "CAT", intro: "Oh no! The cat ran off! Let's find the cat. C, A, T!", reveal: "We found the cat!" },
  { word: "DOG", intro: "Let's find the dog. D, O, G.", reveal: "There is the dog!" },
  { word: "SUN", intro: "It's so cloudy! Let's find the sun. S, U, N!", reveal: "Hooray, the sun is back!" },
  { word: "BUS", intro: "We need a ride! Let's find the bus. B, U, S!", reveal: "All aboard the bus!" },
  { word: "PIG", intro: "Let's find the pig. P, I, G!", reveal: "There is the pig!" },
  { word: "HAT", intro: "Oh no! The hat is missing! Let's find the hat. H, A, T!", reveal: "There’s the hat!" },
  { word: "BIG", intro: "Let's spell BIG! B, I, G!", reveal: "You spelled BIG!" },
  { word: "TREE", intro: "Let's spell TREE! T, R, E, E!", reveal: "You spelled TREE!" },
  { word: "BAG", intro: "Let's spell BAG! B, A, G!", reveal: "You spelled BAG!" },
  { word: "MAP", intro: "Oh no! We need a map! M, A, P!", reveal: "We found the map!" },
  { word: "BED", intro: "It's time for a nap! Let's find the bed. B, E, D!", reveal: "We found the bed!" },
  { word: "HEN", intro: "The hen is hiding! Let's find the hen. H, E, N!", reveal: "There's the hen!" },
  { word: "DIG", intro: "Let's spell DIG! D, I, G!", reveal: "You spelled DIG!" },
  { word: "ZIP", intro: "Let's spell ZIP! Z, I, P!", reveal: "You spelled ZIP!" },
  { word: "BOX", intro: "Let's spell BOX! B, O, X!", reveal: "You spelled BOX!" },
  { word: "MILK", intro: "Let's spell MILK! M, I, L, K!", reveal: "You spelled MILK!" },
  { word: "BOOK", intro: "Oh no! A book is missing! Let's find the book. B, O, O, K!", reveal: "We found the book!" },
  { word: "STAR", intro: "Did you see that shooting star? Let's spell star. S, T, A, R!", reveal: "You spelled STAR!" },
  { word: "CAKE", intro: "Let's spell CAKE! C, A, K, E!", reveal: "You spelled CAKE!" },
  { word: "BALL", intro: "Let's spell BALL! B, A, L, L!", reveal: "You spelled BALL!" },
  { word: "JUMP", intro: "Let's spell JUMP! J, U, M, P!", reveal: "You spelled JUMP!" },
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
  // Find-Alphabet has TWO walk/drive variants — game picks one based on
  // the active avatar. Adding a new avatar later means a new clip id +
  // npm run audio:generate-all to back-fill across every voice.
  entries.push({ id: "prompt-find-alphabet", text: "Let's find the whole alphabet! Walk to each letter, in order, from A all the way to Zee!" });
  entries.push({ id: "prompt-find-alphabet-drive", text: "Let's drive to find the whole alphabet! Drive to each letter, in order, from A all the way to Zee!" });
  entries.push({ id: "prompt-find-alphabet-fly", text: "Let's blast off and find the whole alphabet! Fly to each letter, in order, from A all the way to Zee!" });
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

  // Hints — picked randomly when a kid stalls, so any new line just
  // needs a unique id and an mp3 in the voice's audio folder.
  entries.push({ id: "hint-keep-looking", text: "Keep looking! You can do it!" });
  entries.push({ id: "hint-look-around", text: "Look all around the world. The letter is hiding somewhere!" });
  entries.push({ id: "hint-i-believe", text: "I believe in you!" });
  entries.push({ id: "hint-where-could-it-be", text: "Where could it be?" });
  entries.push({ id: "hint-keep-going", text: "Keep going, you're doing great!" });

  // Wrong-letter nudges. Played in Find the Alphabet right after the
  // bumped letter's name when a kid drives onto a non-target letter.
  // Tone stays positive — every line treats the wrong tap as part of
  // the adventure, never a reprimand.
  entries.push({ id: "wrong-close", text: "You're close, maybe try a different letter!" });
  entries.push({ id: "wrong-almost", text: "Almost! Try another one!" });
  entries.push({ id: "wrong-keep-looking", text: "Oops, keep looking!" });
  entries.push({ id: "wrong-different", text: "Hmm, not that one. Let's keep going!" });
  entries.push({ id: "wrong-try-again", text: "Not this letter, try a different one!" });

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

export function getHintIds(manifest?: AudioManifest): string[] {
  if (manifest && manifest.hints.length > 0) return manifest.hints;
  return ["hint-keep-looking", "hint-look-around"];
}

export function getWrongNudgeIds(manifest?: AudioManifest): string[] {
  if (manifest && manifest.wrongNudge && manifest.wrongNudge.length > 0) return manifest.wrongNudge;
  return [
    "wrong-close",
    "wrong-almost",
    "wrong-keep-looking",
    "wrong-different",
    "wrong-try-again",
  ];
}
