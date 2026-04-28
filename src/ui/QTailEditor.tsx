import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useGameStore } from "../state/store";
import {
  buildLetterCharacter,
  getDefaultQTailConfig,
  loadFont,
  type QTailConfig,
  qTailConfig,
  resetQTailConfig,
  setQTailConfig,
} from "../engine/letters";

// Live tuner for the lowercase-q tail. Four sliders drive the curl's
// thickness, length, rise, and horizontal alignment with the stem.
// Values persist to localStorage immediately so any q rendered in the
// rest of the game picks them up on next build.

type SliderSpec = {
  key: keyof QTailConfig;
  label: string;
  min: number;
  max: number;
  step: number;
  hint: string;
};

const SLIDERS: SliderSpec[] = [
  { key: "thick", label: "Thickness", min: 0.05, max: 0.5, step: 0.01, hint: "ribbon thickness" },
  { key: "reach", label: "Reach", min: 0.2, max: 1.2, step: 0.01, hint: "how far right the tail extends" },
  { key: "rise", label: "Rise", min: 0, max: 0.6, step: 0.01, hint: "how high the tip rises" },
  { key: "alignment", label: "Alignment", min: 0.2, max: 2.5, step: 0.01, hint: "how far inside the stem the tail tucks (larger = further left)" },
  { key: "rotation", label: "Rotation", min: -0.6, max: 0.6, step: 0.01, hint: "tilt the tail around its join (radians, ≈ ±34°)" },
];

export function QTailEditor() {
  const goToMenu = useGameStore((s) => s.goToMenu);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Local state mirrors qTailConfig so the React UI re-renders when
  // sliders move; persistence happens via setQTailConfig in onChange.
  const [cfg, setCfg] = useState<QTailConfig>({ ...qTailConfig });
  const [exportOpen, setExportOpen] = useState(false);

  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const charRef = useRef<{ group: THREE.Group; dispose?: () => void } | null>(null);
  const fontRef = useRef<Awaited<ReturnType<typeof loadFont>> | null>(null);
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
    scene.background = new THREE.Color(0xf0f7ff);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 50);
    camera.position.set(0, 1.5, 4.2);
    camera.lookAt(0, 1, 0);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, canvas);
    controls.target.set(0, 1, 0);
    controls.minDistance = 1.5;
    controls.maxDistance = 10;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.update();
    controlsRef.current = controls;

    // Soft studio lighting so the bevels read.
    const hemi = new THREE.HemisphereLight(0xffffff, 0xa0a8c0, 0.7);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(-3, 5, 4);
    scene.add(key);

    // Sizing.
    const onResize = () => {
      const parent = canvas.parentElement;
      const w = parent?.clientWidth || window.innerWidth;
      const h = parent?.clientHeight || window.innerHeight;
      renderer.setSize(w, h, true);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);
    onResize();

    // Build the initial glyph asynchronously (font load is async).
    void (async () => {
      const font = await loadFont();
      fontRef.current = font;
      buildAndMount();
    })();

    const tick = () => {
      controls.update();
      renderer.render(scene, camera);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      const ch = charRef.current;
      if (ch) {
        scene.remove(ch.group);
        ch.dispose?.();
      }
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Rebuild the q glyph whenever the config changes ─────────────
  useEffect(() => {
    if (!fontRef.current || !sceneRef.current) return;
    buildAndMount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg]);

  function buildAndMount() {
    const font = fontRef.current;
    const scene = sceneRef.current;
    if (!font || !scene) return;
    // Tear down previous.
    const prev = charRef.current;
    if (prev) {
      scene.remove(prev.group);
      prev.dispose?.();
    }
    const character = buildLetterCharacter(font, { letter: "q", lowercase: true });
    // Centre the glyph in the preview.
    character.group.position.set(0, 0, 0);
    scene.add(character.group);
    charRef.current = {
      group: character.group,
      dispose: character.group.userData.dispose as (() => void) | undefined,
    };
  }

  function applyChange(next: Partial<QTailConfig>) {
    setQTailConfig(next);
    setCfg({ ...qTailConfig });
  }

  function onReset() {
    resetQTailConfig();
    setCfg({ ...qTailConfig });
  }

  const exportText = JSON.stringify(cfg, null, 2);
  const defaults = getDefaultQTailConfig();

  return (
    <div style={{ position: "absolute", inset: 0, background: "#f0f7ff", display: "flex" }}>
      {/* Preview */}
      <div style={{ flex: "1 1 auto", position: "relative" }}>
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
        <button
          type="button"
          onClick={goToMenu}
          style={{
            position: "absolute",
            top: 16,
            left: 16,
            border: "4px solid white",
            background: "#3a2a14",
            color: "white",
            borderRadius: 18,
            padding: "10px 18px",
            fontSize: 18,
            fontWeight: 900,
            cursor: "pointer",
            boxShadow: "0 6px 0 rgba(0,0,0,0.18)",
          }}
        >
          ◀ Home
        </button>
      </div>

      {/* Controls */}
      <div
        style={{
          width: 340,
          background: "#fff",
          borderLeft: "4px solid #3a2a14",
          padding: "20px 22px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          overflowY: "auto",
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 900, color: "#3a2a14" }}>q tail tuner</div>
        <div style={{ fontSize: 13, color: "#6a553a", lineHeight: 1.4 }}>
          Drag a slider — values save instantly and any q rendered in
          the game picks them up on next build.
        </div>

        {SLIDERS.map((s) => (
          <SliderRow
            key={s.key}
            spec={s}
            value={cfg[s.key]}
            defaultValue={defaults[s.key]}
            onChange={(v) => applyChange({ [s.key]: v } as Partial<QTailConfig>)}
          />
        ))}

        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <button
            type="button"
            onClick={onReset}
            style={btnStyle("#ff8c4a")}
          >
            Reset
          </button>
          <button
            type="button"
            onClick={() => setExportOpen((v) => !v)}
            style={btnStyle("#3a2a14")}
          >
            {exportOpen ? "Hide JSON" : "Export"}
          </button>
        </div>

        {exportOpen && (
          <textarea
            readOnly
            value={exportText}
            onFocus={(e) => e.currentTarget.select()}
            style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: 13,
              minHeight: 120,
              padding: 8,
              border: "2px solid #3a2a14",
              borderRadius: 8,
              resize: "vertical",
            }}
          />
        )}
      </div>
    </div>
  );
}

function SliderRow({
  spec,
  value,
  defaultValue,
  onChange,
}: {
  spec: SliderSpec;
  value: number;
  defaultValue: number;
  onChange: (v: number) => void;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: "#3a2a14" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontWeight: 800 }}>{spec.label}</span>
        <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#6a553a" }}>
          {value.toFixed(2)} <span style={{ opacity: 0.5 }}>(default {defaultValue.toFixed(2)})</span>
        </span>
      </div>
      <input
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: "100%" }}
      />
      <span style={{ fontSize: 11, opacity: 0.6 }}>{spec.hint}</span>
    </label>
  );
}

function btnStyle(bg: string): React.CSSProperties {
  return {
    flex: 1,
    border: "3px solid white",
    background: bg,
    color: "white",
    borderRadius: 14,
    padding: "10px 14px",
    fontSize: 15,
    fontWeight: 900,
    cursor: "pointer",
    boxShadow: "0 4px 0 rgba(0,0,0,0.18)",
  };
}
