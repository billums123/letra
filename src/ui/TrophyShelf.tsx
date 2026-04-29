import { useState } from "react";
import { useGameStore } from "../state/store";
import { TROPHIES, type TrophySpec } from "../state/trophies";
import { audio } from "../audio/Player";
import { TrophyImage } from "./EarnedTrophyModal";

// Full-screen trophy shelf overlay. Reached from the top-right button
// on the main menu. Earned trophies show in full colour; unearned
// trophies show as soft greyed silhouettes so the kid can see what's
// still up for grabs.
//
// Tapping any trophy speaks its name + how-to-earn line aloud (handy
// for pre-readers — the icon already tells the visual story but the
// audio confirms what they're looking at).

type TrophyShelfProps = {
  open: boolean;
  onClose: () => void;
};

export function TrophyShelf({ open, onClose }: TrophyShelfProps) {
  const trophies = useGameStore((s) => s.trophies);
  const [selected, setSelected] = useState<TrophySpec | null>(null);

  if (!open) return null;
  const earnedCount = TROPHIES.filter((t) => (trophies[t.id] ?? 0) > 0).length;

  return (
    <div
      role="dialog"
      aria-label="Trophy shelf"
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "grid",
        placeItems: "center",
        zIndex: 50,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "linear-gradient(180deg, #fff7d6, #ffd56b)",
          border: "8px solid white",
          borderRadius: 32,
          padding: 24,
          maxWidth: 880,
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 18px 0 rgba(0,0,0,0.18), 0 30px 60px rgba(0,0,0,0.3)",
          color: "#3a2a14",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 40, fontWeight: 900, lineHeight: 1.1 }}>
          🏆 Your Trophies
        </div>
        <div style={{ marginTop: 6, fontWeight: 700, fontSize: 18 }}>
          {earnedCount} of {TROPHIES.length} won
        </div>

        <div
          style={{
            marginTop: 22,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            gap: 14,
          }}
        >
          {TROPHIES.map((t) => {
            const count = trophies[t.id] ?? 0;
            const earned = count > 0;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setSelected(t);
                  void audio.speak(
                    earned ? `${t.name}!` : `Locked. ${t.trigger}`,
                  );
                }}
                aria-label={
                  earned
                    ? `${t.name} — won${count > 1 ? ` ${count} times` : ""}`
                    : `Locked: ${t.name}. ${t.trigger}`
                }
                style={{
                  appearance: "none",
                  border: "5px solid white",
                  borderRadius: 22,
                  padding: 0,
                  cursor: "pointer",
                  background: t.tileColor,
                  position: "relative",
                  aspectRatio: "1 / 1",
                  display: "grid",
                  placeItems: "center",
                  overflow: "hidden",
                  filter: earned ? "none" : "saturate(0.4) brightness(1.05)",
                  boxShadow: earned
                    ? "0 8px 0 rgba(0,0,0,0.18), 0 12px 18px rgba(0,0,0,0.18)"
                    : "0 4px 0 rgba(0,0,0,0.12)",
                  transition: "transform 0.18s ease, box-shadow 0.18s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-3px) scale(1.03)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "none";
                }}
              >
                <TrophyImage
                  src={`/trophies/${t.id}.png`}
                  alt={t.name}
                  fallback={t.fallbackEmoji}
                  size="86%"
                  grayscale={!earned}
                />
                {earned && count > 1 && (
                  <span
                    style={{
                      position: "absolute",
                      bottom: 6,
                      right: 6,
                      background: "#ffcf3a",
                      color: "#5a3a00",
                      border: "3px solid white",
                      borderRadius: 999,
                      padding: "2px 10px",
                      fontWeight: 900,
                      fontSize: 16,
                      boxShadow: "0 2px 0 rgba(0,0,0,0.18)",
                    }}
                  >
                    ×{count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onClose}
          style={{
            marginTop: 22,
            appearance: "none",
            border: "5px solid white",
            background: "#5fa9f0",
            color: "white",
            borderRadius: 999,
            padding: "12px 32px",
            fontSize: 22,
            fontWeight: 900,
            cursor: "pointer",
            boxShadow: "0 8px 0 rgba(0,0,0,0.18)",
          }}
        >
          Done
        </button>
      </div>

      {selected && (
        <TrophyDetail trophy={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function TrophyDetail({
  trophy,
  onClose,
}: {
  trophy: TrophySpec;
  onClose: () => void;
}) {
  const count = useGameStore((s) => s.trophies[trophy.id] ?? 0);
  const earned = count > 0;
  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "grid",
        placeItems: "center",
        zIndex: 60,
        cursor: "pointer",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "white",
          borderRadius: 32,
          border: "8px solid white",
          padding: 18,
          maxWidth: 380,
          width: "92vw",
          textAlign: "center",
          color: "#3a2a14",
          boxShadow: "0 18px 0 rgba(0,0,0,0.18), 0 30px 60px rgba(0,0,0,0.35)",
        }}
      >
        <div
          style={{
            width: "100%",
            aspectRatio: "1 / 1",
            background: trophy.tileColor,
            borderRadius: 24,
            display: "grid",
            placeItems: "center",
            position: "relative",
            overflow: "hidden",
            filter: earned ? "none" : "saturate(0.4) brightness(1.05)",
          }}
        >
          <TrophyImage
            src={`/trophies/${trophy.id}.png`}
            alt={trophy.name}
            fallback={trophy.fallbackEmoji}
            size="84%"
            grayscale={!earned}
          />
          {earned && count > 1 && (
            <span
              style={{
                position: "absolute",
                bottom: 12,
                right: 12,
                background: "#ffcf3a",
                color: "#5a3a00",
                border: "5px solid white",
                borderRadius: 999,
                padding: "4px 16px",
                fontWeight: 900,
                fontSize: 26,
                boxShadow: "0 4px 0 rgba(0,0,0,0.2)",
              }}
            >
              ×{count}
            </span>
          )}
        </div>
        <div style={{ marginTop: 14, fontSize: 30, fontWeight: 900 }}>
          {trophy.name}
        </div>
        <div style={{ marginTop: 4, fontSize: 16, fontWeight: 700, opacity: 0.7 }}>
          {trophy.trigger}
        </div>
        {!earned && (
          <div
            style={{
              marginTop: 10,
              fontSize: 14,
              fontWeight: 700,
              color: "#a07000",
            }}
          >
            🔒 Not won yet
          </div>
        )}
      </div>
    </div>
  );
}
