import { Scene } from "../world/Scene";
import { useInputBootstrap } from "../input/useInput";

export function Game() {
  useInputBootstrap();
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Scene />
      <div
        style={{
          position: "absolute",
          left: 16,
          top: 16,
          padding: "8px 14px",
          background: "rgba(255,255,255,0.85)",
          borderRadius: 12,
          fontWeight: 700,
          fontSize: 14,
          color: "#3a2a14",
          pointerEvents: "none",
        }}
      >
        Move with WASD or arrow keys
      </div>
    </div>
  );
}
