# Letra

**A 3D letter-learning adventure for pre-K kids.**

> **Powered by [Zed](https://zed.dev) + [ElevenLabs](https://elevenlabs.io).**
> Built for the [ElevenLabs × Zed Hack #6](https://hackathons.elevenlabs.io)
> hackathon — Zed's agentic editor wrote most of the code, and ElevenLabs
> voices every line the kid hears.

Letra drops a 3-to-6-year-old into a happy low-poly world full of cute, walking
letter characters with googly eyes, little arms, and big smiles. They learn the
alphabet by walking up to letters, hearing the name and the sound, and earning
trophies and stickers for every letter they master.

ElevenLabs powers every voice line in the game — a single warm, friendly voice
across the welcome, the prompts, the celebrations, and every A-Z phonetic sound.

![cover](docs/cover-placeholder.png)

---

## What's in the box

Three game modes, all hands-off-able by a parent and totally driven by voice
cues so a kid who can't read yet can still navigate:

- **🐱 Spell the Word** — *"Oh no! A cat went missing! Find the letters
  C, A, T to find the cat!"* The letters scatter around the world; walk over
  them in order. Random word every time (cat / dog / sun / bus / pig).
- **🔤 Find the Alphabet** — All 26 letters laid out in a golden spiral.
  Walk to A, then B, then C… Each pickup says the letter and its sound.
- **👂 Match the Sound** — Voice plays a phonetic sound; walk to the letter
  that makes it. Endless mode: cycles through a shuffled alphabet so every
  letter shows up once before any repeats, then reshuffles. Choice count
  scales 3 → 5 as the kid plays. Wrong choice = gentle hint and a replay.

Plus:

- **🏆 Trophies** — a shelf of unlockable rewards. Stack-up trophies for
  finishing the alphabet in each case (UPPERCASE / lowercase / Mixed),
  every fifth time the kid spells a particular word, and every tenth
  successful sound-match. Plus a one-shot **Word Wizard** milestone for
  spelling 25 words altogether.
- **🏅 Sticker book** — every mastered letter (any game mode) gets saved to
  localStorage. Tap a sticker to hear the letter again any time.
- **🔁 Replay button** — every prompt is one tap away of being repeated.
- **Hint timer** — if a kid wanders without making progress, the voice
  gently re-orients them (10 s in Sound Match, 35 s in Spell-the-Word).
- **🎵 Music** — original chiptune-style background tracks. A dedicated
  menu theme plus a randomised pool that rolls a fresh track each time
  the kid enters a game.

### Personalisation

Picked from the menu before each game:

- **Avatar** — drive a chubby orange **kid**, a low-poly **car**, or a
  hovering **rocket**. Same omnidirectional movement model on all three.
- **Biome** — play in the sunny **Park** (trees, mushrooms, lily-pad pond,
  butterflies) or on the **Moon** (low-grav bounding, planted flag, no
  flora). New biomes drop in by adding one file in `src/engine/biomes/`.
- **Letter case** — UPPERCASE, lowercase, or Mixed for Spell-the-Word and
  Find-the-Alphabet. Mixed rolls per-letter in Find-the-Alphabet and
  per-word in Spell-the-Word.

---

## Controls

The game accepts every input a small kid is likely to have within reach:

| Device | Move | Action |
|---|---|---|
| Computer keyboard | WASD or arrow keys | Space / Enter |
| Bluetooth controller (Xbox / PlayStation / generic) | Left stick or D-pad | A / X button |
| Touchscreen (phone, tablet, Chromebook) | On-screen joystick (bottom-left) | (action not needed) |

Inputs combine — plug a controller in mid-game and it just starts working.

---

## Audio

By default Letra ships with **Web Speech** as the voice engine — anyone can
download the repo and play immediately. For the hackathon-quality experience,
generate the static **ElevenLabs** audio bundle once and the game will use it
automatically.

### Run with browser speech (zero setup)

```bash
npm install
npm run dev
```

Open the URL Vite prints. Done. The browser's built-in `SpeechSynthesis` voice
narrates everything.

### Upgrade to ElevenLabs (recommended)

```bash
cp .env.example .env
# add ELEVENLABS_API_KEY=<your key> to .env
npm run audio:generate
npm run dev
```

This generates ~78 short MP3s into `public/audio/` (one for each letter name,
each phonetic sound, each game prompt, each celebration line, plus menu UI).
You only pay for it once — every kid who plays after that gets the cached audio
with zero token spend.

`npm run audio:generate` is incremental (skips clips that already exist).
`npm run audio:generate -- --force` regenerates everything.
`npm run audio:list` shows what would be generated without making any API
calls.

The voice defaults to *Rachel* (a warm, friendly American voice). Override
with `ELEVENLABS_VOICE_ID` in `.env`.

### How the runtime decides

On boot the audio player tries to fetch `public/audio/manifest.json` AND
verifies one MP3 actually exists. If both check out: ElevenLabs mode. Otherwise:
Web Speech. The chosen mode is shown in the bottom-right corner of the menu.

---

## Building & deploying

```bash
npm run build       # tsc + vite production build → dist/
npm run preview     # serve the production build locally
npm run lint        # type-check the whole project
```

The output is plain static files. Drop `dist/` on any static host (Netlify,
Cloudflare Pages, GitHub Pages, S3, the static folder of a Railway service —
no server needed).

---

## How it's built

```
src/
├── audio/
│   ├── Player.ts          dual-backend audio player (ElevenLabs + Web Speech)
│   ├── music.ts           background-music player
│   ├── songs.ts           track registry + per-screen pool selector
│   ├── sfx.ts             one-shot sound effects (chime, woo, …)
│   ├── audioCtx.ts        shared AudioContext + iOS unlock
│   ├── iosKeepalive.ts    silent ticker that keeps iOS audio alive
│   └── types.ts           manifest schema + canonical clip inventory
├── components/Game.tsx    top-level shell — mounts menu or game
├── engine/
│   ├── Engine.ts          three.js renderer + camera + per-frame loop
│   ├── world.ts           low-poly ground, hills, trees, mushrooms, clouds
│   ├── biomes/            biome registry (meadow + moon + alien config)
│   ├── player.ts          avatar character (kid / car / rocket variants)
│   ├── letters.ts         3D letter character builder (text geo + face + arms)
│   ├── letterShapes.ts    per-letter face/arm placement overrides
│   └── particles.ts       confetti burst
├── games/
│   ├── SpellWord.tsx      missing-pet game
│   ├── FindAlphabet.tsx   A-Z hunt
│   └── SoundMatch.tsx     hear-and-find (endless cycles)
├── input/
│   ├── useInput.ts        keyboard + Web Gamepad + joystick channel
│   └── VirtualJoystick.tsx nipplejs joystick (touch only)
├── state/
│   ├── store.ts           zustand store (screen, collected, avatar, biome,
│   │                      case, voice, trophies, pending earn-events)
│   └── trophies.ts        trophy registry + earn rules
└── ui/
    ├── MainMenu.tsx       picture-based game selector
    ├── HUD.tsx            in-game home, replay, target letters
    ├── StickerBook.tsx    reward shelf modal (mastered letters)
    ├── TrophyShelf.tsx    trophy display modal
    ├── EarnedTrophyModal.tsx  pop-up celebration when a trophy unlocks
    ├── TrophyLab.tsx      dev: trigger / inspect trophies
    ├── LetterEditor.tsx   dev: tune any 3D letter glyph (lots of knobs)
    ├── LetterTest.tsx     dev: render every glyph in a grid
    ├── AlienEditor.tsx    dev: tune the alien NPC
    ├── QTailEditor.tsx    dev: tune the lowercase-q tail curl
    └── TreeEditor.tsx     dev: tree preview for screen-caps

scripts/
├── generate-audio.ts      Node script: bakes ElevenLabs MP3s once
├── generate-trophies.ts   Node script: bakes trophy PNGs once
└── …                      misc. asset / audio-tuning utilities
public/
├── fonts/helvetiker_bold.typeface.json   bundled font for the letter glyphs
├── trophies/              generated trophy PNGs
├── music/                 background-music tracks
└── audio/                 generated voice MP3s (gitignored)
```

### Why bare three.js, no React Three Fiber?

The first build of the engine used `@react-three/fiber`, but its renderer
refused to mount its child components in this development environment — across
fiber v8 + React 18 and v9 + React 19, with cleared caches and fresh
installs. Rather than fight the framework, the rendering layer is now plain
three.js: a single `Engine` class owns the renderer, scene, camera, lights,
shadow maps, and the per-frame loop. React just mounts the canvas and gets the
live engine via a callback. The result is more predictable lifecycle and
faster cold start.

### Why static audio?

Two reasons. The first is cost — ElevenLabs character credits are precious,
and a kid playing for 30 minutes will trigger the same letter sounds dozens of
times. Pre-baking once means a single generation pays for unlimited play.

The second is latency. A 3-year-old has roughly zero patience for a "loading…"
moment. Cached MP3s start the instant `audio.play()` is called.

### Designed for tiny motor skills

- Big buttons everywhere (≥240×280 in the menu, ≥84px corner buttons in the
  HUD).
- Universal icons (◀ Home, 🔁 Replay, 🏅 Stickers) so a kid who can't read
  still gets the affordance.
- Voice on hover/touch — the menu speaks the option name as you point at it.
- Generous proximity collection (1.6 m radius) so you don't have to land
  exactly on a letter.
- Hint timer that nudges instead of bossing — *"Look all around the world,
  the letter is hiding!"* — fires after long pauses.
- Joystick is sized 140 px and parked 90 px from the corner so a thumb has
  somewhere comfy to live.
- High-contrast colour cues on the HUD: green = found, pink-pulse = next.

---

## Known limitations / future work

- **Microphone pronunciation feedback** (a stretch goal) is not implemented.
  The Web Speech API's `SpeechRecognition` is good enough to get a letter back,
  but reliably grading a 3-year-old's *"buh"* is genuinely hard — it would
  need a small phoneme classifier rather than the standard word recogniser.
- The Helvetiker glyph is a stylised geometric font. A future iteration could
  swap in a curvy schoolbook font (e.g. Andika or Sassoon) to better match the
  letter shapes most pre-K classrooms use.
- Two biomes ship today (Park + Moon). The biome registry makes adding more
  a one-file affair — forest, beach, and underwater are obvious next picks.
- Audio is American English only. ElevenLabs supports many languages — adding
  Spanish or Mandarin would mostly mean a re-run of the generation script
  with translated prompts.

---

## License

All rights reserved. Built by [@billums123](https://github.com/billums123).
