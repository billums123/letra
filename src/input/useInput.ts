import { useEffect } from "react";

// Unified input vector for the player. x = strafe (-1..1), y = forward/back (-1..1).
// Magnitude is clamped to 1. Action button: A/Space/gamepad south.
export type InputState = {
  move: { x: number; y: number };
  action: boolean;
  // Set externally by the virtual joystick. Cleared each frame after read.
  joystick: { x: number; y: number; active: boolean };
};

const state: InputState = {
  move: { x: 0, y: 0 },
  action: false,
  joystick: { x: 0, y: 0, active: false },
};

const keys = new Set<string>();

// While true, readInput() returns a zero vector regardless of what the
// kid's hands or controllers are doing. Used by full-screen overlays
// (e.g. the trophy-earned modal) so a held-down key or an unreleased
// virtual-joystick touch doesn't drive the player around in the
// background while the kid is reading the popup.
let inputFrozen = false;

function refreshFromKeyboard() {
  let x = 0;
  let y = 0;
  if (keys.has("KeyW") || keys.has("ArrowUp")) y -= 1;
  if (keys.has("KeyS") || keys.has("ArrowDown")) y += 1;
  if (keys.has("KeyA") || keys.has("ArrowLeft")) x -= 1;
  if (keys.has("KeyD") || keys.has("ArrowRight")) x += 1;
  state.move.x = x;
  state.move.y = y;
  state.action = keys.has("Space") || keys.has("Enter");
}

function pollGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const pad of pads) {
    if (!pad) continue;
    // Left stick first, fall back to d-pad.
    const dead = 0.18;
    let lx = Math.abs(pad.axes[0] ?? 0) > dead ? pad.axes[0]! : 0;
    let ly = Math.abs(pad.axes[1] ?? 0) > dead ? pad.axes[1]! : 0;
    if (lx === 0 && ly === 0) {
      // Standard gamepad d-pad indexes (12 up, 13 down, 14 left, 15 right).
      const up = pad.buttons[12]?.pressed;
      const down = pad.buttons[13]?.pressed;
      const left = pad.buttons[14]?.pressed;
      const right = pad.buttons[15]?.pressed;
      if (up) ly -= 1;
      if (down) ly += 1;
      if (left) lx -= 1;
      if (right) lx += 1;
    }
    // Combine with keyboard (max magnitude wins per axis).
    if (Math.abs(lx) > Math.abs(state.move.x)) state.move.x = lx;
    if (Math.abs(ly) > Math.abs(state.move.y)) state.move.y = ly;
    // Action: A button (button 0) or X (button 2).
    if (pad.buttons[0]?.pressed || pad.buttons[2]?.pressed) state.action = true;
    return;
  }
}

function applyJoystick() {
  if (!state.joystick.active) return;
  const { x, y } = state.joystick;
  if (Math.abs(x) > Math.abs(state.move.x)) state.move.x = x;
  if (Math.abs(y) > Math.abs(state.move.y)) state.move.y = y;
}

function clamp() {
  const mag = Math.hypot(state.move.x, state.move.y);
  if (mag > 1) {
    state.move.x /= mag;
    state.move.y /= mag;
  }
}

export function startInput() {
  // Skip the global keyboard handler when the user is typing into a
  // form field — otherwise Space and Arrow are preventDefault'd at
  // the window level and never make it into the <input>/<textarea>
  // (the dev tools have a few). Without this, you can't type a space
  // in the audio tester or word builder.
  const isEditable = (target: EventTarget | null): boolean => {
    const el = target as HTMLElement | null;
    if (!el) return false;
    return (
      el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.tagName === "SELECT" ||
      el.isContentEditable
    );
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (isEditable(e.target)) return;
    keys.add(e.code);
    if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (isEditable(e.target)) return;
    keys.delete(e.code);
  };
  const onBlur = () => keys.clear();
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
  };
}

export function readInput(): InputState {
  if (inputFrozen) {
    // Return a clean zero vector. We deliberately don't poll keyboard
    // / gamepad / joystick here — any held inputs are intentionally
    // ignored until the freeze is lifted.
    state.move.x = 0;
    state.move.y = 0;
    state.action = false;
    return state;
  }
  refreshFromKeyboard();
  pollGamepad();
  applyJoystick();
  clamp();
  return state;
}

// Freeze / unfreeze player input. When freezing we also flush the
// stale input state so a held key (kid pressing W when the modal
// appears) doesn't reactivate the moment we unfreeze without a fresh
// keyup. Caller is responsible for unfreezing.
export function setInputFrozen(frozen: boolean) {
  inputFrozen = frozen;
  if (frozen) {
    keys.clear();
    state.move.x = 0;
    state.move.y = 0;
    state.action = false;
    state.joystick.x = 0;
    state.joystick.y = 0;
    state.joystick.active = false;
  }
}

export function getInputDebugState() {
  return { keys: [...keys], state };
}

export function setJoystick(x: number, y: number, active: boolean) {
  state.joystick.x = x;
  state.joystick.y = y;
  state.joystick.active = active;
}

// React hook — wires up keyboard/window listeners while the host component
// is mounted. Cleanup removes them so we never end up with stale handlers.
export function useInputBootstrap() {
  useEffect(() => startInput(), []);
}
