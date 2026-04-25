import ReactDOM from "react-dom/client";
import { App } from "./App";

// StrictMode is intentionally disabled: it double-mounts components, which
// causes R3F's WebGLRenderer to be created twice and the second initialization
// races with the ResizeObserver — leaving the canvas stuck at 300x150 on first
// load. Production builds don't run StrictMode anyway.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
