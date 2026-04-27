// Shared WebAudio AudioContext. Both the procedural sfx (chimes,
// engine loop, putts) and the music scheduler need to render through
// the same graph so they're routed and gain-staged together. Holding
// the context as a module-level singleton avoids the "creating two
// AudioContexts" warning Chrome emits when a page does it more than
// once per session.

let ctx: AudioContext | null = null;

export function getMusicCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}
