import { useEffect, useRef } from "react";
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
  // Read once on mount — switching avatar / biome mid-game would
  // require engine teardown anyway, and the menu is the only place
  // users can change them. One game session = one avatar + biome.
  const avatar = useGameStore((s) => s.avatar);
  const biomeId = useGameStore((s) => s.biomeId);

  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new Engine(canvasRef.current, { onPlayerPosition }, avatar, biomeId);
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
