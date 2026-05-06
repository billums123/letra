// iOS WebAudio keepalive. Long-running iOS bug: standalone PWAs +
// Safari aggressively suspend the AudioContext on backgrounding,
// scrolling, or even random scenarios, and resume() can stay
// rejected even after the user returns. The community-standard fix
// (used by Howler.js, the `unmute` library, and most production web
// audio apps) is to keep a silent HTML <audio> element looping in
// the background. That:
//   • Promotes the page to "media playback" status so iOS schedules
//     it more like an audio app than a tab,
//   • Forces audio onto the media channel, defeating the silent
//     switch / ringer-mute behaviour,
//   • Keeps the audio "session" alive so the AudioContext doesn't
//     drift into the wedged "interrupted" state.
//
// We also register MediaSession metadata so iOS treats Letra as a
// proper media app — a side benefit being the lock-screen audio
// controls show "Letra" while the kid plays.
//
// Cheap on every other platform — a single silent <audio> element
// loops a 1s file at 32 kbps and consumes effectively no CPU.

const SILENT_URL = "/audio/silent.mp3";
let installed = false;
let silentEl: HTMLAudioElement | null = null;

export function installIOSKeepalive(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;

  const el = document.createElement("audio");
  el.src = SILENT_URL;
  el.loop = true;
  el.preload = "auto";
  // Inline playback — without this, iOS can hijack to fullscreen.
  el.setAttribute("playsinline", "");
  el.setAttribute("webkit-playsinline", "");
  // Avoid AirPlay ghost-routing for a silent placeholder track.
  el.setAttribute("x-webkit-airplay", "deny");
  // Hide the element completely.
  el.style.position = "absolute";
  el.style.width = "0";
  el.style.height = "0";
  el.style.opacity = "0";
  el.style.pointerEvents = "none";
  el.muted = false; // intentionally NOT muted — iOS treats muted <audio> as background-only
  el.volume = 0; // but volume=0 keeps it inaudible while still on the media channel
  document.body.appendChild(el);
  silentEl = el;

  const tryPlay = () => {
    if (!silentEl) return;
    silentEl.play().catch(() => {
      // play() rejects until a user gesture has happened — safe to ignore;
      // the gesture listeners below will retry.
    });
  };

  // Any user gesture is a chance to start (and re-start) the loop.
  // We listen forever rather than `once: true` because iOS may
  // suspend the element after a backgrounding cycle and need a fresh
  // gesture-bound play() to restart.
  document.addEventListener("touchend", tryPlay, { passive: true });
  document.addEventListener("click", tryPlay);
  document.addEventListener("keydown", tryPlay);

  // Returning to foreground / unlocking the device — try to resume
  // the silent loop without waiting for a new gesture.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") tryPlay();
  });
  window.addEventListener("focus", tryPlay);
  window.addEventListener("pageshow", tryPlay);

  // If the element ever pauses unexpectedly (iOS routing change,
  // headphone unplug, etc) restart on the next tick.
  el.addEventListener("pause", () => {
    // Don't fight a deliberate pause caused by document hidden — the
    // visibilitychange listener above handles the resume.
    if (document.visibilityState === "visible") tryPlay();
  });

  // MediaSession metadata so iOS lock-screen / control-centre treat
  // Letra as a proper media app instead of background-eligible junk.
  if ("mediaSession" in navigator && typeof MediaMetadata !== "undefined") {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: "Letra",
        artist: "Letra — Learn Letters in 3D",
        album: "Letra",
        artwork: [
          { src: "/letra-icon.png", sizes: "1024x1024", type: "image/png" },
        ],
      });
      // Treat play / pause from the lock screen as no-ops — we don't
      // want a kid's parent accidentally hard-pausing the app from
      // the control centre.
      navigator.mediaSession.setActionHandler("play", () => tryPlay());
      navigator.mediaSession.setActionHandler("pause", () => tryPlay());
    } catch {
      // Older Safari versions throw on unknown actions; non-fatal.
    }
  }
}
