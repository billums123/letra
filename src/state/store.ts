import { create } from "zustand";

export type Screen = "menu" | "spell-word" | "find-alphabet" | "sound-match" | "letter-test" | "letter-editor";

// The character the kid drives around. "kid" is the default chubby
// orange capsule character; "car" is a cartoony low-poly buggy;
// "rocket" hovers a couple of units off the ground and tilts in the
// direction it's flying. All three share the same omnidirectional
// movement model so controls feel identical regardless of choice.
export type AvatarKind = "kid" | "car" | "rocket";

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
};

const STORAGE_KEY = "letra:collected";
const AVATAR_KEY = "letra:avatar";
const VOICE_KEY = "letra:voiceSlug";

function loadAvatar(): AvatarKind {
  try {
    const raw = localStorage.getItem(AVATAR_KEY);
    if (raw === "kid" || raw === "car" || raw === "rocket") return raw;
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
  try {
    const raw = localStorage.getItem(VOICE_KEY);
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

function saveVoiceSlug(slug: string | null) {
  try {
    if (slug) localStorage.setItem(VOICE_KEY, slug);
    else localStorage.removeItem(VOICE_KEY);
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
}));
