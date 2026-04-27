// Four short looping songs. One is the menu theme; the other three are
// rotated as in-game music (one is picked at random per session). All
// stay in C/F/G major using only basic triads and pentatonic melodies
// so any pair of overlapping notes still sounds friendly to a 3-year-old.

import type { Note, Song, Voice } from "./music";

// Helper: build a sequence of equal-duration notes from a beat offset.
// Lets a melody be written as ["C5", "E5", "G5"] instead of three
// repetitive Note objects.
function seq(startBeat: number, perBeat: number, voice: Voice, notes: (string | null)[], gain = 1): Note[] {
  const out: Note[] = [];
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    if (n == null) continue;
    out.push({ beat: startBeat + i * perBeat, dur: perBeat * 0.95, note: n, voice, gain });
  }
  return out;
}

// Helper: drop a percussion hit on every supplied beat.
function drum(voice: Voice, beats: number[], gain = 1): Note[] {
  return beats.map((b) => ({ beat: b, dur: 0.05, voice, gain }));
}

// ─── Menu theme ──────────────────────────────────────────────────────────
// Friendly major-key welcome. Melody stays in the upper register so it
// reads as "happy / inviting" without the bass overwhelming kids' small
// laptop / phone speakers. 16-beat loop = 9.6s at 100 BPM.
const MENU_THEME: Song = {
  id: "menu-theme",
  name: "Letra Theme",
  bpm: 100,
  loopBeats: 16,
  notes: [
    // Melody (triangle for a soft, flute-like timbre)
    ...seq(0, 1, "triangle", ["E5", "G5", "E5", "D5"], 0.85),
    ...seq(4, 1, "triangle", ["F5", "A5", "G5", "F5"], 0.85),
    ...seq(8, 1, "triangle", ["D5", "G5", "F5", "D5"], 0.85),
    ...seq(12, 1, "triangle", ["E5", "G5", "C5", null], 0.85),
    // A held final chord tone so the loop boundary doesn't feel abrupt.
    { beat: 14, dur: 2, note: "C5", voice: "triangle", gain: 0.7 },
    // Bass — root notes (C, F, G, C) on whole-bar values.
    { beat: 0, dur: 3.8, note: "C3", voice: "sine", gain: 0.55 },
    { beat: 4, dur: 3.8, note: "F3", voice: "sine", gain: 0.55 },
    { beat: 8, dur: 3.8, note: "G3", voice: "sine", gain: 0.55 },
    { beat: 12, dur: 3.8, note: "C3", voice: "sine", gain: 0.55 },
    // Soft hi-hat on the off-beats — keeps it feeling alive.
    ...drum("hat", [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5], 0.5),
    // Kick on 1 and 3 of each bar.
    ...drum("kick", [0, 2, 4, 6, 8, 10, 12, 14], 0.7),
  ],
};

// ─── Sunny Walk ─────────────────────────────────────────────────────────
// Steady walking tempo. Melody is C major pentatonic, so even the
// "wrong" notes can't sound wrong. 16-beat loop @ 118 BPM = 8.1s.
const SUNNY_WALK: Song = {
  id: "sunny-walk",
  name: "Sunny Walk",
  bpm: 118,
  loopBeats: 16,
  notes: [
    // Melody (square gives a chiptune-y "game music" feel kids latch on to)
    ...seq(0, 0.5, "square", ["C5", "E5", "G5", "E5", "G5", "E5", "D5", "C5"], 0.55),
    ...seq(4, 0.5, "square", ["D5", "G5", "A5", "G5", "E5", "D5", "C5", null], 0.55),
    ...seq(8, 0.5, "square", ["E5", "G5", "C6", "G5", "E5", "G5", "D5", "C5"], 0.55),
    ...seq(12, 0.5, "square", ["G4", "C5", "E5", "G5", "E5", "C5", "G4", null], 0.55),
    // Bass walking quarter notes
    ...seq(0, 1, "sine", ["C3", "E3", "G3", "E3"], 0.6),
    ...seq(4, 1, "sine", ["F3", "A3", "G3", "E3"], 0.6),
    ...seq(8, 1, "sine", ["C3", "E3", "G3", "C4"], 0.6),
    ...seq(12, 1, "sine", ["G3", "F3", "E3", "C3"], 0.6),
    // Drums — kick on 1 & 3, snare on 2 & 4 (classic backbeat).
    ...drum("kick", [0, 2, 4, 6, 8, 10, 12, 14], 0.8),
    ...drum("snare", [1, 3, 5, 7, 9, 11, 13, 15], 0.6),
    ...drum("hat", [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5], 0.45),
  ],
};

// ─── Letter Hop ─────────────────────────────────────────────────────────
// Bouncy, slightly syncopated. Melody hops between octaves to feel
// "jumpy". 16 beats @ 130 BPM = ~7.4s.
const LETTER_HOP: Song = {
  id: "letter-hop",
  name: "Letter Hop",
  bpm: 130,
  loopBeats: 16,
  notes: [
    // Melody — leaping pattern with rests, triangle for a softer hop
    ...seq(0, 0.5, "triangle", ["F5", null, "C5", "F5", null, "A5", "F5", null], 0.7),
    ...seq(4, 0.5, "triangle", ["G5", null, "C5", "G5", null, "B5", "G5", null], 0.7),
    ...seq(8, 0.5, "triangle", ["A5", null, "F5", "A5", null, "C6", "A5", null], 0.7),
    ...seq(12, 0.5, "triangle", ["G5", "F5", "E5", "F5", "G5", "A5", "G5", "F5"], 0.7),
    // Bouncy bass — root and 5th
    { beat: 0, dur: 0.4, note: "F2", voice: "sine", gain: 0.7 },
    { beat: 1, dur: 0.4, note: "C3", voice: "sine", gain: 0.6 },
    { beat: 2, dur: 0.4, note: "F2", voice: "sine", gain: 0.7 },
    { beat: 3, dur: 0.4, note: "C3", voice: "sine", gain: 0.6 },
    { beat: 4, dur: 0.4, note: "C3", voice: "sine", gain: 0.7 },
    { beat: 5, dur: 0.4, note: "G3", voice: "sine", gain: 0.6 },
    { beat: 6, dur: 0.4, note: "C3", voice: "sine", gain: 0.7 },
    { beat: 7, dur: 0.4, note: "G3", voice: "sine", gain: 0.6 },
    { beat: 8, dur: 0.4, note: "F2", voice: "sine", gain: 0.7 },
    { beat: 9, dur: 0.4, note: "C3", voice: "sine", gain: 0.6 },
    { beat: 10, dur: 0.4, note: "F2", voice: "sine", gain: 0.7 },
    { beat: 11, dur: 0.4, note: "C3", voice: "sine", gain: 0.6 },
    { beat: 12, dur: 0.4, note: "C3", voice: "sine", gain: 0.7 },
    { beat: 13, dur: 0.4, note: "G3", voice: "sine", gain: 0.6 },
    { beat: 14, dur: 0.4, note: "F3", voice: "sine", gain: 0.6 },
    { beat: 15, dur: 0.4, note: "C3", voice: "sine", gain: 0.6 },
    // Drums
    ...drum("kick", [0, 2, 4, 6, 8, 10, 12, 14], 0.85),
    ...drum("snare", [1, 3, 5, 7, 9, 11, 13, 15], 0.55),
    ...drum("hat", [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5], 0.4),
  ],
};

// ─── Adventure ──────────────────────────────────────────────────────────
// Heroic, sweeping melody — a touch slower so the rising line has room
// to breathe. G major. 16 beats @ 108 BPM = 8.9s.
const ADVENTURE: Song = {
  id: "adventure",
  name: "Adventure",
  bpm: 108,
  loopBeats: 16,
  notes: [
    // Melody (triangle for warmth)
    ...seq(0, 1, "triangle", ["G4", "B4", "D5", "G5"], 0.8),
    ...seq(4, 1, "triangle", ["A5", "G5", "F#5", "D5"], 0.8),
    ...seq(8, 1, "triangle", ["E5", "G5", "B5", "D6"], 0.8),
    ...seq(12, 1, "triangle", ["B5", "A5", "G5", null], 0.8),
    // Long held final note for triumphant feel.
    { beat: 14, dur: 2, note: "G5", voice: "triangle", gain: 0.75 },
    // Bass — root notes of the chord progression I-vi-IV-V (G-Em-C-D)
    { beat: 0, dur: 3.8, note: "G2", voice: "sine", gain: 0.6 },
    { beat: 4, dur: 3.8, note: "E2", voice: "sine", gain: 0.6 },
    { beat: 8, dur: 3.8, note: "C3", voice: "sine", gain: 0.6 },
    { beat: 12, dur: 3.8, note: "D3", voice: "sine", gain: 0.6 },
    // A held chord pad so the music doesn't feel sparse between melody notes.
    { beat: 0, dur: 3.8, note: "D4", voice: "sine", gain: 0.18 },
    { beat: 4, dur: 3.8, note: "G4", voice: "sine", gain: 0.18 },
    { beat: 8, dur: 3.8, note: "E4", voice: "sine", gain: 0.18 },
    { beat: 12, dur: 3.8, note: "F#4", voice: "sine", gain: 0.18 },
    // Drums — half-time feel for the stately tempo
    ...drum("kick", [0, 2, 4, 6, 8, 10, 12, 14], 0.7),
    ...drum("snare", [2, 6, 10, 14], 0.55),
    ...drum("hat", [1, 3, 5, 7, 9, 11, 13, 15], 0.4),
  ],
};

export const MENU_SONG: Song = MENU_THEME;
export const GAME_SONGS: Song[] = [SUNNY_WALK, LETTER_HOP, ADVENTURE];

// Pick one game song per session. Stored in sessionStorage so navigating
// between menu and games doesn't keep re-rolling — the kid hears the
// same in-game track until they reload the page.
const SESSION_KEY = "letra:gameSong";

export function pickGameSong(): Song {
  try {
    const cached = sessionStorage.getItem(SESSION_KEY);
    if (cached) {
      const found = GAME_SONGS.find((s) => s.id === cached);
      if (found) return found;
    }
  } catch {
    // sessionStorage may be unavailable — fall through to a fresh pick.
  }
  const choice = GAME_SONGS[Math.floor(Math.random() * GAME_SONGS.length)];
  try {
    sessionStorage.setItem(SESSION_KEY, choice.id);
  } catch {
    // Non-fatal.
  }
  return choice;
}
