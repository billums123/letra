// Procedural background music — simple WebAudio synth that loops a
// declarative song forever (or until stop()). Kept intentionally
// lightweight: no buffer loading, no audio assets. Songs are described
// in `songs.ts` as a list of beat-aligned notes that the scheduler
// rolls out a few hundred milliseconds ahead of the audio clock so
// timing stays rock-steady even if the JS thread stutters.

import { getMusicCtx } from "./audioCtx";

export type Voice = "sine" | "triangle" | "square" | "kick" | "snare" | "hat";

export type Note = {
  // Beat offset from the start of the loop. Half-beats are fine.
  beat: number;
  // Duration in beats (also fractional).
  dur: number;
  // Scientific pitch notation, e.g. "C4". Ignored for percussion voices.
  note?: string;
  voice: Voice;
  // Per-note gain multiplier (0..1). Defaults to 1.
  gain?: number;
};

export type Song = {
  id: string;
  name: string;
  bpm: number;
  // How many beats one loop iteration is. The next iteration is
  // scheduled exactly this many beats after the previous one.
  loopBeats: number;
  notes: Note[];
};

// Map note name to frequency. Equal-tempered, A4 = 440 Hz. Accepts
// "C4", "C#4", "Db4", "C5" etc.
const NOTE_OFFSETS: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4,
  F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};

function noteToFreq(name: string): number {
  const m = /^([A-G][#b]?)(-?\d+)$/.exec(name.trim());
  if (!m) return 440;
  const semis = NOTE_OFFSETS[m[1]] ?? 0;
  const oct = parseInt(m[2], 10);
  // MIDI: A4 = 69, A4 = 440 Hz. note number = 12*(oct+1) + semis (C4=60).
  const midi = 12 * (oct + 1) + semis;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ─── Percussion voices ────────────────────────────────────────────────────
// Tiny synthesised drums. Source-attached straight to the music master
// gain so the song-level volume slider works the same way as for
// melodic voices.
function playKick(c: AudioContext, dest: AudioNode, t: number, gain = 1) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(140, t);
  osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.4 * gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
  osc.connect(g).connect(dest);
  osc.start(t);
  osc.stop(t + 0.22);
}

function noiseBuffer(c: AudioContext, dur: number): AudioBuffer {
  const sr = c.sampleRate;
  const buf = c.createBuffer(1, Math.ceil(sr * dur), sr);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function playSnare(c: AudioContext, dest: AudioNode, t: number, gain = 1) {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, 0.18);
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 1500;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.18 * gain, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  src.connect(hp).connect(g).connect(dest);
  src.start(t);
  src.stop(t + 0.2);
}

function playHat(c: AudioContext, dest: AudioNode, t: number, gain = 1) {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, 0.06);
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 6000;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.06 * gain, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
  src.connect(hp).connect(g).connect(dest);
  src.start(t);
  src.stop(t + 0.08);
}

// ─── Music player ─────────────────────────────────────────────────────────
// Single-instance scheduler. Lookahead pattern: a setInterval ticks every
// 25ms and schedules anything that should start within the next 200ms.
// That keeps the audio thread's WebAudio queue full so nothing depends on
// JS timing accuracy beyond "wake up at least every 200ms".

const LOOKAHEAD_S = 0.25;
const TICK_MS = 25;

type ActiveSong = {
  song: Song;
  startTime: number; // audio-context time of beat 0 of the very first iteration
  nextLoopAt: number; // audio-context time of the next iteration's beat 0
  masterGain: GainNode;
  scheduledLoopCount: number;
};

class MusicPlayer {
  private active: ActiveSong | null = null;
  private timer: number | null = null;
  private targetVolume = 0.18;

  // Switch to a song. If a different song is already playing, fade out
  // smoothly first (no popping). If the same song is already playing,
  // do nothing — calling repeatedly with the menu song from a re-render
  // shouldn't restart the loop.
  play(song: Song, volume = 0.18) {
    if (this.active && this.active.song.id === song.id) {
      // Already playing — just update target volume in case the caller
      // wants a different mix.
      this.fadeTo(volume);
      return;
    }
    this.stop();
    const c = getMusicCtx();
    if (!c) return;
    const master = c.createGain();
    master.gain.value = 0.0001;
    master.connect(c.destination);
    master.gain.exponentialRampToValueAtTime(Math.max(volume, 0.0002), c.currentTime + 0.4);
    this.targetVolume = volume;
    const startTime = c.currentTime + 0.05;
    this.active = { song, startTime, nextLoopAt: startTime, masterGain: master, scheduledLoopCount: 0 };
    if (this.timer === null) {
      this.timer = setInterval(() => this.scheduleAhead(), TICK_MS) as unknown as number;
    }
    // Schedule the first window's worth right away so we don't wait
    // 25ms for the first tick (avoids a tiny silent gap on game start).
    this.scheduleAhead();
  }

  stop() {
    const c = getMusicCtx();
    if (!c || !this.active) return;
    const { masterGain } = this.active;
    masterGain.gain.cancelScheduledValues(c.currentTime);
    masterGain.gain.setValueAtTime(masterGain.gain.value, c.currentTime);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.3);
    // Disconnect after the fade so any pending oscillator events go
    // through silently rather than getting orphaned.
    const toDisconnect = masterGain;
    setTimeout(() => toDisconnect.disconnect(), 500);
    this.active = null;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  fadeTo(volume: number) {
    const c = getMusicCtx();
    if (!c || !this.active) return;
    this.targetVolume = volume;
    const g = this.active.masterGain.gain;
    g.cancelScheduledValues(c.currentTime);
    g.setValueAtTime(g.value, c.currentTime);
    g.exponentialRampToValueAtTime(Math.max(volume, 0.0002), c.currentTime + 0.4);
  }

  private scheduleAhead() {
    const c = getMusicCtx();
    if (!c || !this.active) return;
    const horizon = c.currentTime + LOOKAHEAD_S;
    const beatsPerSec = this.active.song.bpm / 60;
    const loopDur = this.active.song.loopBeats / beatsPerSec;
    while (this.active.nextLoopAt < horizon) {
      this.scheduleLoopAt(this.active.nextLoopAt);
      this.active.nextLoopAt += loopDur;
      this.active.scheduledLoopCount++;
    }
  }

  private scheduleLoopAt(loopStart: number) {
    if (!this.active) return;
    const beatsPerSec = this.active.song.bpm / 60;
    for (const note of this.active.song.notes) {
      const t = loopStart + note.beat / beatsPerSec;
      const dur = note.dur / beatsPerSec;
      this.scheduleNote(note, t, dur);
    }
  }

  private scheduleNote(note: Note, t: number, dur: number) {
    const c = getMusicCtx();
    if (!c || !this.active) return;
    const dest = this.active.masterGain;
    const g = note.gain ?? 1;
    if (note.voice === "kick") return playKick(c, dest, t, g);
    if (note.voice === "snare") return playSnare(c, dest, t, g);
    if (note.voice === "hat") return playHat(c, dest, t, g);
    if (!note.note) return;
    const freq = noteToFreq(note.note);
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = note.voice;
    osc.frequency.value = freq;
    const peak = 0.18 * g;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.01);
    // Slight tail so notes don't click off — short release shaped by dur.
    const release = Math.max(0.04, dur * 0.4);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    void release;
    osc.connect(gain).connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.06);
  }
}

export const music = new MusicPlayer();
