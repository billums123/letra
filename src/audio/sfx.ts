// Procedural sound effects synthesised on the fly with WebAudio.
// Used for moments where we want a snappy "fun!" cue but don't need a
// recorded asset (and where the round-trip to fetch one would be
// noticeable).

import { getMusicCtx as getCtx } from "./audioCtx";

// Shared SFX gain bus. Every procedural cue (chimes, kid step, motor,
// thrust, fireworks, alien wave) routes through this single node so
// the parent settings panel can scale or mute the entire SFX layer
// in one place. The bus base gain is 0.85 (acts as a soft limiter so
// stacked bursts can't clip); the user-side volume slider multiplies
// that down to 0 on full mute.
const SFX_BUS_BASE = 0.85;
let sfxBus: GainNode | null = null;
let sfxUserVolume = 1;

function getSfxBus(c: AudioContext): GainNode {
  if (sfxBus) return sfxBus;
  sfxBus = c.createGain();
  sfxBus.gain.value = SFX_BUS_BASE * sfxUserVolume;
  sfxBus.connect(c.destination);
  return sfxBus;
}

// Set the global SFX volume factor (0..1). Persists across context
// re-creations because we re-apply on bus creation. Callers should
// pass 0 for a hard mute — the bus stops emitting on the next ramp.
export function setSfxGain(v: number): void {
  sfxUserVolume = Math.max(0, Math.min(1, v));
  if (!sfxBus) return;
  const c = getCtx();
  if (!c) return;
  const g = sfxBus.gain;
  const target = SFX_BUS_BASE * sfxUserVolume;
  g.cancelScheduledValues(c.currentTime);
  g.setValueAtTime(g.value, c.currentTime);
  g.linearRampToValueAtTime(Math.max(target, 0.0001), c.currentTime + 0.05);
}

// Output node for one cue, attenuated by how far away the thing that
// made the sound is. A fish plopping at the far edge of the map should
// not be as loud as one beside the boat, and from the sun it should
// not be audible at all. Distance is the caller's business — biomes
// know where their emitters are; this just applies the number.
function busAt(c: AudioContext, volume: number): AudioNode {
  const bus = getSfxBus(c);
  if (volume >= 0.999) return bus;
  const g = c.createGain();
  g.gain.value = volume;
  g.connect(bus);
  return g;
}

// Below this a cue is inaudible anyway, and building the graph for it
// is pure waste — a dozen fish and a lava fountain would otherwise
// keep allocating nodes for sounds nobody can hear.
const AUDIBLE = 0.03;

// ─── Recorded clip pools ─────────────────────────────────────────────
// Several cues sound better as a recorded ElevenLabs one-shot than as
// a synth, but they must never go silent if the asset is missing —
// before `npm run sfx:generate` has been run, on the very first play
// while the buffers are still decoding, or offline. makeClipPool owns
// the lazy fetch + decode and returns a `play` that reports whether it
// actually made a sound, so every caller can fall through to its
// procedural version.
//
// Pools pick a random clip per play and jitter the playback rate, so a
// kid triggering the same event twenty times in a row (they will)
// doesn't hear twenty identical files.
type ClipPool = { play(gain: number, jitter?: number): boolean; prime(): void };

const allPools: ClipPool[] = [];

function makeClipPool(urls: readonly string[]): ClipPool {
  // Index of the last take played, so a pool of several never repeats
  // itself back to back. Pure random does, often enough to notice when
  // a kid triggers the same cue twenty times in a row.
  let lastPicked = -1;
  // Fetching and decoding are deliberately separate steps. Fetching
  // needs no AudioContext, so it can start the moment a game mounts —
  // before the kid has done anything that would unlock audio. Decoding
  // needs a context, so it waits for one and then runs off the bytes
  // already in hand.
  const raw: (ArrayBuffer | null)[] = urls.map(() => null);
  const buffers: (AudioBuffer | null)[] = urls.map(() => null);
  let fetchStarted = false;
  const decoding = urls.map(() => false);

  function decodeOne(c: AudioContext, i: number): void {
    if (buffers[i] || decoding[i]) return;
    const bytes = raw[i];
    if (!bytes) return;
    decoding[i] = true;
    void (async () => {
      try {
        // decodeAudioData detaches the buffer it is given, so hand it a
        // copy — otherwise a context swap (iOS interruption) would find
        // raw emptied and could never re-decode.
        buffers[i] = await c.decodeAudioData(bytes.slice(0));
      } catch {
        /* swallow — the procedural fallback already covers this */
      } finally {
        decoding[i] = false;
      }
    })();
  }

  function ensureFetched(): void {
    if (fetchStarted) return;
    fetchStarted = true;
    urls.forEach((url, i) => {
      void (async () => {
        try {
          const res = await fetch(url);
          if (!res.ok) return;
          raw[i] = await res.arrayBuffer();
          // Decode the moment the bytes land. Kicking decoding off from
          // prime() instead would be too early — the fetch it just
          // started has not resolved, so there would be nothing to
          // decode and nothing would retry until the first play(), by
          // which point it is too late to be audible.
          const c = getCtx();
          if (c) decodeOne(c, i);
        } catch {
          /* swallow — the procedural fallback already covers this */
        }
      })();
    });
  }

  function ensureDecoded(c: AudioContext): void {
    for (let i = 0; i < urls.length; i++) decodeOne(c, i);
  }

  const pool: ClipPool = {
    // Start pulling the bytes down, and decode them if audio is already
    // live. Call this well before the sound is needed: the first play()
    // of an un-primed pool can only fall back to the synth, and for the
    // volcano that fallback is nearly all sub-bass — inaudible on a
    // tablet speaker, which reads as "the eruption made no sound".
    prime() {
      ensureFetched();
      const c = getCtx();
      if (c) ensureDecoded(c);
    },
    play(gain, jitter = 0.08) {
      const c = getCtx();
      if (!c) return false;
      ensureFetched();
      ensureDecoded(c);
      const ready: AudioBuffer[] = [];
      for (const b of buffers) if (b) ready.push(b);
      if (ready.length === 0) return false;
      let pick = (Math.random() * ready.length) | 0;
      if (ready.length > 1 && pick === lastPicked) pick = (pick + 1) % ready.length;
      lastPicked = pick;
      const src = c.createBufferSource();
      src.buffer = ready[pick];
      src.playbackRate.value = 1 - jitter + Math.random() * jitter * 2;
      const g = c.createGain();
      g.gain.value = gain;
      src.connect(g).connect(getSfxBus(c));
      src.start();
      return true;
    },
  };
  allPools.push(pool);
  return pool;
}

// Warm every recorded clip. Cheap (the whole SFX set is a couple of
// hundred KB) and idempotent, so games can call it on mount and again
// once audio unlocks without worrying about double work.
export function primeSfxClips(): void {
  for (const p of allPools) p.prime();
}

// Lightweight tone helper. `wave` defaults to triangle which sounds friendly
// (no harsh harmonics like sawtooth, no buzz like square).
function tone(
  freq: number,
  start: number,
  dur: number,
  gainPeak = 0.18,
  wave: OscillatorType = "triangle",
  detuneCents = 0
) {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = wave;
  osc.frequency.value = freq;
  osc.detune.value = detuneCents;
  const t0 = c.currentTime + start;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(gainPeak, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(getSfxBus(c));
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

// Glissando — a swept tone that rises (or falls) smoothly. Great for
// "magical sparkle" pickup feels.
function glide(
  startFreq: number,
  endFreq: number,
  start: number,
  dur: number,
  gainPeak = 0.15,
  wave: OscillatorType = "triangle"
) {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = wave;
  const t0 = c.currentTime + start;
  osc.frequency.setValueAtTime(startFreq, t0);
  osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(gainPeak, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(getSfxBus(c));
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

// Note frequencies (equal-tempered, A4=440)
const N = {
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.0, B5: 987.77,
  C6: 1046.5, D6: 1174.66, E6: 1318.51, G6: 1567.98,
};

// ─────────────────────────────────────────────────────────────────────────────
// Pickup variants. Each is short (≤500ms), distinct, and lands on a major
// scale so they always feel happy. We rotate through them randomly so a kid
// who picks up 5 letters in a row hears 5 different rewards.

function fxArpeggio() {
  // C major triad ascending
  tone(N.C5, 0, 0.32);
  tone(N.E5, 0.07, 0.34);
  tone(N.G5, 0.14, 0.5, 0.22);
}

function fxSparkle() {
  // Five quick high notes, like fairy dust
  const notes = [N.G5, N.B5, N.C6, N.E6, N.G6];
  notes.forEach((f, i) => tone(f, i * 0.05, 0.18, 0.13, "triangle"));
}

function fxBounce() {
  // Playful low-high-low-high bounce
  tone(N.C5, 0, 0.18, 0.18);
  tone(N.G5, 0.1, 0.22, 0.18);
  tone(N.E5, 0.22, 0.2, 0.16);
  tone(N.C6, 0.32, 0.32, 0.18);
}

function fxMagic() {
  // Rising glissando + shimmer overlay = "you got it!"
  glide(N.G4, N.E6, 0, 0.45, 0.16);
  tone(N.G6, 0.32, 0.3, 0.1, "sine");
  tone(N.E6, 0.36, 0.25, 0.08, "sine");
}

function fxCoin() {
  // Mario-coin homage: two crisp notes a fifth apart
  tone(N.B5, 0, 0.1, 0.22, "square");
  tone(N.E6, 0.08, 0.28, 0.18, "square");
}

function fxHooray() {
  // Major-7 stack with a held top note
  tone(N.C5, 0, 0.18);
  tone(N.E5, 0.06, 0.18);
  tone(N.G5, 0.12, 0.18);
  tone(N.B5, 0.18, 0.45, 0.2);
}

function fxBubble() {
  // Two ascending blips that wobble — like a happy bloop
  glide(N.C5, N.E5, 0, 0.16, 0.18, "sine");
  glide(N.E5, N.G5, 0.14, 0.18, 0.18, "sine");
  glide(N.G5, N.C6, 0.3, 0.22, 0.16, "sine");
}

function fxFanfare() {
  // Trumpet-fanfare-style 5-note flourish
  tone(N.G4, 0, 0.1, 0.18, "square");
  tone(N.G4, 0.1, 0.1, 0.18, "square");
  tone(N.C5, 0.22, 0.14, 0.2, "square");
  tone(N.E5, 0.36, 0.14, 0.2, "square");
  tone(N.G5, 0.5, 0.36, 0.22, "square");
}

const PICKUP_VARIANTS: Array<() => void> = [
  fxArpeggio,
  fxSparkle,
  fxBounce,
  fxMagic,
  fxCoin,
  fxHooray,
  fxBubble,
  fxFanfare,
];

// Recorded pickups, rotated. The eight procedural variants below stay
// as the fallback so a missing file never means a silent pickup.
const chimeClips = makeClipPool([
  "/audio/sfx/chime-1.mp3",
  "/audio/sfx/chime-2.mp3",
  "/audio/sfx/chime-3.mp3",
  "/audio/sfx/chime-4.mp3",
]);

let lastVariant = -1;

// Plays one of eight celebratory pickup sounds, cycling so the same one
// never repeats twice in a row. A 3-year-old loves variety on rewards.
export function playChime() {
  if (chimeClips.play(0.62)) return;
  let idx = Math.floor(Math.random() * PICKUP_VARIANTS.length);
  if (idx === lastVariant) idx = (idx + 1) % PICKUP_VARIANTS.length;
  lastVariant = idx;
  PICKUP_VARIANTS[idx]();
}

// ─── Kid footstep blip ───────────────────────────────────────────────────
// Short, low, soft pop the kid emits each time their bob peaks. Throttled
// internally so callers can poke it from a tight render loop without
// worrying about layering hundreds per second.
let lastStepAt = 0;
const kidStepClips = makeClipPool(["/audio/sfx/kid-step-1.mp3"]);

export function playKidStep() {
  // Wider pitch jitter than usual: it fires every footfall, and one
  // recording played dead straight turns a walk into a metronome.
  if (kidStepClips.play(0.34, 0.16)) return;
  const now = performance.now();
  if (now - lastStepAt < 220) return;
  lastStepAt = now;
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "sine";
  // Quick 180→120 Hz drop gives a "puh" pop that feels like a footstep.
  const t0 = c.currentTime;
  osc.frequency.setValueAtTime(180, t0);
  osc.frequency.exponentialRampToValueAtTime(120, t0 + 0.06);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.04, t0 + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);
  osc.connect(gain).connect(getSfxBus(c));
  osc.start(t0);
  osc.stop(t0 + 0.15);
}

// ─── Car motor loop ──────────────────────────────────────────────────────
// A continuous low rumble (sawtooth at ~50 Hz) layered with a higher
// "purr" buzz (~140 Hz triangle). The mix gain follows setActivity()
// from idle (very quiet rumble) to full revs (louder, brighter). Built
// as a singleton so repeated start() calls are no-ops; stop() tears it
// down so we don't leak oscillators across letter pickups.
type Motor = {
  start: () => void;
  stop: () => void;
  setActivity: (a: number) => void; // 0 = idle, 1 = full throttle
};

function makeMotor(): Motor {
  let nodes: {
    rumble: OscillatorNode;
    buzz: OscillatorNode;
    rumbleGain: GainNode;
    buzzGain: GainNode;
    master: GainNode;
  } | null = null;
  return {
    start() {
      if (nodes) return;
      const c = getCtx();
      if (!c) return;
      // Sine waves keep this warm and unobtrusive — sawtooth/triangle
      // versions had too many harmonics and grew tiring fast. Both
      // oscillators sit way below normal music levels so a kid
      // playing for 30 minutes doesn't develop motor fatigue.
      const rumble = c.createOscillator();
      rumble.type = "sine";
      rumble.frequency.value = 48;
      const rumbleGain = c.createGain();
      rumbleGain.gain.value = 0.006;
      rumble.connect(rumbleGain);

      const buzz = c.createOscillator();
      buzz.type = "sine";
      buzz.frequency.value = 96;
      const buzzGain = c.createGain();
      buzzGain.gain.value = 0.0015;
      buzz.connect(buzzGain);

      const master = c.createGain();
      master.gain.value = 0.35;
      rumbleGain.connect(master);
      buzzGain.connect(master);
      master.connect(getSfxBus(c));

      rumble.start();
      buzz.start();
      nodes = { rumble, buzz, rumbleGain, buzzGain, master };
    },
    stop() {
      if (!nodes) return;
      const { rumble, buzz, master } = nodes;
      const c = getCtx();
      if (!c) return;
      // Quick fade-out so stopping doesn't click.
      master.gain.cancelScheduledValues(c.currentTime);
      master.gain.setValueAtTime(master.gain.value, c.currentTime);
      master.gain.linearRampToValueAtTime(0.0001, c.currentTime + 0.08);
      rumble.stop(c.currentTime + 0.1);
      buzz.stop(c.currentTime + 0.1);
      nodes = null;
    },
    setActivity(a: number) {
      if (!nodes) return;
      const c = getCtx();
      if (!c) return;
      const clamped = Math.max(0, Math.min(1, a));
      // Ramp, don't set, to avoid clicks. Targets are deliberately
      // narrow so the motor reads as ambient rather than dynamic — kids
      // notice the difference between idle and moving without it ever
      // demanding attention.
      //   master: idle 0.35, full 0.75
      //   rumble freq: idle 48 Hz, full 60 Hz (small Δ feels alive)
      //   buzz freq:   idle 96 Hz, full 124 Hz
      const now = c.currentTime;
      nodes.master.gain.setTargetAtTime(0.35 + clamped * 0.40, now, 0.12);
      nodes.rumble.frequency.setTargetAtTime(48 + clamped * 12, now, 0.12);
      nodes.buzz.frequency.setTargetAtTime(96 + clamped * 28, now, 0.12);
    },
  };
}

export const motor = makeMotor();

// ─── Rocket thrust loop ───────────────────────────────────────────────
// Continuous filtered-noise "shhhhh" with a low rumble layered under
// it. Same start/stop/setActivity contract as motor so the avatar's
// update loop drives it the same way. Idle is a quiet ambient hiss;
// full activity adds rumble and brightens the noise.
type Thrust = {
  start: () => void;
  stop: () => void;
  setActivity: (a: number) => void;
};

function makeThrust(): Thrust {
  let nodes: {
    noise: AudioBufferSourceNode;
    rumble: OscillatorNode;
    noiseFilter: BiquadFilterNode;
    noiseGain: GainNode;
    rumbleGain: GainNode;
    master: GainNode;
  } | null = null;
  return {
    start() {
      if (nodes) return;
      const c = getCtx();
      if (!c) return;
      // Loop the cached noise buffer indefinitely for the hiss base.
      const noise = c.createBufferSource();
      noise.buffer = getNoiseBuffer(c);
      noise.loop = true;
      const noiseFilter = c.createBiquadFilter();
      noiseFilter.type = "bandpass";
      noiseFilter.frequency.value = 1100;
      noiseFilter.Q.value = 0.6;
      const noiseGain = c.createGain();
      noiseGain.gain.value = 0.04;
      noise.connect(noiseFilter).connect(noiseGain);

      // Sub-rumble underneath — the same pattern as the car motor but
      // tuned a little higher so the rocket doesn't sound like a
      // truck idling.
      const rumble = c.createOscillator();
      rumble.type = "sine";
      rumble.frequency.value = 60;
      const rumbleGain = c.createGain();
      rumbleGain.gain.value = 0.012;
      rumble.connect(rumbleGain);

      const master = c.createGain();
      master.gain.value = 0.4;
      noiseGain.connect(master);
      rumbleGain.connect(master);
      master.connect(getSfxBus(c));

      noise.start();
      rumble.start();
      nodes = { noise, rumble, noiseFilter, noiseGain, rumbleGain, master };
    },
    stop() {
      if (!nodes) return;
      const { noise, rumble, master } = nodes;
      const c = getCtx();
      if (!c) return;
      master.gain.cancelScheduledValues(c.currentTime);
      master.gain.setValueAtTime(master.gain.value, c.currentTime);
      master.gain.linearRampToValueAtTime(0.0001, c.currentTime + 0.1);
      noise.stop(c.currentTime + 0.12);
      rumble.stop(c.currentTime + 0.12);
      nodes = null;
    },
    setActivity(a: number) {
      if (!nodes) return;
      const c = getCtx();
      if (!c) return;
      const clamped = Math.max(0, Math.min(1, a));
      const now = c.currentTime;
      // Idle: quiet ambient hiss. Full: brighter, louder thrust with
      // more rumble underneath.
      nodes.master.gain.setTargetAtTime(0.4 + clamped * 0.45, now, 0.12);
      nodes.noiseFilter.frequency.setTargetAtTime(1100 + clamped * 1400, now, 0.12);
      nodes.rumble.frequency.setTargetAtTime(60 + clamped * 28, now, 0.12);
    },
  };
}

export const thrust = makeThrust();

// ─── Cartoony car flourishes ─────────────────────────────────────────────
// Sit on top of the steady motor loop so the car feels playful instead of
// monotone. Single cue: a quick double-blip "putt-putt" sprinkled at
// random while driving. Volume is deliberately tiny — it should add
// personality, not fight with letter audio playing in the same moment.

export function playCarPutt() {
  const c = getCtx();
  if (!c) return;
  // Two short low pops a 3rd apart — cartoony "putt-putt" feel. Short
  // duration + soft gain = the sound of a friendly engine, not a real one.
  tone(150, 0, 0.06, 0.06, "triangle");
  tone(180, 0.09, 0.06, 0.06, "triangle");
}

// ─── Aerial-firework SFX ──────────────────────────────────────────────
// Tonal synth always reads as a chime — for a real aerial firework you
// need (1) a brief mortar thump + ascending shell whistle on launch,
// and (2) a wide deep low-frequency KABOOM with body and a soft
// reverb tail on the burst. Sparkle crackle is kept but pushed below
// the boom so it reads as a tail, not as the whole sound.

// Cached white-noise AudioBuffer — generated once per AudioContext.
let noiseBuffer: AudioBuffer | null = null;
function getNoiseBuffer(c: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === c.sampleRate) return noiseBuffer;
  const length = c.sampleRate * 2;
  const buf = c.createBuffer(1, length, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buf;
  return buf;
}

function startNoise(c: AudioContext, startTime: number, stopTime: number): AudioBufferSourceNode {
  const src = c.createBufferSource();
  src.buffer = getNoiseBuffer(c);
  // Random read offset so consecutive bursts don't share noise patterns.
  const offset = Math.random() * (src.buffer!.duration * 0.5);
  src.start(startTime, offset);
  src.stop(stopTime);
  return src;
}

// Fireworks/aliens used to own a private master bus to soft-limit
// stacked bursts. Now everything routes through the global SFX bus
// (defined at the top of this file) so a single user-side volume +
// mute control reaches every procedural cue, not just the fireworks.
const getFxBus = getSfxBus;

// Aerial mortar launch. Two phases:
//   1) Brief THOOMP at t0 — sub-bass sine drop + short bandpassed
//      noise puff (the sound of the shell leaving the tube).
//   2) Rising shell whistle from t0+0.05 — two detuned sine sweeps
//      from ~600 Hz up through ~3 kHz over ~0.55s, the classic
//      "shell ascending" whistle.
export function playFireworkLaunch() {
  const c = getCtx();
  if (!c) return;
  const dest = getFxBus(c);
  const t0 = c.currentTime;

  // 1a — sub-bass mortar thump
  {
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(85, t0);
    osc.frequency.exponentialRampToValueAtTime(38, t0 + 0.1);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13);
    osc.connect(g).connect(dest);
    osc.start(t0);
    osc.stop(t0 + 0.16);
  }
  // 1b — short noise puff (the actual mortar tube exhaust)
  {
    const n = startNoise(c, t0, t0 + 0.15);
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 550;
    bp.Q.value = 1.2;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13);
    n.connect(bp).connect(g).connect(dest);
  }

  // 2 — rising shell whistle. Two slightly-detuned sine oscillators
  // give the whistle a fuller, warmer tone than a single sine; the
  // exponential pitch sweep up through the audible range reads as
  // motion away from the listener.
  {
    const whistleStart = t0 + 0.05;
    const whistleEnd = t0 + 0.6;
    const osc1 = c.createOscillator();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(620, whistleStart);
    osc1.frequency.exponentialRampToValueAtTime(2900, whistleEnd);
    const osc2 = c.createOscillator();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(940, whistleStart);
    osc2.frequency.exponentialRampToValueAtTime(4400, whistleEnd);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, whistleStart);
    g.gain.exponentialRampToValueAtTime(0.09, whistleStart + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, whistleEnd);
    osc1.connect(g);
    osc2.connect(g);
    g.connect(dest);
    osc1.start(whistleStart);
    osc1.stop(whistleEnd + 0.05);
    osc2.start(whistleStart);
    osc2.stop(whistleEnd + 0.05);
  }
}

// Pre-recorded burst clips (ElevenLabs).
const burstClips = makeClipPool([
  "/audio/sfx/firework-burst-1.mp3",
  "/audio/sfx/firework-burst-2.ogg",
  "/audio/sfx/firework-burst-3.ogg",
]);

// Aerial burst — uses the pre-recorded ElevenLabs clips when their
// buffers have finished decoding; otherwise renders the procedural
// KABOOM synth (sub-bass thump + lowpass body + mid attack + delay
// tail + sparkle crackle) as a fallback.
export function playFireworkBurst() {
  const c = getCtx();
  if (!c) return;
  if (burstClips.play(0.85)) return;
  playProceduralBurst(c, getFxBus(c));
}

// Procedural KABOOM synth. Used as the fallback when the recorded
// buffers haven't finished decoding yet. Layer plan:
//   1) Sub-bass sine drop (50→25 Hz) — the gut-punch "thump" you feel
//   2) Heavily low-passed noise (180→70 Hz) — the body of the boom
//   3) Mid-band (~350 Hz) noise smack — the bright "BOOM" attack
//   4) Reverberant tail via feedback delay — open-sky echo
//   5) Subtle sparkle crackle — fewer, quieter pops, only after the
//      boom has had room to land
function playProceduralBurst(c: AudioContext, dest: AudioNode) {
  const t0 = c.currentTime;

  // 1 — sub-bass body
  {
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(55, t0);
    osc.frequency.exponentialRampToValueAtTime(25, t0 + 0.55);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.7, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.7);
    osc.connect(g).connect(dest);
    osc.start(t0);
    osc.stop(t0 + 0.75);
  }

  // 2 — low-passed boom noise (the rumbling body)
  {
    const n = startNoise(c, t0, t0 + 0.85);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(180, t0);
    lp.frequency.exponentialRampToValueAtTime(70, t0 + 0.6);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.55, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.8);
    n.connect(lp).connect(g).connect(dest);
  }

  // 3 — mid-band attack snap (the "BOOM!" front edge)
  {
    const n = startNoise(c, t0, t0 + 0.4);
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(380, t0);
    bp.frequency.exponentialRampToValueAtTime(180, t0 + 0.35);
    bp.Q.value = 0.7;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.32, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.36);
    n.connect(bp).connect(g).connect(dest);
  }

  // 4 — feedback-delay tail. A quieter, lowpassed copy of the boom
  // body fed through a 180ms delay loop with diminishing feedback
  // gives the burst that "open sky" reverberance without needing
  // a real convolver impulse.
  {
    const n = startNoise(c, t0, t0 + 0.6);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 300;
    const send = c.createGain();
    send.gain.setValueAtTime(0.0001, t0);
    send.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
    send.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
    const delay = c.createDelay(0.6);
    delay.delayTime.value = 0.18;
    const fb = c.createGain();
    fb.gain.value = 0.42;
    n.connect(lp).connect(send);
    // Direct path is omitted — we only want the wet (echoed) signal.
    send.connect(delay);
    delay.connect(fb);
    fb.connect(delay);
    fb.connect(dest);
  }

  // 5 — sparkle crackle, but pushed back so it reads as a tail behind
  // the boom rather than a wall of static. Half the previous count and
  // each pop quieter; window starts after the boom's peak so the
  // listener registers the KABOOM first.
  for (let i = 0; i < 11; i++) {
    const at = t0 + 0.18 + Math.random() * 0.9;
    const dur = 0.04 + Math.random() * 0.05;
    const n = startNoise(c, at, at + dur + 0.02);
    const hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2400 + Math.random() * 2200;
    hp.Q.value = 1.1;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.05 + Math.random() * 0.03, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    n.connect(hp).connect(g).connect(dest);
  }
}

// ─── Alien wave ──────────────────────────────────────────────────────
// Cute chirpy "hi!" sound when a moon-biome alien waves at the player.
// Plays one of the user-supplied clips at /audio/sfx/alien-{1..4} with
// a random pick + pitch jitter so consecutive contacts don't feel
// mechanical. Falls back to a procedural triangle-wave chirp if the
// clips haven't loaded yet.
const alienWaveClips = makeClipPool([
  "/audio/sfx/alien-1.mp3",
  "/audio/sfx/alien-2.mp3",
  "/audio/sfx/alien-3.mp3",
  "/audio/sfx/alien-4.mp3",
]);

export function playAlienWave() {
  const c = getCtx();
  if (!c) return;
  if (alienWaveClips.play(0.7)) return;
  playProceduralAlienWave(c, getFxBus(c));
}

// Procedural fallback — 2-3 short triangle chirps with playful pitch
// sweeps. Reads as a cute synth-creature noise, friendlier than any
// tonal arpeggio. Each call randomizes the base freq + sweep
// directions so consecutive aliens don't sound identical.
function playProceduralAlienWave(c: AudioContext, dest: AudioNode) {
  const t0 = c.currentTime;
  const baseFreq = 500 + Math.random() * 300;
  const noteCount = 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < noteCount; i++) {
    const start = t0 + i * 0.13;
    const dur = 0.14 + Math.random() * 0.08;
    const f1 = baseFreq * (0.7 + Math.random() * 0.7);
    const f2 = f1 * (0.85 + Math.random() * 0.55);
    const osc = c.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(f1, start);
    osc.frequency.exponentialRampToValueAtTime(f2, start + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(0.14, start + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g).connect(dest);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }
}

// Bigger flourish for end-of-word / end-of-round. Octave jump at the end.
const wooClips = makeClipPool([
  "/audio/sfx/woo-1.mp3",
  "/audio/sfx/woo-2.mp3",
  "/audio/sfx/woo-3.mp3",
]);

export function playWoo() {
  if (wooClips.play(0.8)) return;
  tone(N.G4, 0, 0.16);
  tone(N.C5, 0.1, 0.16);
  tone(N.E5, 0.2, 0.16);
  tone(N.G5, 0.3, 0.16);
  tone(N.C6, 0.4, 0.4, 0.22);
  // sparkle tail
  tone(N.E6, 0.5, 0.3, 0.12, "sine");
  tone(N.G6, 0.55, 0.35, 0.1, "sine");
}

// ─── Volcano cues (ocean + jungle biomes) ────────────────────────────────
// Three-part eruption soundscape: a building rumble while the ground
// shakes, a KABOOM + rising whoosh at launch, and small lava pops as
// bombs rain down. The rumble and the boom prefer recorded ElevenLabs
// clips (see scripts/generate-sfx.ts) and fall back to the procedural
// synths below; the lava pops stay procedural because they fire in
// rapid bursts and want zero latency.
const volcanoRumbleClips = makeClipPool(["/audio/sfx/volcano-rumble.mp3"]);
const volcanoBoomClips = makeClipPool([
  "/audio/sfx/volcano-boom-1.mp3",
  "/audio/sfx/volcano-boom-3.mp3",
  "/audio/sfx/volcano-boom-4.mp3",
]);
// Held back for the mega launch, so the eruption that throws the kid
// into space doesn't sound like the everyday one.
const volcanoMegaBoomClips = makeClipPool(["/audio/sfx/volcano-boom-2.mp3"]);

// Low ground-shake rumble that swells over ~0.9s. Played the moment
// the kid drives into the crater, underneath the visual shake, so the
// boom that follows feels earned rather than instant.
// ─── The sun ─────────────────────────────────────────────────────────
// Two cues for the trip off-world. Both are recorded, both fall back
// to a synth so the moment is never silent on a cold cache.

const portalDiveClips = makeClipPool([
  "/audio/sfx/portal-dive-1.mp3",
  "/audio/sfx/portal-dive-2.mp3",
]);

// Driving into a pool of ocean set in the surface of a star. A gulp of
// water, then the drop.
export function playPortalDive(volume = 1) {
  if (volume < AUDIBLE) return;
  const c = getCtx();
  if (!c) return;
  if (portalDiveClips.play(0.85 * volume, 0.06)) return;
  const dest = busAt(c, volume);
  const t0 = c.currentTime;
  // Swallow: bright noise falling away fast, like water closing over.
  {
    const n = startNoise(c, t0, t0 + 0.7);
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(2200, t0);
    bp.frequency.exponentialRampToValueAtTime(280, t0 + 0.6);
    bp.Q.value = 1.1;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.34, t0 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.68);
    n.connect(bp).connect(g).connect(dest);
  }
  // Drop: a tone sliding down two octaves, which is the "falling
  // through" half of it.
  {
    const osc = c.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(520, t0 + 0.04);
    osc.frequency.exponentialRampToValueAtTime(130, t0 + 0.72);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0 + 0.04);
    g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.78);
    osc.connect(g).connect(dest);
    osc.start(t0 + 0.04);
    osc.stop(t0 + 0.82);
  }
}

const sunTouchdownClips = makeClipPool([
  "/audio/sfx/sun-touchdown-1.mp3",
  "/audio/sfx/sun-touchdown-2.mp3",
]);

// Setting down on the star: a soft thump and the roar of it swelling
// up around you.
export function playSunTouchdown(volume = 1) {
  if (volume < AUDIBLE) return;
  const c = getCtx();
  if (!c) return;
  if (sunTouchdownClips.play(0.8 * volume, 0.05)) return;
  const dest = busAt(c, volume);
  const t0 = c.currentTime;
  {
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, t0);
    osc.frequency.exponentialRampToValueAtTime(52, t0 + 0.4);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
    osc.connect(g).connect(dest);
    osc.start(t0);
    osc.stop(t0 + 0.55);
  }
  {
    // The roar: broad noise swelling in behind the thump and hanging.
    const n = startNoise(c, t0, t0 + 1.6);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(320, t0);
    lp.frequency.exponentialRampToValueAtTime(900, t0 + 0.9);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.55);
    n.connect(lp).connect(g).connect(dest);
  }
}

export function playVolcanoRumble(volume = 1) {
  if (volume < AUDIBLE) return;
  const c = getCtx();
  if (!c) return;
  // Barely any jitter — the rumble is timed against the eruption state
  // machine, so stretching it would drift off the boom.
  if (volcanoRumbleClips.play(0.9 * volume, 0.03)) return;
  const dest = busAt(c, volume);
  const t0 = c.currentTime;
  // Deep noise bed, low-passed hard and swelling in.
  {
    const n = startNoise(c, t0, t0 + 1.1);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(90, t0);
    lp.frequency.exponentialRampToValueAtTime(220, t0 + 0.9);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.1);
    n.connect(lp).connect(g).connect(dest);
  }
  // Sub-bass wobble underneath — an LFO-like slow pitch wiggle reads
  // as the mountain itself groaning.
  {
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(42, t0);
    osc.frequency.linearRampToValueAtTime(58, t0 + 0.45);
    osc.frequency.linearRampToValueAtTime(38, t0 + 0.9);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.4, t0 + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.05);
    osc.connect(g).connect(dest);
    osc.start(t0);
    osc.stop(t0 + 1.1);
  }
}

// The eruption itself: sub-bass KABOOM + low noise body + a rising
// two-oscillator whoosh that tracks the avatar sailing skyward.
export function playVolcanoBoom(mega = false, volume = 1) {
  if (volume < AUDIBLE) return;
  const c = getCtx();
  if (!c) return;
  const pool = mega ? volcanoMegaBoomClips : volcanoBoomClips;
  if (pool.play((mega ? 1 : 0.95) * volume)) return;
  const dest = busAt(c, volume);
  const t0 = c.currentTime;
  // 1 — sub-bass punch
  {
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(60, t0);
    osc.frequency.exponentialRampToValueAtTime(26, t0 + 0.5);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.75, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.65);
    osc.connect(g).connect(dest);
    osc.start(t0);
    osc.stop(t0 + 0.7);
  }
  // 2 — boom body (low-passed noise)
  {
    const n = startNoise(c, t0, t0 + 0.9);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(200, t0);
    lp.frequency.exponentialRampToValueAtTime(75, t0 + 0.6);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.6, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.85);
    n.connect(lp).connect(g).connect(dest);
  }
  // 3 — rising launch whoosh: detuned sine pair sweeping up, like the
  // firework shell whistle but bigger and slower to match the arc.
  {
    const s = t0 + 0.06;
    const e = t0 + 0.9;
    const osc1 = c.createOscillator();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(300, s);
    osc1.frequency.exponentialRampToValueAtTime(1900, e);
    const osc2 = c.createOscillator();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(450, s);
    osc2.frequency.exponentialRampToValueAtTime(2800, e);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(0.12, s + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, e);
    osc1.connect(g);
    osc2.connect(g);
    g.connect(dest);
    osc1.start(s);
    osc1.stop(e + 0.05);
    osc2.start(s);
    osc2.stop(e + 0.05);
  }
}

// Lava hitting the sea. A plain water plop is wrong for this — the
// moment is molten rock quenching, so it wants a steam flash and
// crackle over the splash. Shares the small-splash throttle window so
// a bomb fountain can't stack these into a wash.
const lavaHissClips = makeClipPool([
  "/audio/sfx/lava-hiss-1.mp3",
  "/audio/sfx/lava-hiss-2.mp3",
  "/audio/sfx/lava-hiss-3.mp3",
]);

export function playLavaSplash(volume = 1) {
  if (volume < AUDIBLE) return;
  const now = performance.now();
  if (now - lastSmallSplashAt < 110) return;
  lastSmallSplashAt = now;
  const c = getCtx();
  if (!c) return;
  if (lavaHissClips.play(0.5 * volume, 0.1)) return;
  // Procedural fallback — a wet plop with a steam hiss layered over it.
  const dest = busAt(c, volume);
  const t0 = c.currentTime;
  {
    const osc = c.createOscillator();
    osc.type = "sine";
    const f = 300 + Math.random() * 160;
    osc.frequency.setValueAtTime(f, t0);
    osc.frequency.exponentialRampToValueAtTime(f * 0.4, t0 + 0.16);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.13, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
    osc.connect(g).connect(dest);
    osc.start(t0);
    osc.stop(t0 + 0.24);
  }
  {
    // The steam: bright noise that swells a beat after the plop and
    // decays slowly, high-passed so it sits above the splash.
    const n = startNoise(c, t0 + 0.02, t0 + 0.75);
    const hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.setValueAtTime(2200, t0);
    hp.frequency.exponentialRampToValueAtTime(5200, t0 + 0.6);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.11, t0 + 0.09);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.7);
    n.connect(hp).connect(g).connect(dest);
  }
}

// Small "bloop" pop for a lava bomb hitting the ground. Throttled hard
// because a fountain drops many bombs in a burst and we want texture,
// not a drum roll.
const lavaPopClips = makeClipPool([
  "/audio/sfx/lava-pop-1.mp3",
  "/audio/sfx/lava-pop-2.mp3",
]);
let lastLavaPopAt = 0;
export function playLavaPop(volume = 1) {
  if (volume < AUDIBLE) return;
  const now = performance.now();
  if (now - lastLavaPopAt < 120) return;
  lastLavaPopAt = now;
  const c = getCtx();
  if (!c) return;
  if (lavaPopClips.play(0.5 * volume)) return;
  const dest = busAt(c, volume);
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  osc.type = "sine";
  const base = 200 + Math.random() * 120;
  osc.frequency.setValueAtTime(base, t0);
  osc.frequency.exponentialRampToValueAtTime(base * 0.45, t0 + 0.12);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
  osc.connect(g).connect(dest);
  osc.start(t0);
  osc.stop(t0 + 0.18);
  // Tiny sizzle layer on some pops so the field of splats varies.
  if (Math.random() < 0.4) {
    const n = startNoise(c, t0, t0 + 0.1);
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1400 + Math.random() * 800;
    bp.Q.value = 1.5;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.0001, t0);
    ng.gain.exponentialRampToValueAtTime(0.06, t0 + 0.01);
    ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);
    n.connect(bp).connect(ng).connect(dest);
  }
}

// Water splash — the boat (or a launched avatar) plunging into the
// sea. Prefers one of the recorded splashes; the procedural fallback
// is a noise burst through a falling lowpass + a quick "bloop" pitch
// drop underneath, then a lighter secondary patter for the droplets.
const splashClips = makeClipPool([
  "/audio/sfx/splash-1.mp3",
  "/audio/sfx/splash-2.mp3",
  "/audio/sfx/splash-3.mp3",
]);

// The little cousin: fish breaking the surface, lava bombs hitting the
// sea — small water events that fire every few seconds. Deliberately
// quiet and throttled; the big splash above is a payoff sound and
// would trample the music if it played this often.
const smallSplashClips = makeClipPool([
  "/audio/sfx/splash-small-1.mp3",
  "/audio/sfx/splash-small-2.mp3",
  "/audio/sfx/splash-small-3.mp3",
]);
let lastSmallSplashAt = 0;

export function playSmallSplash(volume = 1) {
  if (volume < AUDIBLE) return;
  const now = performance.now();
  // Six fish plus a bomb fountain can all land in the same handful of
  // frames; without this they stack into a wash.
  if (now - lastSmallSplashAt < 110) return;
  lastSmallSplashAt = now;
  const c = getCtx();
  if (!c) return;
  if (smallSplashClips.play(0.26 * volume, 0.12)) return;
  // Procedural fallback — one short noise chirp through a falling
  // bandpass plus a tiny bloop. A miniature of playSplash below.
  const dest = busAt(c, volume);
  const t0 = c.currentTime;
  {
    const n = startNoise(c, t0, t0 + 0.22);
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(1800 + Math.random() * 700, t0);
    bp.frequency.exponentialRampToValueAtTime(600, t0 + 0.18);
    bp.Q.value = 0.9;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.1, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
    n.connect(bp).connect(g).connect(dest);
  }
  {
    const osc = c.createOscillator();
    osc.type = "sine";
    const f = 420 + Math.random() * 220;
    osc.frequency.setValueAtTime(f, t0);
    osc.frequency.exponentialRampToValueAtTime(f * 0.45, t0 + 0.13);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.07, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
    osc.connect(g).connect(dest);
    osc.start(t0);
    osc.stop(t0 + 0.2);
  }
}

export function playSplash(volume = 1) {
  if (volume < AUDIBLE) return;
  const c = getCtx();
  if (!c) return;
  if (splashClips.play(0.9 * volume)) return;
  const dest = busAt(c, volume);
  const t0 = c.currentTime;
  // Main splash body — bandpassed noise sweeping downward.
  {
    const n = startNoise(c, t0, t0 + 0.55);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(2600, t0);
    lp.frequency.exponentialRampToValueAtTime(500, t0 + 0.45);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.45, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
    n.connect(lp).connect(g).connect(dest);
  }
  // Bloop underneath — sine dropping an octave.
  {
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(320, t0);
    osc.frequency.exponentialRampToValueAtTime(120, t0 + 0.22);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.3, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
    osc.connect(g).connect(dest);
    osc.start(t0);
    osc.stop(t0 + 0.32);
  }
  // Droplet patter — a few tiny delayed high blips.
  for (let i = 0; i < 4; i++) {
    const at = t0 + 0.12 + i * 0.06 + Math.random() * 0.04;
    const osc = c.createOscillator();
    osc.type = "sine";
    const f = 900 + Math.random() * 900;
    osc.frequency.setValueAtTime(f, at);
    osc.frequency.exponentialRampToValueAtTime(f * 0.6, at + 0.08);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.07, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
    osc.connect(g).connect(dest);
    osc.start(at);
    osc.stop(at + 0.12);
  }
}
