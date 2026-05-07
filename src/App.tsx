import { Component, type ReactNode, useEffect, useState } from "react";
import { Game } from "./components/Game";
import { Landing } from "./ui/Landing";

// Top-level safety net. Without this, a Three.js context loss, an
// unhandled audio decode error, or any thrown render leaves the kid
// staring at a blank white screen with no recovery. The boundary
// catches the throw, logs it, and shows a tap-to-restart panel so a
// 4-year-old (or a parent grabbing the device) can recover without
// knowing what "force quit" means.
class RootErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    // No third-party crash reporter — privacy-first kids' app. The
    // console log is enough during dev; in production the reload
    // resets state.
    console.error("[Letra] Top-level error caught:", error);
  }

  private handleReload = () => {
    // Full reload (not setState reset) because the failure mode is
    // usually a Three.js / WebGL context that's already wedged. A
    // fresh document is the most reliable recovery, and the audio
    // cache + service worker make it fast.
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "#7ec8ff",
            fontFamily: "'Comic Sans MS', 'Chalkboard SE', system-ui, sans-serif",
            padding: 24,
            textAlign: "center",
          }}
        >
          {/* The error mascot reuses the canonical app icon
              (public/letra-icon.png) so it's guaranteed brand-correct —
              if the icon ever gets rebranded, this updates with it.
              The wobble + tilt sells the "dazed, knocked over" state
              through motion instead of a custom sad-face variant.
              Wrapper uses letra-pop-in (defined globally in
              index.html) so the panel springs in; the icon itself
              uses letra-bob for a gentle living wobble after landing. */}
          <div
            style={{
              animation: "letra-pop-in 0.6s cubic-bezier(.34,1.56,.64,1) backwards",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            {/* Outer wrapper holds the static "knocked over" tilt;
                inner img runs the bob animation. Splitting them so
                letra-bob's keyframe transform doesn't overwrite the
                tilt. */}
            <div
              style={{
                transform: "rotate(-8deg)",
                marginBottom: 20,
                filter: "drop-shadow(0 6px 0 rgba(58, 42, 20, 0.18))",
              }}
            >
              <img
                src="/letra-icon.png"
                alt="Letra"
                width={140}
                height={140}
                style={{
                  display: "block",
                  animation: "letra-bob 3.4s ease-in-out infinite",
                }}
              />
            </div>
            <div
              style={{
                fontFamily: "'Lilita One', 'Comic Sans MS', sans-serif",
                fontSize: 36,
                color: "#1a3a52",
                marginBottom: 8,
                letterSpacing: 0.5,
              }}
            >
              Whoops!
            </div>
            <div
              style={{
                fontSize: 18,
                color: "#1a3a52",
                marginBottom: 24,
                maxWidth: 320,
                lineHeight: 1.4,
              }}
            >
              Letra hit a bump. Tap below to start fresh.
            </div>
            <button
              onClick={this.handleReload}
              style={{
                // Inherit the Comic Sans / Chalkboard body stack instead
                // of Lilita One — Lilita is a display font and compresses
                // poorly at button sizes, which made "Restart Letra"
                // harder to read for kids/parents than the headline above.
                fontFamily: "inherit",
                fontWeight: 700,
                fontSize: 26,
                padding: "16px 36px",
                borderRadius: 18,
                border: "none",
                background: "#ff7eb6",
                color: "white",
                textShadow: "0 2px 0 rgba(140, 50, 90, 0.35)",
                boxShadow: "0 6px 0 #c75a8a",
                cursor: "pointer",
                minWidth: 220,
                minHeight: 64,
              }}
            >
              Restart Letra
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Feature flag for the parent-facing landing page at "/". When false,
// "/" is silently rewritten to "/play" so visitors land directly in
// the game — the Landing component still ships in the bundle (it's
// tiny) but it never mounts. Flip back to true to restore the
// on-ramp + Ko-fi / install-hint / contact-email surface.
//
// Typed as `boolean` (not the literal `false`) so TypeScript doesn't
// narrow the conditional below to "always game" and start warning on
// the Landing branch as unreachable.
const SHOW_LANDING: boolean = true;

// Lightweight pathname-based router. When the landing is shown, "/"
// renders the parent-facing surface and "/play" (plus "/play/<mode>"
// sub-paths synced from in-game state by Game.tsx for analytics)
// renders the game. When the landing is hidden, every path is the
// game — and "/" is normalized to "/play" so Game.tsx's own
// SCREEN_PATHS pushState doesn't add a phantom history entry on top
// of "/".
//
// Navigation between landing and game (when shown) is client-side via
// history.pushState rather than a full window.location.assign, so
// the transition is instant — no white flash from a fresh document
// load, and the AudioContext + image preloads from the initial boot
// stay warm.

function readPath(): string {
  if (typeof window === "undefined") return "/";
  const path = window.location.pathname;
  if (!SHOW_LANDING && (path === "/" || path === "")) {
    // replaceState (not pushState) so the URL bar shows /play
    // immediately without a phantom "/" entry sitting in history
    // that the browser back button would round-trip through.
    window.history.replaceState({}, "", "/play");
    return "/play";
  }
  return path;
}

export function App() {
  const [path, setPath] = useState<string>(readPath);

  useEffect(() => {
    // Keep our top-level path state in sync with browser history. Game.tsx
    // pushes its own SCREEN_PATHS as the kid moves between screens — those
    // pushes don't change which top-level surface (Landing vs. Game) is
    // mounted, so we only re-read on popstate (back/forward) and on the
    // explicit Play handoff below.
    const onPop = () => setPath(readPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const goToGame = () => {
    if (window.location.pathname !== "/play") {
      window.history.pushState({}, "", "/play");
    }
    setPath("/play");
  };

  if (SHOW_LANDING && (path === "/" || path === "")) {
    return (
      <RootErrorBoundary>
        <Landing onPlay={goToGame} />
      </RootErrorBoundary>
    );
  }
  return (
    <RootErrorBoundary>
      <Game />
    </RootErrorBoundary>
  );
}
