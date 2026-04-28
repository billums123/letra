// Shared WebAudio AudioContext. Both the procedural sfx (chimes,
// engine loop, putts) and the music scheduler render through the
// same graph so they're routed and gain-staged together. Holding
// the context as a module-level singleton avoids the "creating two
// AudioContexts" warning Chrome emits when a page does it more than
// once per session.

import { installIOSKeepalive } from "./iosKeepalive";
//
// iOS Safari is aggressive about suspending the context when the
// page is backgrounded, the device locks, the user pulls down
// notification centre, or even on rapid scroll. It also uses an
// "interrupted" state that the spec doesn't define and that
// requires an explicit resume() to leave. We install a resume
// handler that listens to every plausible "user is back" event
// (visibility, focus, page show, touch, click, keydown, plus the
// context's own statechange) so audio always wakes up the moment
// the page returns to the foreground.

let ctx: AudioContext | null = null;
const stateChangeListeners = new Set<() => void>();

export function getMusicCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    installResumeHandler(ctx);
    // The silent-audio + MediaSession trick — keeps iOS from
    // suspending the audio session out from under us. See
    // src/audio/iosKeepalive.ts for the why and the references.
    installIOSKeepalive();
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  return ctx;
}

function installResumeHandler(c: AudioContext) {
  const tryResume = () => {
    // "interrupted" is iOS-only and not in the spec's State union, so
    // we cast through string to avoid a TS narrowing complaint.
    const state = c.state as string;
    if (state === "suspended" || state === "interrupted") {
      c.resume().catch(() => undefined);
    }
  };
  // Page visibility — fires when the tab is brought back, when the
  // device unlocks, when the user closes notification centre, etc.
  document.addEventListener("visibilitychange", tryResume);
  // Window focus — fires when switching back from another window.
  window.addEventListener("focus", tryResume);
  // BFCache restore — fires when navigating back to a cached page.
  window.addEventListener("pageshow", tryResume);
  // Any user gesture is a chance to resume — iOS requires the
  // resume call to happen inside the gesture handler in some cases.
  document.addEventListener("touchend", tryResume, { passive: true });
  document.addEventListener("click", tryResume);
  document.addEventListener("keydown", tryResume);
  // The context's own state changes — when iOS surfaces an
  // "interrupted" state, calling resume from within the statechange
  // handler is the most reliable way out.
  c.addEventListener("statechange", () => {
    if (c.state !== "running") tryResume();
    for (const cb of stateChangeListeners) {
      try {
        cb();
      } catch {
        /* listener errors shouldn't break the audio graph */
      }
    }
  });
}

// Subscribe to AudioContext state changes. Returns an unsubscribe.
// The music player uses this to detect interruption-then-resume
// cycles and re-trigger playback if a long iOS suspension killed
// the buffer source.
export function onAudioContextStateChange(cb: () => void): () => void {
  stateChangeListeners.add(cb);
  return () => stateChangeListeners.delete(cb);
}
