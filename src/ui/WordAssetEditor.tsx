import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useGameStore } from "../state/store";
import {
  CREATURE_FIELD_GROUPS,
  CREATURE_FIELD_META,
  WORD_ASSETS,
  clearCreatureGeometry,
  loadCreatureGeometry,
  saveCreatureGeometry,
  type CreatureGeometry,
  type WordAssetHandles,
} from "../engine/wordAssets";

// Word-asset editor — pick a word from the dropdown, tweak its
// CreatureGeometry on the right, see the result preview on the
// left. Save persists to localStorage so the next time SpellWord
// completes that word, the new look + animation play in-game.

const VOICES: Array<CreatureGeometry["voice"]> = ["meow", "bark", "none"];

export function WordAssetEditor() {
  const goToMenu = useGameStore((s) => s.goToMenu);
  const wordKeys = useMemo(() => Object.keys(WORD_ASSETS).sort(), []);
  const [activeWord, setActiveWord] = useState<string>(wordKeys[0] ?? "CAT");
  const [geometry, setGeometry] = useState<CreatureGeometry>(() => loadCreatureGeometry(activeWord));
  const [exportOpen, setExportOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  // Independent toggle for the camera's auto-rotate. Keeping it
  // separate from "paused" lets you spin around a still creature
  // *or* stop the orbit while watching the tail wag — the two
  // controls don't have to move together.
  const [rotating, setRotating] = useState(true);
  const rotatingRef = useRef(true);
  rotatingRef.current = rotating;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const creatureRef = useRef<WordAssetHandles | null>(null);
  const rafRef = useRef<number>(0);

  // ── Mount renderer + scene once ─────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    rendererRef.current = renderer;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xb6dff7);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 50);
    camera.position.set(2.6, 1.4, 2.4);
    camera.lookAt(0, 0.5, 0);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, canvas);
    controls.target.set(0, 0.45, 0);
    controls.minDistance = 0.6;
    controls.maxDistance = 10;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.2;
    controls.update();
    controlsRef.current = controls;

    // Lighting close to the meadow biome's midday — warm key light,
    // soft fill, low ambient. Lets the editor reflect what the
    // creature will look like in the live game.
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(4, 5, 3);
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0xffffff, 0.45));
    scene.add(new THREE.HemisphereLight(0xfff7d6, 0x86d36a, 0.55));

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(3, 32),
      new THREE.MeshStandardMaterial({ color: 0x86d36a, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    const resize = () => {
      const parent = canvas.parentElement;
      const w = parent?.clientWidth ?? 480;
      const h = parent?.clientHeight ?? 480;
      renderer.setSize(w, h, true);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    let last = performance.now();
    let elapsed = 0;
    const loop = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!pausedRef.current) {
        elapsed += dt;
        creatureRef.current?.tick(dt, elapsed);
      }
      controls.autoRotate = rotatingRef.current;
      controls.update();
      renderer.render(scene, camera);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
    };
  }, []);

  // ── Load saved geometry whenever the active word changes ────────
  useEffect(() => {
    setGeometry(loadCreatureGeometry(activeWord));
  }, [activeWord]);

  // ── Rebuild the creature on every geometry / word change ────────
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (creatureRef.current) {
      scene.remove(creatureRef.current.group);
      creatureRef.current.dispose();
      creatureRef.current = null;
    }
    const asset = WORD_ASSETS[activeWord];
    if (!asset) return;
    const handles = asset.build(geometry);
    // Skip the entry walk in the editor — the creature should sit
    // visible at the origin so the user can adjust the geometry
    // without waiting through a walk-in. We achieve this by manually
    // ticking the asset past its entry duration before the first
    // render frame; the scene-level loop above keeps it idling from
    // there.
    handles.tick(handles.entryDurationS + 0.05, handles.entryDurationS + 0.05);
    handles.group.position.set(0, 0, 0);
    handles.group.rotation.y = Math.PI / 6; // turn slightly so we see depth
    scene.add(handles.group);
    creatureRef.current = handles;
  }, [geometry, activeWord]);

  const setField = <K extends keyof CreatureGeometry>(key: K, value: CreatureGeometry[K]) => {
    setGeometry((g) => ({ ...g, [key]: value }));
  };

  const onSave = () => saveCreatureGeometry(activeWord, geometry);
  const onReset = () => {
    const asset = WORD_ASSETS[activeWord];
    if (!asset) return;
    setGeometry(asset.defaults);
    clearCreatureGeometry(activeWord);
  };
  const onPlayVoice = () => creatureRef.current?.triggerVoice();
  const onResetCamera = () => {
    const cam = cameraRef.current;
    const controls = controlsRef.current;
    if (!cam || !controls) return;
    cam.position.set(2.6, 1.4, 2.4);
    controls.target.set(0, 0.45, 0);
    controls.update();
  };

  const exportJson = useMemo(() => JSON.stringify(geometry, null, 2), [geometry]);
  const onCopy = () => {
    void navigator.clipboard?.writeText(exportJson).catch(() => {
      /* clipboard might be denied */
    });
  };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "#1a1f2c",
        color: "#e7eaf3",
        display: "grid",
        gridTemplateColumns: "1fr 360px",
        gridTemplateRows: "auto 1fr",
        gridTemplateAreas: `"header header" "preview panel"`,
        fontFamily: "inherit",
      }}
    >
      <header
        style={{
          gridArea: "header",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 16px",
          background: "#262d40",
          borderBottom: "1px solid #38405a",
        }}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button type="button" onClick={goToMenu} style={navBtn("#ff8c4a")}>◀ Home</button>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: 0.4 }}>Word Asset Editor</h1>
          <select
            value={activeWord}
            onChange={(e) => setActiveWord(e.target.value)}
            style={{
              background: "#0e1220",
              color: "#e7eaf3",
              border: "1px solid #2a3148",
              borderRadius: 8,
              padding: "6px 10px",
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            {wordKeys.map((w) => (
              <option key={w} value={w}>{w}</option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            style={navBtn(paused ? "#ffd56b" : "#9bdc4a")}
          >
            {paused ? "▶ Play" : "⏸ Pause"}
          </button>
          <button
            type="button"
            onClick={() => setRotating((r) => !r)}
            style={navBtn(rotating ? "#46c2cb" : "#7a8294")}
            aria-label={rotating ? "Stop camera auto-rotation" : "Start camera auto-rotation"}
          >
            {rotating ? "🔄 Spin: on" : "🔄 Spin: off"}
          </button>
          <button type="button" onClick={onPlayVoice} style={navBtn("#b886ff")}>🔊 Voice</button>
          <button type="button" onClick={onResetCamera} style={navBtn("#7e9bff")}>🎥 Center</button>
          <button type="button" onClick={onSave} style={navBtn("#4caf50")}>💾 Save</button>
          <button type="button" onClick={() => setExportOpen((v) => !v)} style={navBtn("#46c2cb")}>📋 Export</button>
          <button type="button" onClick={onReset} style={navBtn("#ff5e7e")}>↺ Reset</button>
        </div>
      </header>

      <div
        style={{
          gridArea: "preview",
          position: "relative",
          minWidth: 0,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
        {exportOpen && (
          <div
            style={{
              position: "absolute",
              left: 16,
              top: 16,
              right: 16,
              bottom: 16,
              background: "rgba(20, 24, 36, 0.96)",
              border: "1px solid #38405a",
              borderRadius: 12,
              padding: 14,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong style={{ fontSize: 14 }}>Exported JSON for {activeWord}</strong>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={onCopy} style={navBtn("#46c2cb")}>Copy</button>
                <button type="button" onClick={() => setExportOpen(false)} style={navBtn("#ff5e7e")}>Close</button>
              </div>
            </div>
            <textarea
              readOnly
              value={exportJson}
              style={{
                flex: 1,
                background: "#0e1220",
                color: "#cdd3e1",
                border: "1px solid #2a3148",
                borderRadius: 8,
                padding: 10,
                fontSize: 12,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                resize: "none",
              }}
            />
          </div>
        )}
      </div>

      <aside
        style={{
          gridArea: "panel",
          background: "#222837",
          borderLeft: "1px solid #38405a",
          overflowY: "auto",
          padding: 12,
        }}
      >
        {CREATURE_FIELD_GROUPS.map((g) => (
          <section key={g.label} style={{ marginBottom: 18 }}>
            <h2 style={{ fontSize: 13, margin: "4px 0 8px", color: "#9aa3b8", fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase" }}>
              {g.label}
            </h2>
            {g.fields.map((field) =>
              field === "voice" ? (
                <VoiceRow
                  key={field}
                  value={geometry.voice}
                  onChange={(v) => setField("voice", v)}
                />
              ) : (
                <FieldRow
                  key={field}
                  field={field}
                  value={geometry[field] as number}
                  onChange={(v) => setField(field, v as never)}
                />
              ),
            )}
          </section>
        ))}
      </aside>
    </div>
  );
}

function FieldRow({
  field,
  value,
  onChange,
}: {
  field: keyof CreatureGeometry;
  value: number;
  onChange: (v: number) => void;
}) {
  const meta = CREATURE_FIELD_META[field];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 84px",
        gap: 8,
        alignItems: "center",
        marginBottom: 6,
      }}
    >
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#cdd3e1" }}>
        <span style={{ display: "flex", justifyContent: "space-between" }}>
          <span>{meta.label}</span>
          <span style={{ color: "#7a8294", fontFamily: "ui-monospace, monospace" }}>{value.toFixed(3)}</span>
        </span>
        <input
          type="range"
          min={meta.min}
          max={meta.max}
          step={meta.step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          style={{ accentColor: "#46c2cb" }}
        />
      </label>
      <input
        type="number"
        step={meta.step}
        value={value}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        style={{
          background: "#0e1220",
          color: "#e7eaf3",
          border: "1px solid #2a3148",
          borderRadius: 6,
          padding: "4px 6px",
          fontSize: 12,
          fontFamily: "ui-monospace, monospace",
        }}
      />
    </div>
  );
}

function VoiceRow({
  value,
  onChange,
}: {
  value: CreatureGeometry["voice"];
  onChange: (v: CreatureGeometry["voice"]) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <span style={{ fontSize: 12, color: "#cdd3e1", flex: 1 }}>Voice</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as CreatureGeometry["voice"])}
        style={{
          background: "#0e1220",
          color: "#e7eaf3",
          border: "1px solid #2a3148",
          borderRadius: 6,
          padding: "4px 8px",
          fontSize: 12,
          fontFamily: "inherit",
          flex: "0 0 auto",
        }}
      >
        {VOICES.map((v) => (
          <option key={v} value={v}>{v}</option>
        ))}
      </select>
    </div>
  );
}

function navBtn(bg: string): React.CSSProperties {
  return {
    appearance: "none",
    border: "none",
    background: bg,
    color: "white",
    borderRadius: 10,
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 800,
    cursor: "pointer",
    boxShadow: "0 4px 0 rgba(0,0,0,0.18)",
  };
}
