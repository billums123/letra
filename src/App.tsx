import { Game } from "./components/Game";
import { Landing } from "./ui/Landing";

// Lightweight pathname-based router. The parent-facing landing lives at
// "/" and the game at "/play" (plus its sub-paths "/play/spell-word"
// etc., synced from in-game state by Game.tsx for analytics). No router
// library: navigation between landing and game is a hard
// window.location.assign — we want the game bundle to mount fresh,
// AudioContext and all, when a parent taps Play.
//
// The landing path is the SOLE entry where any external link, Ko-fi
// button, contact email, or GitHub link appears — keeping those off the
// game surface means a kid mashing the screen can't accidentally exit
// to a payment flow or open a mail composer. See README.

export function App() {
  const path = typeof window !== "undefined" ? window.location.pathname : "/";
  // Treat "/" (and the root with a trailing query/hash that came back
  // as empty pathname) as the landing. Everything else is the game —
  // including /play, /play/<mode>, and the /dev/* tools used in dev
  // builds.
  if (path === "/" || path === "") {
    return <Landing />;
  }
  return <Game />;
}
