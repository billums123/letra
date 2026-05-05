import { useEffect, useMemo, useState } from "react";
import { audio } from "../audio/Player";
import { buildEntries, type AudioEntry } from "../audio/types";
import { useGameStore } from "../state/store";

// Dev-only: list every clip from buildEntries() grouped by category and play
// each one through the runtime audio Player so what you hear matches what the
// real game plays. Voice picker reflects /audio/voices.json — switching here
// also drives the player for this session.
//
// Each row also opens an inline editor: tweak the text being sent to
// ElevenLabs, click Regenerate, hear the result inline (cache-busted URL),
// and copy a `{ id, text }` snippet to hand off to Claude for the source-
// of-truth edit in src/audio/types.ts.

type Category = {
  title: string;
  match: (id: string) => boolean;
};

// Order matters — the first matching category wins.
const CATEGORIES: Category[] = [
  { title: "Letter names", match: (id) => /^letter-[A-Z]-name$/.test(id) },
  { title: "Letter sounds", match: (id) => /^letter-[A-Z]-sound$/.test(id) },
  { title: "Spell-the-word — intros", match: (id) => /^prompt-spell-/.test(id) },
  { title: "Spell-the-word — reveals", match: (id) => /^reveal-spell-/.test(id) },
  { title: "Find-the-alphabet prompts", match: (id) => /^prompt-find-alphabet/.test(id) },
  { title: "Sound-match prompts", match: (id) => /^prompt-sound-match/.test(id) },
  { title: "Celebrations", match: (id) => /^celebrate-/.test(id) },
  { title: "Hints", match: (id) => /^hint-/.test(id) },
  { title: "Wrong-letter nudges", match: (id) => /^wrong-/.test(id) },
  { title: "Menu", match: (id) => /^menu-/.test(id) },
];

function categorise(entries: AudioEntry[]): { title: string; entries: AudioEntry[] }[] {
  const buckets: Record<string, AudioEntry[]> = {};
  const order: string[] = [];
  for (const entry of entries) {
    const cat = CATEGORIES.find((c) => c.match(entry.id));
    const title = cat?.title ?? "Uncategorised";
    if (!buckets[title]) {
      buckets[title] = [];
      order.push(title);
    }
    buckets[title].push(entry);
  }
  const sorted = CATEGORIES.map((c) => c.title).filter((t) => buckets[t]);
  for (const t of order) if (!sorted.includes(t)) sorted.push(t);
  return sorted.map((title) => ({ title, entries: buckets[title] }));
}

// State for an open editor. There's at most one at a time — keeps the UI
// simple and avoids accidental concurrent regenerate calls.
type Editing = {
  id: string;
  originalText: string;
  text: string;
  modelId: string | undefined;
  status: "idle" | "regenerating" | "ok" | "error";
  freshUrl: string | null;
  error: string | null;
};

export function AudioTester() {
  const goToMenu = useGameStore((s) => s.goToMenu);
  const voiceSlug = useGameStore((s) => s.voiceSlug);
  const setVoiceSlug = useGameStore((s) => s.setVoiceSlug);
  const [filter, setFilter] = useState("");
  const [playing, setPlaying] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  // Forces a re-render when the player's voice list resolves (init is async).
  const [, force] = useState(0);

  useEffect(() => {
    const off = audio.subscribe(() => force((n) => n + 1));
    return off;
  }, []);

  const groups = useMemo(() => {
    const all = buildEntries();
    if (!filter.trim()) return categorise(all);
    const needle = filter.trim().toLowerCase();
    const filtered = all.filter(
      (e) => e.id.toLowerCase().includes(needle) || e.text.toLowerCase().includes(needle),
    );
    return categorise(filtered);
  }, [filter]);

  async function playOne(id: string) {
    setPlaying(id);
    try {
      await audio.play(id);
    } finally {
      setPlaying((p) => (p === id ? null : p));
    }
  }

  async function playMany(ids: string[]) {
    for (const id of ids) {
      setPlaying(id);
      await audio.play(id);
    }
    setPlaying(null);
  }

  function startEdit(entry: AudioEntry) {
    setEditing({
      id: entry.id,
      originalText: entry.text,
      text: entry.text,
      modelId: entry.modelId,
      status: "idle",
      freshUrl: null,
      error: null,
    });
  }

  async function regenerate() {
    if (!editing) return;
    const slug = audio.activeVoice?.slug;
    if (!slug) {
      setEditing({ ...editing, status: "error", error: "No active voice." });
      return;
    }
    setEditing({ ...editing, status: "regenerating", error: null });
    try {
      const res = await fetch("/__dev/regenerate-clip", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: editing.id,
          text: editing.text,
          voiceSlug: slug,
          modelId: editing.modelId,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as { url: string };
      // Replace the in-flight Editing object — preserve text in case the
      // user wants to keep iterating.
      setEditing((prev) => (prev ? { ...prev, status: "ok", freshUrl: json.url, error: null } : prev));
    } catch (e) {
      setEditing((prev) => (prev ? { ...prev, status: "error", error: (e as Error).message } : prev));
    }
  }

  async function copyPatch() {
    if (!editing) return;
    const snippet = `{ id: "${editing.id}", text: ${JSON.stringify(editing.text)} }`;
    try {
      await navigator.clipboard.writeText(snippet);
    } catch {
      // Clipboard may not be available in all dev contexts; the textarea
      // in the panel is selectable as a fallback.
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
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "24px 20px 80px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button type="button" onClick={() => goToMenu()} style={btnStyle("#ff8c4a")}>
            ◀ Menu
          </button>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>Audio Tester</h1>
          <span style={{ opacity: 0.7, marginLeft: "auto", fontSize: 14 }}>
            {audio.voices.length} voice{audio.voices.length === 1 ? "" : "s"} ·{" "}
            {audio.activeVoice?.name ?? "—"}
          </span>
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ opacity: 0.8, fontSize: 14 }}>Voice</span>
            <select
              value={audio.activeVoice?.slug ?? ""}
              onChange={(e) => {
                const slug = e.target.value;
                setVoiceSlug(slug);
                void audio.setVoice(slug);
              }}
              style={selectStyle}
            >
              {audio.voices.map((v) => (
                <option key={v.slug} value={v.slug}>
                  {v.name}
                </option>
              ))}
              {audio.voices.length === 0 && <option value="">(none)</option>}
            </select>
          </label>
          <input
            type="search"
            placeholder="Filter by id or text…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{
              flex: "1 1 240px",
              padding: "8px 12px",
              borderRadius: 10,
              border: "2px solid rgba(255,255,255,0.2)",
              background: "rgba(0,0,0,0.3)",
              color: "white",
              fontSize: 16,
            }}
          />
          {voiceSlug && voiceSlug !== audio.activeVoice?.slug && (
            <span style={{ alignSelf: "center", opacity: 0.6, fontSize: 13 }}>
              loading {voiceSlug}…
            </span>
          )}
        </div>

        {groups.map((group) => (
          <section key={group.title} style={{ marginTop: 28 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{group.title}</h2>
              <span style={{ opacity: 0.6, fontSize: 13 }}>({group.entries.length})</span>
              <button
                type="button"
                onClick={() => playMany(group.entries.map((e) => e.id))}
                style={{ ...btnStyle("#7ec8ff"), padding: "4px 10px", fontSize: 13 }}
              >
                ▶ Play all
              </button>
            </div>
            <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
              {group.entries.map((entry) => {
                const isEditing = editing?.id === entry.id;
                return (
                  <div key={entry.id} style={{ display: "grid", gap: 6 }}>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "32px 220px 1fr 80px",
                        alignItems: "center",
                        gap: 12,
                        padding: "8px 12px",
                        borderRadius: 10,
                        border: isEditing ? "1px solid rgba(255,213,107,0.6)" : "1px solid rgba(255,255,255,0.08)",
                        background: playing === entry.id ? "rgba(126,200,255,0.18)" : "rgba(255,255,255,0.04)",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => playOne(entry.id)}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "white",
                          cursor: "pointer",
                          fontSize: 16,
                          padding: 0,
                          opacity: 0.85,
                        }}
                        aria-label={`Play ${entry.id}`}
                      >
                        ▶
                      </button>
                      <code style={{ fontSize: 13, opacity: 0.9 }}>{entry.id}</code>
                      <span
                        style={{
                          opacity: 0.85,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontSize: 14,
                        }}
                      >
                        {entry.text}
                      </span>
                      <button
                        type="button"
                        onClick={() => (isEditing ? setEditing(null) : startEdit(entry))}
                        style={{
                          ...btnStyle(isEditing ? "#888" : "#ffd56b"),
                          padding: "4px 10px",
                          fontSize: 12,
                          color: isEditing ? "white" : "#5a3a00",
                        }}
                      >
                        {isEditing ? "Close" : "Edit"}
                      </button>
                    </div>
                    {isEditing && editing && (
                      <EditPanel
                        editing={editing}
                        onChange={(text) => setEditing({ ...editing, text })}
                        onChangeModel={(modelId) => setEditing({ ...editing, modelId })}
                        onRevert={() => setEditing({ ...editing, text: editing.originalText })}
                        onRegenerate={regenerate}
                        onCopyPatch={copyPatch}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        {groups.length === 0 && (
          <p style={{ opacity: 0.6, marginTop: 24 }}>No clips match that filter.</p>
        )}
      </div>
    </div>
  );
}

function EditPanel({
  editing,
  onChange,
  onChangeModel,
  onRevert,
  onRegenerate,
  onCopyPatch,
}: {
  editing: Editing;
  onChange: (text: string) => void;
  onChangeModel: (modelId: string | undefined) => void;
  onRevert: () => void;
  onRegenerate: () => void;
  onCopyPatch: () => void;
}) {
  const dirty = editing.text !== editing.originalText;
  return (
    <div
      style={{
        marginLeft: 32,
        padding: "12px 14px",
        borderRadius: 10,
        background: "rgba(255,213,107,0.06)",
        border: "1px solid rgba(255,213,107,0.25)",
        display: "grid",
        gap: 8,
      }}
    >
      <textarea
        value={editing.text}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        style={{
          width: "100%",
          padding: "8px 12px",
          borderRadius: 8,
          border: "2px solid rgba(255,255,255,0.2)",
          background: "rgba(0,0,0,0.3)",
          color: "white",
          fontSize: 14,
          resize: "vertical",
          fontFamily: "ui-monospace, Menlo, monospace",
        }}
        placeholder="Text sent to ElevenLabs"
      />
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, opacity: 0.85 }}>
          <span>model</span>
          <select
            value={editing.modelId ?? "default"}
            onChange={(e) => onChangeModel(e.target.value === "default" ? undefined : e.target.value)}
            style={{ ...selectStyle, padding: "4px 8px", fontSize: 13 }}
          >
            <option value="default">voice default (multilingual_v2)</option>
            <option value="eleven_flash_v2">eleven_flash_v2 (phoneme-aware)</option>
            <option value="eleven_multilingual_v2">eleven_multilingual_v2</option>
          </select>
        </label>
        {dirty && (
          <button
            type="button"
            onClick={onRevert}
            style={{ ...btnStyle("#888"), padding: "4px 10px", fontSize: 12 }}
          >
            Revert text
          </button>
        )}
        <button
          type="button"
          onClick={onRegenerate}
          disabled={editing.status === "regenerating"}
          style={{
            ...btnStyle(editing.status === "regenerating" ? "#444" : "#9bdc4a"),
            padding: "4px 12px",
            fontSize: 13,
          }}
        >
          {editing.status === "regenerating" ? "⏳ Regenerating…" : "Regenerate"}
        </button>
        <button
          type="button"
          onClick={onCopyPatch}
          disabled={editing.status !== "ok"}
          style={{
            ...btnStyle(editing.status === "ok" ? "#7ec8ff" : "#444"),
            padding: "4px 12px",
            fontSize: 13,
          }}
        >
          Copy patch
        </button>
      </div>
      {editing.error && (
        <div style={{ color: "#ff7e7e", fontSize: 13 }}>Error: {editing.error}</div>
      )}
      {editing.freshUrl && editing.status === "ok" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ opacity: 0.7, fontSize: 12 }}>fresh:</span>
          {/* key forces remount on each regenerate so the new src is loaded
              even if the URL only differs by query string. */}
          <audio key={editing.freshUrl} controls src={editing.freshUrl} style={{ height: 32 }} />
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
    fontSize: 16,
    fontWeight: 800,
    cursor: "pointer",
    boxShadow: "0 4px 0 rgba(0,0,0,0.18)",
  };
}

const selectStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "2px solid rgba(255,255,255,0.2)",
  background: "rgba(0,0,0,0.3)",
  color: "white",
  fontSize: 15,
  fontWeight: 700,
};
