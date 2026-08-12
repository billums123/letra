// Dev-only Vite middleware backing the SFX Lab screen.
//
// The browser can't call ElevenLabs itself: the API key must never
// reach the client, and the browser can't write into public/. So the
// lab posts here, the dev server does the generation, and clips land
// on disk where the game already looks for them.
//
// Everything here is gated behind `apply: "serve"` — it does not exist
// in a production build, and there is no route to it from the shipped
// app.
//
// Generated takes go to public/audio/sfx/_candidates/ and are NOT what
// the game plays. Approving one copies it over the real filename; that
// separation is the whole point, so a bad take can never silently
// become the shipped sound.

import type { Plugin } from "vite";
import { promises as fs } from "node:fs";
import path from "node:path";

const SFX_DIR = path.resolve(process.cwd(), "public", "audio", "sfx");
const CANDIDATE_DIR = path.join(SFX_DIR, "_candidates");

type GenerateBody = {
  id: string;
  prompt: string;
  durationSeconds: number;
  promptInfluence: number;
};

type ApproveBody = { candidate: string; slot: string };

async function readJson<T>(req: import("node:http").IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

// Filenames arrive from the client, so they get whitelisted rather than
// trusted — this writes to disk and a traversal here would be ugly.
const SAFE = /^[a-z0-9][a-z0-9._-]*\.(mp3|ogg)$/i;

export function sfxLabPlugin(): Plugin {
  return {
    name: "letra-sfx-lab",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/__sfx/")) return next();
        const send = (code: number, body: unknown) => {
          res.statusCode = code;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(body));
        };

        try {
          if (req.url === "/__sfx/state" && req.method === "GET") {
            await fs.mkdir(CANDIDATE_DIR, { recursive: true });
            const [live, candidates] = await Promise.all([
              fs.readdir(SFX_DIR).catch(() => []),
              fs.readdir(CANDIDATE_DIR).catch(() => []),
            ]);
            return send(200, {
              hasKey: Boolean(process.env.ELEVENLABS_API_KEY),
              live: live.filter((f) => /\.(mp3|ogg)$/i.test(f)),
              candidates: candidates.filter((f) => /\.mp3$/i.test(f)).sort().reverse(),
            });
          }

          if (req.url === "/__sfx/generate" && req.method === "POST") {
            const key = process.env.ELEVENLABS_API_KEY;
            if (!key) {
              return send(400, {
                error:
                  "ELEVENLABS_API_KEY is not set. Add it to .env.local and restart the dev server.",
              });
            }
            const body = await readJson<GenerateBody>(req);
            const r = await fetch(
              "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128",
              {
                method: "POST",
                headers: {
                  "xi-api-key": key,
                  "content-type": "application/json",
                  accept: "audio/mpeg",
                },
                body: JSON.stringify({
                  text: body.prompt,
                  duration_seconds: body.durationSeconds,
                  prompt_influence: body.promptInfluence,
                }),
              }
            );
            if (!r.ok) {
              const text = await r.text().catch(() => "");
              // The permissions failure is the one people actually hit,
              // and the raw message doesn't say how to fix it.
              const hint =
                r.status === 401 && text.includes("sound_generation") ?
                  " — the key is missing the sound_generation permission; enable it on the key at elevenlabs.io."
                : "";
              return send(r.status, { error: `ElevenLabs ${r.status}${hint}: ${text.slice(0, 300)}` });
            }
            await fs.mkdir(CANDIDATE_DIR, { recursive: true });
            const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
            const name = `${body.id}-${stamp}.mp3`;
            if (!SAFE.test(name)) return send(400, { error: `unsafe name ${name}` });
            await fs.writeFile(
              path.join(CANDIDATE_DIR, name),
              Buffer.from(await r.arrayBuffer())
            );
            return send(200, { candidate: name });
          }

          if (req.url === "/__sfx/approve" && req.method === "POST") {
            const { candidate, slot } = await readJson<ApproveBody>(req);
            if (!SAFE.test(candidate) || !SAFE.test(slot)) {
              return send(400, { error: "bad filename" });
            }
            await fs.copyFile(
              path.join(CANDIDATE_DIR, candidate),
              path.join(SFX_DIR, slot)
            );
            return send(200, { ok: true, slot });
          }

          if (req.url === "/__sfx/discard" && req.method === "POST") {
            const { candidate } = await readJson<{ candidate: string }>(req);
            if (!SAFE.test(candidate)) return send(400, { error: "bad filename" });
            await fs.unlink(path.join(CANDIDATE_DIR, candidate)).catch(() => {});
            return send(200, { ok: true });
          }

          return next();
        } catch (err) {
          return send(500, { error: (err as Error).message });
        }
      });
    },
  };
}
