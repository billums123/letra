import { useEffect, useState } from "react";
import { Game } from "./components/Game";
import { Landing } from "./ui/Landing";

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
    return <Landing onPlay={goToGame} />;
  }
  return <Game />;
}
