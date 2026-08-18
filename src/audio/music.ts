// Background music player. Each track is a 30-second instrumental MP3
// generated up-front by `npm run music:generate` (ElevenLabs Music API)
// and cached at /public/audio/music/<id>.mp3.
//
// Looping strategy:
//   We rely on AudioBufferSourceNode.loop = true — Web Audio guarantees
//   sample-accurate gapless looping when the buffer's last sample
//   abuts its first. The source MP3 sometimes ships with a tiny bit of
//   leading or trailing near-silence (LAME priming, model artefacts),
//   which causes a perceptible click at the loop seam, so on first
//   load we trim the buffer to matching zero crossings near the head
//   and tail. That gives a click-free join without the energy mush of
//   a crossfade.

import { getMusicCtx, onAudioContextStateChange } from "./audioCtx";

export type Track = {
  id: string;
  name: string;
  url: string;
};

type ActiveTrack = {
  track: Track;
  source: AudioBufferSourceNode;
  masterGain: GainNode;
};

// The "we are in space now" effects bus. Every track plays through it,
// and it is transparent until something asks for it: at amount 0 the
// signal is dry through an open filter, so a kid who never leaves the
// water hears exactly what they always heard.
//
// The effect itself is the ordinary distance cue — a lowpass closing
// down, a long tail, and a slap-back — applied hard enough to read as
// vacuum. It is the same song throughout; only the room changes.
type SpaceBus = {
  input: GainNode;
  tone: BiquadFilterNode;
  dry: GainNode;
  wet: GainNode;
  delay: DelayNode;
  feedback: GainNode;
};

class MusicPlayer {
  private active: ActiveTrack | null = null;
  // Track most-recent play() request so a slow decode can't override
  // a newer call when it finally resolves.
  private loadingUrl: string | null = null;
  // AudioBuffers are loop-trimmed once and re-used for the rest of the
  // session — decoding + scanning is expensive enough that we cache.
  private bufferCache = new Map<string, Promise<AudioBuffer | null>>();
  // Last-requested track + volume. We keep these around so the iOS
  // resume handler can re-play the same track after a long
  // interruption (lock screen, app switch, scroll suspend). The
  // intendedVolume is the per-track "natural" mix level requested by
  // Game.tsx (e.g. 0.18 for the menu theme); userVolume is the
  // settings-panel multiplier on top of that.
  private intendedTrack: Track | null = null;
  private intendedVolume = 0.18;
  private userVolume = 1;
  // Voice duck. When a voice clip is playing we dip the music so the
  // narration stays intelligible — for a phonics game the spoken letter
  // sound IS the product, and it used to compete with the music at full
  // volume. duckCount ref-counts overlapping voice clips; duckLevel is
  // the current multiplier applied on top of intendedVolume*userVolume
  // (1 = open, DUCK_GAIN = ducked). A short release hold keeps the music
  // down through the tiny gaps in a clip sequence (e.g. letter-name →
  // letter-sound) instead of pumping up and back down between them.
  private duckCount = 0;
  private duckLevel = 1;
  private duckReleaseTimer: number | null = null;
  private readonly DUCK_GAIN = 0.35;
  private readonly DUCK_RELEASE_MS = 220;
  // Set true when the context goes suspended/interrupted; on the
  // next return-to-running we know to re-trigger playback because
  // the source node may have been killed.
  private interrupted = false;
  // Watchdog timer that re-arms music if the context is supposed to
  // be running but isn't — covers the rare iOS case where neither
  // a state change event nor a user gesture fires.
  private watchdog: number | null = null;
  // Wired once on first play().
  private resumeWired = false;
  // Effects bus, built on first use and then reused for the life of
  // the page — a ConvolverNode's impulse response is not free to make.
  private bus: SpaceBus | null = null;
  private spaceAmount = 0;
  // Last amount actually written to the audio graph. setSpaceAmount is
  // called from the render loop, and there is no point rewriting six
  // AudioParams sixty times a second for a value that moves this
  // slowly.
  private spaceWritten = -1;

  async play(track: Track, volume = 0.18): Promise<void> {
    this.wireResumeHandlers();
    // A different track means a different place, and nowhere else is
    // in space. Without this, leaving the sun via the Home button —
    // which never runs the biome tick that would wind it back down —
    // strands the menu theme in reverb.
    if (this.active?.track.id !== track.id) this.setSpaceAmount(0);
    this.intendedTrack = track;
    this.intendedVolume = volume;
    if (this.active && this.active.track.id === track.id && !this.interrupted) {
      this.applyGain(0.2);
      return;
    }
    const c = getMusicCtx();
    if (!c) return;
    this.loadingUrl = track.url;
    const buffer = await this.loadBuffer(c, track.url);
    if (!buffer) return;
    if (this.loadingUrl !== track.url) return;
    // The decode may have settled while a resume was in-flight; clear
    // the interrupted flag once we're actually about to schedule a new
    // source so the watchdog doesn't immediately re-trigger.
    this.interrupted = false;

    // Sequence the transition entirely on the audio clock so the old
    // track is fully silent before the new one starts. Two tracks
    // never overlap. A 60ms fade-out keeps the cut from clicking, and
    // the new track starts ~20ms after that with a brief fade-in.
    const now = c.currentTime;
    const FADE = 0.06;
    let startAt = now + 0.02;
    if (this.active) {
      this.fadeOutAndStop(this.active, FADE);
      startAt = now + FADE + 0.02;
      this.active = null;
    }

    const master = c.createGain();
    master.gain.value = 0.0001;
    master.connect(this.ensureBus(c).input);
    // Start at the current target — which honours an in-progress duck so
    // a track that comes in while the voice is talking starts dipped.
    master.gain.linearRampToValueAtTime(
      Math.max(volume * this.userVolume * this.duckLevel, 0.0001),
      startAt + 0.04,
    );
    const source = c.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(master);
    source.start(startAt);
    this.active = { track, source, masterGain: master };
  }

  stop(): void {
    this.setSpaceAmount(0);
    if (this.active) {
      this.fadeOutAndStop(this.active, 0.06);
      this.active = null;
    }
    this.loadingUrl = null;
    // Drop the intended track too — explicit stop means "we're done";
    // the iOS resume handler must not re-trigger a track the user
    // navigated away from.
    this.intendedTrack = null;
  }

  // Wire context resume handlers + start a watchdog the first time
  // music is requested. Listens for state changes (the audioCtx
  // module installs gesture/visibility listeners separately); when
  // the context comes back to "running" after an interruption and we
  // had an intended track, re-trigger playback because the iOS
  // suspension may have killed the buffer source.
  private wireResumeHandlers(): void {
    if (this.resumeWired) return;
    this.resumeWired = true;
    onAudioContextStateChange(() => this.handleStateChange());
    // Watchdog — covers the rare case where neither state change
    // events nor user gestures fire (for example, scroll-induced
    // suspension on some iOS versions). Every 1.5s we sanity-check
    // that the context is running and the active track is alive;
    // if we have an intended track and don't, restart.
    if (typeof window !== "undefined") {
      this.watchdog = window.setInterval(() => this.handleStateChange(), 1500);
    }
  }

  private handleStateChange(): void {
    const c = getMusicCtx();
    if (!c) return;
    const state = c.state as string;
    if (state !== "running") {
      // Mark interrupted so that when we come back to running we
      // know to re-trigger playback (the iOS source may be dead).
      this.interrupted = true;
      // Belt-and-suspenders resume — audioCtx also tries.
      void c.resume().catch(() => undefined);
      return;
    }
    // Running. Only re-trigger if we KNOW we were interrupted —
    // don't restart on every routine state-change tick from the
    // watchdog timer.
    if (!this.intendedTrack || !this.interrupted) return;
    // If a play is already loading the right track (decode in
    // flight), don't double-trigger; the in-flight play() will
    // schedule the new source on its own.
    if (this.loadingUrl === this.intendedTrack.url) {
      this.interrupted = false;
      return;
    }
    this.interrupted = false;
    const track = this.intendedTrack;
    const volume = this.intendedVolume;
    // Drop active so play() takes the swap path (it bails early if
    // active.track.id matches the requested track).
    this.active = null;
    void this.play(track, volume);
  }

  // Ramp the active track to its current target gain — the per-track
  // intended mix, scaled by the settings-panel volume and the voice
  // duck. Single funnel so volume changes, ducking, and unducking all
  // resolve to one consistent target.
  private applyGain(rampSec: number): void {
    const c = getMusicCtx();
    if (!c || !this.active) return;
    const target = Math.max(this.intendedVolume * this.userVolume * this.duckLevel, 0.0001);
    const g = this.active.masterGain.gain;
    g.cancelScheduledValues(c.currentTime);
    g.setValueAtTime(g.value, c.currentTime);
    g.linearRampToValueAtTime(target, c.currentTime + rampSec);
  }

  // Dip the music under a voice clip. Ref-counted so overlapping clips
  // don't fight; always pair with unduck().
  duck(): void {
    if (this.duckReleaseTimer !== null) {
      clearTimeout(this.duckReleaseTimer);
      this.duckReleaseTimer = null;
    }
    this.duckCount++;
    if (this.duckLevel !== this.DUCK_GAIN) {
      this.duckLevel = this.DUCK_GAIN;
      this.applyGain(0.12);
    }
  }

  unduck(): void {
    if (this.duckCount > 0) this.duckCount--;
    if (this.duckCount > 0) return;
    // Release hold — wait a beat before restoring full volume so a run
    // of clips with tiny gaps (a letter-name → letter-sound sequence)
    // doesn't make the music audibly pump up between each one.
    if (this.duckReleaseTimer !== null) clearTimeout(this.duckReleaseTimer);
    if (typeof window === "undefined") {
      this.duckLevel = 1;
      this.applyGain(0.3);
      return;
    }
    this.duckReleaseTimer = window.setTimeout(() => {
      this.duckReleaseTimer = null;
      this.duckLevel = 1;
      this.applyGain(0.3);
    }, this.DUCK_RELEASE_MS);
  }

  // 0 = the track as recorded, 1 = the same track heard from orbit.
  // Driven from the ocean biome's altitude fade, so the music drains
  // away with the sky and comes back with it.
  setSpaceAmount(k: number): void {
    const next = Math.max(0, Math.min(1, k));
    this.spaceAmount = next;
    const c = getMusicCtx();
    if (!c) return;
    // Only touch the graph when it would actually move — this runs
    // every frame. The endpoints always get written, so the effect
    // lands exactly off and exactly on.
    if (next === this.spaceWritten) return;
    if (next !== 0 && next !== 1 && Math.abs(next - this.spaceWritten) < 0.008) return;
    this.spaceWritten = next;
    const bus = this.ensureBus(c);
    const at = c.currentTime;
    const set = (p: AudioParam, v: number) => {
      p.cancelScheduledValues(at);
      p.setValueAtTime(p.value, at);
      p.linearRampToValueAtTime(v, at + 0.12);
    };
    // Exponential in frequency so the filter sweep sounds even.
    set(bus.tone.frequency, 20000 * Math.pow(700 / 20000, next));
    set(bus.dry.gain, 1 - 0.45 * next);
    set(bus.wet.gain, 0.75 * next);
    set(bus.feedback.gain, 0.52 * next);
    // A touch slower as well. Two per cent is under a third of a
    // semitone — too little to hear as out of tune, plenty to feel as
    // drifting.
    if (this.active) set(this.active.source.playbackRate, 1 - 0.02 * next);
  }

  private ensureBus(c: AudioContext): SpaceBus {
    if (this.bus) return this.bus;
    const input = c.createGain();
    const tone = c.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 20000;
    tone.Q.value = 0.6;
    const dry = c.createGain();
    dry.gain.value = 1;
    const wet = c.createGain();
    wet.gain.value = 0;
    const delay = c.createDelay(1);
    delay.delayTime.value = 0.34;
    const feedback = c.createGain();
    feedback.gain.value = 0;
    const verb = c.createConvolver();
    verb.buffer = makeReverbImpulse(c, 3.4, 2.6);

    // Tone sits in the main path, so the whole signal goes distant —
    // filtering only the wet half leaves a bright, close dry signal
    // sitting on top of a far-away one, which reads as a broken mix
    // rather than as distance.
    input.connect(tone);
    tone.connect(dry);
    dry.connect(c.destination);
    tone.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(verb);
    verb.connect(wet);
    wet.connect(c.destination);

    this.bus = { input, tone, dry, wet, delay, feedback };
    return this.bus;
  }

  // Settings-panel master volume multiplier (0..1). Scales the
  // currently-playing track without disturbing its intended per-track
  // mix level, and is stored so the next play() inherits the factor.
  setUserVolume(v: number): void {
    this.userVolume = Math.max(0, Math.min(1, v));
    if (this.active) {
      this.applyGain(0.2);
    }
  }

  private fadeOutAndStop(active: ActiveTrack, fadeSec: number): void {
    const c = getMusicCtx();
    if (!c) return;
    const now = c.currentTime;
    const g = active.masterGain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0.0001, now + fadeSec);
    try { active.source.stop(now + fadeSec + 0.02); } catch { /* may already be stopped */ }
    const node = active.masterGain;
    // Disconnect after the source has stopped so the graph stays clean.
    setTimeout(() => node.disconnect(), Math.ceil((fadeSec + 0.1) * 1000));
  }

  private async loadBuffer(c: AudioContext, url: string): Promise<AudioBuffer | null> {
    let promise = this.bufferCache.get(url);
    if (!promise) {
      promise = (async () => {
        try {
          const res = await fetch(url);
          if (!res.ok) return null;
          const arr = await res.arrayBuffer();
          const decoded = await c.decodeAudioData(arr);
          return trimToZeroCrossings(c, decoded);
        } catch {
          return null;
        }
      })();
      this.bufferCache.set(url, promise);
    }
    return promise;
  }
}

// Exponentially decaying noise, which is all a convolution reverb
// needs to sound like a very large empty room. Cheaper than shipping
// an impulse-response file, and nobody is going to identify the hall.
function makeReverbImpulse(c: AudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.max(1, Math.floor(c.sampleRate * seconds));
  const ir = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < ir.numberOfChannels; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return ir;
}

// Find a positive-going zero crossing near each end of the buffer and
// truncate to that range. Both endpoints land on the same sample sign
// and slope, so AudioBufferSourceNode.loop = true joins them without
// an audible click. Leaves musical content alone — only the bits at
// the very start/end (likely silence or near-zero amplitude) get cut.
function trimToZeroCrossings(c: AudioContext, buf: AudioBuffer): AudioBuffer {
  const sr = buf.sampleRate;
  // Search windows: how far in we'll look for a zero crossing. Capped
  // so we never trim more than ~8% off either end even if the audio
  // never crosses zero (e.g. heavy bass DC offset).
  const headSearch = Math.min(Math.floor(sr * 0.25), Math.floor(buf.length * 0.08));
  const tailSearch = headSearch;
  const ch0 = buf.getChannelData(0);

  let start = 0;
  for (let i = 0; i < headSearch; i++) {
    if (ch0[i] <= 0 && ch0[i + 1] > 0) { start = i + 1; break; }
  }
  let end = buf.length;
  for (let i = buf.length - 1; i > buf.length - tailSearch; i--) {
    if (ch0[i - 1] <= 0 && ch0[i] > 0) { end = i; break; }
  }
  if (end - start < buf.length / 2) {
    // Search failed (unusual signal) — keep the original. A click at
    // the seam beats halving the music.
    return buf;
  }

  const len = end - start;
  const trimmed = c.createBuffer(buf.numberOfChannels, len, sr);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    trimmed.getChannelData(ch).set(buf.getChannelData(ch).subarray(start, end));
  }
  return trimmed;
}

export const music = new MusicPlayer();
