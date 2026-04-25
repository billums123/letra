import { useEffect, useRef } from "react";
import nipplejs, { type JoystickManager } from "nipplejs";
import { setJoystick } from "./useInput";

// Virtual joystick zone. Only mounts when the device exposes touch — keyboard
// and gamepad users never see it. Sized big and offset from the corner so a
// little kid can park their thumb without missing.

const isTouchDevice =
  typeof window !== "undefined" &&
  ("ontouchstart" in window || navigator.maxTouchPoints > 0);

export function VirtualJoystick({ visible = true }: { visible?: boolean }) {
  const zoneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible || !isTouchDevice) return;
    const zone = zoneRef.current;
    if (!zone) return;

    const manager: JoystickManager = nipplejs.create({
      zone,
      mode: "static",
      position: { left: "90px", bottom: "90px" },
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
  }, [visible]);

  if (!isTouchDevice) return null;

  return (
    <div
      ref={zoneRef}
      style={{
        position: "absolute",
        left: 0,
        bottom: 0,
        width: 220,
        height: 220,
        zIndex: 5,
        // touch-action: none keeps the browser from scrolling/zooming.
        touchAction: "none",
        pointerEvents: visible ? "auto" : "none",
      }}
    />
  );
}
