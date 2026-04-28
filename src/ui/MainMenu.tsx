import { useEffect, useRef, useState } from "react";
import { useGameStore } from "../state/store";
import { audio } from "../audio/Player";
import { StickerBook } from "./StickerBook";
import { ALPHABET } from "../audio/types";
import { isDev } from "../util/isDev";
import { useIsCompact } from "../util/useIsCompact";
import { BIOMES } from "../engine/biomes";

// Picture-based main menu. Designed for ages 3-6: huge buttons, big icons,
// audio narration on hover, no required reading. Pre-readers can navigate
// by visual identification + voice cue.

type GameCardProps = {
  // Either an emoji glyph or a URL for a PNG icon. PNG wins when both
  // are provided — emoji is a friendly fallback if the file is missing.
  emoji?: string;
  iconUrl?: string;
  title: string;
  subtitle: string;
  color: string;
  voiceClipId: string;
  onSelect: () => void;
  ariaLabel: string;
};

function GameCard({ emoji, iconUrl, title, subtitle, color, voiceClipId, onSelect, ariaLabel, compact }: GameCardProps & { compact: boolean }) {
  const lastSpoken = useRef(0);
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const speak = () => {
    // Throttle speak so a kid bouncing the cursor doesn't trigger a stutter.
    const now = performance.now();
    if (now - lastSpoken.current < 1200) return;
    lastSpoken.current = now;
    audio.play(voiceClipId);
  };
  const iconSize = compact ? 120 : 180;
  // Compose the card transform from press / hover state. Pressed wins
  // (drops the card 4px) but hover gives a small lift + tilt that
  // reads as "this is alive, you can tap me".
  const transform = pressed
    ? "translateY(4px) rotate(0deg)"
    : hover
      ? "translateY(-4px) rotate(-1deg) scale(1.02)"
      : "translateY(0) rotate(0deg) scale(1)";
  // Soft inner highlight at the top of the card adds a touch of depth
  // without changing the overall colour. We layer it on top of the
  // solid card colour with a vertical gradient.
  const cardBg = `linear-gradient(180deg, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0) 38%), ${color}`;
  return (
    <button
      type="button"
      onMouseEnter={() => { setHover(true); speak(); }}
      onMouseLeave={() => { setHover(false); setPressed(false); }}
      onFocus={() => { setHover(true); speak(); }}
      onBlur={() => setHover(false)}
      onTouchStart={() => { setPressed(true); speak(); }}
      onTouchEnd={() => setPressed(false)}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onClick={onSelect}
      aria-label={ariaLabel}
      style={{
        appearance: "none",
        border: compact ? "5px solid white" : "6px solid white",
        background: cardBg,
        borderRadius: compact ? 24 : 30,
        padding: compact ? "16px 14px 18px" : "28px 24px 24px",
        margin: 0,
        minWidth: 0,
        // Fixed minimum so all cards stay the same height even if a
        // longer title wraps to two lines.
        minHeight: compact ? 240 : 340,
        cursor: "pointer",
        boxShadow: pressed
          ? "0 4px 0 rgba(0,0,0,0.18), 0 6px 12px rgba(0,0,0,0.15)"
          : hover
            ? "0 14px 0 rgba(0,0,0,0.18), 0 22px 32px rgba(0,0,0,0.22)"
            : "0 10px 0 rgba(0,0,0,0.18), 0 14px 24px rgba(0,0,0,0.18)",
        color: "#3a2a14",
        font: "inherit",
        textAlign: "center",
        transform,
        transition: "transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.18s ease",
        outlineOffset: 4,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-start",
        // Don't allow the icon to bleed visually into the next card —
        // a quick crop matches the rounded card edge.
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div
        style={{
          width: "100%",
          height: iconSize,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          // Slight lift for the icon during hover so it pops off the card.
          transform: hover ? "translateY(-3px) scale(1.04)" : "none",
          transition: "transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
        aria-hidden
      >
        {iconUrl ? (
          <img
            src={iconUrl}
            alt=""
            style={{
              width: iconSize,
              height: iconSize,
              objectFit: "contain",
              filter: "drop-shadow(0 8px 0 rgba(0,0,0,0.14)) drop-shadow(0 4px 10px rgba(0,0,0,0.18))",
            }}
            draggable={false}
          />
        ) : (
          <div style={{ fontSize: compact ? 88 : 108, lineHeight: 1 }}>{emoji}</div>
        )}
      </div>
      <div
        style={{
          // Title + subtitle share a flex column that balances the card
          // bottom regardless of title length.
          marginTop: compact ? 6 : 10,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
        }}
      >
        <div
          style={{
            // clamp() keeps the title from blowing the card width when
            // it wraps (Find the Alphabet → 2 lines on narrow phones)
            // while still reading large on desktop.
            fontSize: compact ? "clamp(18px, 5vw, 22px)" : 30,
            fontWeight: 900,
            letterSpacing: 0.4,
            lineHeight: 1.1,
            textShadow: "0 2px 0 rgba(255,255,255,0.4)",
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: compact ? 13 : 17,
            fontWeight: 700,
            opacity: 0.78,
          }}
        >
          {subtitle}
        </div>
      </div>
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
  const compact = useIsCompact();

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
        display: "flex",
        flexDirection: "column",
        // Let the menu scroll vertically when the viewport is shorter
        // than its content (phones in portrait). Horizontal hidden so a
        // stray card overflow can't introduce a sideways scroll bar.
        overflowX: "hidden",
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
      }}
    >
      <header style={{ padding: compact ? "16px 16px 0" : "28px 24px 0", textAlign: "center" }}>
        <h1
          style={{
            margin: 0,
            fontSize: compact ? 52 : 84,
            color: "#3a2a14",
            textShadow: "0 6px 0 rgba(255,255,255,0.6)",
            letterSpacing: 2,
            // Reserve room on the right for the absolutely-positioned
            // sticker badge so the title doesn't slide under it.
            paddingRight: compact ? 64 : 0,
            paddingLeft: compact ? (isDev() ? 64 : 0) : 0,
          }}
        >
          Letra
        </h1>
        <p style={{ marginTop: 4, fontSize: compact ? 16 : 20, color: "#3a2a14", fontWeight: 800 }}>
          Pick a game!
        </p>
      </header>
      <main
        style={{
          display: "grid",
          // auto-fit collapses to one column on phones, two cards
          // sit comfortably on tablet, and on desktop we cap each
          // card at ~360px so two-card layouts don't stretch into
          // wide ribbons. The container max-width keeps everything
          // centred with healthy breathing room on big screens.
          gridTemplateColumns: compact
            ? "repeat(auto-fit, minmax(240px, 1fr))"
            : "repeat(auto-fit, minmax(280px, 360px))",
          justifyContent: "center",
          alignItems: "stretch",
          gap: compact ? 12 : 28,
          padding: compact ? "12px 14px" : "24px 32px",
          maxWidth: 1240,
          width: "100%",
          margin: "0 auto",
          // Push the cards toward the visual centre on tall desktop
          // viewports rather than letting them sit at the very top.
          flex: compact ? "0 0 auto" : "1 1 auto",
          alignSelf: "center",
        }}
      >
        <GameCard
          iconUrl="/icons/spell-word.png"
          emoji="🐱"
          title="Spell the Word"
          subtitle="Find the missing pet"
          color="#ffd56b"
          voiceClipId={audio.menu("spell")}
          onSelect={() => setScreen("spell-word")}
          ariaLabel="Spell the Word — find the letters that spell missing animals"
          compact={compact}
        />
        <GameCard
          iconUrl="/icons/find-alphabet.png"
          emoji="🔤"
          title="Find the Alphabet"
          subtitle="A all the way to Z"
          color="#9bdc4a"
          voiceClipId={audio.menu("alphabet")}
          onSelect={() => setScreen("find-alphabet")}
          ariaLabel="Find the alphabet from A to Z"
          compact={compact}
        />
        {/* Match the Sound is dev-gated for now while we keep iterating
            on the audio match heuristics — kid users only see Spell
            the Word and Find the Alphabet. Drop the isDev() wrapper to
            re-enable it. */}
        {isDev() && (
          <GameCard
            iconUrl="/icons/match-sound.png"
            emoji="👂"
            title="Match the Sound"
            subtitle="Hear it, find it"
            color="#ff8aaa"
            voiceClipId={audio.menu("sounds")}
            onSelect={() => setScreen("sound-match")}
            ariaLabel="Match the sound to the letter"
            compact={compact}
          />
        )}
      </main>

      {/* Bottom bar — one tidy flex row containing every control. On
          desktop the layout is [avatar] [world] | [voice], on phones
          everything centres + wraps. The previous design had each
          picker absolutely-positioned at a different corner, which
          collided with the WASD hint and got messy whenever a
          third card wrapped or the viewport got narrow. */}
      <footer
        style={{
          padding: compact ? "10px 14px 18px" : "16px 24px 16px",
          color: "#3a2a14",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "center",
          gap: compact ? 10 : 18,
          paddingBottom: `calc(${compact ? 18 : 16}px + env(safe-area-inset-bottom, 0px))`,
        }}
      >
        <AvatarPicker avatar={avatar} setAvatar={setAvatar} compact={compact} />
        <BiomePicker compact={compact} />
        <VoicePicker audioMode={audioMode} />
      </footer>

      {/* Authoring tools — only mounted on localhost / dev builds, never
          shown to actual kid users. See src/util/isDev.ts. */}
      {isDev() && (
        <div style={{ position: "absolute", top: compact ? 12 : 24, left: compact ? 12 : 24, display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={() => setScreen("letter-test")}
            aria-label="Open the letter test page"
            style={compact ? compactCornerBtn : cornerBtn}
          >
            {compact ? "🔍" : "🔍 Letter test"}
          </button>
          <button
            type="button"
            onClick={() => setScreen("letter-editor")}
            aria-label="Open the 3D letter editor"
            style={compact ? compactCornerBtn : cornerBtn}
          >
            {compact ? "✏️" : "✏️ Editor"}
          </button>
          <button
            type="button"
            onClick={() => setScreen("alien-editor")}
            aria-label="Open the alien editor"
            style={compact ? compactCornerBtn : cornerBtn}
          >
            {compact ? "👽" : "👽 Alien"}
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowStickers(true)}
        aria-label={`Sticker book — ${collected.size} of ${ALPHABET.length} letters mastered`}
        style={{
          position: "absolute",
          top: compact ? 12 : 24,
          right: compact ? 12 : 24,
          appearance: "none",
          border: compact ? "4px solid white" : "5px solid white",
          background: "#ff8aaa",
          color: "white",
          borderRadius: "50%",
          width: compact ? 56 : 84,
          height: compact ? 56 : 84,
          fontSize: compact ? 24 : 36,
          fontWeight: 900,
          cursor: "pointer",
          boxShadow: "0 6px 0 rgba(0,0,0,0.18)",
          display: "grid",
          placeItems: "center",
        }}
      >
        🏅
        <span
          style={{
            position: "absolute",
            bottom: -6,
            right: -6,
            background: "#3a2a14",
            color: "white",
            fontSize: compact ? 12 : 16,
            borderRadius: 12,
            padding: compact ? "1px 6px" : "2px 8px",
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
// Custom voice picker. The native <select> on mobile pops up a tiny
// system picker that doesn't match the app at all and is awkward to
// hit with a thumb. This rolls its own popover: a chunky pill button
// shows the current voice; tapping opens a vertical card of styled
// voice chips. Closes on outside click or Escape.
function VoicePicker({ audioMode }: { audioMode: "elevenlabs" | "speech" | "muted" }) {
  const voiceSlug = useGameStore((s) => s.voiceSlug);
  const setVoiceSlug = useGameStore((s) => s.setVoiceSlug);
  // Subscribe to the AudioPlayer so the picker updates after init / setVoice.
  const [voices, setVoices] = useState(audio.voices);
  const [activeSlug, setActiveSlug] = useState<string | null>(audio.activeVoice?.slug ?? null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const refresh = () => {
      setVoices([...audio.voices]);
      setActiveSlug(audio.activeVoice?.slug ?? null);
    };
    refresh();
    return audio.subscribe(refresh);
  }, []);

  // Dismiss on outside click + Escape so the popover behaves like every
  // other dropdown a user has touched.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const canPick = voices.length > 1 && audioMode === "elevenlabs";
  const currentSlug = voiceSlug ?? activeSlug ?? voices[0]?.slug ?? null;
  const currentName =
    audioMode === "muted"
      ? "Off"
      : audioMode === "speech"
        ? "Browser"
        : audio.activeVoice?.name ?? "ElevenLabs";

  // Single voice or non-ElevenLabs mode: render a static read-only pill.
  if (!canPick) {
    return (
      <span style={voiceTriggerStyle(false)} aria-label={`Current voice: ${currentName}`}>
        <span aria-hidden style={{ fontSize: 18 }}>🎤</span>
        <span>{currentName}</span>
      </span>
    );
  }

  return (
    <div ref={rootRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Voice: ${currentName}. Tap to change.`}
        style={voiceTriggerStyle(open)}
      >
        <span aria-hidden style={{ fontSize: 18 }}>🎤</span>
        <span>{currentName}</span>
        <span aria-hidden style={{ fontSize: 12, opacity: 0.7, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.12s ease" }}>▼</span>
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Choose voice"
          style={{
            position: "absolute",
            // Anchor above the button so the popover can't extend below
            // the bottom of the menu (where the iOS home-bar lives).
            bottom: "calc(100% + 8px)",
            right: 0,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: 8,
            minWidth: 180,
            background: "white",
            border: "3px solid #3a2a14",
            borderRadius: 18,
            boxShadow: "0 12px 24px rgba(0,0,0,0.22), 0 6px 0 rgba(0,0,0,0.15)",
            zIndex: 30,
          }}
        >
          {voices.map((v) => {
            const active = v.slug === currentSlug;
            return (
              <button
                key={v.slug}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  setVoiceSlug(v.slug);
                  setOpen(false);
                }}
                style={{
                  appearance: "none",
                  border: active ? "3px solid #3a2a14" : "3px solid transparent",
                  background: active ? "#ffd56b" : "rgba(0,0,0,0.04)",
                  color: "#3a2a14",
                  borderRadius: 14,
                  padding: "10px 14px",
                  fontSize: 16,
                  fontWeight: 800,
                  cursor: "pointer",
                  textAlign: "left",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  // Big enough touch target — Apple HIG says 44pt minimum,
                  // and a 3-year-old's thumb is even less precise.
                  minHeight: 44,
                }}
              >
                <span aria-hidden style={{ fontSize: 18 }}>{active ? "🎙️" : "🎤"}</span>
                <span style={{ flex: 1 }}>{v.name}</span>
                {active && <span aria-hidden style={{ fontSize: 16 }}>✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Pill-button styling shared between the open / read-only states.
function voiceTriggerStyle(open: boolean): React.CSSProperties {
  return {
    appearance: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    border: open ? "3px solid #3a2a14" : "3px solid white",
    background: open ? "#ffd56b" : "rgba(255,255,255,0.85)",
    color: "#3a2a14",
    borderRadius: 999,
    padding: "8px 14px",
    fontSize: 14,
    fontWeight: 800,
    cursor: "pointer",
    boxShadow: "0 4px 0 rgba(0,0,0,0.12)",
    minHeight: 40,
  };
}

type AvatarOption = { kind: "kid" | "car" | "rocket"; label: string; emoji: string; color: string };
const AVATAR_OPTIONS: AvatarOption[] = [
  { kind: "kid", label: "Kid", emoji: "🧒", color: "#ff8c4a" },
  { kind: "car", label: "Car", emoji: "🚗", color: "#ff5555" },
  { kind: "rocket", label: "Rocket", emoji: "🚀", color: "#7e9bff" },
];

// Two cartoony cards floating along the bottom-left of the menu so kids
// can switch what they drive without having to leave the menu screen.
// The active option gets a thicker ring + slight pop. Voiceover speaks
// the option name when hovered/touched (helps non-readers).
//
// On phones we drop the absolute positioning and put the picker in
// document flow above the footer — that prevents it from sitting on
// top of the third game card on tall narrow viewports.
function AvatarPicker({
  avatar,
  setAvatar,
  compact: _compact,
}: {
  avatar: "kid" | "car" | "rocket";
  setAvatar: (a: "kid" | "car" | "rocket") => void;
  compact: boolean;
}) {
  void _compact;
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        alignItems: "center",
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

// Pill chips along the bottom-right (or top of footer on phones)
// that swap the active biome. Currently experimental — the registry
// in src/engine/biomes ships meadow + moon. Selecting one writes
// to the store; the engine reads it on next mount, so the choice
// takes effect when the kid enters a game.
function BiomePicker({ compact: _compact }: { compact: boolean }) {
  void _compact;
  const biomeId = useGameStore((s) => s.biomeId);
  const setBiomeId = useGameStore((s) => s.setBiomeId);
  const setAvatar = useGameStore((s) => s.setAvatar);
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
      }}
      aria-label="Pick a world"
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
        }}
      >
        World:
      </span>
      {BIOMES.map((b) => {
        const active = biomeId === b.id;
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => {
              setBiomeId(b.id);
              // Each biome can suggest a "go-with" avatar. Apply it
              // automatically so picking the moon also flips you to
              // the rocket — feels right and saves a tap.
              if (b.recommendedAvatar) setAvatar(b.recommendedAvatar);
            }}
            aria-label={`World: ${b.label}${active ? ", currently selected" : ""}`}
            aria-pressed={active}
            style={{
              appearance: "none",
              border: active ? "4px solid #3a2a14" : "3px solid white",
              background: active ? "#fff7d6" : "rgba(255,255,255,0.85)",
              color: "#3a2a14",
              borderRadius: 18,
              padding: "8px 12px 6px",
              cursor: "pointer",
              boxShadow: active ? "0 6px 0 rgba(0,0,0,0.18)" : "0 4px 0 rgba(0,0,0,0.12)",
              minWidth: 64,
              transform: active ? "translateY(-2px)" : "none",
              transition: "transform 0.12s ease",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <span aria-hidden style={{ fontSize: 22, lineHeight: 1 }}>{b.emoji}</span>
            <span style={{ fontSize: 11, fontWeight: 900, marginTop: 2 }}>{b.label}</span>
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

// Compact icon-only variant for the dev tools on phone — same affordance,
// barely-there footprint so we don't crowd the title.
const compactCornerBtn: React.CSSProperties = {
  ...cornerBtn,
  padding: 0,
  width: 40,
  height: 40,
  fontSize: 18,
  borderRadius: 12,
  borderWidth: 3,
  display: "grid",
  placeItems: "center",
};
