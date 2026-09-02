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
import {
  ALPHABET,
  LETTER_NAME_TEXT,
  LETTER_SOUND_TEXT,
  buildEntries,
  getHintIds,
  getWrongNudgeIds,
} from "./types";
import { music } from "./music";

type Mode = "elevenlabs" | "speech" | "muted";

// Background cache-warming pace. The delay lets the 3D scene and the
// music bed finish claiming bandwidth first; the gap keeps ~160 small
// requests from looking like a flood to anyone's network.
const WARM_DELAY_MS = 8000;
const WARM_GAP_MS = 60;

class AudioPlayer {
  mode: Mode = "speech";
  manifest: AudioManifest | null = null;
  voices: VoiceRegistryEntry[] = [];
  activeVoice: VoiceRegistryEntry | null = null;
  // User-side master volume and mute, driven by the parent settings
  // panel. Kept separate from `mode` so toggling mute doesn't lose the
  // underlying ElevenLabs/speech selection — a mute is a runtime
  // veto, not a capability change.
  private userVolume = 1;
  private userMuted = false;
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
  // True once init() has settled, either way. Until then we genuinely
  // don't know which backend we're on, so speak() stays quiet rather
  // than guessing — see the note there.
  private initSettled = false;
  // Recovery watcher state. A boot can land on the Web Speech voice for
  // reasons that clear up on their own (see watchForRecovery), so we
  // re-check instead of living with it for the rest of the session.
  private retryWatching = false;
  private retrying = false;
  private lastRetryAt = 0;
  // Which voice we've already walked through warmVoiceCache for.
  private warmedSlug: string | null = null;
  private static readonly RETRY_COOLDOWN_MS = 5000;

  // Optional preferred slug applied at init time. Pages that depend on a
  // particular voice can call setPreferredVoice before init.
  private preferredSlug: string | null = null;

  // Tracks the in-flight init() so play() / playSequence() / enqueue()
  // can await it before resolving their mode. Without this, bootstrap
  // code that fires within ~100 ms of page load (e.g. a game's 250 ms
  // setTimeout intro prompt landing on a deep-link reload) races init
  // and falls back to the Web Speech voice — the wrong voice for the
  // very first prompt the kid hears. Multiple init() calls return the
  // same promise so they don't trigger duplicate manifest fetches.
  private initPromise: Promise<void> | null = null;

  setPreferredVoice(slug: string | null): void {
    this.preferredSlug = slug;
  }

  setVolume(v: number): void {
    this.userVolume = Math.max(0, Math.min(1, v));
    if (this.audioEl) this.audioEl.volume = this.userVolume;
  }

  setMuted(m: boolean): void {
    this.userMuted = m;
    if (m) this.stop();
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

  init(): Promise<void> {
    // Memoize so repeated init() calls (e.g. from React StrictMode
    // double-invoke or HMR re-mounts) reuse the original promise.
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._init().finally(() => {
      this.initSettled = true;
      this.watchForRecovery();
    });
    return this.initPromise;
  }

  private async _init(): Promise<void> {
    // Prime the Web Speech voice no matter which backend we end up on.
    // play() falls back to it per-clip now, so it has to be ready even
    // when we're happily serving ElevenLabs MP3s.
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      this.primeSpeechVoice();
    }
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
          if (await this.clipShipped(`/audio/${probe}.mp3`)) {
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
    } else {
      this.mode = "muted";
    }
    this.emit();
  }

  // Did this voice's MP3s actually ship alongside its manifest? That is
  // the only question this probe exists to answer — the manifest is a
  // build-time record, so it already knows which clips were generated.
  //
  // So it only says NO to a definite 404. A request that never reaches
  // the server tells us nothing about the voice, and answering NO to
  // that used to drop the whole session onto the robot Web Speech
  // voice — which then read every menu label aloud, because speak() is
  // a no-op in ElevenLabs mode and live in speech mode. HEAD is also
  // the one request in this file a service worker can never serve from
  // cache (workbox routes GETs only), so offline it is guaranteed to
  // fail: a PWA cold-launched before the iPad finished re-associating
  // with wifi hit this every time.
  private async clipShipped(url: string): Promise<boolean> {
    // Bound the wait. On flaky wifi a hanging probe holds the whole
    // boot open, and speak() stays silent until init settles.
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer: ReturnType<typeof setTimeout> | null = ctl
      ? setTimeout(() => ctl.abort(), 2500)
      : null;
    try {
      const res = await fetch(url, { method: "HEAD", signal: ctl?.signal });
      return res.ok;
    } catch {
      return true;
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  // Landing on the Web Speech voice is usually not a broken install —
  // it's a launch that happened a second before the network was ready.
  // Nothing used to re-check, so one unlucky launch meant the robot
  // voice until the app was killed and reopened. Re-run init when the
  // app comes back to the front or the browser reports it's online.
  private watchForRecovery(): void {
    if (this.retryWatching || typeof window === "undefined") return;
    this.retryWatching = true;
    const retry = () => {
      if (this.mode === "elevenlabs" || this.retrying) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - this.lastRetryAt < AudioPlayer.RETRY_COOLDOWN_MS) return;
      this.lastRetryAt = now;
      this.retrying = true;
      void this._init().finally(() => {
        this.retrying = false;
      });
    };
    window.addEventListener("online", retry);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", retry);
    }
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
      if (!(await this.clipShipped(`/audio/${slug}/${probe}.mp3`))) return false;
      this.manifest = manifest;
      this.activeVoice = this.voices.find((v) => v.slug === slug) ?? {
        slug,
        name: slug,
        voiceId: manifest.voiceId,
        modelId: manifest.modelId,
        generatedAt: manifest.generatedAt,
      };
      this.mode = "elevenlabs";
      this.warmVoiceCache(slug, manifest);
      return true;
    } catch {
      return false;
    }
  }

  // Every clip id the game can ask for. buildEntries() is the source of
  // truth rather than the manifest, because the two drift: the
  // avatar-specific find-alphabet lines (…-drive, …-fly) have MP3s on
  // disk and are played by FindAlphabet.tsx, but were never added to
  // the manifest's prompts map. Warming from the manifest alone left
  // exactly those two uncached, so a kid playing as the car or the
  // rocket got the synth voice for their intro line offline. Ids a
  // given voice never generated just 404 during the walk and are
  // skipped.
  private allClipIds(m: AudioManifest): string[] {
    const ids = new Set<string>();
    for (const e of buildEntries()) if (e.id) ids.add(e.id);
    for (const l of Object.values(m.letters ?? {})) {
      if (l?.name) ids.add(l.name);
      if (l?.sound) ids.add(l.sound);
    }
    for (const id of Object.values(m.prompts ?? {})) if (id) ids.add(id);
    for (const id of Object.values(m.menu ?? {})) if (id) ids.add(id);
    for (const id of [...(m.celebrate ?? []), ...(m.hints ?? []), ...(m.wrongNudge ?? [])]) {
      if (id) ids.add(id);
    }
    return [...ids];
  }

  // Pull the active voice into the service worker's cache in the
  // background, so a session that starts without a network still gets
  // the real voice rather than the synth fallback.
  //
  // These have to be explicit GETs. The <audio> element asks for media
  // with a Range header, the server answers 206, and workbox won't
  // store a partial response — which is why the runtime cache sat empty
  // however much of the alphabet the kid played. A plain fetch() gets a
  // cacheable 200; the route's rangeRequests option hands that stored
  // copy back to the element later. See the runtimeCaching block in
  // vite.config.ts, which had to start matching by URL for this to land
  // in the same cache.
  private warmVoiceCache(slug: string, manifest: AudioManifest): void {
    if (this.warmedSlug === slug) return;
    this.warmedSlug = slug;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (typeof caches === "undefined") return;
    const ids = this.allClipIds(manifest);
    void (async () => {
      try {
        await navigator.serviceWorker.ready;
        // No controller means nothing is intercepting these fetches, so
        // they'd spend bandwidth and cache nothing. That's `vite dev`
        // (the worker is off there) and the very first load before the
        // worker takes over — the next launch picks it up.
        if (!navigator.serviceWorker.controller) {
          this.warmedSlug = null;
          return;
        }
        await new Promise((r) => setTimeout(r, WARM_DELAY_MS));
        const cache = await caches.open("letra-audio");
        for (const id of ids) {
          const url = `/audio/${slug}/${id}.mp3`;
          if (await cache.match(url)) continue;
          const res = await fetch(url);
          // A 404 is a gap in this voice's library, not a network
          // problem — skip it and keep going.
          if (!res.ok && res.status !== 404) throw new Error(String(res.status));
          await new Promise((r) => setTimeout(r, WARM_GAP_MS));
        }
      } catch {
        // Offline, or the network went away mid-walk. Stop rather than
        // grinding through the rest; clearing the guard lets the next
        // launch resume where the cache left off.
        this.warmedSlug = null;
      }
    })();
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
    // Cancel a spoken line whatever mode we're in — play()'s per-clip
    // fallback can be talking while the player is on ElevenLabs.
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
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
    // Wait out any in-flight init so the first prompt after page load
    // doesn't ship under the wrong (speech-fallback) mode.
    if (this.initPromise) await this.initPromise;
    if (this.mode === "muted" || this.userMuted) return;
    if (opts.interrupt !== false) this.stop();
    if (this.mode === "elevenlabs") {
      // Yield once to let the AbortError from the just-paused previous
      // play() settle in the microtask queue. Without this, back-to-back
      // calls (e.g. clicking "Next word" while the celebrate clip is
      // still finishing) race: the new a.play() promise itself rejects
      // with AbortError, our .catch(finish) swallows it, and the new
      // clip never starts. Symptom: occasionally no audio for the new
      // word.
      await Promise.resolve();
      // Dip the background music for the duration of the clip so the
      // voice stays clear. unduck() runs whenever the returned promise
      // settles — ended, error, OR a stop() that resolves it early —
      // so the music always comes back up.
      music.duck();
      // Set by the element's error event: this clip couldn't be loaded.
      let failed = false;
      return new Promise<void>((resolve) => {
        const a = this.getAudioEl();
        // Swap the src on the cached element rather than creating a
        // new Audio — keeps the iOS unlock state intact across plays.
        a.src = this.clipUrl(id);
        a.volume = this.userVolume;
        // Fast-forward to start in case the element was paused
        // mid-clip by a previous stop().
        try { a.currentTime = 0; } catch { /* not always settable until loadedmetadata */ }
        this.current = a;
        const finish = () => {
          if (this.currentResolver === resolve) this.currentResolver = null;
          a.removeEventListener("ended", finish);
          a.removeEventListener("error", onError);
          resolve();
        };
        // A clip that won't load — offline before it was ever cached, or
        // a gap in this voice's library — used to just go quiet. Say
        // that one line with the synth voice instead. Per-clip, so a
        // missing MP3 costs a line rather than flipping the session.
        const onError = () => {
          failed = true;
          finish();
        };
        this.currentResolver = resolve;
        a.addEventListener("ended", finish);
        a.addEventListener("error", onError);
        a.play()
          .then(() => {
            // First successful play() inside any user gesture path
            // counts as our unlock — flips the flag so future
            // setTimeout-deferred plays don't try to re-unlock.
            this.unlocked = true;
          })
          .catch(finish);
      })
        .then(() => {
          if (!failed || this.userMuted || this.mode === "muted") return;
          return this.speakNow(textForId(id));
        })
        .finally(() => music.unduck());
    }
    // Speech fallback: derive the natural-language text from the id.
    const text = textForId(id);
    return this.speak(text);
  }

  // Speak arbitrary text — used by speech-synthesis fallback or for debug.
  speak(text: string): Promise<void> {
    if (this.mode === "muted" || this.userMuted) return Promise.resolve();
    if (this.mode === "elevenlabs") {
      // No live synthesis path on ElevenLabs — for arbitrary text we just
      // resolve immediately. Use play() for known clip ids instead.
      return Promise.resolve();
    }
    // Deciding which backend we're on takes a few round trips, and
    // `mode` reads "speech" until init settles. Anything that spoke
    // inside that window — a kid touching a menu card the instant it
    // paints — got the robot voice even on a perfectly healthy boot.
    // Stay quiet for the fraction of a second instead.
    if (this.initPromise && !this.initSettled) return Promise.resolve();
    // Duck the music under the spoken line, same as the ElevenLabs path.
    music.duck();
    return this.speakNow(text).finally(() => music.unduck());
  }

  // The bare Web Speech call: no mode check, no ducking — callers own
  // both. play()'s per-clip fallback has to synthesise a line while the
  // player is still in ElevenLabs mode, which speak() refuses by design.
  private speakNow(text: string): Promise<void> {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const utter = new SpeechSynthesisUtterance(text);
      if (this.speechVoice) utter.voice = this.speechVoice;
      utter.rate = 0.95;
      utter.pitch = 1.1;
      utter.volume = this.userVolume;
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

  randomWrongNudge(): string {
    const ids = getWrongNudgeIds(this.manifest ?? undefined);
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
    "wrong-close": "You're close, maybe try a different letter!",
    "wrong-almost": "Almost! Try another one!",
    "wrong-keep-looking": "Oops, keep looking!",
    "wrong-different": "Hmm, not that one. Let's keep going!",
    "wrong-try-again": "Not this letter, try a different one!",
    "menu-welcome": "Welcome to Letra! Pick a game to start.",
    "menu-spell": "Spell the word.",
    "menu-alphabet": "Find the alphabet.",
    "menu-sounds": "Match the sound.",
    "menu-back": "Back to the main menu.",
  };
  return other[id] ?? id;
}

export const audio = new AudioPlayer();

// Read-only console hook: `__letraAudio()` reports which voice backend
// the session actually landed on. Not dev-gated on purpose — "why does
// it sound like a screen reader?" is a question you can only answer on
// the device it's happening on, and that device is usually a kid's
// iPad pointed at production.
if (typeof window !== "undefined") {
  (window as unknown as { __letraAudio?: () => unknown }).__letraAudio = () => ({
    mode: audio.mode,
    voice: audio.activeVoice?.slug ?? null,
    voices: audio.voices.map((v) => v.slug),
    clips: audio.manifest ? Object.keys(audio.manifest.letters ?? {}).length : 0,
  });
}

// Sanity export of the alphabet so callers don't need to import twice.
export { ALPHABET };
