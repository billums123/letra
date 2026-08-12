// SFX Lab — dev-only screen for auditioning every sound in the game
// and replacing any of them with an ElevenLabs generation, without
// touching code or the CLI.
//
// Flow per cue: hear what it does now → tweak the prompt → Generate →
// audition the take against the current sound → Approve into a slot,
// or Regenerate. Takes land in public/audio/sfx/_candidates/ and are
// NOT live until approved, so a bad one can never quietly become the
// shipped sound.
//
// The generation itself happens in the dev server (see
// scripts/sfx-lab-plugin.ts) because the API key must not reach the
// browser and the browser can't write into public/.

import { useEffect, useMemo, useRef, useState } from "react";
import { SFX_CATALOG, type SfxCue } from "../audio/sfxCatalog";
import * as sfx from "../audio/sfx";
import { useGameStore } from "../state/store";

type LabState = { hasKey: boolean; live: string[]; candidates: string[] };

const CARD: React.CSSProperties = {
  background: "#fff",
  borderRadius: 14,
  padding: "14px 16px",
  marginBottom: 12,
  boxShadow: "0 2px 10px rgba(0,0,0,0.08)",
};
const BTN: React.CSSProperties = {
  border: "none",
  borderRadius: 9,
  padding: "7px 13px",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
  background: "#e8eef5",
  color: "#243",
};
const PRIMARY: React.CSSProperties = { ...BTN, background: "#3b82f6", color: "#fff" };
const GOOD: React.CSSProperties = { ...BTN, background: "#16a34a", color: "#fff" };
const TAG: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  padding: "2px 8px",
  borderRadius: 999,
  letterSpacing: 0.4,
  textTransform: "uppercase",
};

export function SfxLab() {
  const setScreen = useGameStore((s) => s.setScreen);
  const [state, setState] = useState<LabState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const r = await fetch("/__sfx/state");
      setState(await r.json());
    } catch {
      setError("Dev endpoint unreachable — is the Vite dev server running?");
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  const synths = useMemo(() => SFX_CATALOG.filter((c) => c.kind === "synth"), []);
  const recorded = useMemo(() => SFX_CATALOG.filter((c) => c.kind === "recorded"), []);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflowY: "auto",
        background: "#eef2f7",
        padding: "16px 18px 60px",
        fontFamily: "system-ui, sans-serif",
        color: "#1f2937",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <button style={BTN} onClick={() => setScreen("menu")}>
          ◀ Back
        </button>
        <h1 style={{ fontSize: 22, margin: 0 }}>SFX Lab</h1>
        <button style={BTN} onClick={() => void refresh()}>
          Refresh
        </button>
      </div>

      <p style={{ fontSize: 13, lineHeight: 1.5, maxWidth: 760, color: "#475569" }}>
        Every sound the game makes. <b>Synth</b> cues are generated live with
        oscillators — no file, nothing to replace until you generate one.{" "}
        <b>Recorded</b> cues play an mp3 and fall back to a synth if it's missing, so
        the game is never silent. Approving writes the file the game loads;{" "}
        <b>reload the page</b> to hear an approved clip in-game, since clips are
        decoded once per session.
      </p>

      {error && <div style={{ ...CARD, background: "#fee2e2" }}>{error}</div>}
      {state && !state.hasKey && (
        <div style={{ ...CARD, background: "#fef3c7" }}>
          <b>No ELEVENLABS_API_KEY.</b> Add it to <code>.env.local</code> and restart
          the dev server. The key also needs the <code>sound_generation</code>{" "}
          permission — a text-to-speech-only key returns 401 on every clip.
        </div>
      )}

      <Section title={`Synth cues (${synths.length})`} blurb="Made with oscillators. No asset on disk.">
        {synths.map((c) => (
          <Cue key={c.id} cue={c} state={state} onChanged={refresh} />
        ))}
      </Section>

      <Section
        title={`Recorded cues (${recorded.length})`}
        blurb="Play an mp3, with a synth fallback if it's missing."
      >
        {recorded.map((c) => (
          <Cue key={c.id} cue={c} state={state} onChanged={refresh} />
        ))}
      </Section>
    </div>
  );
}

function Section({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <h2 style={{ fontSize: 16, margin: "22px 0 4px" }}>{title}</h2>
      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>{blurb}</div>
      {children}
    </>
  );
}

function Cue({
  cue,
  state,
  onChanged,
}: {
  cue: SfxCue;
  state: LabState | null;
  onChanged: () => Promise<void>;
}) {
  const [prompt, setPrompt] = useState(cue.prompt);
  const [seconds, setSeconds] = useState(cue.durationSeconds);
  const [influence, setInfluence] = useState(cue.promptInfluence);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Takes for this cue, newest first.
  const takes = (state?.candidates ?? []).filter((f) => f.startsWith(`${cue.id}-`));

  const playLive = () => {
    const fn = (sfx as unknown as Record<string, undefined | (() => void)>)[cue.play];
    if (fn) fn();
  };
  const playFile = (url: string) => {
    audioRef.current?.pause();
    const a = new Audio(url);
    audioRef.current = a;
    void a.play();
  };

  const generate = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/__sfx/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: cue.id,
          prompt,
          durationSeconds: seconds,
          promptInfluence: influence,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      await onChanged();
      playFile(`/audio/sfx/_candidates/${j.candidate}?t=${Date.now()}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const approve = async (candidate: string, slot: string) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/__sfx/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidate, slot }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      await onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const discard = async (candidate: string) => {
    await fetch("/__sfx/discard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ candidate }),
    });
    await onChanged();
  };

  return (
    <div style={CARD}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <b style={{ fontSize: 15 }}>{cue.label}</b>
        <span
          style={{
            ...TAG,
            background: cue.kind === "synth" ? "#fde68a" : "#bbf7d0",
            color: "#3f3f46",
          }}
        >
          {cue.kind}
        </span>
        <code style={{ fontSize: 11, color: "#64748b" }}>{cue.play}()</code>
        <div style={{ flex: 1 }} />
        <button style={PRIMARY} onClick={playLive}>
          ▶ Play in-game sound
        </button>
        <button style={BTN} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide" : "Replace…"}
        </button>
      </div>

      <div style={{ fontSize: 13, color: "#334155", margin: "8px 0 6px", lineHeight: 1.5 }}>
        {cue.sounds}
      </div>
      <div style={{ fontSize: 12, color: "#64748b" }}>
        <b>Used in:</b> {cue.usedIn.join(" · ")}
      </div>
      {cue.slots.length > 0 && (
        <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
          <b>Files:</b>{" "}
          {cue.slots.map((f) => (
            <button
              key={f}
              style={{ ...BTN, padding: "2px 8px", fontSize: 11, marginRight: 5 }}
              onClick={() => playFile(`/audio/sfx/${f}?t=${Date.now()}`)}
            >
              ▶ {f}
            </button>
          ))}
        </div>
      )}

      {open && (
        <div style={{ marginTop: 12, borderTop: "1px solid #e2e8f0", paddingTop: 12 }}>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            style={{
              width: "100%",
              fontSize: 13,
              padding: 9,
              borderRadius: 8,
              border: "1px solid #cbd5e1",
              fontFamily: "inherit",
              resize: "vertical",
            }}
          />
          <div
            style={{ display: "flex", gap: 14, alignItems: "center", margin: "8px 0", flexWrap: "wrap" }}
          >
            <label style={{ fontSize: 12 }}>
              Seconds{" "}
              <input
                type="number"
                step="0.1"
                min="0.5"
                max="22"
                value={seconds}
                onChange={(e) => setSeconds(Number(e.target.value))}
                style={{ width: 64, padding: 4 }}
              />
            </label>
            <label style={{ fontSize: 12 }}>
              Prompt influence{" "}
              <input
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={influence}
                onChange={(e) => setInfluence(Number(e.target.value))}
                style={{ width: 64, padding: 4 }}
              />
            </label>
            <button style={PRIMARY} disabled={busy} onClick={() => void generate()}>
              {busy ? "Generating…" : takes.length ? "Regenerate" : "Generate"}
            </button>
          </div>

          {err && (
            <div style={{ fontSize: 12, color: "#b91c1c", marginBottom: 8 }}>{err}</div>
          )}

          {takes.length > 0 && (
            <div style={{ background: "#f8fafc", borderRadius: 9, padding: 9 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                Takes (not live until approved)
              </div>
              {takes.map((t) => (
                <div
                  key={t}
                  style={{
                    display: "flex",
                    gap: 6,
                    alignItems: "center",
                    marginBottom: 5,
                    flexWrap: "wrap",
                  }}
                >
                  <button
                    style={{ ...BTN, padding: "3px 9px", fontSize: 12 }}
                    onClick={() => playFile(`/audio/sfx/_candidates/${t}?t=${Date.now()}`)}
                  >
                    ▶
                  </button>
                  <code style={{ fontSize: 11, flex: 1, minWidth: 150 }}>{t}</code>
                  {cue.slots.length === 0 && (
                    <span style={{ fontSize: 11, color: "#92400e" }}>
                      synth cue — add a slot in sfxCatalog.ts to make it playable
                    </span>
                  )}
                  {cue.slots.map((slot) => (
                    <button
                      key={slot}
                      style={{ ...GOOD, padding: "3px 9px", fontSize: 12 }}
                      disabled={busy}
                      onClick={() => void approve(t, slot)}
                      title={`Overwrite ${slot} with this take`}
                    >
                      Approve → {slot}
                    </button>
                  ))}
                  <button
                    style={{ ...BTN, padding: "3px 9px", fontSize: 12 }}
                    onClick={() => void discard(t)}
                  >
                    Discard
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
