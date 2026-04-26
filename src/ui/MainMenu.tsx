import { useEffect, useRef, useState } from "react";
import { useGameStore } from "../state/store";
import { audio } from "../audio/Player";
import { StickerBook } from "./StickerBook";
import { ALPHABET } from "../audio/types";

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
  const [showStickers, setShowStickers] = useState(false);

  // Welcome line on first paint.
  useEffect(() => {
    audio.play(audio.menu("welcome"));
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
      <footer
        style={{
          padding: "12px 24px 16px",
          color: "#3a2a14",
          fontSize: 14,
          opacity: 0.7,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>WASD / arrows / controller / touch joystick</span>
        <span>
          Voice: {audioMode === "elevenlabs" ? "ElevenLabs" : audioMode === "speech" ? "Browser" : "Off"}
        </span>
      </footer>

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
