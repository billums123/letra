import { useGameStore } from "../state/store";
import { audio } from "../audio/Player";

// In-game heads-up display: title bar, prompt text, back button, replay button.
// Pre-K kids can't read complicated UI, so we keep buttons huge with universal
// icons (◀ Home, 🔁 Replay).

type HUDProps = {
  title?: string;
  prompt?: string;
  // Letters the kid is hunting for, in order. Already-found letters render
  // brighter; the next letter pulses to draw the eye.
  targets?: { letter: string; found: boolean }[];
  // Callback to replay the latest prompt.
  onReplayPrompt?: () => void;
};

export function HUD({ title, prompt, targets, onReplayPrompt }: HUDProps) {
  const goToMenu = useGameStore((s) => s.goToMenu);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 10,
        display: "grid",
        gridTemplateRows: "auto 1fr auto",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: 16,
          gap: 12,
        }}
      >
        <button
          type="button"
          onClick={() => {
            audio.stop();
            goToMenu();
          }}
          style={{
            pointerEvents: "auto",
            border: "4px solid white",
            background: "#ff8c4a",
            color: "white",
            borderRadius: 20,
            padding: "10px 18px",
            fontSize: 22,
            fontWeight: 900,
            cursor: "pointer",
            boxShadow: "0 6px 0 rgba(0,0,0,0.18)",
          }}
          aria-label="Back to main menu"
        >
          ◀ Home
        </button>
        {title && (
          <div
            style={{
              background: "rgba(255,255,255,0.9)",
              borderRadius: 18,
              padding: "8px 18px",
              fontSize: 22,
              fontWeight: 900,
              color: "#3a2a14",
              boxShadow: "0 4px 0 rgba(0,0,0,0.1)",
            }}
          >
            {title}
          </div>
        )}
        {onReplayPrompt && (
          <button
            type="button"
            onClick={() => {
              audio.stop();
              onReplayPrompt();
            }}
            style={{
              pointerEvents: "auto",
              border: "4px solid white",
              background: "#46c2cb",
              color: "white",
              borderRadius: 20,
              padding: "10px 18px",
              fontSize: 22,
              fontWeight: 900,
              cursor: "pointer",
              boxShadow: "0 6px 0 rgba(0,0,0,0.18)",
            }}
            aria-label="Replay the prompt"
          >
            🔁 Hear it
          </button>
        )}
      </div>

      <div />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          padding: 16,
        }}
      >
        {targets && targets.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: 12,
              padding: "10px 18px",
              background: "rgba(255,255,255,0.9)",
              borderRadius: 18,
              boxShadow: "0 4px 0 rgba(0,0,0,0.1)",
            }}
            aria-label={`Letters: ${targets.map((t) => `${t.letter}${t.found ? " found" : ""}`).join(", ")}`}
          >
            {targets.map((t, i) => {
              const next = !t.found && targets.slice(0, i).every((x) => x.found);
              return (
                <span
                  key={i}
                  style={{
                    fontSize: 36,
                    fontWeight: 900,
                    color: t.found ? "#9bdc4a" : next ? "#ff5e7e" : "#3a2a14",
                    textShadow: t.found ? "0 0 12px rgba(155,220,74,0.7)" : "none",
                    animation: next ? "letra-pulse 1s ease-in-out infinite" : undefined,
                  }}
                >
                  {t.letter}
                </span>
              );
            })}
          </div>
        )}
        {prompt && (
          <div
            style={{
              padding: "10px 16px",
              background: "rgba(0,0,0,0.55)",
              color: "white",
              borderRadius: 14,
              fontSize: 18,
              fontWeight: 700,
              maxWidth: "70%",
              textAlign: "center",
            }}
          >
            {prompt}
          </div>
        )}
      </div>

      <style>{`
        @keyframes letra-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.18); }
        }
      `}</style>
    </div>
  );
}
