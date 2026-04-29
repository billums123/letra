import { useEffect, useRef, useState } from "react";
import { useGameStore } from "../state/store";
import { getTrophy } from "../state/trophies";
import { audio } from "../audio/Player";
import { playWoo } from "../audio/sfx";

// Modal that fires whenever the kid earns a trophy. Watches the head of
// the pendingEarns queue in the store and renders an animated celebration
// over the current screen. Tapping anywhere dismisses (returning the
// game to its prior state and popping the next event off the queue).
//
// Mounted once at the app root (Game.tsx) so it shows during gameplay
// AND on the menu — the kid never misses a milestone regardless of
// where they are when it triggers.

export function EarnedTrophyModal() {
  const earn = useGameStore((s) => s.pendingEarns[0]) ?? null;
  const dismiss = useGameStore((s) => s.dismissEarn);

  // Local enter/leave state so we can play an exit animation before the
  // event is actually popped from the queue.
  const [phase, setPhase] = useState<"enter" | "settled" | "exit">("enter");
  // Track the earn we're currently animating. When the head of the queue
  // changes (after dismiss + animation finishes), we restart from "enter".
  const lastEarnIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!earn) {
      lastEarnIdRef.current = null;
      return;
    }
    const key = `${earn.id}:${earn.count}`;
    if (lastEarnIdRef.current !== key) {
      lastEarnIdRef.current = key;
      setPhase("enter");
      // Audio: short celebratory whoop, then speak the trophy name.
      // Don't await — audio failures shouldn't block the modal.
      try {
        playWoo();
      } catch {
        // Non-fatal — celebration audio is nice-to-have.
      }
      // Speak the name a beat after the woo lands. We use the synthesis
      // path directly because trophies don't have pre-rendered clips.
      const t = setTimeout(() => {
        try {
          // Trophy names aren't pre-rendered clips, so we route through
          // the speech-synthesis fallback (Player.speak) which works in
          // every audio mode.
          void audio.speak(`${getTrophy(earn.id).name}!`);
        } catch {
          // ignore
        }
      }, 500);
      // Settle into the resting state so the trophy stops bouncing.
      const t2 = setTimeout(() => setPhase("settled"), 900);
      return () => {
        clearTimeout(t);
        clearTimeout(t2);
      };
    }
  }, [earn]);

  if (!earn) return null;
  const spec = getTrophy(earn.id);

  const handleDismiss = () => {
    setPhase("exit");
    // Brief exit animation, then pop the queue.
    setTimeout(() => {
      dismiss();
      setPhase("enter");
    }, 220);
  };

  // The trophy art lives at /trophies/<id>.png. If missing, fall back
  // to the emoji glyph in the spec — keeps the modal usable even before
  // the asset gen script has been run.
  const imgSrc = `/trophies/${spec.id}.png`;

  return (
    <div
      role="dialog"
      aria-label={`You earned ${spec.name}!`}
      onClick={handleDismiss}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 100,
        background:
          phase === "exit"
            ? "rgba(0,0,0,0)"
            : "radial-gradient(circle at 50% 40%, rgba(255,236,150,0.55) 0%, rgba(0,0,0,0.6) 70%)",
        display: "grid",
        placeItems: "center",
        cursor: "pointer",
        transition: "background 0.22s ease",
        userSelect: "none",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {/* Confetti — pure CSS, no external deps. Render a fixed set of
          falling shapes and rely on randomized animation delays. */}
      <Confetti show={phase !== "exit"} />

      <div
        style={{
          // Strict column flex with everything center-aligned on a
          // shared vertical axis — replaces the previous mix of
          // inline-block + textAlign which made the NEW! sash and
          // the trophy frame sit off-axis from each other.
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          color: "#3a2a14",
          transform:
            phase === "exit"
              ? "translateY(-30px) scale(0.7)"
              : phase === "settled"
                ? "translateY(0) scale(1)"
                : "translateY(20px) scale(0.4)",
          opacity: phase === "exit" ? 0 : 1,
          transition:
            phase === "exit"
              ? "transform 0.22s ease, opacity 0.22s ease"
              : "transform 0.55s cubic-bezier(0.34, 1.8, 0.64, 1), opacity 0.4s ease",
          maxWidth: "min(92vw, 540px)",
          padding: 24,
          gap: 0,
        }}
      >
        {/* Trophy tile + corner-pinned NEW! sash. The sash is absolutely
            positioned over the white frame so it doesn't shove the rest
            of the column off the centre axis. */}
        <div
          style={{
            background: "white",
            borderRadius: 32,
            border: "8px solid white",
            boxShadow:
              "0 18px 0 rgba(0,0,0,0.18), 0 30px 60px rgba(0,0,0,0.35)",
            padding: 18,
            position: "relative",
          }}
        >
          {earn.firstTime && (
            <div
              aria-hidden
              style={{
                position: "absolute",
                top: -16,
                left: -16,
                background: "#ff5577",
                color: "white",
                fontWeight: 900,
                padding: "6px 18px",
                fontSize: 22,
                borderRadius: 999,
                border: "4px solid white",
                boxShadow: "0 6px 0 rgba(0,0,0,0.18)",
                transform: "rotate(-10deg)",
                letterSpacing: 2,
                zIndex: 1,
              }}
            >
              NEW!
            </div>
          )}
          <div
            style={{
              width: 280,
              height: 280,
              maxWidth: "70vw",
              maxHeight: "70vw",
              borderRadius: 24,
              background: spec.tileColor,
              display: "grid",
              placeItems: "center",
              position: "relative",
              overflow: "hidden",
              boxShadow:
                "inset 0 8px 0 rgba(255,255,255,0.4), inset 0 -8px 0 rgba(0,0,0,0.06)",
              // Container size for the fallback emoji's cqmin sizing —
              // makes the emoji scale with the tile rather than blowing
              // out at fixed 180px and getting clipped.
              containerType: "size",
            }}
          >
            <TrophyImage
              src={imgSrc}
              alt={spec.name}
              fallback={spec.fallbackEmoji}
              size="78%"
            />
            {earn.count > 1 && (
              <div
                style={{
                  position: "absolute",
                  bottom: 12,
                  right: 12,
                  background: "#ffcf3a",
                  color: "#5a3a00",
                  border: "5px solid white",
                  borderRadius: 999,
                  padding: "6px 18px",
                  fontWeight: 900,
                  fontSize: 32,
                  boxShadow: "0 4px 0 rgba(0,0,0,0.2)",
                }}
              >
                ×{earn.count}
              </div>
            )}
          </div>
        </div>
        <div
          style={{
            marginTop: 22,
            fontSize: 38,
            fontWeight: 900,
            lineHeight: 1.05,
            textShadow: "0 3px 0 rgba(255,255,255,0.5)",
          }}
        >
          {spec.name}!
        </div>
        <div
          style={{
            marginTop: 6,
            fontSize: 18,
            fontWeight: 700,
            opacity: 0.7,
            lineHeight: 1.25,
            // Cap trigger-line width so the sentence wraps on its own
            // line break rather than at random spots in narrow modals.
            maxWidth: 360,
          }}
        >
          {spec.trigger}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleDismiss();
          }}
          style={{
            marginTop: 22,
            appearance: "none",
            border: "6px solid white",
            background: "#9bdc4a",
            color: "white",
            borderRadius: 28,
            padding: "16px 40px",
            fontSize: 30,
            fontWeight: 900,
            cursor: "pointer",
            boxShadow:
              "0 10px 0 rgba(0,0,0,0.18), 0 14px 24px rgba(0,0,0,0.22)",
            animation: "letra-trophy-bounce 0.8s ease-in-out infinite",
          }}
        >
          Yay! ▶
        </button>
      </div>

      <style>{`
        @keyframes letra-trophy-bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
      `}</style>
    </div>
  );
}

// Image with PNG/emoji fallback — used by the modal AND the shelf so
// the rendering rules stay consistent. We always wrap in a sized box
// (width = height = `size`) and the emoji fallback uses cqmin so its
// font-size tracks the wrapper instead of the viewport (which used to
// produce a huge ear emoji that overflowed small tiles).
export function TrophyImage({
  src,
  alt,
  fallback,
  size = "88%",
  grayscale = false,
}: {
  src: string;
  alt: string;
  fallback: string;
  size?: string;
  grayscale?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "grid",
        placeItems: "center",
        containerType: "size",
      }}
    >
      {failed ? (
        <span
          aria-label={alt}
          style={{
            fontSize: "70cqmin",
            lineHeight: 1,
            filter: grayscale ? "grayscale(1) opacity(0.35)" : "none",
            userSelect: "none",
          }}
        >
          {fallback}
        </span>
      ) : (
        <img
          src={src}
          alt={alt}
          onError={() => setFailed(true)}
          draggable={false}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            filter: grayscale
              ? "grayscale(1) brightness(0.7) opacity(0.35)"
              : "drop-shadow(0 8px 0 rgba(0,0,0,0.14)) drop-shadow(0 4px 10px rgba(0,0,0,0.18))",
            userSelect: "none",
          }}
        />
      )}
    </div>
  );
}

// Lightweight CSS-only confetti shower. Renders ~24 falling shapes.
function Confetti({ show }: { show: boolean }) {
  const items = Array.from({ length: 24 }, (_, i) => i);
  const colors = ["#ff5577", "#ffcf3a", "#9bdc4a", "#5fa9f0", "#c4a8ff", "#ffb084"];
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        opacity: show ? 1 : 0,
        transition: "opacity 0.4s ease",
        overflow: "hidden",
      }}
    >
      {items.map((i) => {
        const left = (i / items.length) * 100 + (i % 3) * 4 - 4;
        const delay = (i % 7) * 0.12;
        const duration = 1.6 + (i % 5) * 0.18;
        const size = 8 + (i % 4) * 4;
        const color = colors[i % colors.length];
        const rotate = (i * 47) % 360;
        return (
          <span
            key={i}
            style={{
              position: "absolute",
              left: `${left}%`,
              top: -20,
              width: size,
              height: size * 0.4,
              background: color,
              borderRadius: 2,
              transform: `rotate(${rotate}deg)`,
              animation: `letra-confetti-fall ${duration}s linear ${delay}s infinite`,
            }}
          />
        );
      })}
      <style>{`
        @keyframes letra-confetti-fall {
          0%   { transform: translateY(0)  rotate(0deg); }
          100% { transform: translateY(110vh) rotate(720deg); }
        }
      `}</style>
    </div>
  );
}
