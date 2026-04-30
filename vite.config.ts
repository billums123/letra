import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Cloudflare Web Analytics — privacy-friendly visitor count + visit-duration
// reporting. Picks up the token from CLOUDFLARE_ANALYTICS_TOKEN at build time
// (set it on Railway → no secret to commit). When the env var is unset the
// plugin is a no-op, so local builds and forks don't ping Cloudflare.
function cloudflareWebAnalytics(token: string | undefined): PluginOption {
  return {
    name: "cloudflare-web-analytics",
    apply: "build",
    transformIndexHtml(html) {
      if (!token) return html;
      const config = JSON.stringify({ token });
      const tag = `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='${config}'></script>`;
      return html.replace("</head>", `    ${tag}\n  </head>`);
    },
  };
}

// Letra dev server. Default port 5173; falls through to next free port.
export default defineConfig({
  plugins: [
    react(),
    cloudflareWebAnalytics(process.env.CLOUDFLARE_ANALYTICS_TOKEN),
    // PWA: makes Letra installable to the home screen on phones / Chromebooks
    // and lets the game work offline once everything's been loaded once. The
    // service worker auto-updates so a deployed change rolls out without the
    // kid having to reinstall anything.
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "letra-icon.svg",
        "fonts/*.json",
        // The audio files aren't precached because a full alphabet can run
        // 200+ MB across multiple voices — far too big for the install
        // budget. Instead we runtime-cache them: each clip is fetched
        // once and pinned, so a kid who plays through the alphabet ends
        // up with everything cached for offline use.
      ],
      manifest: {
        name: "Letra — Learn Letters in 3D",
        short_name: "Letra",
        description: "A 3D letter-learning adventure for pre-K kids.",
        theme_color: "#7ec8ff",
        background_color: "#a8e2ff",
        display: "standalone",
        orientation: "any",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "letra-icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        // Precache the app shell — small, deterministic, no audio.
        globPatterns: ["**/*.{js,css,html,svg,json,woff2,ttf}"],
        // Bump the budget — the bundled font + a single voice's manifest
        // can push past the default 2 MB.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            // Audio MP3s — cache on first hit. Voice MP3s rarely change
            // once authored, so CacheFirst is fine.
            urlPattern: ({ request }) => request.destination === "audio",
            handler: "CacheFirst",
            options: {
              cacheName: "letra-audio",
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Background-music MP3s. They're loaded via fetch() +
            // decodeAudioData (so request.destination is "" rather than
            // "audio") — match by URL prefix instead.
            urlPattern: /\/audio\/music\/.*\.mp3$/,
            handler: "CacheFirst",
            options: {
              cacheName: "letra-music",
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // SFX clips (firework bursts etc). Same fetch() + decode
            // path as music; covers both .mp3 and .ogg variants.
            urlPattern: /\/audio\/sfx\/.*\.(mp3|ogg)$/,
            handler: "CacheFirst",
            options: {
              cacheName: "letra-sfx",
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // voices.json + per-voice manifest.json — small, can refresh.
            urlPattern: /\/audio\/(voices|.*\/manifest)\.json$/,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "letra-audio-manifests",
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
        ],
      },
      devOptions: {
        // Off in dev to avoid the SW caching stale Vite HMR bundles. The
        // build step still produces a working SW for production preview.
        enabled: false,
      },
    }),
  ],
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
