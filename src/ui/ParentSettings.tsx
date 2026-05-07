import { useEffect, useMemo, useRef, useState } from "react";
import { useGameStore } from "../state/store";
import { useIsCompact } from "../util/useIsCompact";

// Parent-gated settings panel. Reachable only via the gear icon on the
// main menu and only after a math-gate prompt designed to be unsolvable
// by the 3-6 year olds Letra targets — so an accidental tap by the kid
// can't reach the reset / mute / contact controls. Everything inside
// (volume slider, music toggle, reset progress, mailto, privacy notice)
// is parent-facing UI we explicitly want kept off the play surface.

const CONTACT_EMAIL = "hello@playletra.com";
const GITHUB_URL = "https://github.com/billums123/letra";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function ParentSettings({ open, onClose }: Props) {
  const compact = useIsCompact();
  const [unlocked, setUnlocked] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Re-arm the gate every time the modal closes so re-opening always
  // requires a fresh adult check. A kid who watches their parent solve
  // the problem and then re-opens the panel still hits the wall.
  useEffect(() => {
    if (!open) setUnlocked(false);
  }, [open]);

  // Esc + outside click close the modal — same affordance as
  // CasePicker / TrophyShelf so adults don't have to learn a new
  // dismiss gesture for this surface.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Parent settings"
      onMouseDown={(e) => {
        if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
          onClose();
        }
      }}
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "grid",
        placeItems: "center",
        zIndex: 70,
        padding: 16,
        // Parent-facing surface uses a quieter, document-style font
        // stack — Fredoka for headings, system body for the dense
        // settings text. The kid menu's Lilita One display face would
        // make a 14-row settings panel feel like a billboard.
        fontFamily: "'Fredoka','Comic Sans MS','Chalkboard SE',system-ui,sans-serif",
        color: "#1c3550",
      }}
    >
      <div
        ref={dialogRef}
        style={{
          background: "#fff7e6",
          border: "8px solid white",
          borderRadius: 28,
          width: "100%",
          maxWidth: 540,
          maxHeight: "calc(100% - 16px)",
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
          padding: compact ? "22px 20px 24px" : "28px 32px 32px",
          boxShadow: "0 16px 0 rgba(0,0,0,0.16), 0 28px 50px rgba(0,0,0,0.28)",
          position: "relative",
        }}
      >
        <CloseButton onClick={onClose} />
        {unlocked ? (
          <SettingsPanel onDone={onClose} />
        ) : (
          <ParentGate onPass={() => setUnlocked(true)} />
        )}
      </div>
    </div>
  );
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Close settings"
      style={{
        position: "absolute",
        top: 10,
        right: 10,
        appearance: "none",
        border: "3px solid white",
        background: "#1c3550",
        color: "white",
        width: 38,
        height: 38,
        borderRadius: "50%",
        fontSize: 18,
        fontWeight: 800,
        cursor: "pointer",
        boxShadow: "0 4px 0 rgba(0,0,0,0.18)",
        display: "grid",
        placeItems: "center",
        lineHeight: 1,
        padding: 0,
      }}
    >
      ✕
    </button>
  );
}

// Two-digit addition. Toddlers and pre-readers can't solve it; adults
// do it in under 3 seconds. Generated once per mount so refreshing the
// gate doesn't let a kid memorize the answer from a sibling.
function generateProblem(): { a: number; b: number; answer: number } {
  const a = 10 + Math.floor(Math.random() * 40); // 10..49
  const b = 10 + Math.floor(Math.random() * 40); // 10..49
  return { a, b, answer: a + b };
}

function ParentGate({ onPass }: { onPass: () => void }) {
  const compact = useIsCompact();
  // useMemo with an empty dep is intentional — the problem should stay
  // stable across re-renders within the same gate session (so a stray
  // setState doesn't roll the prompt under the parent's typing) but
  // re-roll on every fresh open via the unmount in ParentSettings.
  const problem = useMemo(generateProblem, []);
  const [answer, setAnswer] = useState("");
  const [shaking, setShaking] = useState(false);
  const [errored, setErrored] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus on mount — adults expect to type the answer immediately
  // without an extra tap. iOS Safari only honours focus() inside a
  // user gesture, but the gear-tap that opened us already qualifies.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    const n = Number(answer);
    if (Number.isFinite(n) && n === problem.answer) {
      onPass();
      return;
    }
    setShaking(true);
    setErrored(true);
    setAnswer("");
    setTimeout(() => setShaking(false), 380);
    inputRef.current?.focus();
  };

  return (
    <div style={{ textAlign: "center" }}>
      {/* Inline SVG shield instead of the 🛡️ emoji so the icon picks
          up the same #1c3550 as the text around it. The emoji renders
          multicolored on every platform and clashed visually with the
          rest of the parent-gate type. */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width={36}
        height={36}
        fill="#1c3550"
        aria-hidden
        style={{ display: "block", margin: "0 auto 4px" }}
      >
        <path d="M12 2 4 5v6c0 4.97 3.4 9.36 8 11 4.6-1.64 8-6.03 8-11V5l-8-3z" />
      </svg>
      <div
        style={{
          fontSize: compact ? 22 : 26,
          fontWeight: 600,
          color: "#1c3550",
          marginBottom: 4,
        }}
      >
        For grown-ups
      </div>
      <p
        style={{
          margin: "0 0 22px",
          fontSize: 14,
          color: "#3a4a5e",
          fontWeight: 500,
        }}
      >
        Solve this to open settings.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
          animation: shaking ? "letra-gate-shake 0.36s ease-in-out" : undefined,
        }}
      >
        <div
          style={{
            fontSize: compact ? 38 : 46,
            fontWeight: 700,
            letterSpacing: 1,
            color: "#1c3550",
            background: "white",
            padding: "14px 28px",
            borderRadius: 18,
            border: "4px solid #ffd56b",
            boxShadow: "0 6px 0 rgba(0,0,0,0.10)",
          }}
        >
          {problem.a} + {problem.b} = ?
        </div>

        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          maxLength={3}
          value={answer}
          onChange={(e) => {
            setErrored(false);
            // Strip anything that isn't a digit — keeps the field
            // sane on devices where the numeric keyboard still allows
            // a long-press to insert punctuation.
            setAnswer(e.target.value.replace(/[^0-9]/g, ""));
          }}
          aria-label="Type the answer"
          style={{
            width: 140,
            textAlign: "center",
            fontSize: 32,
            fontWeight: 700,
            padding: "10px 14px",
            borderRadius: 14,
            border: errored ? "3px solid #d54e6a" : "3px solid #1c3550",
            background: "white",
            color: "#1c3550",
            outline: "none",
            fontFamily: "inherit",
          }}
        />

        {errored && (
          <div
            style={{
              fontSize: 14,
              color: "#d54e6a",
              fontWeight: 600,
            }}
          >
            Not quite — try again.
          </div>
        )}

        <button
          type="submit"
          style={{
            appearance: "none",
            border: "4px solid white",
            background: "#1c3550",
            color: "white",
            borderRadius: 999,
            padding: "12px 28px",
            fontSize: 18,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit",
            boxShadow: "0 6px 0 rgba(0,0,0,0.18)",
            letterSpacing: 0.4,
            minWidth: 160,
          }}
        >
          Continue
        </button>
      </form>
    </div>
  );
}

function SettingsPanel({ onDone }: { onDone: () => void }) {
  const compact = useIsCompact();
  const audioVolume = useGameStore((s) => s.audioVolume);
  const setAudioVolume = useGameStore((s) => s.setAudioVolume);
  const audioMuted = useGameStore((s) => s.audioMuted);
  const setAudioMuted = useGameStore((s) => s.setAudioMuted);
  const musicEnabled = useGameStore((s) => s.musicEnabled);
  const setMusicEnabled = useGameStore((s) => s.setMusicEnabled);
  const resetCollected = useGameStore((s) => s.resetCollected);
  const resetTrophies = useGameStore((s) => s.resetTrophies);

  const [confirmReset, setConfirmReset] = useState(false);
  const [didReset, setDidReset] = useState(false);

  const handleReset = () => {
    resetCollected();
    resetTrophies();
    setConfirmReset(false);
    setDidReset(true);
    // Briefly flash the confirmation; auto-dismiss so the parent
    // doesn't need a second tap to clear it.
    setTimeout(() => setDidReset(false), 2400);
  };

  return (
    <div>
      <div
        style={{
          fontSize: compact ? 22 : 26,
          fontWeight: 600,
          color: "#1c3550",
          marginBottom: 4,
          textAlign: "center",
        }}
      >
        Settings
      </div>
      <p
        style={{
          margin: "0 0 18px",
          fontSize: 13,
          color: "#3a4a5e",
          fontWeight: 500,
          textAlign: "center",
        }}
      >
        Made for parents — your kid won't see this.
      </p>

      <Section title="Sound">
        {/* On phones, the [Label][slider][%] inline row overflowed the
            card because Label's 130px reserve + the slider's 120px
            min-width + the percentage span totalled more than the
            modal interior could hold. On compact we stack the slider
            below its label so each piece gets the full row width. */}
        <div
          style={{
            display: "flex",
            flexDirection: compact ? "column" : "row",
            alignItems: compact ? "stretch" : "center",
            gap: compact ? 6 : 12,
          }}
        >
          <Label>Volume</Label>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flex: 1,
              minWidth: 0,
            }}
          >
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(audioVolume * 100)}
              onChange={(e) => setAudioVolume(Number(e.target.value) / 100)}
              aria-label="Master volume"
              style={{
                flex: 1,
                minWidth: 0,
                accentColor: "#1c3550",
              }}
            />
            <span
              style={{
                minWidth: 38,
                textAlign: "right",
                fontVariantNumeric: "tabular-nums",
                fontWeight: 600,
                color: "#1c3550",
                flexShrink: 0,
              }}
            >
              {Math.round(audioVolume * 100)}%
            </span>
          </div>
        </div>
        <Row>
          <Label>Mute everything</Label>
          <Toggle checked={audioMuted} onChange={setAudioMuted} ariaLabel="Mute all sound" />
        </Row>
        <Row>
          <Label>Background music</Label>
          <Toggle
            checked={musicEnabled}
            onChange={setMusicEnabled}
            ariaLabel="Background music"
          />
        </Row>
      </Section>

      <Section title="Progress">
        {!confirmReset && !didReset && (
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            style={destructiveBtnStyle}
          >
            Reset progress
          </button>
        )}
        {confirmReset && !didReset && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              padding: 14,
              borderRadius: 14,
              background: "#fde6ec",
              border: "2px solid #f3a4b4",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: "#7a1d35" }}>
              This clears all trophies and word counts. It can't be undone.
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={handleReset}
                style={{
                  ...destructiveBtnStyle,
                  background: "#d54e6a",
                  color: "white",
                  border: "3px solid white",
                  flex: "1 1 auto",
                }}
              >
                Yes, reset
              </button>
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                style={{
                  ...neutralBtnStyle,
                  flex: "1 1 auto",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {didReset && (
          <div
            style={{
              padding: "12px 14px",
              borderRadius: 14,
              background: "#e7f4d6",
              border: "2px solid #9bdc4a",
              color: "#2d4d10",
              fontSize: 14,
              fontWeight: 600,
            }}
            role="status"
          >
            Progress cleared.
          </div>
        )}
      </Section>

      <Section title="Help & contact">
        <a
          href={`mailto:${CONTACT_EMAIL}?subject=Letra%20feedback`}
          style={linkRowStyle}
        >
          <span aria-hidden style={{ fontSize: 20 }}>
            ✉️
          </span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{CONTACT_EMAIL}</div>
            <div style={{ fontSize: 12, color: "#3a4a5e" }}>
              Bug reports, feature requests, or just say hello!
            </div>
          </div>
        </a>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={linkRowStyle}
        >
          <span aria-hidden style={{ fontSize: 20 }}>
            🔍
          </span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>About &amp; source code</div>
            <div style={{ fontSize: 12, color: "#3a4a5e" }}>
              Letra is open source on GitHub.
            </div>
          </div>
        </a>
      </Section>

      <Section title="Privacy">
        <p
          style={{
            margin: 0,
            fontSize: 13,
            lineHeight: 1.55,
            color: "#1c3550",
          }}
        >
          Letra runs entirely on your device. We don't ask for an account,
          we don't collect anything from your kid, and we never show ads.
          Trophies and progress are saved only in this browser's local
          storage — clearing your browser data wipes them.
        </p>
        <p
          style={{
            margin: "10px 0 0",
            fontSize: 13,
            lineHeight: 1.55,
            color: "#1c3550",
          }}
        >
          <strong>For children under 13 (COPPA):</strong> Letra does not
          collect personal information from any user, child or adult. If
          you have questions, email{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            style={{ color: "#1c3550", fontWeight: 700 }}
          >
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </Section>

      <button
        type="button"
        onClick={onDone}
        style={{
          ...neutralBtnStyle,
          width: "100%",
          marginTop: 4,
          background: "#1c3550",
          color: "white",
          border: "3px solid white",
          padding: "12px 22px",
          fontSize: 16,
        }}
      >
        Done
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        marginBottom: 18,
        padding: "14px 16px",
        background: "white",
        borderRadius: 18,
        border: "3px solid #ffd56b",
        boxShadow: "0 4px 0 rgba(0,0,0,0.06)",
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: 1.4,
          textTransform: "uppercase",
          color: "#7a5a14",
          marginBottom: 10,
        }}
      >
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {children}
      </div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "nowrap",
      }}
    >
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        flex: "0 0 auto",
        minWidth: 130,
        fontSize: 14,
        fontWeight: 600,
        color: "#1c3550",
      }}
    >
      {children}
    </span>
  );
}

function Toggle({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      style={{
        appearance: "none",
        border: "3px solid white",
        background: checked ? "#1c3550" : "#c8d4df",
        width: 56,
        height: 32,
        borderRadius: 999,
        position: "relative",
        cursor: "pointer",
        boxShadow: "0 3px 0 rgba(0,0,0,0.12)",
        marginLeft: "auto",
        flex: "0 0 auto",
        transition: "background 0.15s ease",
        padding: 0,
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: 2,
          left: checked ? 26 : 2,
          width: 22,
          height: 22,
          borderRadius: "50%",
          background: "white",
          boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
          transition: "left 0.15s ease",
        }}
      />
    </button>
  );
}

const destructiveBtnStyle: React.CSSProperties = {
  appearance: "none",
  border: "3px solid #d54e6a",
  background: "white",
  color: "#7a1d35",
  borderRadius: 14,
  padding: "10px 18px",
  fontSize: 15,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
  boxShadow: "0 4px 0 rgba(0,0,0,0.10)",
  letterSpacing: 0.3,
};

const neutralBtnStyle: React.CSSProperties = {
  appearance: "none",
  border: "3px solid #1c3550",
  background: "white",
  color: "#1c3550",
  borderRadius: 14,
  padding: "10px 18px",
  fontSize: 15,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
  boxShadow: "0 4px 0 rgba(0,0,0,0.10)",
  letterSpacing: 0.3,
};

const linkRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "10px 12px",
  borderRadius: 12,
  background: "#fff7e6",
  color: "#1c3550",
  textDecoration: "none",
  border: "2px solid transparent",
  transition: "border-color 0.12s ease",
};
