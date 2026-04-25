import { useEffect, useRef } from "react";
import * as THREE from "three";
import { Engine } from "../engine/Engine";
import { getInputDebugState } from "../input/useInput";

type SceneProps = {
  onEngineReady?: (engine: Engine) => void;
  onPlayerPosition?: (pos: THREE.Vector3) => void;
};

export function Scene({ onEngineReady, onPlayerPosition }: SceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new Engine(canvasRef.current, { onPlayerPosition });
    engineRef.current = engine;
    if (import.meta.env.DEV) {
      const w = window as unknown as { __letra: Engine; __letraInput: typeof getInputDebugState };
      w.__letra = engine;
      w.__letraInput = getInputDebugState;
    }
    onEngineReady?.(engine);
    return () => {
      engineRef.current = null;
      if (import.meta.env.DEV) delete (window as unknown as { __letra?: Engine }).__letra;
      engine.dispose();
    };
    // We intentionally do not re-create the engine on prop changes — engine
    // owns its lifecycle and consumers receive the live instance via the
    // onEngineReady callback for further wiring.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the live event callbacks fresh without re-creating the renderer.
  useEffect(() => {
    engineRef.current?.setEvents({ onPlayerPosition });
  }, [onPlayerPosition]);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
    />
  );
}
