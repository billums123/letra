import { useGameStore } from "../state/store";
import { audio } from "../audio/Player";
import { useIsCompact } from "../util/useIsCompact";

// In-game heads-up display: title bar, prompt text, back button.
// Pre-K kids can't read complicated UI, so we keep buttons huge with universal
// icons (◀ Home).

type HUDProps = {
  title?: string;
  prompt?: string;
  // Letters the kid is hunting for, in order. Already-found letters render
  // brighter; the next letter pulses to draw the eye.
  targets?: { letter: string; found: boolean }[];
};

export function HUD({ title, prompt, targets }: HUDProps) {
  const goToMenu = useGameStore((s) => s.goToMenu);
  const compact = useIsCompact();

  const buttonStyle: React.CSSProperties = {
    pointerEvents: "auto",
    border: compact ? "3px solid white" : "4px solid white",
    color: "white",
    borderRadius: compact ? 16 : 20,
    padding: compact ? "8px 12px" : "10px 18px",
    fontSize: compact ? 16 : 22,
    fontWeight: 900,
    cursor: "pointer",
    boxShadow: "0 6px 0 rgba(0,0,0,0.18)",
    whiteSpace: "nowrap",
  };

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
          padding: compact ? 10 : 16,
          gap: compact ? 6 : 12,
          // Stay clear of the iOS notch / status bar.
          paddingTop: `calc(${compact ? 10 : 16}px + env(safe-area-inset-top, 0px))`,
        }}
      >
        <button
          type="button"
          onClick={() => {
            audio.stop();
            goToMenu();
          }}
          style={{ ...buttonStyle, background: "#ff8c4a" }}
          aria-label="Back to main menu"
        >
          ◀ {compact ? "" : "Home"}
        </button>
        {title && (
          <div
            style={{
              background: "rgba(255,255,255,0.9)",
              borderRadius: compact ? 14 : 18,
              padding: compact ? "6px 12px" : "8px 18px",
              fontSize: compact ? 16 : 22,
              fontWeight: 900,
              color: "#3a2a14",
              boxShadow: "0 4px 0 rgba(0,0,0,0.1)",
              minWidth: 0,
              flex: "0 1 auto",
              textAlign: "center",
              // Truncate long titles instead of wrapping when room is tight.
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {title}
          </div>
        )}
      </div>

      <div />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: compact ? 8 : 12,
          padding: compact ? "8px 12px" : 16,
          // Keep the bottom HUD clear of the iOS home-bar.
          paddingBottom: `calc(${compact ? 8 : 16}px + env(safe-area-inset-bottom, 0px))`,
        }}
      >
        {targets && targets.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: compact ? "clamp(2px, 1.2vw, 8px)" : 12,
              padding: compact ? "6px 12px" : "10px 18px",
              background: "rgba(255,255,255,0.9)",
              borderRadius: compact ? 14 : 18,
              boxShadow: "0 4px 0 rgba(0,0,0,0.1)",
              maxWidth: "calc(100vw - 24px)",
            }}
            aria-label={`Letters: ${targets.map((t) => `${t.letter}${t.found ? " found" : ""}`).join(", ")}`}
          >
            {targets.map((t, i) => {
              const next = !t.found && targets.slice(0, i).every((x) => x.found);
              return (
                <span
                  key={i}
                  style={{
                    // Scales the alphabet progress letters between roughly
                    // 18px (small phones) and 36px (desktop). Keeps the
                    // 10-letter bar from overflowing on narrow viewports.
                    fontSize: compact ? "clamp(18px, 4.4vw, 28px)" : 36,
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
              padding: compact ? "8px 12px" : "10px 16px",
              background: "rgba(0,0,0,0.55)",
              color: "white",
              borderRadius: 14,
              fontSize: compact ? 14 : 18,
              fontWeight: 700,
              maxWidth: compact ? "calc(100vw - 24px)" : "70%",
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
