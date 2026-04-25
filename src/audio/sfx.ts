// Procedural sound effects synthesised on the fly with WebAudio.
// Used for moments where we want a snappy "fun!" cue but don't need a
// recorded asset (and where the round-trip to fetch one would be
// noticeable). Currently:
//   - playChime() — happy two-note bell on letter pickup
//   - playWoo() — bigger triple-note flourish on round/word completion

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  // Browsers suspend the context until a user gesture; resume() is a no-op
  // if we're already running.
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(freq: number, start: number, dur: number, gainPeak = 0.18) {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "triangle";
  osc.frequency.value = freq;
  const t0 = c.currentTime + start;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(gainPeak, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

// Quick three-note chime (C5 → E5 → G5) — major arpeggio reads as "yes!"
export function playChime() {
  const C5 = 523.25;
  const E5 = 659.25;
  const G5 = 783.99;
  tone(C5, 0, 0.32);
  tone(E5, 0.07, 0.34);
  tone(G5, 0.14, 0.5, 0.22);
}

// Bigger flourish for end-of-word / end-of-round. Octave jump at the end.
export function playWoo() {
  const seq = [392.0, 523.25, 659.25, 783.99, 1046.5];
  seq.forEach((f, i) => tone(f, i * 0.08, 0.42, 0.16));
}
