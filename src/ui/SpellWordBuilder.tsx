import { useEffect, useMemo, useRef, useState } from "react";
import { useGameStore } from "../state/store";
import { SPELL_WORDS } from "../audio/types";

// Dev-only: guided flow for adding a new word to Spell-the-Word.
//   1. Type the word (uppercase A-Z, 2–10 chars).
//   2. Pick / edit an intro + reveal prompt from templates or AI suggestions.
//   3. POST to /__dev/generate-spell-clips — Vite middleware writes
//      prompt-spell-<WORD>.mp3 + reveal-spell-<WORD>.mp3 for every voice.
//      The endpoint accepts partial bodies, so the review step can edit one
//      side and regenerate just that MP3 without touching the other.
//   4. Listen, edit either side inline, regenerate just that part, approve.
//   5. Copy a multi-line hand-off snippet (file pointer + entry + voices that
//      already have MP3s + optional trophy reminder) to paste into chat —
//      Claude wires it into src/audio/types.ts.

type Stage = "word" | "prompts" | "generating" | "review" | "done";

type Suggestion = { label: string; intro: string; reveal: string; source: "template" | "ai" };

function spellLetters(word: string): string {
  return word.toUpperCase().split("").join(", ");
}

function buildSuggestions(word: string): Suggestion[] {
  const lower = word.toLowerCase();
  const upper = word.toUpperCase();
  const letters = spellLetters(word);
  // The "Let's find the <word>" templates only make sense for nouns.
  // Adjectives (BIG, RED) and verbs (RUN, HOP) need a part-of-speech
  // -agnostic shape, so the third template uses "Let's spell <word>"
  // which works for literally anything.
  return [
    {
      label: "Lost / missing (nouns)",
      intro: `Oh no! The ${lower} is missing! Let's find the ${lower}. ${letters}!`,
      reveal: `We found the ${lower}!`,
      source: "template",
    },
    {
      label: "Hiding (nouns)",
      intro: `The ${lower} is hiding! Let's find the ${lower}. ${letters}!`,
      reveal: `There is the ${lower}!`,
      source: "template",
    },
    {
      label: "Spell it (works for any word)",
      intro: `Let's spell ${upper}! ${letters}!`,
      reveal: `You spelled ${upper}!`,
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
  type GeneratedRow = { voice: string; intro?: string; reveal?: string };
  const [generated, setGenerated] = useState<GeneratedRow[]>([]);
  // null when nothing in flight; "intro"/"reveal" for partial regen of a
  // single side; "both" for the initial generate or a full re-roll.
  const [regeneratingPart, setRegeneratingPart] = useState<"intro" | "reveal" | "both" | null>(null);
  const [includeTrophyHint, setIncludeTrophyHint] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<Suggestion[]>([]);
  const [aiStatus, setAiStatus] = useState<"idle" | "loading" | "error">("idle");
  const [aiError, setAiError] = useState<string | null>(null);
  const [snippetCopied, setSnippetCopied] = useState(false);
  // Optional ElevenLabs model override. undefined = use the voice's
  // registered default. Same shape as the AudioTester's per-clip
  // override so the two tools feel consistent.
  const [modelId, setModelId] = useState<string | undefined>(undefined);

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

  // Generates one or both sides. Initial run goes through "generating"
  // stage with a dedicated spinner; per-part regenerations stay on
  // the review stage and only spin a single button.
  async function generateParts(parts: ("intro" | "reveal")[], opts: { initial?: boolean } = {}) {
    setError(null);
    const which = parts.length === 2 ? "both" : parts[0];
    setRegeneratingPart(which);
    if (opts.initial) setStage("generating");
    try {
      const res = await fetch("/__dev/generate-spell-clips", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          word: cleanWord,
          intro: parts.includes("intro") ? intro : undefined,
          reveal: parts.includes("reveal") ? reveal : undefined,
          modelId,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as { generated: GeneratedRow[] };
      // Merge with existing rows so a partial regen only updates the
      // requested side and leaves the other URL intact.
      setGenerated((prev) => {
        const next: GeneratedRow[] = [];
        const seen = new Set<string>();
        for (const row of json.generated) {
          const existing = prev.find((p) => p.voice === row.voice);
          next.push({
            voice: row.voice,
            intro: row.intro ?? existing?.intro,
            reveal: row.reveal ?? existing?.reveal,
          });
          seen.add(row.voice);
        }
        for (const row of prev) if (!seen.has(row.voice)) next.push(row);
        return next;
      });
      setStage("review");
    } catch (e) {
      setError((e as Error).message);
      if (opts.initial) setStage("prompts");
    } finally {
      setRegeneratingPart(null);
    }
  }

  // Hand-off snippet — gives Claude enough to wire this in without
  // hunting around. Includes file/array pointer, the literal entry,
  // a list of voices that already have MP3s on disk, and an optional
  // reminder about the per-word trophy.
  const voicesGenerated = generated
    .filter((g) => g.intro && g.reveal)
    .map((g) => g.voice)
    .join(", ");
  const trophyHint = includeTrophyHint
    ? `\n\nAlso add a per-word trophy in scripts/generate-trophies.ts (id: "spell-${cleanWord.toLowerCase()}") matching the existing CAT/DOG/etc. entries, plus a trophy image entry in scripts/optimize-images.ts.`
    : "";
  const snippet = `Please add this word to Spell-the-Word.

File: src/audio/types.ts
Array: SPELL_WORDS (append at the end)
Entry:

  { word: "${cleanWord}", intro: ${JSON.stringify(intro)}, reveal: ${JSON.stringify(reveal)} },

The MP3s are already on disk for these voices: ${voicesGenerated || "(none yet — generate first)"}.
Files: public/audio/<voice>/prompt-spell-${cleanWord}.mp3 + reveal-spell-${cleanWord}.mp3${trophyHint}`;

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(snippet);
      setSnippetCopied(true);
      setTimeout(() => setSnippetCopied(false), 2000);
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
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginLeft: "auto",
              fontSize: 13,
              opacity: 0.85,
            }}
          >
            <span>model</span>
            <select
              value={modelId ?? "default"}
              onChange={(e) => setModelId(e.target.value === "default" ? undefined : e.target.value)}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: "2px solid rgba(255,255,255,0.2)",
                background: "rgba(0,0,0,0.3)",
                color: "white",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              <option value="default">voice default (multilingual_v2)</option>
              <option value="eleven_v3">eleven_v3 (most expressive)</option>
              <option value="eleven_flash_v2">eleven_flash_v2 (phoneme-aware)</option>
              <option value="eleven_multilingual_v2">eleven_multilingual_v2</option>
            </select>
          </label>
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
              onClick={() => generateParts(["intro", "reveal"], { initial: true })}
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

        {/* Step 3 — Listen + iterate */}
        {(stage === "review" || stage === "done") && (
          <Section step={3} title="Listen + iterate" active={stage === "review"} done={stage === "done"}>
            <div style={{ opacity: 0.85, fontSize: 13, marginBottom: 12 }}>
              Edit either side and regenerate just that part — no need to re-roll both.
            </div>
            <PartPanel
              label="Intro"
              text={intro}
              onChangeText={setIntro}
              urlsByVoice={generated
                .map((g) => ({ voice: g.voice, url: g.intro }))
                .filter((x): x is { voice: string; url: string } => Boolean(x.url))}
              busy={regeneratingPart === "intro" || regeneratingPart === "both"}
              disabled={stage !== "review"}
              onRegenerate={() => generateParts(["intro"])}
            />
            <PartPanel
              label="Reveal"
              text={reveal}
              onChangeText={setReveal}
              urlsByVoice={generated
                .map((g) => ({ voice: g.voice, url: g.reveal }))
                .filter((x): x is { voice: string; url: string } => Boolean(x.url))}
              busy={regeneratingPart === "reveal" || regeneratingPart === "both"}
              disabled={stage !== "review"}
              onRegenerate={() => generateParts(["reveal"])}
            />
            {error && (
              <div style={{ ...hintStyle, color: "#ff7e7e", marginTop: 8 }}>Error: {error}</div>
            )}
            <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={() => setStage("prompts")} style={btnStyle("#888")} disabled={stage !== "review"}>
                ← Pick a different template
              </button>
              <button
                type="button"
                onClick={() => generateParts(["intro", "reveal"])}
                disabled={stage !== "review" || regeneratingPart !== null}
                style={btnStyle(regeneratingPart === "both" ? "#444" : "#7ec8ff")}
              >
                {regeneratingPart === "both" ? "⏳ Regenerating both…" : "Regenerate both"}
              </button>
              <button
                type="button"
                onClick={() => setStage("done")}
                disabled={stage !== "review"}
                style={btnStyle("#9bdc4a")}
              >
                ✓ Approve
              </button>
            </div>
          </Section>
        )}

        {/* Step 4 — Hand-off */}
        {stage === "done" && (
          <Section step={4} title="Hand off to Claude" active done={false}>
            <div style={{ opacity: 0.85, fontSize: 14, marginBottom: 8 }}>
              Paste the snippet below into chat with Claude — it includes the file pointer,
              the array name, the literal entry, and the list of voices that already have
              MP3s on disk, so Claude doesn't have to ask follow-ups.
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={includeTrophyHint}
                onChange={(e) => setIncludeTrophyHint(e.target.checked)}
              />
              <span>Also ask Claude to add a per-word trophy (existing 5 words each have one)</span>
            </label>
            <textarea
              readOnly
              value={snippet}
              rows={includeTrophyHint ? 10 : 7}
              style={{ ...textareaStyle, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13 }}
              onFocus={(e) => e.currentTarget.select()}
            />
            <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={copySnippet}
                style={btnStyle(snippetCopied ? "#9bdc4a" : "#ffd56b")}
              >
                {snippetCopied ? "✓ Copied!" : "Copy snippet"}
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
                  setIncludeTrophyHint(false);
                  setStage("word");
                }}
                style={btnStyle("#7ec8ff")}
              >
                Add another word
              </button>
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

// Wraps an <audio> element and explicitly calls .load() whenever the
// src URL changes. Setting a new src via React's `src` prop updates the
// DOM attribute but doesn't reliably trigger a media load — Chrome in
// particular often keeps the previous buffer (or none at all, showing
// 0:00 / 0:00) until you call .load() yourself.
function AudioPreview({ url }: { url: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    ref.current?.load();
  }, [url]);
  return <audio ref={ref} controls preload="auto" src={url} style={{ height: 32 }} />;
}

// One side of the spell-the-word audio (intro OR reveal). Renders an
// editable textarea, the latest MP3 for each voice, and a Regenerate
// button that hits the partial endpoint.
function PartPanel({
  label,
  text,
  onChangeText,
  urlsByVoice,
  busy,
  disabled,
  onRegenerate,
}: {
  label: string;
  text: string;
  onChangeText: (text: string) => void;
  urlsByVoice: { voice: string; url: string }[];
  busy: boolean;
  disabled: boolean;
  onRegenerate: () => void;
}) {
  return (
    <div
      style={{
        marginBottom: 12,
        padding: "10px 12px",
        borderRadius: 10,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <strong style={{ fontSize: 14 }}>{label}</strong>
        <button
          type="button"
          onClick={onRegenerate}
          disabled={busy || disabled || !text.trim()}
          style={{
            ...btnStyle(busy ? "#444" : "#9bdc4a"),
            padding: "4px 10px",
            fontSize: 12,
            marginLeft: "auto",
          }}
        >
          {busy ? "⏳ Regenerating…" : "Regenerate"}
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => onChangeText(e.target.value)}
        rows={2}
        disabled={disabled || busy}
        style={{ ...textareaStyle, fontSize: 13 }}
      />
      {urlsByVoice.length > 0 && (
        <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
          {urlsByVoice.map((row) => (
            <div key={row.voice} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ opacity: 0.7, fontSize: 12, width: 70 }}>{row.voice}</span>
              <AudioPreview url={row.url} />
            </div>
          ))}
        </div>
      )}
    </div>
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
