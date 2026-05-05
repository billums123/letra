import ReactDOM from "react-dom/client";
import { App } from "./App";
import { preloadImages } from "./util/preloadImages";

// Kick off image fetches before React mounts so the menu hero, game-card
// icons, case-picker tiles and trophy art are already in the HTTP cache
// by the time anything actually renders them. Without this the first
// time a kid opens the case picker or earns a trophy there's a visible
// pop-in lag while the PNG round-trips to the network.
preloadImages();

// StrictMode is intentionally disabled: it double-mounts components, which
// causes R3F's WebGLRenderer to be created twice and the second initialization
// races with the ResizeObserver — leaving the canvas stuck at 300x150 on first
// load. Production builds don't run StrictMode anyway.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
