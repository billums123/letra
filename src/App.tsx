import { useEffect, useState } from "react";
import { Game } from "./components/Game";
import { Landing } from "./ui/Landing";

// Lightweight pathname-based router. The parent-facing landing lives at
// "/" and the game at "/play" (plus its sub-paths "/play/spell-word"
// etc., synced from in-game state by Game.tsx for analytics). The
// landing path is the SOLE entry where any external link, Ko-fi
// button, contact email, or GitHub link appears — keeping those off
// the game surface means a kid mashing the screen can't accidentally
// exit to a payment flow or open a mail composer.
//
// Navigation between landing and game is client-side via history.pushState
// rather than a full window.location.assign, so the transition is
// instant — no white flash from a fresh document load, and the
// AudioContext + image preloads from the initial boot stay warm.

function readPath(): string {
  if (typeof window === "undefined") return "/";
  return window.location.pathname;
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

  if (path === "/" || path === "") {
    return <Landing onPlay={goToGame} />;
  }
  return <Game />;
}
