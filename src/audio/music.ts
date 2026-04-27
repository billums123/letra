// Background music player. Each track is a 30-second instrumental clip
// generated up-front by `npm run music:generate` (ElevenLabs Music API)
// and cached at /public/audio/music/<id>.mp3.
//
// Why crossfade scheduling instead of AudioBufferSourceNode.loop?
//   The native loop flag plays the buffer end-to-start sample-accurately,
//   which is great when the audio actually loops (start sample == end
//   sample). The Music API doesn't guarantee that — clips can have
//   slight tails or different head/tail energies. Overlapping each
//   iteration with a short crossfade hides the seam regardless of
//   whether the model produced a perfectly loopable clip.

import { getMusicCtx } from "./audioCtx";

export type Track = {
  id: string;
  name: string;
  url: string;
};

// Crossfade window in seconds. Long enough to fully mask a discontinuity,
// short enough that the listener doesn't perceive overlap as muddiness.
const CROSSFADE_S = 0.6;
// How far ahead we keep the audio thread's queue stocked. The scheduler
// tick wakes up on a timer and ensures at least this many seconds of
// audio are scheduled past the current play head.
const SCHEDULE_AHEAD_S = 2.0;
const TICK_MS = 250;

type ActiveTrack = {
  track: Track;
  buffer: AudioBuffer;
  masterGain: GainNode;
  // Audio-context time at which the next iteration of the loop should
  // begin playing. Each scheduled iteration advances this by
  // (buffer.duration - CROSSFADE_S) so consecutive iterations overlap.
  nextStart: number;
};

class MusicPlayer {
  private active: ActiveTrack | null = null;
  private timer: number | null = null;
  // In-flight track URL — protects against the case where play() is
  // called twice in quick succession with different tracks; only the
  // most-recent call should actually take effect once decoding finishes.
  private loadingUrl: string | null = null;
  // AudioBuffer cache — we only ever decode each track once per session.
  private bufferCache = new Map<string, Promise<AudioBuffer | null>>();

  async play(track: Track, volume = 0.18): Promise<void> {
    if (this.active && this.active.track.id === track.id) {
      this.fadeTo(volume);
      return;
    }
    const c = getMusicCtx();
    if (!c) return;
    this.loadingUrl = track.url;
    const buffer = await this.loadBuffer(c, track.url);
    if (!buffer) return;
    // If a different track was requested while we were decoding, drop
    // this result on the floor. The newer call will win.
    if (this.loadingUrl !== track.url) return;
    this.stop();
    const master = c.createGain();
    master.gain.value = 0.0001;
    master.connect(c.destination);
    master.gain.exponentialRampToValueAtTime(Math.max(volume, 0.0002), c.currentTime + 0.5);
    this.active = {
      track,
      buffer,
      masterGain: master,
      nextStart: c.currentTime + 0.05,
    };
    // Prime the queue with one iteration up front so the first beat
    // doesn't wait for the next scheduler tick.
    this.scheduleAhead();
    if (this.timer === null) {
      this.timer = setInterval(() => this.scheduleAhead(), TICK_MS) as unknown as number;
    }
  }

  stop(): void {
    if (this.active) {
      const c = getMusicCtx();
      if (c) {
        const g = this.active.masterGain.gain;
        g.cancelScheduledValues(c.currentTime);
        g.setValueAtTime(g.value, c.currentTime);
        g.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.4);
        const toDisconnect = this.active.masterGain;
        // Disconnect after the fade so any still-scheduled buffer sources
        // play through silently rather than clicking off.
        setTimeout(() => toDisconnect.disconnect(), 600);
      }
      this.active = null;
    }
    this.loadingUrl = null;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  fadeTo(volume: number): void {
    const c = getMusicCtx();
    if (!c || !this.active) return;
    const g = this.active.masterGain.gain;
    g.cancelScheduledValues(c.currentTime);
    g.setValueAtTime(g.value, c.currentTime);
    g.exponentialRampToValueAtTime(Math.max(volume, 0.0002), c.currentTime + 0.4);
  }

  private async loadBuffer(c: AudioContext, url: string): Promise<AudioBuffer | null> {
    let promise = this.bufferCache.get(url);
    if (!promise) {
      promise = (async () => {
        try {
          const res = await fetch(url);
          if (!res.ok) return null;
          const arr = await res.arrayBuffer();
          return await c.decodeAudioData(arr);
        } catch {
          return null;
        }
      })();
      this.bufferCache.set(url, promise);
    }
    return promise;
  }

  private scheduleAhead(): void {
    const c = getMusicCtx();
    if (!c || !this.active) return;
    const horizon = c.currentTime + SCHEDULE_AHEAD_S;
    while (this.active.nextStart < horizon) {
      this.scheduleIteration(this.active.nextStart);
      const dur = this.active.buffer.duration;
      // Each iteration starts CROSSFADE_S before the previous one ends,
      // so the next iteration's fade-in covers this iteration's fade-out.
      this.active.nextStart += dur - CROSSFADE_S;
    }
  }

  private scheduleIteration(startAt: number): void {
    if (!this.active) return;
    const c = getMusicCtx();
    if (!c) return;
    const dur = this.active.buffer.duration;
    const src = c.createBufferSource();
    src.buffer = this.active.buffer;
    const g = c.createGain();
    // Linear crossfade. Equal-power (sin/cos) would preserve perceived
    // loudness more accurately during the overlap, but for instrumental
    // music with consistent energy the difference is inaudible and
    // linear is a single-line scheduler call.
    g.gain.setValueAtTime(0.0001, startAt);
    g.gain.linearRampToValueAtTime(1, startAt + CROSSFADE_S);
    g.gain.setValueAtTime(1, startAt + dur - CROSSFADE_S);
    g.gain.linearRampToValueAtTime(0.0001, startAt + dur);
    src.connect(g).connect(this.active.masterGain);
    src.start(startAt);
    src.stop(startAt + dur + 0.05);
  }
}

export const music = new MusicPlayer();
