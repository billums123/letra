import { useGameStore } from "../state/store";
import { ALPHABET } from "../audio/types";
import { audio } from "../audio/Player";

// The sticker book is the kid's reward shelf. Every letter they walk over in
// any game becomes "mastered" in localStorage; here we show the whole alphabet
// with mastered ones in colour and locked ones grey.

type StickerBookProps = {
  open: boolean;
  onClose: () => void;
};

export function StickerBook({ open, onClose }: StickerBookProps) {
  const collected = useGameStore((s) => s.collected);
  const reset = useGameStore((s) => s.resetCollected);
  if (!open) return null;
  const masteredCount = collected.size;

  return (
    <div
      role="dialog"
      aria-label="Sticker book"
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "grid",
        placeItems: "center",
        zIndex: 50,
        padding: 24,
      }}
    >
      <div
        style={{
          background: "linear-gradient(180deg, #fff7d6, #ffd56b)",
          border: "8px solid white",
          borderRadius: 32,
          padding: 28,
          maxWidth: 640,
          width: "100%",
          boxShadow: "0 18px 0 rgba(0,0,0,0.18), 0 30px 60px rgba(0,0,0,0.3)",
          color: "#3a2a14",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 44, fontWeight: 900 }}>Your Stickers</div>
        <div style={{ marginTop: 4, fontWeight: 700, fontSize: 18 }}>
          {masteredCount} of {ALPHABET.length} letters mastered
        </div>
        <div
          style={{
            marginTop: 18,
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap: 10,
          }}
        >
          {ALPHABET.map((L) => {
            const has = collected.has(L);
            return (
              <button
                key={L}
                type="button"
                onClick={() => {
                  if (has) {
                    audio.play(audio.letterName(L)).then(() => audio.play(audio.letterSound(L), { interrupt: false }));
                  }
                }}
                style={{
                  appearance: "none",
                  border: has ? "4px solid white" : "4px dashed rgba(0,0,0,0.2)",
                  background: has ? "#9bdc4a" : "rgba(255,255,255,0.5)",
                  color: has ? "white" : "rgba(0,0,0,0.3)",
                  borderRadius: 16,
                  fontSize: 30,
                  fontWeight: 900,
                  padding: "16px 4px",
                  boxShadow: has ? "0 6px 0 rgba(0,0,0,0.15)" : "none",
                  cursor: has ? "pointer" : "default",
                  transition: "transform 0.1s ease",
                  transform: has ? "rotate(-3deg)" : "none",
                }}
                aria-label={has ? `Letter ${L}, mastered. Tap to hear it.` : `Letter ${L}, not yet mastered`}
              >
                {L}
              </button>
            );
          })}
        </div>
        <div style={{ marginTop: 22, display: "flex", justifyContent: "space-between", gap: 12 }}>
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Clear your sticker book and start fresh?")) reset();
            }}
            style={{
              appearance: "none",
              border: "3px solid white",
              background: "rgba(255,255,255,0.4)",
              borderRadius: 16,
              fontSize: 14,
              fontWeight: 700,
              padding: "8px 14px",
              cursor: "pointer",
              color: "#3a2a14",
            }}
          >
            Reset
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              appearance: "none",
              border: "4px solid white",
              background: "#ff8c4a",
              color: "white",
              borderRadius: 18,
              padding: "12px 24px",
              fontSize: 22,
              fontWeight: 900,
              cursor: "pointer",
              boxShadow: "0 6px 0 rgba(0,0,0,0.18)",
            }}
            aria-label="Close sticker book"
          >
            Done!
          </button>
        </div>
      </div>
    </div>
  );
}
