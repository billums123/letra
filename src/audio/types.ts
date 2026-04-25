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

export type AudioEntry = {
  id: string;
  // Text fed to ElevenLabs / read by Web Speech as a fallback.
  text: string;
  // SSML-like phonetic hint for letter sounds. Used when speaking via Web Speech.
  speakAs?: string;
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
  A: "eh",
  I: "eye",
  K: "Kay",
  O: "oh",
  U: "you",
  V: "vee",
  W: "double you",
  Y: "why",
  Z: "zee",
};

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

  // Letter names — said clearly with a friendly tone. We feed ElevenLabs the
  // override text from LETTER_NAME_TEXT for letters where the bare glyph was
  // pronounced incorrectly.
  for (const L of ALPHABET) {
    const text = letterNameText(L);
    entries.push({ id: `letter-${L}-name`, text, speakAs: text });
  }

  // Letter sounds — voiced as the phonetic blend.
  for (const L of ALPHABET) {
    entries.push({
      id: `letter-${L}-sound`,
      text: LETTER_SOUND_TEXT[L],
      speakAs: LETTER_SOUND_TEXT[L],
    });
  }

  // Spell-the-word prompts and reveal lines.
  for (const w of SPELL_WORDS) {
    entries.push({ id: `prompt-spell-${w.word}`, text: w.intro });
    entries.push({ id: `reveal-spell-${w.word}`, text: w.reveal });
  }

  // Game prompts.
  entries.push({ id: "prompt-find-alphabet", text: "Let's find the whole alphabet! Walk to each letter, in order, from A all the way to Z!" });
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
