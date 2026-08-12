import { create } from "zustand";
import {
  ALL_TROPHY_IDS,
  SPELL_REPS_PER_TROPHY,
  SPELL_TROPHY_IDS,
  WORD_WIZARD_THRESHOLD,
  type TrophyId,
} from "./trophies";

export type Screen =
  | "menu"
  | "spell-word"
  | "find-alphabet"
  | "sound-match"
  | "letter-test"
  | "letter-editor"
  | "alien-editor"
  | "q-tail-editor"
  | "trophy-lab"
  | "audio-tester"
  | "word-builder"
  | "word-asset-editor";

// One trophy-earned event waiting to be celebrated. Games push these
// onto pendingEarns; the EarnedTrophyModal renders the head of the
// queue and pops it when the kid taps "Yay!".
export type PendingEarn = {
  id: TrophyId;
  // Stack count *after* this award fires — used by the modal to render
  // the "Now ×3" banner.
  count: number;
  // True when this is the very first time the kid has seen this trophy.
  // Drives a slightly bigger entrance animation + "NEW!" sash.
  firstTime: boolean;
};

// The character the kid drives around. "kid" is the default chubby
// orange capsule character; "car" is a cartoony low-poly buggy;
// "rocket" hovers a couple of units off the ground and tilts in the
// direction it's flying. All three share the same omnidirectional
// movement model so controls feel identical regardless of choice.
export type AvatarKind = "kid" | "car" | "rocket" | "boat";

// Letter case the kid picks before entering Spell the Word or Find the
// Alphabet. "mixed" is interpreted per-game: for Find the Alphabet each
// letter rolls its case independently, for Spell the Word each whole
// word rolls a single case (so a word is never half-cased).
export type LetterCase = "uppercase" | "lowercase" | "mixed";

type GameState = {
  screen: Screen;
  setScreen: (screen: Screen) => void;
  goToMenu: () => void;

  // Reward shelf — letters the kid has "mastered" (collected at least once across all modes).
  collected: Set<string>;
  collect: (letter: string) => void;
  resetCollected: () => void;

  // Audio mode is decided once at boot: "elevenlabs" if a manifest is present, else "speech".
  audioMode: "elevenlabs" | "speech" | "muted";
  setAudioMode: (mode: "elevenlabs" | "speech" | "muted") => void;

  // Currently-selected avatar. Persisted to localStorage so the kid
  // sees their choice the next time they boot the game.
  avatar: AvatarKind;
  setAvatar: (avatar: AvatarKind) => void;

  // Slug of the active ElevenLabs voice (matches a slug in
  // /audio/voices.json). null means "use the registry default".
  voiceSlug: string | null;
  setVoiceSlug: (slug: string | null) => void;

  // Active biome id. The biome registry lives in src/engine/biomes;
  // see getBiome() there for the resolution + fallback.
  biomeId: string;
  setBiomeId: (id: string) => void;

  // Letter-case selection chosen on the case picker before a game.
  letterCase: LetterCase;
  setLetterCase: (c: LetterCase) => void;

  // Master audio mix, set by the parent-gated settings panel. Volume
  // is 0..1; mute hard-silences voice + music + sfx; musicEnabled
  // toggles only the background score (voice + sfx still play).
  audioVolume: number;
  setAudioVolume: (v: number) => void;
  musicEnabled: boolean;
  setMusicEnabled: (e: boolean) => void;
  audioMuted: boolean;
  setAudioMuted: (m: boolean) => void;

  // Trophy state. trophies[id] is the count of times the kid has earned
  // that trophy (0 = unearned). Stack trophies grow indefinitely;
  // milestone trophies cap at 1.
  trophies: Record<TrophyId, number>;
  // Queue of unviewed earn events. Modal at app root drains this.
  pendingEarns: PendingEarn[];
  // Running total of correct sound-match matches across all sessions.
  // Used to award the Listening Star trophy every 10 matches without
  // popping a modal every single round.
  soundMatchCount: number;
  // Per-word completion counters. Keys are uppercase words ("CAT",
  // "DOG", ...). Used to award the per-word spell trophies on every
  // SPELL_REPS_PER_TROPHY-th completion of the same word, and to
  // drive the Word Wizard milestone (sum across all words >=
  // WORD_WIZARD_THRESHOLD).
  spellWordCounts: Record<string, number>;
  // Award a trophy directly. Increments the count and queues an earn
  // event. For SPELLING trophies the production flow goes through
  // recordSpellCompletion instead — this is the lower-level primitive
  // for testing and for non-spell trophies.
  awardTrophy: (id: TrophyId) => void;
  // Record one correct sound match. Increments soundMatchCount and
  // awards the Listening Star trophy each time the running total
  // crosses a multiple of SOUND_MATCH_PER_TROPHY.
  recordSoundMatch: () => void;
  // Record a successful Spell-the-Word completion. Increments the
  // per-word counter and awards the matching spell-<word> trophy on
  // every SPELL_REPS_PER_TROPHY-th completion of the same word, and
  // cascades Word Wizard once total completions cross
  // WORD_WIZARD_THRESHOLD.
  recordSpellCompletion: (word: string) => void;
  // Pop the head of pendingEarns (called by the modal on dismiss).
  dismissEarn: () => void;
  // Wipe trophy state. Used by the trophy lab + a future "reset" button.
  resetTrophies: () => void;
};

// One Listening Star is awarded for every N successful sound-match
// rounds. Tuned for "feels rewarding without popping every round."
export const SOUND_MATCH_PER_TROPHY = 10;

const STORAGE_KEY = "letra:collected";
const AVATAR_KEY = "letra:avatar";
const VOICE_KEY = "letra:voiceSlug";
const BIOME_KEY = "letra:biomeId";
const LETTER_CASE_KEY = "letra:letterCase";
const TROPHIES_KEY = "letra:trophies";
const SOUND_MATCH_COUNT_KEY = "letra:soundMatchCount";
const SPELL_WORD_COUNTS_KEY = "letra:spellWordCounts";
const AUDIO_VOLUME_KEY = "letra:audioVolume";
const MUSIC_ENABLED_KEY = "letra:musicEnabled";
const AUDIO_MUTED_KEY = "letra:audioMuted";

function loadAudioVolume(): number {
  try {
    const raw = localStorage.getItem(AUDIO_VOLUME_KEY);
    if (raw === null) return 1;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
  } catch {
    // ignore
  }
  return 1;
}

function saveAudioVolume(v: number) {
  try {
    localStorage.setItem(AUDIO_VOLUME_KEY, String(v));
  } catch {
    // Non-fatal.
  }
}

function loadMusicEnabled(): boolean {
  try {
    const raw = localStorage.getItem(MUSIC_ENABLED_KEY);
    if (raw === "0") return false;
    if (raw === "1") return true;
  } catch {
    // ignore
  }
  return true;
}

function saveMusicEnabled(e: boolean) {
  try {
    localStorage.setItem(MUSIC_ENABLED_KEY, e ? "1" : "0");
  } catch {
    // Non-fatal.
  }
}

function loadAudioMuted(): boolean {
  try {
    const raw = localStorage.getItem(AUDIO_MUTED_KEY);
    if (raw === "1") return true;
  } catch {
    // ignore
  }
  return false;
}

function saveAudioMuted(m: boolean) {
  try {
    localStorage.setItem(AUDIO_MUTED_KEY, m ? "1" : "0");
  } catch {
    // Non-fatal.
  }
}

function loadAvatar(): AvatarKind {
  try {
    const raw = localStorage.getItem(AVATAR_KEY);
    if (raw === "kid" || raw === "car" || raw === "rocket" || raw === "boat") return raw;
  } catch {
    // localStorage may be disabled — default to the kid.
  }
  return "kid";
}

function saveAvatar(avatar: AvatarKind) {
  try {
    localStorage.setItem(AVATAR_KEY, avatar);
  } catch {
    // Non-fatal.
  }
}

function loadVoiceSlug(): string | null {
  // The voice picker is currently disabled in the UI and we ship a
  // single canonical voice (Marissa, marked isDefault in voices.json).
  // Returning null here forces every user — even those who previously
  // selected a different voice — onto the registry default. When the
  // picker is re-enabled, restore the original localStorage read.
  try {
    localStorage.removeItem(VOICE_KEY);
  } catch {
    /* non-fatal */
  }
  return null;
}

function saveVoiceSlug(slug: string | null) {
  try {
    if (slug) localStorage.setItem(VOICE_KEY, slug);
    else localStorage.removeItem(VOICE_KEY);
  } catch {
    // Non-fatal.
  }
}

function loadLetterCase(): LetterCase {
  try {
    const raw = localStorage.getItem(LETTER_CASE_KEY);
    if (raw === "uppercase" || raw === "lowercase" || raw === "mixed")
      return raw;
  } catch {
    // ignore
  }
  return "uppercase";
}

function saveLetterCase(c: LetterCase) {
  try {
    localStorage.setItem(LETTER_CASE_KEY, c);
  } catch {
    // Non-fatal.
  }
}

function loadBiomeId(): string {
  try {
    const raw = localStorage.getItem(BIOME_KEY);
    if (raw && raw.length > 0) return raw;
  } catch {
    // ignore
  }
  return "meadow";
}

function saveBiomeId(id: string) {
  try {
    localStorage.setItem(BIOME_KEY, id);
  } catch {
    // Non-fatal.
  }
}

function emptyTrophies(): Record<TrophyId, number> {
  const out = {} as Record<TrophyId, number>;
  for (const id of ALL_TROPHY_IDS) out[id] = 0;
  return out;
}

function loadTrophies(): Record<TrophyId, number> {
  try {
    const raw = localStorage.getItem(TROPHIES_KEY);
    if (!raw) return emptyTrophies();
    const parsed = JSON.parse(raw) as Partial<Record<TrophyId, number>>;
    const out = emptyTrophies();
    for (const id of ALL_TROPHY_IDS) {
      const v = parsed?.[id];
      if (typeof v === "number" && v >= 0) out[id] = v | 0;
    }
    return out;
  } catch {
    return emptyTrophies();
  }
}

function saveTrophies(trophies: Record<TrophyId, number>) {
  try {
    localStorage.setItem(TROPHIES_KEY, JSON.stringify(trophies));
  } catch {
    // Non-fatal.
  }
}

function loadSoundMatchCount(): number {
  try {
    const raw = localStorage.getItem(SOUND_MATCH_COUNT_KEY);
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n | 0 : 0;
  } catch {
    return 0;
  }
}

function saveSoundMatchCount(n: number) {
  try {
    localStorage.setItem(SOUND_MATCH_COUNT_KEY, String(n));
  } catch {
    // Non-fatal.
  }
}

function loadSpellWordCounts(): Record<string, number> {
  try {
    const raw = localStorage.getItem(SPELL_WORD_COUNTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "number" && v >= 0) out[k.toUpperCase()] = v | 0;
    }
    return out;
  } catch {
    return {};
  }
}

function saveSpellWordCounts(counts: Record<string, number>) {
  try {
    localStorage.setItem(SPELL_WORD_COUNTS_KEY, JSON.stringify(counts));
  } catch {
    // Non-fatal.
  }
}

function loadCollected(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveCollected(collected: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...collected]));
  } catch {
    // localStorage may be disabled (private mode) — non-fatal.
  }
}

export const useGameStore = create<GameState>((set, get) => ({
  screen: "menu",
  setScreen: (screen) => set({ screen }),
  goToMenu: () => set({ screen: "menu" }),

  collected: loadCollected(),
  collect: (letter) => {
    const next = new Set(get().collected);
    next.add(letter.toUpperCase());
    saveCollected(next);
    set({ collected: next });
  },
  resetCollected: () => {
    saveCollected(new Set());
    set({ collected: new Set() });
  },

  audioMode: "speech",
  setAudioMode: (audioMode) => set({ audioMode }),

  avatar: loadAvatar(),
  setAvatar: (avatar) => {
    saveAvatar(avatar);
    set({ avatar });
  },

  voiceSlug: loadVoiceSlug(),
  setVoiceSlug: (slug) => {
    saveVoiceSlug(slug);
    set({ voiceSlug: slug });
  },

  biomeId: loadBiomeId(),
  setBiomeId: (id) => {
    saveBiomeId(id);
    set({ biomeId: id });
  },

  letterCase: loadLetterCase(),
  setLetterCase: (c) => {
    saveLetterCase(c);
    set({ letterCase: c });
  },

  audioVolume: loadAudioVolume(),
  setAudioVolume: (v) => {
    const clamped = Math.max(0, Math.min(1, v));
    saveAudioVolume(clamped);
    set({ audioVolume: clamped });
  },
  musicEnabled: loadMusicEnabled(),
  setMusicEnabled: (e) => {
    saveMusicEnabled(e);
    set({ musicEnabled: e });
  },
  audioMuted: loadAudioMuted(),
  setAudioMuted: (m) => {
    saveAudioMuted(m);
    set({ audioMuted: m });
  },

  trophies: loadTrophies(),
  pendingEarns: [],
  soundMatchCount: loadSoundMatchCount(),
  spellWordCounts: loadSpellWordCounts(),
  recordSoundMatch: () => {
    const next = get().soundMatchCount + 1;
    saveSoundMatchCount(next);
    set({ soundMatchCount: next });
    if (next % SOUND_MATCH_PER_TROPHY === 0) {
      get().awardTrophy("sound-match");
    }
  },
  recordSpellCompletion: (word) => {
    const upper = word.toUpperCase();
    const state = get();
    const current = state.spellWordCounts[upper] ?? 0;
    const nextCount = current + 1;
    const nextCounts = { ...state.spellWordCounts, [upper]: nextCount };
    saveSpellWordCounts(nextCounts);
    set({ spellWordCounts: nextCounts });

    // Per-word trophy fires every Nth completion of the SAME word.
    if (nextCount % SPELL_REPS_PER_TROPHY === 0) {
      const trophyId = `spell-${upper.toLowerCase()}` as TrophyId;
      if (SPELL_TROPHY_IDS.includes(trophyId)) {
        get().awardTrophy(trophyId);
      }
    }

    // Word Wizard milestone: fires when the kid has completed any
    // 25 words altogether (regardless of which words). Only fires
    // once — awardTrophy bails on the second call for the milestone.
    const total = Object.values(nextCounts).reduce((s, n) => s + n, 0);
    if (
      total >= WORD_WIZARD_THRESHOLD &&
      (get().trophies["word-wizard"] ?? 0) === 0
    ) {
      get().awardTrophy("word-wizard");
    }
  },
  awardTrophy: (id) => {
    const state = get();
    const current = state.trophies[id] ?? 0;
    // Milestone trophies are one-shot; award() is a no-op once earned.
    const isMilestone = id === "word-wizard";
    if (isMilestone && current >= 1) return;

    const next = { ...state.trophies, [id]: current + 1 };
    const earn: PendingEarn = {
      id,
      count: next[id],
      firstTime: current === 0,
    };
    const pending = [...state.pendingEarns, earn];

    saveTrophies(next);
    set({ trophies: next, pendingEarns: pending });
  },
  dismissEarn: () => {
    const pending = get().pendingEarns;
    if (pending.length === 0) return;
    set({ pendingEarns: pending.slice(1) });
  },
  resetTrophies: () => {
    const cleared = emptyTrophies();
    saveTrophies(cleared);
    saveSoundMatchCount(0);
    saveSpellWordCounts({});
    set({
      trophies: cleared,
      pendingEarns: [],
      soundMatchCount: 0,
      spellWordCounts: {},
    });
  },
}));
