// Procedural sound effects synthesised on the fly with WebAudio.
// Used for moments where we want a snappy "fun!" cue but don't need a
// recorded asset (and where the round-trip to fetch one would be
// noticeable).

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
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

// ─── Cartoony car flourishes ─────────────────────────────────────────────
// Sit on top of the steady motor loop so the car feels playful instead of
// monotone. Two cues:
//   • playCarVroom — short rising sweep, fired on idle→moving transitions
//   • playCarPutt  — quick double-blip, fired at random while driving
// Volumes are deliberately tiny — they should add personality, not fight
// with letter audio playing in the same moment.

export function playCarVroom() {
  const c = getCtx();
  if (!c) return;
  // Two-octave rising sweep with a low fundamental — reads as "starting
  // up" without sounding mechanical or scary.
  glide(120, 320, 0, 0.32, 0.10, "triangle");
  glide(240, 540, 0.04, 0.28, 0.06, "sine");
}

export function playCarPutt() {
  const c = getCtx();
  if (!c) return;
  // Two short low pops a 3rd apart — cartoony "putt-putt" feel. Short
  // duration + soft gain = the sound of a friendly engine, not a real one.
  tone(150, 0, 0.06, 0.06, "triangle");
  tone(180, 0.09, 0.06, 0.06, "triangle");
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
