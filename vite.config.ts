import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { promises as fs } from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { generateClipMp3 } from "./scripts/elevenlabs";
import type { VoicesRegistry } from "./src/audio/types";

// Load .env.local then .env so the dev plugin below can reach
// ELEVENLABS_API_KEY. Vite normally only exposes VITE_-prefixed vars to the
// client; server-side middleware is fine to read whatever it wants.
loadDotenv({ path: ".env.local" });
loadDotenv({ path: ".env" });

// Dev-only middleware that powers the in-app authoring screens
// (/dev/word-builder, /dev/audio-tester). Three endpoints:
//
//   POST /__dev/generate-spell-clips  { word, intro, reveal }
//     → writes prompt-spell-<WORD>.mp3 and reveal-spell-<WORD>.mp3 for every
//       voice in voices.json. Drives the new-word flow.
//
//   POST /__dev/regenerate-clip  { id, text, voiceSlug, modelId? }
//     → writes a single <id>.mp3 for one voice, used by the audio tester
//       when the dev tweaks an existing clip's text and wants to hear it
//       without restarting anything.
//
//   POST /__dev/suggest-spell-prompts  { word }
//     → calls the OpenAI API (OPENAI_API_KEY in .env) to generate 3
//       intro+reveal pairs for a new word. Used in the word builder.
//
// Both ElevenLabs paths share the helper used by the build-time script so
// voice settings stay identical. `apply: "serve"` means the plugin (and
// the API keys it reads) only ever loads in `vite dev`.
function devAudioPlugin(): PluginOption {
  const PUBLIC_AUDIO = path.resolve("public/audio");

  async function readJson(req: import("node:http").IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (e) {
          reject(e);
        }
      });
      req.on("error", reject);
    });
  }

  function sendJson(res: import("node:http").ServerResponse, status: number, body: unknown) {
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body));
  }

  function requireKey(res: import("node:http").ServerResponse): string | null {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      sendJson(res, 500, { error: "ELEVENLABS_API_KEY missing — add it to .env" });
      return null;
    }
    return apiKey;
  }

  return {
    name: "letra-dev-audio",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__dev/generate-spell-clips", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("POST only");
          return;
        }
        try {
          const body = (await readJson(req)) as { word?: string; intro?: string; reveal?: string };
          const word = String(body?.word ?? "").toUpperCase();
          const intro = body?.intro ? String(body.intro).trim() : "";
          const reveal = body?.reveal ? String(body.reveal).trim() : "";
          if (!/^[A-Z]{2,10}$/.test(word)) {
            sendJson(res, 400, { error: "Invalid word. Need uppercase A-Z, 2–10 chars." });
            return;
          }
          // Partial regeneration: omit intro to skip the intro MP3, omit
          // reveal to skip the reveal MP3. At least one must be present
          // — there's nothing to do otherwise.
          if (!intro && !reveal) {
            sendJson(res, 400, { error: "Need at least one of intro or reveal." });
            return;
          }
          const apiKey = requireKey(res);
          if (!apiKey) return;
          const registryRaw = await fs.readFile(path.join(PUBLIC_AUDIO, "voices.json"), "utf8");
          const registry = JSON.parse(registryRaw) as VoicesRegistry;
          const generated: { voice: string; intro?: string; reveal?: string }[] = [];
          for (const voice of registry.voices) {
            const voiceDir = path.join(PUBLIC_AUDIO, voice.slug);
            await fs.mkdir(voiceDir, { recursive: true });
            const result: { voice: string; intro?: string; reveal?: string } = { voice: voice.slug };
            if (intro) {
              const introPath = path.join(voiceDir, `prompt-spell-${word}.mp3`);
              await generateClipMp3({ text: intro, voiceId: voice.voiceId, modelId: voice.modelId, apiKey, outPath: introPath });
              result.intro = `/audio/${voice.slug}/prompt-spell-${word}.mp3?ts=${Date.now()}`;
            }
            if (reveal) {
              const revealPath = path.join(voiceDir, `reveal-spell-${word}.mp3`);
              await generateClipMp3({ text: reveal, voiceId: voice.voiceId, modelId: voice.modelId, apiKey, outPath: revealPath });
              result.reveal = `/audio/${voice.slug}/reveal-spell-${word}.mp3?ts=${Date.now()}`;
            }
            generated.push(result);
          }
          sendJson(res, 200, { word, generated });
        } catch (err) {
          sendJson(res, 500, { error: (err as Error).message });
        }
      });

      server.middlewares.use("/__dev/suggest-spell-prompts", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("POST only");
          return;
        }
        try {
          const body = (await readJson(req)) as { word?: string };
          const word = String(body?.word ?? "").toUpperCase();
          if (!/^[A-Z]{2,10}$/.test(word)) {
            sendJson(res, 400, { error: "Invalid word." });
            return;
          }
          const apiKey = process.env.OPENAI_API_KEY;
          if (!apiKey) {
            sendJson(res, 500, { error: "OPENAI_API_KEY missing — add it to .env to use AI suggestions." });
            return;
          }
          const letters = word.split("").join(", ");
          const lower = word.toLowerCase();
          const userPrompt = `Generate 3 distinct, warm, friendly intro+reveal pairs for the word "${word}". Each pair should:
- Use a different scenario angle (lost, hidden, broken, weather, food, animal-friend, etc.)
- Spell the letters comma-separated: "${letters}"
- Use the lowercase word: "${lower}"
- Sound natural read aloud by an adult to a small child
- Keep intros SHORT — aim for ~14 words, hard cap at 18. One brisk sentence.
- Reveals must be a punchy triumphant fragment, ≤6 words.

Length is critical — pre-K kids tune out long sentences. Cut filler ("help me",
"can you", "let's go and") aggressively.

Examples of the right length (don't copy these):
- BUS intro: "We need the bus! Find B, U, S to bring it!" (10 words)
- PIG intro: "The pig is hiding! Find P, I, G to call them out!" (12 words)
- DOG reveal: "There is the dog!" (4 words)

Return JSON in this exact schema:
{"suggestions":[{"label":"2–4 word scenario","intro":"...","reveal":"..."},{...},{...}]}`;
          // response_format: json_object guarantees the assistant returns
          // valid JSON — no fence stripping required. Supported by gpt-4o
          // and the 4o-mini family; we use 4o-mini for cost.
          const oRes = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              authorization: `Bearer ${apiKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              response_format: { type: "json_object" },
              messages: [
                {
                  role: "system",
                  content:
                    "You write narration for a 3D alphabet game for pre-K kids (3–6 years old). Always return strictly valid JSON matching the schema the user provides.",
                },
                { role: "user", content: userPrompt },
              ],
            }),
          });
          if (!oRes.ok) {
            const t = await oRes.text().catch(() => "<no body>");
            throw new Error(`OpenAI ${oRes.status}: ${t.slice(0, 200)}`);
          }
          const json = (await oRes.json()) as {
            choices: { message: { content: string } }[];
          };
          const text = json.choices?.[0]?.message?.content;
          if (!text) throw new Error("OpenAI response had no content.");
          const parsed = JSON.parse(text) as {
            suggestions: { label: string; intro: string; reveal: string }[];
          };
          if (!Array.isArray(parsed.suggestions)) throw new Error("Suggestions array missing.");
          sendJson(res, 200, { word, suggestions: parsed.suggestions });
        } catch (err) {
          sendJson(res, 500, { error: (err as Error).message });
        }
      });

      server.middlewares.use("/__dev/regenerate-clip", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("POST only");
          return;
        }
        try {
          const body = (await readJson(req)) as {
            id?: string;
            text?: string;
            voiceSlug?: string;
            modelId?: string;
          };
          const id = String(body?.id ?? "").trim();
          const text = String(body?.text ?? "").trim();
          const voiceSlug = String(body?.voiceSlug ?? "").trim();
          // id is also used as a path component, so reject anything that
          // could escape the voice directory or contain shell-funny chars.
          if (!/^[a-zA-Z0-9-]+$/.test(id)) {
            sendJson(res, 400, { error: "Invalid clip id. Must match /^[a-zA-Z0-9-]+$/." });
            return;
          }
          if (!/^[a-z0-9-]+$/.test(voiceSlug)) {
            sendJson(res, 400, { error: "Invalid voice slug." });
            return;
          }
          if (!text) {
            sendJson(res, 400, { error: "Empty text." });
            return;
          }
          const apiKey = requireKey(res);
          if (!apiKey) return;
          const registryRaw = await fs.readFile(path.join(PUBLIC_AUDIO, "voices.json"), "utf8");
          const registry = JSON.parse(registryRaw) as VoicesRegistry;
          const voice = registry.voices.find((v) => v.slug === voiceSlug);
          if (!voice) {
            sendJson(res, 400, { error: `Voice "${voiceSlug}" not in registry.` });
            return;
          }
          const voiceDir = path.join(PUBLIC_AUDIO, voice.slug);
          await fs.mkdir(voiceDir, { recursive: true });
          const outPath = path.join(voiceDir, `${id}.mp3`);
          const modelId = (body?.modelId && String(body.modelId).trim()) || voice.modelId;
          await generateClipMp3({ text, voiceId: voice.voiceId, modelId, apiKey, outPath });
          sendJson(res, 200, {
            id,
            voiceSlug: voice.slug,
            url: `/audio/${voice.slug}/${id}.mp3?ts=${Date.now()}`,
          });
        } catch (err) {
          sendJson(res, 500, { error: (err as Error).message });
        }
      });
    },
  };
}

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
    devAudioPlugin(),
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
        // PNGs are included so menu icons, case-picker tiles and trophy
        // art all paint from the SW cache on repeat visits with zero
        // network latency. The bundle of all PNGs is ~1 MB total —
        // well under the install budget.
        globPatterns: ["**/*.{js,css,html,svg,json,woff2,ttf,png}"],
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
