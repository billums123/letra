import { create } from "zustand";

export type Screen = "menu" | "spell-word" | "find-alphabet" | "sound-match" | "letter-test";

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
};

const STORAGE_KEY = "letra:collected";

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
}));
