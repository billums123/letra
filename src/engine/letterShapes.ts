import * as THREE from "three";

// Shared types and geometry helpers used by both the in-game letter
// character (src/engine/letters.ts) and the authoring editor
// (src/ui/LetterEditor.tsx). Keeping the shape primitives, mouth
// geometry, and wave math in one place ensures what the editor
// previews is exactly what the kid sees.

export type Vec3 = { x: number; y: number; z: number };
export type Transform = { pos: Vec3; rot: Vec3 };
export type Pair = { R: Transform; L: Transform };

export const ZERO_ROT: Vec3 = { x: 0, y: 0, z: 0 };
export const ARM_REST_ROT: Vec3 = { x: 0, y: 0, z: 0 };
export const SMILE_REST_ROT: Vec3 = { x: Math.PI / 2, y: 0, z: 0 };

// Mirror a Transform across the X axis. Position negates X; rotations
// around Y and Z negate (rotation about X stays the same — that's
// still the same axis after a left/right flip).
export function mirrorT(t: Transform): Transform {
  return {
    pos: { x: -t.pos.x, y: t.pos.y, z: t.pos.z },
    rot: { x: t.rot.x, y: -t.rot.y, z: -t.rot.z },
  };
}
export function pairFromR(R: Transform): Pair {
  return { R, L: mirrorT(R) };
}

// ─── Wave authoring ──────────────────────────────────────────────────────
// Each pattern maps a phase value (in radians) into a normalised [-1, 1]
// amplitude. The arm angle is `offset + pattern(phase * frequency * 2π)
// * amplitude`. Adding new patterns means extending this table and the
// dropdown.
export type WavePattern =
  | "sine"
  | "triangle"
  | "square"
  | "sawtooth"
  | "bounce"
  | "double-pulse";

export type WaveConfig = {
  pattern: WavePattern;
  amplitude: number;   // radians — peak swing magnitude
  frequency: number;   // hz — full cycles per second
  offset: number;      // radians — rest bias added to the swing
};

export const DEFAULT_WAVE: WaveConfig = {
  pattern: "sine",
  amplitude: 1.0,
  frequency: 2.86, // 18 rad/s ≈ 2.86 Hz — the sin(c*18) feel of the
  // original hand-tuned arm wave.
  offset: -0.6,
};

export const WAVE_PATTERN_LABEL: Record<WavePattern, string> = {
  sine: "Sine (smooth)",
  triangle: "Triangle (linear)",
  square: "Square (snap)",
  sawtooth: "Sawtooth (ramp)",
  bounce: "Bounce (ease-out)",
  "double-pulse": "Double pulse",
};

export function wavePatternValue(pattern: WavePattern, phaseRad: number): number {
  // Normalise phase to [0, 2π) for stable shapes regardless of accumulated
  // time. Angle units throughout this module: radians.
  const TWO_PI = Math.PI * 2;
  const p = ((phaseRad % TWO_PI) + TWO_PI) % TWO_PI;
  switch (pattern) {
    case "sine":
      return Math.sin(p);
    case "triangle": {
      const t = p / TWO_PI;
      if (t < 0.25) return t * 4;
      if (t < 0.75) return 2 - t * 4;
      return t * 4 - 4;
    }
    case "square":
      return p < Math.PI ? 1 : -1;
    case "sawtooth":
      return p / Math.PI - 1;
    case "bounce": {
      const t = p / TWO_PI;
      const x = t < 0.5 ? t * 2 : 2 - t * 2;
      return -1 + (1 - (1 - x) * (1 - x)) * 2;
    }
    case "double-pulse":
      return Math.sin(p * 2) * (1 - (p / TWO_PI) * 0.4);
  }
}

// ─── Mouth geometry ──────────────────────────────────────────────────────
export type MouthShape =
  | "smile"
  | "big-smile"
  | "open-smile"
  | "frown"
  | "smirk-left"
  | "smirk-right"
  | "open-o"
  | "flat";

export const MOUTH_LABEL: Record<MouthShape, string> = {
  smile: "Smile",
  "big-smile": "Big smile",
  "open-smile": "Open mouth",
  frown: "Frown",
  "smirk-left": "Smirk (left)",
  "smirk-right": "Smirk (right)",
  "open-o": "Surprised O",
  flat: "Flat line",
};

// Each shape is wrapped in a group so callers can position/rotate one
// consistent target regardless of which primitive(s) make up the look.
export function makeMouth(shape: MouthShape, radius: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const tube = Math.max(0.03, radius * 0.22);
  switch (shape) {
    case "smile": {
      const m = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 8, 16, Math.PI), mat);
      g.add(m);
      break;
    }
    case "big-smile": {
      const m = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.3, tube * 1.3, 8, 18, Math.PI * 1.1), mat);
      g.add(m);
      break;
    }
    case "open-smile": {
      const arc = new THREE.Mesh(new THREE.TorusGeometry(radius, tube * 1.2, 8, 18, Math.PI), mat);
      g.add(arc);
      const inside = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 0.6, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0x2b0d05 })
      );
      inside.position.y = -radius * 0.15;
      inside.scale.set(1, 0.6, 0.5);
      g.add(inside);
      break;
    }
    case "frown": {
      const m = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 8, 16, Math.PI), mat);
      m.rotation.z = Math.PI;
      m.position.y = -radius * 0.6;
      g.add(m);
      break;
    }
    case "smirk-left": {
      const m = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 8, 14, Math.PI * 0.7), mat);
      m.position.x = -radius * 0.25;
      g.add(m);
      break;
    }
    case "smirk-right": {
      const m = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 8, 14, Math.PI * 0.7), mat);
      m.position.x = radius * 0.25;
      m.rotation.y = Math.PI;
      g.add(m);
      break;
    }
    case "open-o": {
      const m = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.65, tube * 1.1, 10, 20), mat);
      g.add(m);
      const inside = new THREE.Mesh(
        new THREE.CircleGeometry(radius * 0.55, 16),
        new THREE.MeshStandardMaterial({ color: 0x2b0d05, side: THREE.DoubleSide })
      );
      g.add(inside);
      break;
    }
    case "flat": {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(tube * 1.2, radius * 1.4, 4, 8), mat);
      m.rotation.z = Math.PI / 2;
      g.add(m);
      break;
    }
  }
  return g;
}

// ─── EditableParts shape ────────────────────────────────────────────────
// The full per-letter override schema. Authored in the editor, persisted
// to localStorage, exported as JSON, and consumed at runtime by the
// in-game LetterCharacter when an entry exists for the letter.
export type EditableParts = {
  eye: Pair;
  pupil: Pair; // pos relative to its eye
  shine: Pair; // pos relative to its eye
  smile: Transform;
  mouthShape: MouthShape;
  cheek: Pair;
  arm: Pair;
  foot: Pair;
  eyeRadius: number;
  pupilRadius: number;
  shineRadius: number;
  smileRadius: number;
  cheekRadius: number;
  footRadius: number;
  wave: WaveConfig;
  hidden: Partial<Record<string, boolean>>;
};
