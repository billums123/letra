import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Letra dev server. Default port 5173; falls through to next free port.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    host: true,
  },
  preview: {
    port: 4173,
    strictPort: false,
  },
});
