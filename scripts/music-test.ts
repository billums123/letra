// Music player regression tests.
//
// The bug this exists for: "sometimes the music cuts out while playing
// on different maps — the sfx and voices still play." Both of those
// keep working because they build a fresh node (sfx) or use an
// <audio> element (voice) every time. The music is the only thing in
// the app holding one long-lived AudioBufferSourceNode for minutes at
// a stretch, so it is the only thing that can silently die and stay
// dead.
//
// Web Audio is impossible to drive from node and the failure is
// intermittent in a browser, so we fake the graph and step the
// player through each way it can end up silent.

import { readdirSync, readFileSync } from "node:fs";
import { MusicPlayer, type Track } from "../src/audio/music";

// ── Fake Web Audio ────────────────────────────────────────────────
class Param {
  constructor(public value: number) {}
  cancelScheduledValues() { return this; }
  setValueAtTime(v: number) { this.value = v; return this; }
  linearRampToValueAtTime(v: number) { this.value = v; return this; }
}

class Node_ {
  connect() {}
  disconnect() {}
}

class Gain extends Node_ { gain = new Param(1); }

class Source extends Node_ {
  buffer: unknown = null;
  loop = false;
  playbackRate = new Param(1);
  started = false;
  stopped = false;
  onended: (() => void) | null = null;
  start() { this.started = true; sources.push(this); }
  stop() { this.stopped = true; setTimeout(() => this.onended?.(), 0); }
  // What iOS does to us: the node dies, the context never leaves
  // "running", and the only notice we get is an ended event.
  killFromOutside() { this.stopped = true; this.onended?.(); }
}

class Buf {
  constructor(
    public numberOfChannels: number,
    public length: number,
    public sampleRate: number,
    private data = Array.from({ length: numberOfChannels }, () => new Float32Array(length)),
  ) {}
  getChannelData(ch: number) { return this.data[ch]; }
}

let sources: Source[] = [];
const live = () => sources.filter((s) => s.started && !s.stopped);

let ctxRef: Ctx | null = null;

class Ctx {
  constructor() { ctxRef = this; }
  state = "running";
  currentTime = 0;
  sampleRate = 44100;
  destination = new Node_();
  private listeners: Array<() => void> = [];
  addEventListener(_: string, cb: () => void) { this.listeners.push(cb); }
  setState(s: string) { this.state = s; for (const cb of [...this.listeners]) cb(); }
  resume() { return Promise.resolve(); }
  createGain() { return new Gain(); }
  createBufferSource() { return new Source(); }
  createBiquadFilter() { return { type: "", frequency: new Param(0), Q: new Param(0), connect() {}, disconnect() {} }; }
  createDelay() { return { delayTime: new Param(0), connect() {}, disconnect() {} }; }
  createConvolver() { return { buffer: null as unknown, connect() {}, disconnect() {} }; }
  createBuffer(ch: number, len: number, sr: number) { return new Buf(ch, len, sr); }
  decodeAudioData() {
    // A sine so the loop-seam trimmer finds its zero crossings.
    const len = 44100;
    const b = new Buf(2, len, 44100);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = Math.sin((i / 441) * Math.PI * 2);
    }
    return Promise.resolve(b);
  }
}

// ── Fake DOM ──────────────────────────────────────────────────────
let watchdog: (() => void) | null = null;
const el = () => ({
  src: "", loop: false, preload: "", muted: false, volume: 0,
  style: {} as Record<string, string>,
  setAttribute() {}, addEventListener() {},
  play: () => Promise.resolve(),
});

const win = {
  AudioContext: Ctx,
  addEventListener() {},
  // Capture the watchdog rather than running it — the tests step it.
  setInterval: (cb: () => void) => { watchdog = cb; return 1; },
  setTimeout: (cb: () => void, ms: number) => setTimeout(cb, ms),
  clearTimeout: (id: number) => clearTimeout(id),
};
const doc = {
  addEventListener() {},
  createElement: () => el(),
  body: { appendChild() {} },
  visibilityState: "visible",
};

Object.defineProperty(globalThis, "window", { value: win, configurable: true });
Object.defineProperty(globalThis, "document", { value: doc, configurable: true });
Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });

// ── Fake network ──────────────────────────────────────────────────
let netUp = true;
let fetches = 0;
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  value: async (url: string) => {
    fetches++;
    if (!netUp) throw new TypeError(`Load failed: ${url}`);
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
  },
});

const A: Track = { id: "a", name: "A", url: "/audio/music/a.mp3" };
const B: Track = { id: "b", name: "B", url: "/audio/music/b.mp3" };

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
// Every player subscribes to the context's state changes for as long
// as it lives, so retire the previous one before starting the next.
let prev: MusicPlayer | null = null;
const fresh = () => {
  prev?.stop();
  sources = [];
  fetches = 0;
  netUp = true;
  prev = new MusicPlayer();
  return prev;
};
const tick = () => watchdog?.();

// 1. A track that fails to load must not be written off for the rest
//    of the session. The iPad this runs on has bad wifi; one dropped
//    fetch used to poison that track until the app was relaunched.
{
  const m = fresh();
  netUp = false;
  await m.play(A, 0.16);
  check("a failed load leaves no music", live().length === 0);
  netUp = true;
  await m.play(A, 0.16);
  check("the same track plays once the network is back", live().length === 1,
    `${live().length} live source(s), ${fetches} fetch(es)`);
}

// 2. Nobody re-enters the map to trigger that retry, so the watchdog
//    has to do it on its own.
{
  const m = fresh();
  netUp = false;
  await m.play(A, 0.16);
  netUp = true;
  tick();
  await new Promise((r) => setTimeout(r, 20));
  check("the watchdog retries a track that never loaded", live().length === 1,
    `${live().length} live source(s)`);
}

// 3. An iOS audio-session interruption (a call, Siri, the lock
//    screen) suspends the context and kills the source. Coming back
//    to running has to schedule a new one.
{
  const m = fresh();
  await m.play(A, 0.16);
  const first = live()[0];
  check("music is playing before the interruption", live().length === 1);
  ctxRef!.setState("interrupted");
  ctxRef!.setState("running");
  await new Promise((r) => setTimeout(r, 20));
  check("music comes back after an interruption",
    live().length === 1 && live()[0] !== first,
    `${live().length} live source(s)`);
  check("the interrupted source is not left running", first.stopped);
}

// 4. iOS also kills the node without ever moving the context off
//    "running" — the only signal is an ended event on a looping
//    source, which can't happen any other way.
{
  const m = fresh();
  await m.play(A, 0.16);
  const first = live()[0];
  first.killFromOutside();
  tick();
  await new Promise((r) => setTimeout(r, 20));
  check("a source killed under us is replaced",
    live().length === 1 && live()[0] !== first,
    `${live().length} live source(s)`);
}

// 5. Ordinary track swaps must not trip any of that: exactly one
//    track plays at a time, and it's the one that was asked for.
{
  const m = fresh();
  await m.play(A, 0.16);
  await m.play(B, 0.16);
  await new Promise((r) => setTimeout(r, 20));
  tick();
  await new Promise((r) => setTimeout(r, 20));
  check("swapping tracks leaves exactly one playing", live().length === 1,
    `${live().length} live source(s)`);
}

// 6. Retrying is not hammering. Five watchdog ticks with the network
//    down must not fire five downloads.
{
  const m = fresh();
  netUp = false;
  await m.play(A, 0.16);
  const after = fetches;
  for (let i = 0; i < 5; i++) tick();
  await new Promise((r) => setTimeout(r, 20));
  check("a down network is retried with a backoff, not on every tick",
    fetches - after <= 1, `${fetches - after} extra fetch(es) across 5 ticks`);
}

// 7. The whole app gets exactly one AudioContext. A second one is not
//    a local decision: on iOS it takes over the page's audio session,
//    and closing it leaves the shared context interrupted — music and
//    every procedural sound effect go silent together while the voice
//    clips carry on, because those are <audio> elements. That is what
//    a per-meow context in wordAssets/creature.ts was doing.
{
  const dir = new URL("../src/", import.meta.url);
  const offenders: string[] = [];
  const walk = (d: URL) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const at = new URL(e.name + (e.isDirectory() ? "/" : ""), d);
      if (e.isDirectory()) { walk(at); continue; }
      if (!/\.tsx?$/.test(e.name)) continue;
      if (at.pathname.endsWith("/audio/audioCtx.ts")) continue;
      const src = readFileSync(at, "utf8");
      if (/new\s+AudioContext\s*\(/.test(src) || /webkitAudioContext/.test(src)) {
        offenders.push(at.pathname.slice(at.pathname.indexOf("/src/") + 1));
      }
    }
  };
  walk(dir);
  check("only audioCtx.ts builds an AudioContext", offenders.length === 0,
    offenders.join(", ") || "no other module constructs one");
}

console.log(failures === 0 ? "\nall good" : `\n${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
