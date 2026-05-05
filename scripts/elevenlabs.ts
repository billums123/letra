// Shared ElevenLabs TTS helper. Used by:
//   - scripts/generate-audio.ts (build-time CLI)
//   - vite.config.ts dev plugin (`/__dev/generate-spell-clips` endpoint)
// Keeping the HTTP call in one place means the dev tool and the CLI never
// drift on voice settings, headers, or model defaults.

import { promises as fs } from "node:fs";

export type GenerateClipArgs = {
  text: string;
  voiceId: string;
  modelId: string;
  apiKey: string;
  outPath: string;
};

export async function generateClipMp3(args: GenerateClipArgs): Promise<void> {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${args.voiceId}?output_format=mp3_44100_128`;
  const body = {
    text: args.text,
    model_id: args.modelId,
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0.4,
      use_speaker_boost: true,
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": args.apiKey,
      "content-type": "application/json",
      accept: "audio/mpeg",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "<no body>");
    throw new Error(`ElevenLabs ${res.status}: ${text.slice(0, 200)}`);
  }
  const arrayBuf = await res.arrayBuffer();
  await fs.writeFile(args.outPath, Buffer.from(arrayBuf));
}
