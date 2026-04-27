import { useEffect, useRef, useState } from "react";
import { useGameStore } from "../state/store";
import { audio } from "../audio/Player";
import { StickerBook } from "./StickerBook";
import { ALPHABET } from "../audio/types";
import { isDev } from "../util/isDev";

// Picture-based main menu. Designed for ages 3-6: huge buttons, big icons,
// audio narration on hover, no required reading. Pre-readers can navigate
// by visual identification + voice cue.

type GameCardProps = {
  emoji: string;
  title: string;
  subtitle: string;
  color: string;
  voiceClipId: string;
  onSelect: () => void;
  ariaLabel: string;
};

function GameCard({ emoji, title, subtitle, color, voiceClipId, onSelect, ariaLabel }: GameCardProps) {
  const lastSpoken = useRef(0);
  const speak = () => {
    // Throttle speak so a kid bouncing the cursor doesn't trigger a stutter.
    const now = performance.now();
    if (now - lastSpoken.current < 1200) return;
    lastSpoken.current = now;
    audio.play(voiceClipId);
  };
  return (
    <button
      type="button"
      onMouseEnter={speak}
      onFocus={speak}
      onTouchStart={speak}
      onClick={onSelect}
      aria-label={ariaLabel}
      style={{
        appearance: "none",
        border: "6px solid white",
        background: color,
        borderRadius: 28,
        padding: "32px 28px",
        margin: 14,
        minWidth: 240,
        minHeight: 280,
        cursor: "pointer",
        boxShadow: "0 12px 0 rgba(0,0,0,0.18), 0 18px 30px rgba(0,0,0,0.18)",
        color: "#3a2a14",
        font: "inherit",
        textAlign: "center",
        transition: "transform 0.12s ease, box-shadow 0.12s ease",
        outlineOffset: 4,
      }}
      onMouseDown={(e) => (e.currentTarget.style.transform = "translateY(4px)")}
      onMouseUp={(e) => (e.currentTarget.style.transform = "")}
      onMouseLeave={(e) => (e.currentTarget.style.transform = "")}
    >
      <div style={{ fontSize: 96, lineHeight: 1, marginBottom: 12 }} aria-hidden>
        {emoji}
      </div>
      <div style={{ fontSize: 30, fontWeight: 900, letterSpacing: 0.5 }}>{title}</div>
      <div style={{ fontSize: 18, fontWeight: 700, opacity: 0.85, marginTop: 6 }}>{subtitle}</div>
    </button>
  );
}

export function MainMenu() {
  const setScreen = useGameStore((s) => s.setScreen);
  const audioMode = useGameStore((s) => s.audioMode);
  const collected = useGameStore((s) => s.collected);
  const avatar = useGameStore((s) => s.avatar);
  const setAvatar = useGameStore((s) => s.setAvatar);
  const [showStickers, setShowStickers] = useState(false);

  // Stop any leftover voice clip if we land on the menu mid-utterance,
  // but don't auto-play a welcome line — the menu music carries the vibe.
  useEffect(() => {
    return () => audio.stop();
  }, []);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background:
          "radial-gradient(circle at 30% 20%, #ffe9a3 0%, #7ec8ff 60%, #5fa9f0 100%)",
        display: "grid",
        gridTemplateRows: "auto 1fr auto",
        overflow: "hidden",
      }}
    >
      <header style={{ padding: "28px 24px 0", textAlign: "center" }}>
        <h1
          style={{
            margin: 0,
            fontSize: 84,
            color: "#3a2a14",
            textShadow: "0 6px 0 rgba(255,255,255,0.6)",
            letterSpacing: 2,
          }}
        >
          Letra
        </h1>
        <p style={{ marginTop: 6, fontSize: 20, color: "#3a2a14", fontWeight: 800 }}>
          Pick a game!
        </p>
      </header>
      <main
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <GameCard
          emoji="🐱"
          title="Spell the Word"
          subtitle="Find the missing pet"
          color="#ffd56b"
          voiceClipId={audio.menu("spell")}
          onSelect={() => setScreen("spell-word")}
          ariaLabel="Spell the Word — find the letters that spell missing animals"
        />
        <GameCard
          emoji="🔤"
          title="Find the Alphabet"
          subtitle="A all the way to Z"
          color="#9bdc4a"
          voiceClipId={audio.menu("alphabet")}
          onSelect={() => setScreen("find-alphabet")}
          ariaLabel="Find the alphabet from A to Z"
        />
        <GameCard
          emoji="👂"
          title="Match the Sound"
          subtitle="Hear it, find it"
          color="#ff8aaa"
          voiceClipId={audio.menu("sounds")}
          onSelect={() => setScreen("sound-match")}
          ariaLabel="Match the sound to the letter"
        />
      </main>

      <AvatarPicker avatar={avatar} setAvatar={setAvatar} />
      <footer
        style={{
          padding: "12px 24px 16px",
          color: "#3a2a14",
          fontSize: 14,
          opacity: 0.7,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span>WASD / arrows / controller / touch joystick</span>
        <VoicePicker audioMode={audioMode} />
      </footer>

      {/* Authoring tools — only mounted on localhost / dev builds, never
          shown to actual kid users. See src/util/isDev.ts. */}
      {isDev() && (
        <div style={{ position: "absolute", top: 24, left: 24, display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={() => setScreen("letter-test")}
            aria-label="Open the letter test page"
            style={cornerBtn}
          >
            🔍 Letter test
          </button>
          <button
            type="button"
            onClick={() => setScreen("letter-editor")}
            aria-label="Open the 3D letter editor"
            style={cornerBtn}
          >
            ✏️ Editor
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowStickers(true)}
        aria-label={`Sticker book — ${collected.size} of ${ALPHABET.length} letters mastered`}
        style={{
          position: "absolute",
          top: 24,
          right: 24,
          appearance: "none",
          border: "5px solid white",
          background: "#ff8aaa",
          color: "white",
          borderRadius: "50%",
          width: 84,
          height: 84,
          fontSize: 36,
          fontWeight: 900,
          cursor: "pointer",
          boxShadow: "0 8px 0 rgba(0,0,0,0.18)",
          display: "grid",
          placeItems: "center",
        }}
      >
        🏅
        <span
          style={{
            position: "absolute",
            bottom: -8,
            right: -8,
            background: "#3a2a14",
            color: "white",
            fontSize: 16,
            borderRadius: 12,
            padding: "2px 8px",
            border: "3px solid white",
          }}
        >
          {collected.size}
        </span>
      </button>

      <StickerBook open={showStickers} onClose={() => setShowStickers(false)} />
    </div>
  );
}

// Footer-right voice picker. Shows "Voice: <name>" plus a select if more
// than one voice has been generated. The select syncs to the store, which
// triggers Game.tsx to swap the active voice in the AudioPlayer without
// a full reload.
function VoicePicker({ audioMode }: { audioMode: "elevenlabs" | "speech" | "muted" }) {
  const voiceSlug = useGameStore((s) => s.voiceSlug);
  const setVoiceSlug = useGameStore((s) => s.setVoiceSlug);
  // Subscribe to the AudioPlayer so the dropdown updates after init / setVoice.
  const [voices, setVoices] = useState(audio.voices);
  const [activeSlug, setActiveSlug] = useState<string | null>(audio.activeVoice?.slug ?? null);
  useEffect(() => {
    const refresh = () => {
      setVoices([...audio.voices]);
      setActiveSlug(audio.activeVoice?.slug ?? null);
    };
    refresh();
    return audio.subscribe(refresh);
  }, []);

  const showSelect = voices.length > 1;
  const currentName =
    audioMode === "muted"
      ? "Off"
      : audioMode === "speech"
        ? "Browser"
        : audio.activeVoice?.name ?? "ElevenLabs";

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span>Voice: {currentName}</span>
      {showSelect && audioMode === "elevenlabs" && (
        <select
          value={voiceSlug ?? activeSlug ?? voices[0].slug}
          onChange={(e) => setVoiceSlug(e.target.value)}
          aria-label="Choose voice"
          style={{
            padding: "4px 6px",
            fontSize: 12,
            fontWeight: 700,
            border: "2px solid white",
            borderRadius: 8,
            background: "rgba(255,255,255,0.85)",
            color: "#3a2a14",
            cursor: "pointer",
          }}
        >
          {voices.map((v) => (
            <option key={v.slug} value={v.slug}>{v.name}</option>
          ))}
        </select>
      )}
    </span>
  );
}

type AvatarOption = { kind: "kid" | "car"; label: string; emoji: string; color: string };
const AVATAR_OPTIONS: AvatarOption[] = [
  { kind: "kid", label: "Kid", emoji: "🧒", color: "#ff8c4a" },
  { kind: "car", label: "Car", emoji: "🚗", color: "#ff5555" },
];

// Two cartoony cards floating along the bottom-left of the menu so kids
// can switch what they drive without having to leave the menu screen.
// The active option gets a thicker ring + slight pop. Voiceover speaks
// the option name when hovered/touched (helps non-readers).
function AvatarPicker({
  avatar,
  setAvatar,
}: {
  avatar: "kid" | "car";
  setAvatar: (a: "kid" | "car") => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 24,
        left: 24,
        display: "flex",
        gap: 10,
        zIndex: 8,
      }}
      aria-label="Pick your character"
    >
      <span
        style={{
          alignSelf: "center",
          fontSize: 13,
          fontWeight: 800,
          background: "rgba(255,255,255,0.8)",
          color: "#3a2a14",
          padding: "6px 10px",
          borderRadius: 10,
          marginRight: 4,
        }}
      >
        Play as:
      </span>
      {AVATAR_OPTIONS.map((opt) => {
        const active = avatar === opt.kind;
        return (
          <button
            key={opt.kind}
            type="button"
            onClick={() => {
              setAvatar(opt.kind);
              audio.speak(opt.label);
            }}
            onMouseEnter={() => audio.speak(opt.label)}
            onTouchStart={() => audio.speak(opt.label)}
            aria-label={`Play as ${opt.label}${active ? ", currently selected" : ""}`}
            aria-pressed={active}
            style={{
              appearance: "none",
              border: active ? "5px solid white" : "3px solid rgba(255,255,255,0.6)",
              background: opt.color,
              color: "white",
              borderRadius: 22,
              padding: "10px 14px 6px",
              cursor: "pointer",
              boxShadow: active ? "0 8px 0 rgba(0,0,0,0.2)" : "0 4px 0 rgba(0,0,0,0.15)",
              minWidth: 76,
              transform: active ? "translateY(-2px)" : "none",
              transition: "transform 0.12s ease",
            }}
          >
            <div style={{ fontSize: 36, lineHeight: 1 }} aria-hidden>{opt.emoji}</div>
            <div style={{ fontSize: 12, fontWeight: 900, marginTop: 4 }}>{opt.label}</div>
          </button>
        );
      })}
    </div>
  );
}

const cornerBtn: React.CSSProperties = {
  appearance: "none",
  border: "4px solid white",
  background: "rgba(255,255,255,0.7)",
  color: "#3a2a14",
  borderRadius: 16,
  padding: "8px 14px",
  fontSize: 14,
  fontWeight: 800,
  cursor: "pointer",
  boxShadow: "0 4px 0 rgba(0,0,0,0.12)",
};
