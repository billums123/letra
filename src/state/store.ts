import { create } from "zustand";

export type Screen = "menu" | "spell-word" | "find-alphabet" | "sound-match" | "letter-test" | "letter-editor";

// The character the kid drives around. The "kid" is the default chubby
// orange capsule character; "car" is a cartoony low-poly buggy. Both
// share the same omnidirectional movement model so controls feel
// identical regardless of choice.
export type AvatarKind = "kid" | "car";

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
};

const STORAGE_KEY = "letra:collected";
const AVATAR_KEY = "letra:avatar";

function loadAvatar(): AvatarKind {
  try {
    const raw = localStorage.getItem(AVATAR_KEY);
    if (raw === "kid" || raw === "car") return raw;
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
}));
