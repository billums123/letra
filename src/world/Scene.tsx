import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Engine } from "../engine/Engine";
import { getInputDebugState } from "../input/useInput";
import { useGameStore } from "../state/store";

type SceneProps = {
  onEngineReady?: (engine: Engine) => void;
  onPlayerPosition?: (pos: THREE.Vector3) => void;
};

export function Scene({ onEngineReady, onPlayerPosition }: SceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  // Bumped when the WebGL context is lost (iOS Safari kills GL on
  // backgrounding / memory pressure). The bump changes the canvas
  // element's React key, forcing a fresh DOM element + a fresh
  // Engine constructor on the next render, while the existing
  // useEffect cleanup tears down the dead one. Brief
  // "Reconnecting…" overlay covers the swap.
  const [resetNonce, setResetNonce] = useState(0);
  const [reconnecting, setReconnecting] = useState(false);
  // Read once on mount — switching avatar / biome mid-game would
  // require engine teardown anyway, and the menu is the only place
  // users can change them. One game session = one avatar + biome.
  const avatar = useGameStore((s) => s.avatar);
  const biomeId = useGameStore((s) => s.biomeId);

  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new Engine(
      canvasRef.current,
      {
        onPlayerPosition,
        onContextLost: () => {
          // Show the reconnecting overlay, then bump the nonce so
          // React swaps in a fresh canvas + Engine. The next mount
          // hides the overlay once the new engine is up.
          console.warn("[Letra] WebGL context lost — remounting engine");
          setReconnecting(true);
          setResetNonce((n) => n + 1);
        },
      },
      avatar,
      biomeId,
    );
    engineRef.current = engine;
    if (import.meta.env.DEV) {
      const w = window as unknown as { __letra: Engine; __letraInput: typeof getInputDebugState };
      w.__letra = engine;
      w.__letraInput = getInputDebugState;
    }
    onEngineReady?.(engine);
    // If we just rebuilt after a context-loss, drop the overlay now
    // that the new renderer is live. First mount (resetNonce === 0)
    // had reconnecting=false, so this is a no-op there.
    if (reconnecting) setReconnecting(false);
    return () => {
      engineRef.current = null;
      if (import.meta.env.DEV) delete (window as unknown as { __letra?: Engine }).__letra;
      engine.dispose();
    };
    // Engine is normally created once per mount, but resetNonce is in
    // the deps so a WebGL context loss can force a clean rebuild.
    // Avatar / biome still aren't deps — those changes are routed
    // through full menu→game remounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetNonce]);

  // Keep the live event callbacks fresh without re-creating the renderer.
  useEffect(() => {
    engineRef.current?.setEvents({ onPlayerPosition });
  }, [onPlayerPosition]);

  return (
    <>
      <canvas
        key={resetNonce}
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
      />
      {reconnecting && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(126, 200, 255, 0.92)",
            fontFamily: "'Comic Sans MS', 'Chalkboard SE', system-ui, sans-serif",
            fontSize: 24,
            fontWeight: 700,
            color: "#1a3a52",
            zIndex: 5,
            pointerEvents: "none",
          }}
        >
          Reconnecting…
        </div>
      )}
    </>
  );
}
