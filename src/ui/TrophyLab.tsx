import { useState } from "react";
import { useGameStore } from "../state/store";
import {
  SPELL_REPS_PER_TROPHY,
  SPELL_TROPHY_IDS,
  TROPHIES,
  WORD_WIZARD_THRESHOLD,
  type TrophyId,
} from "../state/trophies";
import { SPELL_WORDS } from "../audio/types";
import { TrophyImage } from "./EarnedTrophyModal";
import { TrophyShelf } from "./TrophyShelf";
import { isDev } from "../util/isDev";

// Dev-only test harness for the trophy system. Reachable via the
// "🧪 Trophy Lab" button in the dev corner of MainMenu (only mounted
// when isDev() returns true). Lets you:
//   - Trigger any trophy's earn-moment modal in isolation
//   - Build a "shelf state" (some earned, some not, varied stack counts)
//   - Reset all trophies
//   - Open the shelf in any state
//
// Nothing here ships to production — the entire screen is gated by
// isDev() at the route level in Game.tsx.

export function TrophyLab() {
  const trophies = useGameStore((s) => s.trophies);
  const soundMatchCount = useGameStore((s) => s.soundMatchCount);
  const spellWordCounts = useGameStore((s) => s.spellWordCounts);
  const awardTrophy = useGameStore((s) => s.awardTrophy);
  const recordSoundMatch = useGameStore((s) => s.recordSoundMatch);
  const recordSpellCompletion = useGameStore((s) => s.recordSpellCompletion);
  const resetTrophies = useGameStore((s) => s.resetTrophies);
  const goToMenu = useGameStore((s) => s.goToMenu);
  const [showShelf, setShowShelf] = useState(false);

  if (!isDev()) {
    return (
      <div style={{ padding: 24, color: "#3a2a14" }}>
        Trophy Lab is dev-only. Run with <code>npm run dev</code> or visit on
        localhost.
      </div>
    );
  }

  const earnedCount = TROPHIES.filter((t) => (trophies[t.id] ?? 0) > 0).length;
  const totalSpellCompletions = Object.values(spellWordCounts).reduce(
    (sum, n) => sum + (n ?? 0),
    0,
  );

  const buildShelfState = (preset: "empty" | "partial" | "full") => {
    resetTrophies();
    if (preset === "empty") return;
    if (preset === "partial") {
      // A realistic mid-game state: 5 CATs (Cat Catcher ×1), a few
      // DOGs but not enough yet, one alphabet completion, a couple
      // of listening stars. Word Wizard stays locked.
      for (let i = 0; i < SPELL_REPS_PER_TROPHY; i++) {
        recordSpellCompletion("CAT");
      }
      recordSpellCompletion("DOG");
      recordSpellCompletion("DOG");
      awardTrophy("alphabet-upper");
      // Two listening stars (= 20 matches in store).
      awardTrophy("sound-match");
      awardTrophy("sound-match");
      useGameStore.setState({ pendingEarns: [] });
      return;
    }
    if (preset === "full") {
      for (const t of TROPHIES) {
        for (let i = 0; i < 3; i++) awardTrophy(t.id);
      }
      useGameStore.setState({ pendingEarns: [] });
    }
  };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "linear-gradient(180deg, #fff7e6 0%, #ffd56b 100%)",
        overflowY: "auto",
        padding: 24,
        color: "#3a2a14",
        font: "16px/1.4 -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
      }}
    >
      <header style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 18, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={goToMenu}
          style={{
            appearance: "none",
            border: "3px solid white",
            background: "#5fa9f0",
            color: "white",
            borderRadius: 999,
            padding: "8px 18px",
            fontWeight: 800,
            cursor: "pointer",
            boxShadow: "0 4px 0 rgba(0,0,0,0.18)",
          }}
        >
          ← Back to menu
        </button>
        <h1 style={{ margin: 0, fontSize: 28 }}>🧪 Trophy Lab</h1>
        <span style={{ color: "#8a7458" }}>
          {earnedCount} / {TROPHIES.length} earned · {totalSpellCompletions} spell completions ·
          {" "}{soundMatchCount} sound matches
        </span>
      </header>

      <Section title="1 · Shelf state presets">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <LabBtn onClick={() => buildShelfState("empty")} color="#ffb084">Reset to empty</LabBtn>
          <LabBtn onClick={() => buildShelfState("partial")} color="#ffd56b">Partial shelf</LabBtn>
          <LabBtn onClick={() => buildShelfState("full")} color="#9bdc4a">Full shelf (×3 each)</LabBtn>
          <LabBtn onClick={() => setShowShelf(true)} color="#5fa9f0" textColor="white">Open shelf →</LabBtn>
        </div>
      </Section>

      <Section title="2 · Earn-moment popup (per trophy)">
        <p style={{ marginTop: 0, color: "#8a7458" }}>
          Each "Award +1" click directly awards the trophy and queues an earn
          modal — handy for testing the popup in isolation. In the real game,
          spelling trophies only fire after the kid spells the same word{" "}
          <b>{SPELL_REPS_PER_TROPHY}</b> times (use Section 3 to test that flow).
          Word Wizard fires automatically when total spell completions reach{" "}
          <b>{WORD_WIZARD_THRESHOLD}</b>.
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: 12,
          }}
        >
          {TROPHIES.map((t) => {
            const count = trophies[t.id] ?? 0;
            return (
              <div
                key={t.id}
                style={{
                  background: "white",
                  borderRadius: 18,
                  padding: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  border: "3px solid white",
                  boxShadow: "0 4px 0 rgba(0,0,0,0.08)",
                }}
              >
                <div
                  style={{
                    width: 64,
                    height: 64,
                    background: t.tileColor,
                    borderRadius: 14,
                    display: "grid",
                    placeItems: "center",
                    flexShrink: 0,
                    overflow: "hidden",
                  }}
                >
                  <TrophyImage
                    src={`/trophies/${t.id}.png`}
                    alt={t.name}
                    fallback={t.fallbackEmoji}
                    size="84%"
                  />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 14, lineHeight: 1.2 }}>
                    {t.name}
                  </div>
                  <div style={{ fontSize: 12, color: "#8a7458" }}>
                    count: {count} · {t.kind}
                  </div>
                  <button
                    type="button"
                    onClick={() => triggerAward(t.id)}
                    disabled={t.kind === "milestone" && count >= 1}
                    style={{
                      marginTop: 6,
                      appearance: "none",
                      border: "2px solid #d6c8b0",
                      background: t.kind === "milestone" && count >= 1 ? "#eee" : "#fff",
                      color: t.kind === "milestone" && count >= 1 ? "#aaa" : "#3a2a14",
                      borderRadius: 999,
                      padding: "4px 12px",
                      fontWeight: 800,
                      fontSize: 12,
                      cursor: t.kind === "milestone" && count >= 1 ? "not-allowed" : "pointer",
                    }}
                  >
                    Award +1
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="3 · Spell-the-word completions (per word)">
        <p style={{ marginTop: 0, color: "#8a7458" }}>
          Mirrors the real flow: each click is one in-game completion of that
          word. The spell trophy fires every <b>{SPELL_REPS_PER_TROPHY}</b>
          {" "}completions of the SAME word, and the modal shows up just like
          a kid would see it.
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: 10,
          }}
        >
          {SPELL_WORDS.map((w) => {
            const upper = w.word.toUpperCase();
            const count = spellWordCounts[upper] ?? 0;
            const towardNext = count % SPELL_REPS_PER_TROPHY;
            return (
              <div
                key={upper}
                style={{
                  background: "white",
                  borderRadius: 16,
                  padding: 12,
                  border: "3px solid white",
                  boxShadow: "0 4px 0 rgba(0,0,0,0.08)",
                }}
              >
                <div style={{ fontWeight: 900, fontSize: 16 }}>{upper}</div>
                <div style={{ fontSize: 12, color: "#8a7458", marginBottom: 6 }}>
                  {count} completion{count === 1 ? "" : "s"} ·{" "}
                  {towardNext}/{SPELL_REPS_PER_TROPHY} toward next trophy
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <LabBtn onClick={() => recordSpellCompletion(upper)} color="#ffd56b">
                    +1 spell
                  </LabBtn>
                  <LabBtn
                    onClick={() => {
                      for (let i = 0; i < SPELL_REPS_PER_TROPHY; i++) {
                        recordSpellCompletion(upper);
                      }
                    }}
                    color="#9bdc4a"
                  >
                    +{SPELL_REPS_PER_TROPHY} spells (1 trophy)
                  </LabBtn>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="4 · Sound match counter">
        <p style={{ marginTop: 0, color: "#8a7458" }}>
          Listening Star fires every 10 matches. Use these to step through
          without needing to actually play 10 rounds in-game.
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 800 }}>soundMatchCount = {soundMatchCount}</span>
          <LabBtn onClick={() => recordSoundMatch()} color="#ffb084">+1 match</LabBtn>
          <LabBtn
            onClick={() => {
              for (let i = 0; i < 10; i++) recordSoundMatch();
            }}
            color="#9bdc4a"
          >
            +10 matches (1 trophy)
          </LabBtn>
        </div>
      </Section>

      <Section title="5 · Quick scenarios">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <LabBtn
            onClick={() => {
              // First-time-earn flow: clean state, spell CAT five times
              // so the production trigger fires.
              resetTrophies();
              for (let i = 0; i < SPELL_REPS_PER_TROPHY; i++) {
                recordSpellCompletion("CAT");
              }
            }}
            color="#ffb084"
          >
            Scenario: first-time earn (5× CAT)
          </LabBtn>
          <LabBtn
            onClick={() => {
              // Stack-up flow: 15 DOGs = ×3. Drain in-between earns so
              // only the final modal pops, then re-trigger.
              for (let i = 0; i < SPELL_REPS_PER_TROPHY * 3; i++) {
                recordSpellCompletion("DOG");
              }
            }}
            color="#ffd56b"
          >
            Scenario: stack DOG ×3 (15× DOG)
          </LabBtn>
          <LabBtn
            onClick={() => {
              // Word Wizard cascade: get to 24 spell completions across
              // varied words (queues the spell trophies along the way),
              // drain the modal queue, then the 25th completion fires
              // the spell trophy AND Word Wizard back-to-back.
              resetTrophies();
              const words = SPELL_WORDS.map((w) => w.word.toUpperCase());
              for (let i = 0; i < WORD_WIZARD_THRESHOLD - 1; i++) {
                recordSpellCompletion(words[i % words.length]);
              }
              useGameStore.setState({ pendingEarns: [] });
              recordSpellCompletion(words[0]);
            }}
            color="#c4a8ff"
          >
            Scenario: trigger Word Wizard
          </LabBtn>
          <LabBtn
            onClick={() => {
              // Multi-queue test: stack three different trophies fast.
              // Modal should show them one by one as the kid dismisses.
              awardTrophy("alphabet-upper");
              awardTrophy("spell-bus");
              awardTrophy("sound-match");
            }}
            color="#5fa9f0"
            textColor="white"
          >
            Scenario: queue 3 modals
          </LabBtn>
        </div>
      </Section>

      <TrophyShelf open={showShelf} onClose={() => setShowShelf(false)} />
    </div>
  );

  function triggerAward(id: TrophyId) {
    awardTrophy(id);
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: "rgba(255,255,255,0.7)",
        borderRadius: 22,
        padding: 18,
        marginBottom: 18,
        border: "3px solid white",
      }}
    >
      <h2 style={{ margin: "0 0 12px", fontSize: 20 }}>{title}</h2>
      {children}
    </section>
  );
}

function LabBtn({
  onClick,
  children,
  color,
  textColor = "#3a2a14",
}: {
  onClick: () => void;
  children: React.ReactNode;
  color: string;
  textColor?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        appearance: "none",
        border: "3px solid white",
        background: color,
        color: textColor,
        borderRadius: 999,
        padding: "8px 18px",
        fontWeight: 800,
        fontSize: 14,
        cursor: "pointer",
        boxShadow: "0 4px 0 rgba(0,0,0,0.18)",
      }}
    >
      {children}
    </button>
  );
}
