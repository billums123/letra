// Procedural sound effects synthesised on the fly with WebAudio.
// Used for moments where we want a snappy "fun!" cue but don't need a
// recorded asset (and where the round-trip to fetch one would be
// noticeable).

import { getMusicCtx as getCtx } from "./audioCtx";

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
  osc.connect(gain).connect(c.destination);
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
  osc.connect(gain).connect(c.destination);
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

let lastVariant = -1;

// Plays one of eight celebratory pickup sounds, cycling so the same one
// never repeats twice in a row. A 3-year-old loves variety on rewards.
export function playChime() {
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
export function playKidStep() {
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
  osc.connect(gain).connect(c.destination);
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
      master.connect(c.destination);

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
      master.connect(c.destination);

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

// Master gain limiter for fireworks — one shared gain bus capped at
// 0.85 so simultaneous launches/bursts can't pile up into clipping.
let fxBus: GainNode | null = null;
function getFxBus(c: AudioContext): GainNode {
  if (fxBus) return fxBus;
  fxBus = c.createGain();
  fxBus.gain.value = 0.85;
  fxBus.connect(c.destination);
  return fxBus;
}

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

// Pre-recorded burst clips (ElevenLabs). We rotate through them at
// random so consecutive fireworks don't all sound identical. The
// fetch + decode is lazy and async — the very first burst before the
// buffers finish loading falls through to the procedural synth so
// there's never silence.
const BURST_CLIP_URLS = [
  "/audio/sfx/firework-burst-1.mp3",
  "/audio/sfx/firework-burst-2.ogg",
  "/audio/sfx/firework-burst-3.ogg",
];
const burstBuffers: (AudioBuffer | null)[] = BURST_CLIP_URLS.map(() => null);
let burstLoadStarted = false;
function ensureBurstBuffers(c: AudioContext) {
  if (burstLoadStarted) return;
  burstLoadStarted = true;
  for (let i = 0; i < BURST_CLIP_URLS.length; i++) {
    void (async () => {
      try {
        const res = await fetch(BURST_CLIP_URLS[i]);
        if (!res.ok) return;
        const arr = await res.arrayBuffer();
        burstBuffers[i] = await c.decodeAudioData(arr);
      } catch {
        /* swallow — procedural fallback already covers this case */
      }
    })();
  }
}

// Aerial burst — uses the pre-recorded ElevenLabs clips when their
// buffers have finished decoding; otherwise renders the procedural
// KABOOM synth (sub-bass thump + lowpass body + mid attack + delay
// tail + sparkle crackle) as a fallback.
export function playFireworkBurst() {
  const c = getCtx();
  if (!c) return;
  const dest = getFxBus(c);
  ensureBurstBuffers(c);
  const ready: AudioBuffer[] = [];
  for (const b of burstBuffers) if (b) ready.push(b);
  if (ready.length > 0) {
    const buf = ready[(Math.random() * ready.length) | 0];
    const src = c.createBufferSource();
    src.buffer = buf;
    // Slight pitch jitter (±2 semitones) keeps consecutive plays of
    // the same clip from sounding mechanically identical.
    src.playbackRate.value = 0.92 + Math.random() * 0.16;
    const g = c.createGain();
    g.gain.value = 0.85;
    src.connect(g).connect(dest);
    src.start();
    return;
  }
  playProceduralBurst(c, dest);
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
// Prefers pre-recorded MP3 / OGG clips at /audio/sfx/alien-wave-{1..5}
// (random rotation + pitch jitter). Falls back to a procedural triangle-
// wave chirp synth when no clips are loaded yet — covers the case where
// the ElevenLabs Sound Effects permission isn't enabled and we haven't
// dropped in user-supplied recordings.
const ALIEN_WAVE_URLS = [
  "/audio/sfx/alien-wave-1.mp3",
  "/audio/sfx/alien-wave-2.mp3",
  "/audio/sfx/alien-wave-3.mp3",
  "/audio/sfx/alien-wave-4.mp3",
  "/audio/sfx/alien-wave-5.mp3",
];
const alienWaveBuffers: (AudioBuffer | null)[] = ALIEN_WAVE_URLS.map(() => null);
let alienWaveLoadStarted = false;
function ensureAlienWaveBuffers(c: AudioContext) {
  if (alienWaveLoadStarted) return;
  alienWaveLoadStarted = true;
  for (let i = 0; i < ALIEN_WAVE_URLS.length; i++) {
    void (async () => {
      try {
        const res = await fetch(ALIEN_WAVE_URLS[i]);
        if (!res.ok) return;
        const arr = await res.arrayBuffer();
        alienWaveBuffers[i] = await c.decodeAudioData(arr);
      } catch {
        /* swallow — procedural fallback already covers this case */
      }
    })();
  }
}

export function playAlienWave() {
  const c = getCtx();
  if (!c) return;
  const dest = getFxBus(c);
  ensureAlienWaveBuffers(c);
  const ready: AudioBuffer[] = [];
  for (const b of alienWaveBuffers) if (b) ready.push(b);
  if (ready.length > 0) {
    const buf = ready[(Math.random() * ready.length) | 0];
    const src = c.createBufferSource();
    src.buffer = buf;
    // Pitch jitter so consecutive plays of the same clip don't feel
    // mechanically identical (±2 semitones).
    src.playbackRate.value = 0.92 + Math.random() * 0.16;
    const g = c.createGain();
    g.gain.value = 0.7;
    src.connect(g).connect(dest);
    src.start();
    return;
  }
  playProceduralAlienWave(c, dest);
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
export function playWoo() {
  tone(N.G4, 0, 0.16);
  tone(N.C5, 0.1, 0.16);
  tone(N.E5, 0.2, 0.16);
  tone(N.G5, 0.3, 0.16);
  tone(N.C6, 0.4, 0.4, 0.22);
  // sparkle tail
  tone(N.E6, 0.5, 0.3, 0.12, "sine");
  tone(N.G6, 0.55, 0.35, 0.1, "sine");
}
