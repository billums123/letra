import { useMemo, useRef, useState } from "react";
import { useGameStore } from "../state/store";
import { SPELL_WORDS } from "../audio/types";

// Dev-only: guided flow for adding a new word to Spell-the-Word.
//   1. Type the word (uppercase A-Z, 2–10 chars).
//   2. Pick / edit an intro + reveal prompt from three archetype templates.
//   3. POST to /__dev/generate-spell-clips — Vite middleware writes
//      prompt-spell-<WORD>.mp3 + reveal-spell-<WORD>.mp3 for every voice.
//   4. Listen, edit, re-roll. Approve.
//   5. Copy the SPELL_WORDS snippet to paste into chat — Claude wires it
//      into src/audio/types.ts.

type Stage = "word" | "prompts" | "generating" | "review" | "done";

type Suggestion = { label: string; intro: string; reveal: string; source: "template" | "ai" };

function spellLetters(word: string): string {
  return word.toUpperCase().split("").join(", ");
}

function buildSuggestions(word: string): Suggestion[] {
  const lower = word.toLowerCase();
  const letters = spellLetters(word);
  return [
    {
      label: "Lost / missing",
      intro: `Oh no! A ${lower} went missing! Help me find the letters that spell ${letters} to find the ${lower}!`,
      reveal: `We found the ${lower}!`,
      source: "template",
    },
    {
      label: "Hiding",
      intro: `Our friend the ${lower} is hiding. Find ${letters} to call them out!`,
      reveal: `There is the ${lower}!`,
      source: "template",
    },
    {
      label: "Bring it back",
      intro: `We need the ${lower}! Find the letters ${letters} to bring it back!`,
      reveal: `Hooray, the ${lower} is here!`,
      source: "template",
    },
  ];
}

export function SpellWordBuilder() {
  const goToMenu = useGameStore((s) => s.goToMenu);
  const [stage, setStage] = useState<Stage>("word");
  const [word, setWord] = useState("");
  const [intro, setIntro] = useState("");
  const [reveal, setReveal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<{ voice: string; intro: string; reveal: string }[]>([]);
  const [aiSuggestions, setAiSuggestions] = useState<Suggestion[]>([]);
  const [aiStatus, setAiStatus] = useState<"idle" | "loading" | "error">("idle");
  const [aiError, setAiError] = useState<string | null>(null);
  const introAudioRef = useRef<HTMLAudioElement>(null);
  const revealAudioRef = useRef<HTMLAudioElement>(null);

  const cleanWord = word.trim().toUpperCase();
  const wordValid = /^[A-Z]{2,10}$/.test(cleanWord);
  const alreadyExists = useMemo(
    () => SPELL_WORDS.some((w) => w.word === cleanWord),
    [cleanWord],
  );

  const templateSuggestions = useMemo(() => (wordValid ? buildSuggestions(cleanWord) : []), [wordValid, cleanWord]);
  const suggestions = useMemo(() => [...templateSuggestions, ...aiSuggestions], [templateSuggestions, aiSuggestions]);

  function pickSuggestion(s: Suggestion) {
    setIntro(s.intro);
    setReveal(s.reveal);
  }

  async function requestAiSuggestions() {
    if (!wordValid) return;
    setAiStatus("loading");
    setAiError(null);
    try {
      const res = await fetch("/__dev/suggest-spell-prompts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ word: cleanWord }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as { suggestions: { label: string; intro: string; reveal: string }[] };
      setAiSuggestions(json.suggestions.map((s) => ({ ...s, source: "ai" as const })));
      setAiStatus("idle");
    } catch (e) {
      setAiError((e as Error).message);
      setAiStatus("error");
    }
  }

  async function generate() {
    setError(null);
    setStage("generating");
    try {
      const res = await fetch("/__dev/generate-spell-clips", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ word: cleanWord, intro, reveal }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as { generated: { voice: string; intro: string; reveal: string }[] };
      setGenerated(json.generated);
      setStage("review");
    } catch (e) {
      setError((e as Error).message);
      setStage("prompts");
    }
  }

  // Snippet to paste into chat — Claude appends to SPELL_WORDS in types.ts.
  const snippet = `{ word: "${cleanWord}", intro: ${JSON.stringify(intro)}, reveal: ${JSON.stringify(reveal)} },`;

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(snippet);
    } catch {
      // No clipboard in some local dev contexts — the textarea is selectable.
    }
  }

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "linear-gradient(#1a1828, #2c2240)",
        color: "white",
        overflowY: "auto",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "24px 20px 80px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button type="button" onClick={() => goToMenu()} style={btnStyle("#ff8c4a")}>
            ◀ Menu
          </button>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>Spell-the-Word Builder</h1>
        </div>

        {/* Step 1 — Word */}
        <Section step={1} title="Pick a word" active={stage === "word"} done={stage !== "word"}>
          <input
            autoFocus
            type="text"
            placeholder="e.g. FROG"
            value={word}
            disabled={stage !== "word"}
            onChange={(e) => setWord(e.target.value.toUpperCase())}
            style={inputStyle}
          />
          <div style={hintStyle}>
            2–10 letters, A–Z only. Existing words: {SPELL_WORDS.map((w) => w.word).join(", ")}.
          </div>
          {alreadyExists && (
            <div style={{ ...hintStyle, color: "#ffd56b" }}>
              ⚠ "{cleanWord}" is already in SPELL_WORDS — generating will overwrite its MP3s.
            </div>
          )}
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button
              type="button"
              disabled={!wordValid}
              onClick={() => {
                pickSuggestion(buildSuggestions(cleanWord)[0]);
                setStage("prompts");
                void requestAiSuggestions();
              }}
              style={btnStyle(wordValid ? "#7ec8ff" : "#444")}
            >
              Next → suggest prompts
            </button>
          </div>
        </Section>

        {/* Step 2 — Prompts */}
        <Section step={2} title="Approve the prompts" active={stage === "prompts"} done={stage === "review" || stage === "done"}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
            <div style={{ opacity: 0.85, fontSize: 14 }}>
              Pick one (or edit freely). Templates first, then AI suggestions.
            </div>
            <button
              type="button"
              disabled={stage !== "prompts" || aiStatus === "loading"}
              onClick={requestAiSuggestions}
              style={{ ...btnStyle("#a48cff"), padding: "4px 10px", fontSize: 13, marginLeft: "auto" }}
            >
              {aiStatus === "loading"
                ? "⏳ Asking GPT…"
                : aiSuggestions.length > 0
                  ? "🔁 Re-roll AI"
                  : "✨ Suggest with AI"}
            </button>
          </div>
          {aiError && (
            <div style={{ ...hintStyle, color: "#ff7e7e" }}>AI error: {aiError}</div>
          )}
          <div style={{ display: "grid", gap: 8 }}>
            {suggestions.map((s, idx) => (
              <button
                key={`${s.source}-${idx}-${s.label}`}
                type="button"
                disabled={stage !== "prompts"}
                onClick={() => pickSuggestion(s)}
                style={{
                  textAlign: "left",
                  padding: "10px 14px",
                  borderRadius: 10,
                  border:
                    intro === s.intro && reveal === s.reveal
                      ? "2px solid #ffd56b"
                      : "1px solid rgba(255,255,255,0.1)",
                  background: s.source === "ai" ? "rgba(164,140,255,0.08)" : "rgba(255,255,255,0.04)",
                  color: "white",
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 14 }}>
                  <span>{s.label}</span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "2px 6px",
                      borderRadius: 6,
                      background: s.source === "ai" ? "rgba(164,140,255,0.3)" : "rgba(255,255,255,0.15)",
                      letterSpacing: 0.5,
                      textTransform: "uppercase",
                    }}
                  >
                    {s.source === "ai" ? "AI" : "tpl"}
                  </span>
                </div>
                <div style={{ opacity: 0.85, fontSize: 13, marginTop: 4 }}>{s.intro}</div>
                <div style={{ opacity: 0.7, fontSize: 13, marginTop: 2 }}>{s.reveal}</div>
              </button>
            ))}
          </div>
          <label style={labelStyle}>
            <span>Intro</span>
            <textarea
              value={intro}
              disabled={stage !== "prompts"}
              onChange={(e) => setIntro(e.target.value)}
              rows={3}
              style={textareaStyle}
            />
          </label>
          <label style={labelStyle}>
            <span>Reveal</span>
            <textarea
              value={reveal}
              disabled={stage !== "prompts"}
              onChange={(e) => setReveal(e.target.value)}
              rows={2}
              style={textareaStyle}
            />
          </label>
          {error && (
            <div style={{ ...hintStyle, color: "#ff7e7e", marginTop: 8 }}>Error: {error}</div>
          )}
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button
              type="button"
              disabled={stage !== "prompts"}
              onClick={() => {
                setStage("word");
                setAiSuggestions([]);
                setAiError(null);
                setAiStatus("idle");
              }}
              style={btnStyle("#888")}
            >
              ← Back
            </button>
            <button
              type="button"
              disabled={stage !== "prompts" || !intro.trim() || !reveal.trim()}
              onClick={generate}
              style={btnStyle("#9bdc4a")}
            >
              Generate audio
            </button>
          </div>
        </Section>

        {/* Step 3 — Generating spinner */}
        {stage === "generating" && (
          <div style={{ marginTop: 24, opacity: 0.85 }}>
            ⏳ Calling ElevenLabs for {cleanWord} (intro + reveal × {Math.max(1, generated.length || 1)} voice
            {generated.length === 1 ? "" : "s"})…
          </div>
        )}

        {/* Step 4 — Listen */}
        {(stage === "review" || stage === "done") && (
          <Section step={3} title="Listen + approve" active={stage === "review"} done={stage === "done"}>
            {generated.map((g) => (
              <div key={g.voice} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>{g.voice}</div>
                <div style={{ display: "grid", gap: 4 }}>
                  <div>
                    <span style={{ opacity: 0.7, fontSize: 13, marginRight: 8 }}>intro</span>
                    <audio ref={introAudioRef} controls src={g.intro} style={{ verticalAlign: "middle" }} />
                  </div>
                  <div>
                    <span style={{ opacity: 0.7, fontSize: 13, marginRight: 8 }}>reveal</span>
                    <audio ref={revealAudioRef} controls src={g.reveal} style={{ verticalAlign: "middle" }} />
                  </div>
                </div>
              </div>
            ))}
            <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={() => setStage("prompts")} style={btnStyle("#888")}>
                Edit prompts
              </button>
              <button type="button" onClick={generate} style={btnStyle("#7ec8ff")}>
                Re-roll audio
              </button>
              <button type="button" onClick={() => setStage("done")} style={btnStyle("#9bdc4a")}>
                ✓ Approve
              </button>
            </div>
          </Section>
        )}

        {/* Step 5 — Hand-off */}
        {stage === "done" && (
          <Section step={4} title="Hand off to Claude" active done={false}>
            <div style={{ opacity: 0.85, fontSize: 14, marginBottom: 8 }}>
              MP3s are already on disk. Paste this line into chat with Claude — they'll add it to{" "}
              <code>SPELL_WORDS</code> in <code>src/audio/types.ts</code>.
            </div>
            <textarea
              readOnly
              value={snippet}
              rows={2}
              style={{ ...textareaStyle, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13 }}
              onFocus={(e) => e.currentTarget.select()}
            />
            <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
              <button type="button" onClick={copySnippet} style={btnStyle("#ffd56b")}>
                Copy snippet
              </button>
              <button
                type="button"
                onClick={() => {
                  setWord("");
                  setIntro("");
                  setReveal("");
                  setGenerated([]);
                  setAiSuggestions([]);
                  setAiError(null);
                  setAiStatus("idle");
                  setStage("word");
                }}
                style={btnStyle("#7ec8ff")}
              >
                Add another word
              </button>
            </div>
            <div style={{ ...hintStyle, marginTop: 12 }}>
              Tip: also tell Claude if you want a per-word trophy (currently 5/5 existing words have one).
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({
  step,
  title,
  active,
  done,
  children,
}: {
  step: number;
  title: string;
  active: boolean;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        marginTop: 24,
        padding: "16px 18px",
        borderRadius: 14,
        background: active ? "rgba(126,200,255,0.08)" : "rgba(255,255,255,0.03)",
        border: active ? "2px solid rgba(126,200,255,0.5)" : "1px solid rgba(255,255,255,0.08)",
        opacity: !active && !done ? 0.5 : 1,
      }}
    >
      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, opacity: 0.95 }}>
        {done ? "✓ " : `${step}. `}
        {title}
      </h2>
      <div style={{ marginTop: 10 }}>{children}</div>
    </section>
  );
}

function btnStyle(bg: string): React.CSSProperties {
  return {
    background: bg,
    color: "white",
    border: "3px solid rgba(255,255,255,0.6)",
    borderRadius: 14,
    padding: "8px 14px",
    fontSize: 15,
    fontWeight: 800,
    cursor: "pointer",
    boxShadow: "0 4px 0 rgba(0,0,0,0.18)",
  };
}

const inputStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "2px solid rgba(255,255,255,0.2)",
  background: "rgba(0,0,0,0.3)",
  color: "white",
  fontSize: 22,
  fontWeight: 900,
  letterSpacing: 4,
  width: 220,
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "2px solid rgba(255,255,255,0.2)",
  background: "rgba(0,0,0,0.3)",
  color: "white",
  fontSize: 14,
  resize: "vertical",
};

const labelStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
  marginTop: 12,
  fontSize: 13,
  fontWeight: 700,
  opacity: 0.85,
};

const hintStyle: React.CSSProperties = {
  marginTop: 6,
  fontSize: 12,
  opacity: 0.7,
};
