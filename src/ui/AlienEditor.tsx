import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useGameStore } from "../state/store";
import {
  ALIEN_FIELD_GROUPS,
  ALIEN_FIELD_META,
  type AlienGeometry,
  DEFAULT_ALIEN_GEOMETRY,
  clearAlienGeometry,
  loadAlienGeometry,
  saveAlienGeometry,
} from "../engine/biomes/alienConfig";
import { makeAlien } from "../engine/biomes/moon";

// Alien geometry editor — a stripped-down workbench for tweaking the
// moon-biome aliens. No gizmos / undo / animation; just a numeric
// slider for every field in AlienGeometry, a live 3D preview, and
// Save / Reset / Export buttons. Persisted via localStorage; the moon
// biome reads the saved value on next mount, so a quick way to test
// changes is "Save → go to menu → enter Find the Alphabet on Moon".

const PREVIEW_HUE = 0.55;

export function AlienEditor() {
  const goToMenu = useGameStore((s) => s.goToMenu);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [geometry, setGeometry] = useState<AlienGeometry>(() => loadAlienGeometry());
  const [exportOpen, setExportOpen] = useState(false);

  // ── Three.js preview, mounted once ──────────────────────────────
  // We hold the alien as a single mutable group rebuilt whenever
  // `geometry` changes. The preview camera + lighting are static.
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const alienRef = useRef<{ group: THREE.Group; tick: (dt: number, t: number) => void } | null>(null);
  const rafRef = useRef<number>(0);

  // Mount renderer + scene once.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    rendererRef.current = renderer;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x202635);
    sceneRef.current = scene;
    const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 50);
    camera.position.set(2.2, 1.6, 2.6);
    camera.lookAt(0, 0.95, 0);
    cameraRef.current = camera;

    // Lights — match the moon biome roughly so the preview looks
    // like the alien actually does in-game.
    const sun = new THREE.DirectionalLight(0xc8d8ff, 1.4);
    sun.position.set(-3, 5, 3);
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0x404870, 0.55));
    scene.add(new THREE.HemisphereLight(0x4a7cb0, 0x111626, 0.4));

    // A small ground disc so the contact shadow has something to land on.
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(2.5, 32),
      new THREE.MeshStandardMaterial({ color: 0xa1a7b0, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    // Resize handler keeps the preview square-ish to its container.
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

    // Render loop. The alien's tick advances animations; we feed
    // wall-clock time so wave / blink / antennae sway continue.
    const start = performance.now();
    let last = start;
    const loop = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = (now - start) / 1000;
      alienRef.current?.tick(dt, t);
      // Slowly orbit the camera so we can see the alien from all angles.
      const ang = t * 0.25;
      camera.position.x = Math.cos(ang) * 2.7;
      camera.position.z = Math.sin(ang) * 2.7;
      camera.position.y = 1.5;
      camera.lookAt(0, 0.95, 0);
      renderer.render(scene, camera);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      renderer.dispose();
    };
  }, []);

  // Rebuild the alien any time the config changes. Drops the old
  // group's geometry / materials so we don't leak GL resources on
  // every slider tweak.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (alienRef.current) {
      scene.remove(alienRef.current.group);
      alienRef.current.group.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else if (mat) (mat as THREE.Material).dispose();
      });
    }
    // Preview alien: no walking (we always pass the same player position
    // very far away so it never enters wave mode); just stand in place
    // so the user can read the geometry tweaks frame-by-frame.
    const fakePlayer = () => new THREE.Vector3(100, 0, 100);
    const flatGround = () => 0;
    const alien = makeAlien(PREVIEW_HUE, 0, 0, fakePlayer, flatGround, geometry);
    scene.add(alien.group);
    alienRef.current = alien;
  }, [geometry]);

  const setField = (key: keyof AlienGeometry, value: number) => {
    setGeometry((g) => ({ ...g, [key]: value }));
  };

  const onSave = () => {
    saveAlienGeometry(geometry);
  };
  const onReset = () => {
    setGeometry(DEFAULT_ALIEN_GEOMETRY);
    clearAlienGeometry();
  };

  const exportJson = useMemo(() => JSON.stringify(geometry, null, 2), [geometry]);
  const onCopy = () => {
    void navigator.clipboard?.writeText(exportJson).catch(() => {
      /* clipboard might be denied — non-fatal */
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
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: 0.4 }}>
            Alien Editor
          </h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={onSave} style={navBtn("#4caf50")}>💾 Save</button>
          <button type="button" onClick={() => setExportOpen((v) => !v)} style={navBtn("#46c2cb")}>
            📋 Export
          </button>
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
              <strong style={{ fontSize: 14 }}>Exported JSON</strong>
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
        {ALIEN_FIELD_GROUPS.map((g) => (
          <section key={g.label} style={{ marginBottom: 18 }}>
            <h2 style={{ fontSize: 13, margin: "4px 0 8px", color: "#9aa3b8", fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase" }}>
              {g.label}
            </h2>
            {g.fields.map((field) => (
              <FieldRow
                key={field}
                field={field}
                value={geometry[field]}
                onChange={(v) => setField(field, v)}
              />
            ))}
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
  field: keyof AlienGeometry;
  value: number;
  onChange: (v: number) => void;
}) {
  const meta = ALIEN_FIELD_META[field];
  const step = meta.step ?? 0.01;
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
      <label
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          fontSize: 12,
          color: "#cdd3e1",
        }}
      >
        <span style={{ display: "flex", justifyContent: "space-between" }}>
          <span>{meta.label}</span>
          <span style={{ color: "#7a8294", fontFamily: "ui-monospace, monospace" }}>
            {value.toFixed(3)}
          </span>
        </span>
        <input
          type="range"
          min={meta.min}
          max={meta.max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          style={{ accentColor: "#46c2cb" }}
        />
      </label>
      <input
        type="number"
        step={step}
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
