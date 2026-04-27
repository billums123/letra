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

import { getMusicCtx } from "./audioCtx";

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
    if (this.loadingUrl !== track.url) return;
    this.stop();
    const master = c.createGain();
    master.gain.value = 0.0001;
    master.connect(c.destination);
    master.gain.exponentialRampToValueAtTime(Math.max(volume, 0.0002), c.currentTime + 0.5);
    const source = c.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(master);
    source.start(c.currentTime + 0.05);
    this.active = { track, source, masterGain: master };
  }

  stop(): void {
    if (this.active) {
      const c = getMusicCtx();
      if (c) {
        const g = this.active.masterGain.gain;
        g.cancelScheduledValues(c.currentTime);
        g.setValueAtTime(g.value, c.currentTime);
        g.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.4);
        const src = this.active.source;
        const node = this.active.masterGain;
        // Stop the buffer source after the fade so we don't click off,
        // then disconnect to free the graph.
        setTimeout(() => {
          try { src.stop(); } catch { /* may already be stopped */ }
          node.disconnect();
        }, 600);
      }
      this.active = null;
    }
    this.loadingUrl = null;
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
