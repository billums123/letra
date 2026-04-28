// Audio player. Two backends:
//   1. ElevenLabs static MP3s (preferred — best voice quality, no rate limits
//      or token spend at runtime).
//   2. Web Speech API fallback so the game still talks even without an API key
//      (no kid is going to enjoy a silent letter game).
//
// Voice selection: on boot we read /audio/voices.json (the registry the
// generation script maintains). If present, we pick a voice — either the
// one passed via setActiveVoice() or the first in the registry — and
// resolve clip URLs as /audio/<slug>/<id>.mp3. Without a registry we fall
// back to the legacy flat layout (/audio/<id>.mp3) for backward compat.

import type { AudioManifest, VoicesRegistry, VoiceRegistryEntry } from "./types";
import { ALPHABET, LETTER_NAME_TEXT, LETTER_SOUND_TEXT, getHintIds } from "./types";

type Mode = "elevenlabs" | "speech" | "muted";

class AudioPlayer {
  mode: Mode = "speech";
  manifest: AudioManifest | null = null;
  voices: VoiceRegistryEntry[] = [];
  activeVoice: VoiceRegistryEntry | null = null;
  // Subscribers receive notifications when init/voice changes complete.
  private listeners = new Set<() => void>();
  // Single, reused HTMLAudioElement for every voice clip. iOS only
  // unlocks an element when its FIRST .play() is called inside a
  // user gesture; previously we created a new Audio per clip, which
  // meant only the first letter played and subsequent ones stayed
  // silent on iOS. Reusing the same element means the one-time
  // unlock applies forever — every later play() just swaps the src.
  private audioEl: HTMLAudioElement | null = null;
  private current: HTMLAudioElement | null = null;
  // True once we've successfully started a play on the audio element
  // inside a user gesture. Subsequent setTimeout-deferred play()s
  // (which lose their gesture context on iOS) work after this point.
  private unlocked = false;
  // The resolver of the in-flight play() promise, so stop() can resolve
  // it instead of leaving the caller hanging forever (which used to break
  // .then() chains for letter name → letter sound).
  private currentResolver: (() => void) | null = null;
  // Background queue of clip ids waiting to be played one-at-a-time.
  // Used by enqueue() so rapid collection of nearby letters doesn't cancel
  // every previous audio and end up silent.
  private queue: string[] = [];
  private queueDraining = false;
  // Increments whenever stop()/flushQueue()/setVoice() is called; lets
  // playSequence() know its sequence has been cancelled so it won't keep
  // firing the next clip in the chain.
  private sequenceVersion = 0;
  private speechVoice: SpeechSynthesisVoice | null = null;
  private speechReady = false;

  // Optional preferred slug applied at init time. Pages that depend on a
  // particular voice can call setPreferredVoice before init.
  private preferredSlug: string | null = null;

  setPreferredVoice(slug: string | null): void {
    this.preferredSlug = slug;
  }

  // Lazily create + cache the single audio element. Setting playsinline
  // attrs prevents iOS from hijacking the page into fullscreen on play.
  private getAudioEl(): HTMLAudioElement {
    if (this.audioEl) return this.audioEl;
    const a = new Audio();
    a.preload = "auto";
    a.setAttribute("playsinline", "");
    a.setAttribute("webkit-playsinline", "");
    // Voice clips shouldn't be airplayed — keeps clips local to the
    // device.
    a.setAttribute("x-webkit-airplay", "deny");
    this.audioEl = a;
    // Wire a one-time unlock attempt on the first user gesture so a
    // setTimeout-deferred play() (e.g. our 250ms intro prompt) works
    // even though it has lost its gesture context. The unlock fires
    // a play() on a silent file from a real gesture, which marks
    // the element "unlocked" for all future plays on iOS.
    if (typeof document !== "undefined" && !this.unlocked) {
      const unlock = () => {
        if (this.unlocked || !this.audioEl) return;
        const el = this.audioEl;
        const prevSrc = el.src;
        el.src = "/audio/silent.mp3";
        const onReady = () => {
          this.unlocked = true;
          // Restore whatever src was set (probably empty) so a
          // subsequent play(id) doesn't accidentally play the
          // silent placeholder.
          if (prevSrc) el.src = prevSrc;
          else el.removeAttribute("src");
        };
        el.play().then(onReady).catch(() => {
          // Failed to unlock — try again on the next gesture.
          el.src = prevSrc;
        });
      };
      document.addEventListener("touchend", unlock, { passive: true });
      document.addEventListener("click", unlock);
      document.addEventListener("keydown", unlock);
    }
    return a;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  async init(): Promise<void> {
    // Try the registry first.
    try {
      const regRes = await fetch("/audio/voices.json", { cache: "no-store" });
      if (regRes.ok) {
        const reg = (await regRes.json()) as VoicesRegistry;
        if (reg && Array.isArray(reg.voices) && reg.voices.length > 0) {
          this.voices = reg.voices;
          // Pick the active voice: preferred slug → flagged default → first.
          const pick =
            (this.preferredSlug && reg.voices.find((v) => v.slug === this.preferredSlug)) ||
            reg.voices.find((v) => v.isDefault) ||
            reg.voices[0];
          const ok = await this.loadVoice(pick.slug);
          if (ok) {
            this.emit();
            return;
          }
        }
      }
    } catch {
      // ignore — fall through to legacy
    }

    // Legacy flat-layout fallback.
    try {
      const res = await fetch("/audio/manifest.json", { cache: "no-store" });
      if (res.ok) {
        const manifest = (await res.json()) as AudioManifest;
        const probe = manifest.letters?.A?.name;
        if (probe) {
          const probeRes = await fetch(`/audio/${probe}.mp3`, { method: "HEAD" });
          if (probeRes.ok) {
            this.manifest = manifest;
            this.mode = "elevenlabs";
            this.activeVoice = null; // legacy flat
            this.emit();
            return;
          }
        }
      }
    } catch {
      // No manifest — fall through to speech.
    }

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      this.mode = "speech";
      this.primeSpeechVoice();
    } else {
      this.mode = "muted";
    }
    this.emit();
  }

  // Switch to a different voice from the registry. Returns true on success.
  async setVoice(slug: string): Promise<boolean> {
    const ok = await this.loadVoice(slug);
    if (ok) this.emit();
    return ok;
  }

  // Loads a per-voice manifest and verifies a probe clip exists. Sets
  // mode to "elevenlabs" on success.
  private async loadVoice(slug: string): Promise<boolean> {
    try {
      const manifestRes = await fetch(`/audio/${slug}/manifest.json`, { cache: "no-store" });
      if (!manifestRes.ok) return false;
      const manifest = (await manifestRes.json()) as AudioManifest;
      const probe = manifest.letters?.A?.name;
      if (!probe) return false;
      const probeRes = await fetch(`/audio/${slug}/${probe}.mp3`, { method: "HEAD" });
      if (!probeRes.ok) return false;
      this.manifest = manifest;
      this.activeVoice = this.voices.find((v) => v.slug === slug) ?? {
        slug,
        name: slug,
        voiceId: manifest.voiceId,
        modelId: manifest.modelId,
        generatedAt: manifest.generatedAt,
      };
      this.mode = "elevenlabs";
      return true;
    } catch {
      return false;
    }
  }

  // Compute the URL for a clip id, accounting for whether we're in
  // per-voice (registry) or legacy flat layout.
  private clipUrl(id: string): string {
    if (this.activeVoice) return `/audio/${this.activeVoice.slug}/${id}.mp3`;
    return `/audio/${id}.mp3`;
  }

  private primeSpeechVoice() {
    const synth = window.speechSynthesis;
    const pick = () => {
      const voices = synth.getVoices();
      // Prefer a friendly female English voice; many systems ship "Samantha",
      // "Karen", "Google US English", "Microsoft Aria".
      const preferred =
        voices.find((v) => /samantha|karen|aria|jenny|allison|google us english/i.test(v.name) && v.lang.startsWith("en")) ||
        voices.find((v) => v.lang.startsWith("en") && v.localService) ||
        voices.find((v) => v.lang.startsWith("en")) ||
        voices[0];
      if (preferred) {
        this.speechVoice = preferred;
        this.speechReady = true;
      }
    };
    pick();
    if (!this.speechReady) {
      synth.addEventListener("voiceschanged", pick, { once: true });
    }
  }

  setMode(mode: Mode) {
    this.mode = mode;
  }

  isMuted() {
    return this.mode === "muted";
  }

  stop() {
    if (this.current) {
      this.current.pause();
      this.current.currentTime = 0;
      this.current = null;
    }
    if (this.currentResolver) {
      // Resolve the pending play() promise so any awaiter (e.g. the
      // queue drain loop or a playSequence step) can move on instead
      // of hanging forever.
      this.currentResolver();
      this.currentResolver = null;
    }
    // Bumping the sequence version cancels any in-flight playSequence().
    this.sequenceVersion++;
    if (this.mode === "speech" && typeof window !== "undefined") {
      window.speechSynthesis.cancel();
    }
  }

  // Drop everything in the queue and stop the current clip. Used when
  // switching screens / games — prevents leftover queued audio from a
  // previous round bleeding into the new one.
  flushQueue() {
    this.queue = [];
    this.stop();
  }

  // Plays a clip by id (key into the manifest). Returns a promise that resolves
  // when the clip finishes (or immediately on error so callers don't deadlock).
  async play(id: string, opts: { interrupt?: boolean } = {}): Promise<void> {
    if (this.mode === "muted") return;
    if (opts.interrupt !== false) this.stop();
    if (this.mode === "elevenlabs") {
      return new Promise((resolve) => {
        const a = this.getAudioEl();
        // Swap the src on the cached element rather than creating a
        // new Audio — keeps the iOS unlock state intact across plays.
        a.src = this.clipUrl(id);
        // Fast-forward to start in case the element was paused
        // mid-clip by a previous stop().
        try { a.currentTime = 0; } catch { /* not always settable until loadedmetadata */ }
        this.current = a;
        const finish = () => {
          if (this.currentResolver === resolve) this.currentResolver = null;
          a.removeEventListener("ended", finish);
          a.removeEventListener("error", finish);
          resolve();
        };
        this.currentResolver = resolve;
        a.addEventListener("ended", finish);
        a.addEventListener("error", finish);
        a.play()
          .then(() => {
            // First successful play() inside any user gesture path
            // counts as our unlock — flips the flag so future
            // setTimeout-deferred plays don't try to re-unlock.
            this.unlocked = true;
          })
          .catch(finish);
      });
    }
    // Speech fallback: derive the natural-language text from the id.
    const text = textForId(id);
    return this.speak(text);
  }

  // Speak arbitrary text — used by speech-synthesis fallback or for debug.
  speak(text: string): Promise<void> {
    if (this.mode === "muted") return Promise.resolve();
    if (this.mode === "elevenlabs") {
      // No live synthesis path on ElevenLabs — for arbitrary text we just
      // resolve immediately. Use play() for known clip ids instead.
      return Promise.resolve();
    }
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return Promise.resolve();
    return new Promise((resolve) => {
      const utter = new SpeechSynthesisUtterance(text);
      if (this.speechVoice) utter.voice = this.speechVoice;
      utter.rate = 0.95;
      utter.pitch = 1.1;
      utter.onend = () => resolve();
      utter.onerror = () => resolve();
      window.speechSynthesis.speak(utter);
    });
  }

  // Queue a clip to play after the currently-queued audio finishes.
  // Useful when several clips might fire in quick succession (e.g. the
  // kid speed-walks through three letters) — without queueing, each new
  // play() would interrupt the previous one and leave the user hearing
  // only the last clip.
  enqueue(id: string): void {
    this.queue.push(id);
    void this.drainQueue();
  }

  private async drainQueue(): Promise<void> {
    if (this.queueDraining) return;
    this.queueDraining = true;
    try {
      while (this.queue.length > 0) {
        const id = this.queue.shift()!;
        // interrupt:false → if something else is playing, this would
        // overlap; but the drain loop only runs one clip at a time, so
        // by the time we await play() the previous clip has already
        // completed (or been cancelled, in which case stop() resolved
        // its promise).
        await this.play(id, { interrupt: true });
      }
    } finally {
      this.queueDraining = false;
    }
  }

  // Plays the given clip ids strictly in order. If anything cancels the
  // sequence (stop(), another play(), a voice swap), remaining clips are
  // skipped instead of playing late or out of context.
  async playSequence(ids: string[]): Promise<void> {
    if (this.mode === "muted" || ids.length === 0) return;
    this.stop();
    const myVersion = this.sequenceVersion;
    for (const id of ids) {
      if (myVersion !== this.sequenceVersion) return;
      await this.play(id, { interrupt: false });
    }
  }

  letterName(letter: string): string {
    return this.manifest?.letters[letter.toUpperCase()]?.name ?? `letter-${letter.toUpperCase()}-name`;
  }

  letterSound(letter: string): string {
    return this.manifest?.letters[letter.toUpperCase()]?.sound ?? `letter-${letter.toUpperCase()}-sound`;
  }

  prompt(key: string): string {
    return this.manifest?.prompts[key] ?? `prompt-${key}`;
  }

  randomCelebrate(): string {
    const ids = this.manifest?.celebrate ?? [
      "celebrate-1",
      "celebrate-2",
      "celebrate-3",
      "celebrate-4",
      "celebrate-5",
      "celebrate-6",
    ];
    return ids[(Math.random() * ids.length) | 0];
  }

  randomHint(): string {
    const ids = getHintIds(this.manifest ?? undefined);
    return ids[(Math.random() * ids.length) | 0];
  }

  menu(key: string): string {
    return this.manifest?.menu[key] ?? `menu-${key}`;
  }
}

// Translate a clip id back into natural text for the speech fallback. Keeping
// this in one place avoids forks of "what does clip X say" across the codebase.
function textForId(id: string): string {
  // Letter clips
  const letterName = id.match(/^letter-([A-Z])-name$/);
  if (letterName) {
    const L = letterName[1];
    return LETTER_NAME_TEXT[L] ?? L;
  }
  const letterSound = id.match(/^letter-([A-Z])-sound$/);
  if (letterSound) {
    const L = letterSound[1];
    return LETTER_SOUND_TEXT[L] ?? L;
  }
  // Spell prompts
  const spellPrompt = id.match(/^prompt-spell-([A-Z]+)$/);
  if (spellPrompt) {
    const w = spellPrompt[1];
    return `Find the letters that spell ${w.split("").join(", ")}!`;
  }
  const spellReveal = id.match(/^reveal-spell-([A-Z]+)$/);
  if (spellReveal) return `You spelled ${spellReveal[1]}!`;
  // Other prompts and menu items — sensible defaults.
  const other: Record<string, string> = {
    "prompt-find-alphabet": "Let's find the whole alphabet! Walk to each letter from A to Z.",
    "prompt-sound-match": "Listen and find the letter that makes this sound.",
    "prompt-sound-match-replay": "Listen again.",
    "celebrate-1": "You did it!",
    "celebrate-2": "Great job!",
    "celebrate-3": "Wonderful!",
    "celebrate-4": "Amazing!",
    "celebrate-5": "You are a star!",
    "celebrate-6": "Way to go!",
    "hint-keep-looking": "Keep looking! You can do it!",
    "hint-look-around": "Look all around the world. The letter is hiding!",
    "hint-i-believe": "I believe in you!",
    "hint-where-could-it-be": "Where could it be?",
    "hint-keep-going": "Keep going, you're doing great!",
    "menu-welcome": "Welcome to Letra! Pick a game to start.",
    "menu-spell": "Spell the word.",
    "menu-alphabet": "Find the alphabet.",
    "menu-sounds": "Match the sound.",
    "menu-back": "Back to the main menu.",
  };
  return other[id] ?? id;
}

export const audio = new AudioPlayer();

// Sanity export of the alphabet so callers don't need to import twice.
export { ALPHABET };
