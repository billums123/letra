import { useEffect, useRef, useState } from "react";
import nipplejs, { type JoystickManager } from "nipplejs";
import { setJoystick } from "./useInput";

// Floating virtual joystick. The stick spawns wherever the kid first
// touches the screen (nipplejs `dynamic` mode) so a 3-year-old never has
// to hunt for a fixed control in the corner.
//
// Detection has two gates so it never false-fires on a desktop mouse:
//   1. `(pointer: coarse)` matches phones/tablets immediately on mount.
//   2. A one-shot `touchstart` upgrades hybrid devices (Surface,
//      touchscreen Chromebooks) the first time a real finger lands.
// Desktop mice trip neither gate, so the zone never mounts and clicks
// pass straight through to whatever's behind it.

function detectInitialTouch() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(pointer: coarse)").matches ?? false;
}

export function VirtualJoystick({ visible = true }: { visible?: boolean }) {
  const zoneRef = useRef<HTMLDivElement>(null);
  const [touchAvailable, setTouchAvailable] = useState(detectInitialTouch);

  useEffect(() => {
    if (touchAvailable) return;
    const onTouch = () => setTouchAvailable(true);
    window.addEventListener("touchstart", onTouch, { once: true, passive: true });
    return () => window.removeEventListener("touchstart", onTouch);
  }, [touchAvailable]);

  useEffect(() => {
    if (!visible || !touchAvailable) return;
    const zone = zoneRef.current;
    if (!zone) return;

    const manager: JoystickManager = nipplejs.create({
      zone,
      mode: "dynamic",
      color: "#ffd56b",
      size: 140,
      restOpacity: 0.6,
      fadeTime: 100,
    });

    manager.on("move", (_evt, data) => {
      if (!data?.vector) return;
      // nipplejs y is screen-up positive, ours is forward (negative-z) so flip.
      const x = data.vector.x;
      const y = -data.vector.y;
      const force = Math.min(data.force, 1);
      setJoystick(x * force, y * force, true);
    });
    manager.on("end", () => setJoystick(0, 0, false));

    return () => {
      manager.destroy();
      setJoystick(0, 0, false);
    };
  }, [visible, touchAvailable]);

  if (!touchAvailable) return null;

  return (
    <div
      ref={zoneRef}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 5,
        touchAction: "none",
        // HUD (zIndex 10) sits above and its buttons capture their own taps,
        // so a fullscreen zone here is safe.
        pointerEvents: visible ? "auto" : "none",
      }}
    />
  );
}
