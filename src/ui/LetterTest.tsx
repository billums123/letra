import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Font, FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { audio } from "../audio/Player";
import { ALPHABET, LETTER_NAME_TEXT, LETTER_SOUND_TEXT } from "../audio/types";
import { buildLetterCharacter, colorFor, loadFont } from "../engine/letters";
import { useGameStore } from "../state/store";

// Letter Test: a QA / debug page that shows every letter character in 3D and
// lets you play their name + phonetic sound clips one at a time. Useful for
// validating that the ElevenLabs-generated audio sounds right and that the
// face/limb placement scales across narrow (I, L) and wide (M, W) glyphs.

function Preview({
  letter,
  font,
  lowercase = false,
  height = 220,
  orbit = true,
}: {
  letter: string;
  font: Font | null;
  lowercase?: boolean;
  height?: number;
  orbit?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!font || !containerRef.current) return;
    const container = containerRef.current;
    const w = container.clientWidth;
    const h = container.clientHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, w / h, 0.1, 50);
    camera.position.set(0, 1.6, 7);
    camera.lookAt(0, 1.4, 0);

    scene.add(new THREE.HemisphereLight(0xfff7d6, 0xddddff, 0.7));
    const dir = new THREE.DirectionalLight(0xffffff, 1.1);
    dir.position.set(3, 5, 4);
    scene.add(dir);
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));

    const character = buildLetterCharacter(font, { letter, lowercase });
    character.group.position.set(0, 0, 0);
    character.faceTowards(camera.position.x, camera.position.z);
    scene.add(character.group);

    let raf = 0;
    const clock = new THREE.Clock();
    let running = true;
    const tick = () => {
      if (!running) return;
      const dt = Math.min(clock.getDelta(), 0.1);
      character.update(dt, clock.elapsedTime);
      character.faceTowards(camera.position.x, camera.position.z);
      if (orbit) {
        const t = clock.elapsedTime;
        camera.position.x = Math.sin(t * 0.4) * 1.4;
        camera.lookAt(0, 1.4, 0);
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onResize = () => {
      const W = container.clientWidth;
      const H = container.clientHeight;
      renderer.setSize(W, H, false);
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(container);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
      const dispose = character.group.userData.dispose as (() => void) | undefined;
      dispose?.();
      renderer.dispose();
      if (renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
    };
  }, [letter, font, lowercase, orbit]);

  return <div ref={containerRef} style={{ width: "100%", height }} />;
}

export function LetterTest() {
  const goToMenu = useGameStore((s) => s.goToMenu);
  const [font, setFont] = useState<Font | null>(null);
  const [selected, setSelected] = useState<string>("A");
  const [showLowercase, setShowLowercase] = useState(false);
  const [view, setView] = useState<"audio" | "audit3d">("audio");

  useEffect(() => {
    let cancelled = false;
    loadFont().then((f) => {
      if (!cancelled) setFont(f);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const playName = (L: string) => {
    audio.stop();
    audio.play(audio.letterName(L));
  };
  const playSound = (L: string) => {
    audio.stop();
    audio.play(audio.letterSound(L));
  };
  const playBoth = (L: string) => {
    audio.stop();
    audio.play(audio.letterName(L)).then(() => audio.play(audio.letterSound(L), { interrupt: false }));
  };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "linear-gradient(180deg, #fff7d6, #a8e2ff)",
        overflow: "auto",
        padding: 24,
        color: "#3a2a14",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 36 }}>Letter Test</h1>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", borderRadius: 14, overflow: "hidden", border: "3px solid white" }}>
            <button
              type="button"
              onClick={() => setView("audio")}
              style={tabStyle(view === "audio")}
            >
              🔊 Audio
            </button>
            <button
              type="button"
              onClick={() => setView("audit3d")}
              style={tabStyle(view === "audit3d")}
            >
              👀 3D audit
            </button>
          </div>
          <label style={{ fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={showLowercase}
              onChange={(e) => setShowLowercase(e.target.checked)}
            />
            Lowercase
          </label>
          <button
            type="button"
            onClick={() => {
              audio.stop();
              goToMenu();
            }}
            style={{
              border: "4px solid white",
              background: "#ff8c4a",
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
      </div>

      <p style={{ marginTop: 4, marginBottom: 16, fontSize: 14, opacity: 0.7 }}>
        {view === "audio" ? (
          <>
            Click a letter to hear the name and phonetic sound. The text shown
            below each letter is what the audio script feeds to ElevenLabs —
            edit <code>src/audio/types.ts</code> and re-run{" "}
            <code>npm run audio:generate</code> to change a pronunciation.
          </>
        ) : (
          <>
            Every letter rendered in 3D at the same time so you can spot any
            visual issues at a glance. Click one to inspect it bigger below
            and play its audio. Toggle "Lowercase" to audit the lowercase
            forms.
          </>
        )}
      </p>

      {view === "audit3d" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            gap: 12,
            marginBottom: 24,
          }}
        >
          {ALPHABET.map((L) => {
            const swatch = `#${colorFor(L).getHexString()}`;
            const isSelected = selected === L;
            return (
              <div
                key={L}
                onClick={() => {
                  setSelected(L);
                  audio.stop();
                  audio.play(audio.letterName(L)).then(() => audio.play(audio.letterSound(L), { interrupt: false }));
                }}
                style={{
                  background: "white",
                  border: isSelected ? `4px solid ${swatch}` : "4px solid rgba(255,255,255,0.6)",
                  borderRadius: 14,
                  padding: 6,
                  boxShadow: "0 4px 0 rgba(0,0,0,0.08)",
                  cursor: "pointer",
                  position: "relative",
                }}
              >
                <Preview letter={L} font={font} lowercase={showLowercase} height={150} orbit={false} />
                <div
                  style={{
                    position: "absolute",
                    bottom: 8,
                    left: 8,
                    background: swatch,
                    color: "white",
                    fontSize: 13,
                    fontWeight: 900,
                    padding: "3px 8px",
                    borderRadius: 8,
                  }}
                >
                  {showLowercase ? L.toLowerCase() : L}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div
        style={{
          display: view === "audio" ? "grid" : "none",
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          gap: 14,
        }}
      >
        {ALPHABET.map((L) => {
          const display = showLowercase ? L.toLowerCase() : L;
          const swatch = `#${colorFor(L).getHexString()}`;
          const isSelected = selected === L;
          return (
            <div
              key={L}
              onClick={() => {
                setSelected(L);
                playBoth(L);
              }}
              style={{
                background: "white",
                border: isSelected ? `5px solid ${swatch}` : "5px solid transparent",
                borderRadius: 18,
                padding: 12,
                boxShadow: "0 6px 0 rgba(0,0,0,0.08)",
                cursor: "pointer",
                transition: "transform 0.1s ease",
                transform: isSelected ? "translateY(-3px)" : "none",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                }}
              >
                <span
                  style={{
                    fontSize: 56,
                    fontWeight: 900,
                    color: swatch,
                    lineHeight: 1,
                    letterSpacing: -2,
                  }}
                >
                  {display}
                </span>
                <div style={{ textAlign: "right", fontSize: 12, color: "#3a2a14", opacity: 0.7, lineHeight: 1.4 }}>
                  <div>name: <strong>{LETTER_NAME_TEXT[L] ?? L}</strong></div>
                  <div>sound: <strong>/{LETTER_SOUND_TEXT[L]}/</strong></div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    playName(L);
                  }}
                  style={btnStyle("#46c2cb")}
                >
                  🔊 Name
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    playSound(L);
                  }}
                  style={btnStyle("#ff8aaa")}
                >
                  🔊 Sound
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <h2 style={{ marginTop: 28, fontSize: 22 }}>
        3D Preview: {showLowercase ? selected.toLowerCase() : selected}
      </h2>
      <div
        style={{
          background: "rgba(255,255,255,0.7)",
          borderRadius: 18,
          padding: 12,
          marginTop: 6,
          marginBottom: 32,
        }}
      >
        <Preview letter={selected} font={font} lowercase={showLowercase} />
      </div>
    </div>
  );
}

function btnStyle(bg: string): React.CSSProperties {
  return {
    flex: 1,
    appearance: "none",
    border: "2px solid white",
    background: bg,
    color: "white",
    borderRadius: 12,
    padding: "8px 6px",
    fontSize: 13,
    fontWeight: 800,
    cursor: "pointer",
    boxShadow: "0 3px 0 rgba(0,0,0,0.12)",
  };
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    appearance: "none",
    border: "none",
    background: active ? "#3a2a14" : "rgba(255,255,255,0.7)",
    color: active ? "white" : "#3a2a14",
    padding: "10px 16px",
    fontSize: 14,
    fontWeight: 800,
    cursor: "pointer",
  };
}
