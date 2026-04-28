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
  // interruption (lock screen, app switch, scroll suspend).
  private intendedTrack: Track | null = null;
  private intendedVolume = 0.18;
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

  async play(track: Track, volume = 0.18): Promise<void> {
    this.wireResumeHandlers();
    this.intendedTrack = track;
    this.intendedVolume = volume;
    if (this.active && this.active.track.id === track.id && !this.interrupted) {
      this.fadeTo(volume);
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
    master.connect(c.destination);
    master.gain.linearRampToValueAtTime(volume, startAt + 0.04);
    const source = c.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(master);
    source.start(startAt);
    this.active = { track, source, masterGain: master };
  }

  stop(): void {
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

  fadeTo(volume: number): void {
    const c = getMusicCtx();
    if (!c || !this.active) return;
    const g = this.active.masterGain.gain;
    g.cancelScheduledValues(c.currentTime);
    g.setValueAtTime(g.value, c.currentTime);
    g.linearRampToValueAtTime(Math.max(volume, 0.0001), c.currentTime + 0.2);
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
