import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Font, FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { ALPHABET } from "../audio/types";
import { colorFor, loadFont } from "../engine/letters";
import {
  type EditableParts as SharedEditableParts,
  type MouthShape as SharedMouthShape,
  type Pair as SharedPair,
  type Transform as SharedTransform,
  type Vec3 as SharedVec3,
  type WaveConfig as SharedWaveConfig,
  type WavePattern as SharedWavePattern,
  ARM_REST_ROT as SHARED_ARM_REST,
  DEFAULT_WAVE as SHARED_DEFAULT_WAVE,
  MOUTH_LABEL as SHARED_MOUTH_LABEL,
  SMILE_REST_ROT as SHARED_SMILE_REST,
  WAVE_PATTERN_LABEL as SHARED_WAVE_PATTERN_LABEL,
  ZERO_ROT as SHARED_ZERO_ROT,
  makeMouth as sharedMakeMouth,
  mirrorT as sharedMirrorT,
  pairFromR as sharedPairFromR,
  wavePatternValue as sharedWavePatternValue,
} from "../engine/letterShapes";
import { useGameStore } from "../state/store";

// The editor still owns the higher-level UI types (PartId, Side, etc.)
// but every concept that touches the runtime (transforms, mouth geometry,
// wave math, the EditableParts shape) is now imported from
// engine/letterShapes so the editor and game render identically. The
// local aliases below preserve the existing names so the rest of the
// file doesn't need rewiring.
type Vec3 = SharedVec3;
type Transform = SharedTransform;
type Pair = SharedPair;
type MouthShape = SharedMouthShape;
type WavePattern = SharedWavePattern;
type WaveConfig = SharedWaveConfig;
type EditableParts = SharedEditableParts;
const ZERO_ROT = SHARED_ZERO_ROT;
const ARM_REST_ROT = SHARED_ARM_REST;
const SMILE_REST_ROT = SHARED_SMILE_REST;
const DEFAULT_WAVE = SHARED_DEFAULT_WAVE;
const WAVE_PATTERN_LABEL = SHARED_WAVE_PATTERN_LABEL;
const MOUTH_LABEL = SHARED_MOUTH_LABEL;
const mirrorT = sharedMirrorT;
const pairFromR = sharedPairFromR;
const wavePatternValue = sharedWavePatternValue;
const makeMouth = sharedMakeMouth;

// 3D letter editor.
//
// Lets you build a letter character by manipulating each part directly:
//   • Orbit the camera with the mouse (left-drag = rotate, right-drag = pan,
//     wheel = zoom).
//   • Click any part to select it — a transform gizmo appears so you can drag
//     the part in X (red), Y (green), or Z (blue).
//   • Or type exact X/Y/Z values in the side panel.
//   • Toggle "Mirror" to keep the left/right pair in sync (eyes, cheeks,
//     arms, feet).
//   • Pick a different letter to edit. Each letter saves its overrides to
//     localStorage so you can iterate freely without losing work.
//   • "Export config" copies a JSON blob of all per-letter overrides to your
//     clipboard, ready to paste into a fixture or commit.
//
// Reference: this view is procedural — it's the same Helvetiker glyph the
// game uses, with the same materials, just rebuilt every frame from the
// editable transforms instead of a fixed function.

type Side = "R" | "L" | "both";

// Helpers for reading / writing per-side data given the current selection.
function isPaired(id: "eye" | "pupil" | "shine" | "smile" | "cheek" | "arm" | "foot"): id is "eye" | "pupil" | "shine" | "cheek" | "arm" | "foot" {
  return id !== "smile";
}

// Returns the Transform corresponding to the current selection. If the
// part is paired and the side is "both", we read R as the canonical.
function getTransform(parts: EditableParts, id: "eye" | "pupil" | "shine" | "smile" | "cheek" | "arm" | "foot", side: Side): Transform {
  if (id === "smile") return parts.smile;
  const pair = parts[id];
  if (side === "L") return pair.L;
  return pair.R;
}

// Look up the Three.js group keyed by part + side. Singletons (smile)
// ignore the side. For paired parts, "both" uses the right-side handle
// since that's where the gizmo grabs the canonical side.
function lookupPartGroup(groups: Record<string, THREE.Object3D>, id: "eye" | "pupil" | "shine" | "smile" | "cheek" | "arm" | "foot", side: Side): THREE.Object3D | undefined {
  if (id === "smile") return groups.smile;
  const sideKey = side === "L" ? "L" : "R";
  return groups[`${id}:${sideKey}`];
}

// Apply an edit to the right place. The gizmo always reports an absolute
// position/rotation in inner-group space; we copy those values directly
// into the side being edited. If side === "both", we mirror across to the
// other side so symmetry is preserved.
function applyEdit(
  parts: EditableParts,
  id: "eye" | "pupil" | "shine" | "smile" | "cheek" | "arm" | "foot",
  side: Side,
  pos: THREE.Vector3,
  rot: THREE.Euler
): EditableParts {
  const newT: Transform = {
    pos: { x: pos.x, y: pos.y, z: pos.z },
    rot: { x: rot.x, y: rot.y, z: rot.z },
  };
  if (id === "smile") {
    return { ...parts, smile: newT };
  }
  const pair = parts[id];
  if (side === "L") {
    return { ...parts, [id]: { R: pair.R, L: newT } };
  }
  if (side === "R") {
    return { ...parts, [id]: { R: newT, L: pair.L } };
  }
  // both — mirror the edit across so the other side stays in sync.
  return { ...parts, [id]: { R: newT, L: mirrorT(newT) } };
}

type PartId = "eye" | "pupil" | "shine" | "smile" | "cheek" | "arm" | "foot";
const PART_IDS: PartId[] = ["eye", "pupil", "shine", "smile", "cheek", "arm", "foot"];
const PART_LABELS: Record<PartId, string> = {
  eye: "Eye (white)",
  pupil: "Pupil (offset from eye)",
  shine: "Shine (offset from eye)",
  smile: "Mouth",
  cheek: "Cheek",
  arm: "Arm pivot",
  foot: "Foot",
};
const SYMMETRIC: Record<PartId, boolean> = {
  eye: true, pupil: true, shine: true, smile: false, cheek: true, arm: true, foot: true,
};

// Bumped to v2 — the storage shape changed when symmetric parts started
// holding both sides explicitly. v1 entries are migrated transparently.
const STORAGE_KEY = "letra:editor:overrides:v2";
const STORAGE_KEY_V1 = "letra:editor:overrides:v1";

// Procedural defaults — same math the game uses, evaluated for a generic
// letter of width 1.4 and height 1.6. The user can override per letter.
function defaultParts(width: number, height: number): EditableParts {
  const half = Math.max(0.18, width * 0.5 - 0.06);
  const depthFront = 0.55 / 2 + 0.08;
  const eyeRadius = Math.min(0.2, half * 0.4, height * 0.13);
  const eyeY = Math.min(Math.max(height * 0.74, 0.85), height - eyeRadius * 1.4);
  const eyeOffset = Math.max(eyeRadius * 1.1, Math.min(half - eyeRadius * 1.05, half * 0.6));
  const smileRadius = Math.min(0.16, half * 0.5);
  const smileY = Math.max(eyeY - eyeRadius * 2.4, height * 0.36);
  const cheekRadius = Math.min(0.1, half * 0.18);
  const cheekOffset = Math.min(half - cheekRadius, eyeOffset + cheekRadius * 1.2);
  const armX = Math.max(half + 0.18, 0.36);
  const armY = Math.min(height * 0.55, height - 0.4);
  const footOffset = Math.max(0.18, Math.min(half * 0.4, 0.32));
  // Right-side canonical transforms; mirror to get the matching left side.
  const eyeR: Transform = { pos: { x: eyeOffset, y: eyeY, z: depthFront + eyeRadius * 0.4 }, rot: { ...ZERO_ROT } };
  const pupilR: Transform = { pos: { x: 0, y: 0, z: eyeRadius * 0.5 }, rot: { ...ZERO_ROT } };
  const shineR: Transform = { pos: { x: -eyeRadius * 0.25, y: eyeRadius * 0.3, z: eyeRadius * 0.7 }, rot: { ...ZERO_ROT } };
  const cheekR: Transform = { pos: { x: cheekOffset, y: smileY + cheekRadius * 0.4, z: depthFront }, rot: { ...ZERO_ROT } };
  const armR: Transform = { pos: { x: armX, y: armY, z: 0 }, rot: { ...ARM_REST_ROT } };
  const footR: Transform = { pos: { x: footOffset, y: 0.05, z: 0.2 }, rot: { ...ZERO_ROT } };
  // Pupil/shine live in eye-local space, so their R is asymmetric in X
  // (shine sits on one side of the eye for a "highlight" look). Mirror in
  // X to make the left-eye highlight sit on the corresponding side.
  return {
    eye: pairFromR(eyeR),
    pupil: pairFromR(pupilR),
    shine: pairFromR(shineR),
    smile: { pos: { x: 0, y: smileY, z: depthFront + 0.03 }, rot: { ...SMILE_REST_ROT } },
    mouthShape: "smile",
    cheek: pairFromR(cheekR),
    arm: pairFromR(armR),
    foot: pairFromR(footR),
    eyeRadius,
    pupilRadius: eyeRadius * 0.55,
    shineRadius: eyeRadius * 0.18,
    smileRadius,
    cheekRadius,
    footRadius: 0.16,
    wave: { ...DEFAULT_WAVE },
    hidden: {},
  };
}

// Migrate any older saved override into the current EditableParts shape.
// Two prior shapes existed:
//   v0: each part was a bare Vec3 (no rotation)
//   v1: each part was a Transform { pos, rot }
// Today (v2) symmetric parts are Pair { R, L } and we have mouthShape.
function migrate(p: unknown): EditableParts | null {
  if (!p || typeof p !== "object") return null;
  const o = p as Record<string, unknown>;
  const asTransform = (t: unknown, restRot: Vec3 = ZERO_ROT): Transform => {
    if (t && typeof t === "object" && "pos" in (t as Record<string, unknown>)) return t as Transform;
    if (t && typeof t === "object" && "x" in (t as Record<string, unknown>)) {
      return { pos: t as Vec3, rot: { ...restRot } };
    }
    return { pos: { x: 0, y: 0, z: 0 }, rot: { ...restRot } };
  };
  const asPair = (raw: unknown, restRot: Vec3 = ZERO_ROT): Pair => {
    // Already a Pair (current shape)
    if (raw && typeof raw === "object" && "R" in (raw as Record<string, unknown>) && "L" in (raw as Record<string, unknown>)) {
      const r = raw as { R: unknown; L: unknown };
      return { R: asTransform(r.R, restRot), L: asTransform(r.L, restRot) };
    }
    // Older single-side Transform → mirror to fill in left.
    const R = asTransform(raw, restRot);
    return { R, L: mirrorT(R) };
  };
  return {
    eye: asPair(o.eye),
    pupil: asPair(o.pupil),
    shine: asPair(o.shine),
    smile: asTransform(o.smile, SMILE_REST_ROT),
    mouthShape: typeof o.mouthShape === "string" ? (o.mouthShape as MouthShape) : "smile",
    cheek: asPair(o.cheek),
    arm: asPair(o.arm, ARM_REST_ROT),
    foot: asPair(o.foot),
    eyeRadius: typeof o.eyeRadius === "number" ? o.eyeRadius : 0.2,
    pupilRadius: typeof o.pupilRadius === "number" ? o.pupilRadius : 0.11,
    shineRadius: typeof o.shineRadius === "number" ? o.shineRadius : 0.04,
    smileRadius: typeof o.smileRadius === "number" ? o.smileRadius : 0.16,
    cheekRadius: typeof o.cheekRadius === "number" ? o.cheekRadius : 0.1,
    footRadius: typeof o.footRadius === "number" ? o.footRadius : 0.16,
    wave: migrateWave(o.wave),
    hidden: o.hidden && typeof o.hidden === "object" ? (o.hidden as Record<string, boolean>) : {},
  };
}

function migrateWave(raw: unknown): WaveConfig {
  if (raw && typeof raw === "object") {
    const w = raw as Record<string, unknown>;
    const pattern = (typeof w.pattern === "string" ? w.pattern : DEFAULT_WAVE.pattern) as WavePattern;
    return {
      pattern,
      amplitude: typeof w.amplitude === "number" ? w.amplitude : DEFAULT_WAVE.amplitude,
      frequency: typeof w.frequency === "number" ? w.frequency : DEFAULT_WAVE.frequency,
      offset: typeof w.offset === "number" ? w.offset : DEFAULT_WAVE.offset,
    };
  }
  return { ...DEFAULT_WAVE };
}

function loadOverrides(): Record<string, EditableParts> {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    let isLegacy = false;
    if (!raw) {
      raw = localStorage.getItem(STORAGE_KEY_V1);
      isLegacy = !!raw;
    }
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const migrated: Record<string, EditableParts> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const m = migrate(v);
      if (m) migrated[k] = m;
    }
    if (isLegacy) {
      // Promote the migrated content to the v2 storage location.
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    }
    return migrated;
  } catch {
    return {};
  }
}

function saveOverrides(o: Record<string, EditableParts>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(o));
  } catch {
    // localStorage may be disabled — non-fatal.
  }
}

// Build a letter in the editor. Returns the geometry size and a function
// that rebuilds part meshes whenever parts change. We rebuild the meshes
// every render rather than tracking individual updates — at this scale
// (a few dozen meshes) it's plenty fast.
type BuiltLetter = {
  // Outer group (positioned/rotated for the celebration jump+spin)
  root: THREE.Group;
  // Inner group (carries scale pulse — children are the meshes)
  inner: THREE.Group;
  // Selectable handles per part-and-side for the gizmo. Keys look like
  // "eye:R", "eye:L", "smile" (single).
  partGroups: Record<string, THREE.Object3D>;
  // Arm pivots (so the celebration animation can wave them)
  armPivotR: THREE.Group;
  armPivotL: THREE.Group;
  baseY: number;
  size: { width: number; height: number };
  dispose: () => void;
};

function buildEditableLetter(
  font: Font,
  letter: string,
  parts: EditableParts
): BuiltLetter {
  const root = new THREE.Group();
  const inner = new THREE.Group();
  root.add(inner);
  const display = letter;
  const color = colorFor(letter);
  const letterMat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, emissive: color.clone().multiplyScalar(0.08) });
  const geo = new TextGeometry(display, {
    font,
    size: 1.6,
    depth: 0.55,
    curveSegments: 6,
    bevelEnabled: true,
    bevelThickness: 0.07,
    bevelSize: 0.05,
    bevelSegments: 3,
  });
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const cx = (bb.min.x + bb.max.x) / 2;
  geo.translate(-cx, -bb.min.y, 0);
  geo.computeBoundingBox();
  const size = new THREE.Vector3();
  geo.boundingBox!.getSize(size);

  const letterMesh = new THREE.Mesh(geo, letterMat);
  letterMesh.castShadow = true;
  letterMesh.receiveShadow = true;
  inner.add(letterMesh);

  const partGroups: Record<string, THREE.Object3D> = {};
  const setRot = (obj: THREE.Object3D, r: Vec3) => obj.rotation.set(r.x, r.y, r.z);
  const isHidden = (key: string) => !!parts.hidden?.[key];

  // Eyes — render BOTH sides explicitly from the per-side transforms.
  // Hidden parts are skipped entirely, including their children
  // (pupil/shine), since those are positioned in eye-local space and
  // would float around without their parent.
  const makeEye = (eyeT: Transform, pupilT: Transform, shineT: Transform, sideKey: "R" | "L") => {
    const eyeGroup = new THREE.Group();
    eyeGroup.position.set(eyeT.pos.x, eyeT.pos.y, eyeT.pos.z);
    setRot(eyeGroup, eyeT.rot);
    const sclera = new THREE.Mesh(
      new THREE.SphereGeometry(parts.eyeRadius, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 })
    );
    eyeGroup.add(sclera);
    if (!isHidden(`pupil:${sideKey}`)) {
      const pupil = new THREE.Mesh(
        new THREE.SphereGeometry(parts.pupilRadius, 12, 10),
        new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 })
      );
      pupil.position.set(pupilT.pos.x, pupilT.pos.y, pupilT.pos.z);
      setRot(pupil, pupilT.rot);
      eyeGroup.add(pupil);
      partGroups[`pupil:${sideKey}`] = pupil;
    }
    if (!isHidden(`shine:${sideKey}`)) {
      const shine = new THREE.Mesh(
        new THREE.SphereGeometry(parts.shineRadius, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      );
      shine.position.set(shineT.pos.x, shineT.pos.y, shineT.pos.z);
      setRot(shine, shineT.rot);
      eyeGroup.add(shine);
      partGroups[`shine:${sideKey}`] = shine;
    }
    return eyeGroup;
  };
  if (!isHidden("eye:R")) {
    const eyeR = makeEye(parts.eye.R, parts.pupil.R, parts.shine.R, "R");
    inner.add(eyeR);
    partGroups["eye:R"] = eyeR;
  }
  if (!isHidden("eye:L")) {
    const eyeL = makeEye(parts.eye.L, parts.pupil.L, parts.shine.L, "L");
    inner.add(eyeL);
    partGroups["eye:L"] = eyeL;
  }

  // Mouth
  if (!isHidden("smile")) {
    const mouthMat = new THREE.MeshStandardMaterial({ color: 0x6b1d10 });
    const mouthGroup = makeMouth(parts.mouthShape, parts.smileRadius, mouthMat);
    mouthGroup.position.set(parts.smile.pos.x, parts.smile.pos.y, parts.smile.pos.z);
    setRot(mouthGroup, parts.smile.rot);
    inner.add(mouthGroup);
    partGroups.smile = mouthGroup;
  }

  // Cheeks
  const cheekMat = new THREE.MeshStandardMaterial({ color: 0xff8aaa, transparent: true, opacity: 0.75 });
  const cheekGeo = new THREE.SphereGeometry(parts.cheekRadius, 10, 8);
  if (!isHidden("cheek:R")) {
    const cheekR = new THREE.Mesh(cheekGeo, cheekMat);
    cheekR.position.set(parts.cheek.R.pos.x, parts.cheek.R.pos.y, parts.cheek.R.pos.z);
    setRot(cheekR, parts.cheek.R.rot);
    cheekR.scale.set(1, 0.7, 0.4);
    inner.add(cheekR);
    partGroups["cheek:R"] = cheekR;
  }
  if (!isHidden("cheek:L")) {
    const cheekL = new THREE.Mesh(cheekGeo, cheekMat);
    cheekL.position.set(parts.cheek.L.pos.x, parts.cheek.L.pos.y, parts.cheek.L.pos.z);
    setRot(cheekL, parts.cheek.L.rot);
    cheekL.scale.set(1, 0.7, 0.4);
    inner.add(cheekL);
    partGroups["cheek:L"] = cheekL;
  }

  // Arms — pivots are still created (the wave loop expects them) but not
  // added to the scene when hidden, so the user sees nothing where the
  // arm would be while the animation code can still safely write to
  // armPivotR/L without a null check.
  const limbMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
  const armGeo = new THREE.CapsuleGeometry(0.1, 0.45, 4, 8);
  const armPivotR = new THREE.Group();
  armPivotR.position.set(parts.arm.R.pos.x, parts.arm.R.pos.y, parts.arm.R.pos.z);
  setRot(armPivotR, parts.arm.R.rot);
  const armR = new THREE.Mesh(armGeo, limbMat);
  armR.position.set(0.25, -0.05, 0);
  armR.rotation.z = Math.PI / 4;
  armPivotR.add(armR);
  if (!isHidden("arm:R")) {
    inner.add(armPivotR);
    partGroups["arm:R"] = armPivotR;
  }
  const armPivotL = new THREE.Group();
  armPivotL.position.set(parts.arm.L.pos.x, parts.arm.L.pos.y, parts.arm.L.pos.z);
  setRot(armPivotL, parts.arm.L.rot);
  const armL = new THREE.Mesh(armGeo, limbMat);
  armL.position.set(-0.25, -0.05, 0);
  armL.rotation.z = -Math.PI / 4;
  armPivotL.add(armL);
  if (!isHidden("arm:L")) {
    inner.add(armPivotL);
    partGroups["arm:L"] = armPivotL;
  }

  // Feet
  const footMat = new THREE.MeshStandardMaterial({ color: 0x3a2a14, roughness: 0.7 });
  const footGeo = new THREE.SphereGeometry(parts.footRadius, 10, 8);
  if (!isHidden("foot:R")) {
    const footR = new THREE.Mesh(footGeo, footMat);
    footR.position.set(parts.foot.R.pos.x, parts.foot.R.pos.y, parts.foot.R.pos.z);
    setRot(footR, parts.foot.R.rot);
    footR.scale.set(1, 0.6, 1.2);
    inner.add(footR);
    partGroups["foot:R"] = footR;
  }
  if (!isHidden("foot:L")) {
    const footL = new THREE.Mesh(footGeo, footMat);
    footL.position.set(parts.foot.L.pos.x, parts.foot.L.pos.y, parts.foot.L.pos.z);
    setRot(footL, parts.foot.L.rot);
    footL.scale.set(1, 0.6, 1.2);
    inner.add(footL);
    partGroups["foot:L"] = footL;
  }

  const dispose = () => {
    root.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat) (mat as THREE.Material).dispose();
    });
  };

  return {
    root,
    inner,
    partGroups,
    armPivotR,
    armPivotL,
    baseY: 0,
    size: { width: size.x, height: size.y },
    dispose,
  };
}

type GizmoMode = "translate" | "rotate";

export function LetterEditor() {
  const goToMenu = useGameStore((s) => s.goToMenu);
  const [font, setFont] = useState<Font | null>(null);
  // letter holds the literal character to author — "A".."Z" or "a".."z".
  // Each case has its own storage entry so you can author the uppercase
  // and lowercase forms independently.
  const [letter, setLetter] = useState<string>("A");
  const lowercase = letter === letter.toLowerCase() && letter !== letter.toUpperCase();
  const [selectedPart, setSelectedPart] = useState<PartId>("eye");
  // Which side of a symmetric pair to edit. "both" mirrors edits across.
  const [side, setSide] = useState<Side>("both");
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>("translate");
  const [overrides, setOverrides] = useState<Record<string, EditableParts>>(() => {
    const raw = loadOverrides();
    // Migrate old position-only entries to the new {pos, rot} shape.
    const migrated: Record<string, EditableParts> = {};
    for (const [k, v] of Object.entries(raw)) {
      const m = migrate(v as EditableParts);
      if (m) migrated[k] = m;
    }
    return migrated;
  });
  const [parts, setParts] = useState<EditableParts | null>(null);
  // Celebration animation. When > 0, the render loop applies the celebrate
  // transform on top of the editable letter.
  const celebrationTRef = useRef<number>(-1);
  // Continuous arm-wave loop. When true, the tick advances `wavePhaseRef`
  // and sets the arm pivots' Z rotation each frame. Independent of the
  // full celebration so the user can isolate the wave for editing.
  const [isWaving, setIsWaving] = useState(false);
  const isWavingRef = useRef(false);
  const wavePhaseRef = useRef(0);
  // Wave shape parameters live on `parts.wave` — see EditableParts.wave —
  // because each letter has its own wave personality. The tick loop reads
  // partsRef.current?.wave directly, so no separate ref is needed.

  // Toast — small in-app confirmation banner. Auto-dismisses; far less
  // disruptive than the browser's window.alert which we used previously.
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const toastTimerRef = useRef<number>(0);
  const showToast = (kind: "ok" | "err", text: string) => {
    setToast({ kind, text });
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2400);
  };
  useEffect(() => () => window.clearTimeout(toastTimerRef.current), []);

  // Per-letter undo/redo history. Only the current letter has history at a
  // time — switching letters keeps each letter's history separate.
  const [history, setHistory] = useState<Record<string, { stack: EditableParts[]; index: number }>>({});

  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    orbit: OrbitControls;
    transform: TransformControls;
    raycaster: THREE.Raycaster;
    pointer: THREE.Vector2;
    built: BuiltLetter | null;
    dispose: () => void;
  } | null>(null);
  const partsRef = useRef<EditableParts | null>(null);
  const selectedPartRef = useRef<PartId>(selectedPart);
  const sideRef = useRef<Side>(side);
  const gizmoModeRef = useRef<GizmoMode>(gizmoMode);
  const onPartChangeRef = useRef<((p: EditableParts) => void) | null>(null);
  // Latest letter id (read inside long-lived listeners that captured an
  // older closure).
  const letterRef = useRef(letter);
  useEffect(() => { letterRef.current = letter; }, [letter]);
  // Pushes go through this ref so the (init-once) TransformControls listeners
  // always see the current implementation rather than a stale closure.
  const pushHistoryRef = useRef<((L: string, v: EditableParts) => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadFont().then((f) => {
      if (!cancelled) setFont(f);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // When letter changes, load saved override or compute defaults.
  useEffect(() => {
    if (!font) return;
    const existing = overrides[letter];
    if (existing) {
      setParts(existing);
    } else {
      // Build a temp letter to measure dimensions for defaults.
      const probe = buildEditableLetter(font, letter, defaultParts(1.4, 1.6));
      const def = defaultParts(probe.size.width, probe.size.height);
      probe.dispose();
      setParts(def);
    }
    // Seed the per-letter undo stack with the current state.
    setHistory((h) => {
      if (h[letter]) return h;
      const seed = overrides[letter] ?? null;
      if (!seed) return h;
      return { ...h, [letter]: { stack: [seed], index: 0 } };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [letter, font]);

  // Initialise three.js scene once.
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeaf6ff);

    const camera = new THREE.PerspectiveCamera(40, container.clientWidth / container.clientHeight, 0.1, 50);
    camera.position.set(2.5, 1.8, 5);
    camera.lookAt(0, 1, 0);

    scene.add(new THREE.HemisphereLight(0xfff7d6, 0xddddff, 0.7));
    const dir = new THREE.DirectionalLight(0xffffff, 1.1);
    dir.position.set(3, 5, 4);
    scene.add(dir);
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));

    // Floor grid for reference
    const grid = new THREE.GridHelper(8, 16, 0xa0c8e8, 0xc8dcec);
    scene.add(grid);
    // Axes for reference (small)
    const axes = new THREE.AxesHelper(0.6);
    axes.position.y = 0.001;
    scene.add(axes);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.set(0, 0.9, 0);
    orbit.minDistance = 1.5;
    orbit.maxDistance = 12;
    orbit.update();

    const transform = new TransformControls(camera, renderer.domElement);
    transform.setSize(0.7);
    scene.add(transform.getHelper());
    // While dragging the transform gizmo, freeze the camera orbit. When the
    // drag ENDS, push the new state to history as a single undoable step —
    // pushing on every objectChange used to fill the stack with hundreds of
    // micro-deltas, making "undo" appear to do nothing.
    transform.addEventListener("dragging-changed", (e) => {
      const dragging = (e as unknown as { value: boolean }).value;
      orbit.enabled = !dragging;
      if (!dragging && partsRef.current && pushHistoryRef.current) {
        pushHistoryRef.current(letterRef.current, partsRef.current);
      }
    });
    // When the gizmo moves or rotates the part, push values back into state.
    // We write to the side the user is editing; if mode is "both", we mirror
    // the change across to keep symmetry.
    transform.addEventListener("objectChange", () => {
      const obj = transform.object;
      if (!obj || !partsRef.current || !onPartChangeRef.current) return;
      const id = selectedPartRef.current;
      const s = sideRef.current;
      const next = applyEdit(partsRef.current, id, s, obj.position, obj.rotation);
      onPartChangeRef.current(next);
    });

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const onPointerDown = (event: PointerEvent) => {
      // Don't intercept clicks on the gizmo (TransformControls handles those).
      // We test by checking what the raycast hits. If it's a part, select it.
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      if (!sceneRef.current) return;
      const partGroups = sceneRef.current.built?.partGroups ?? {};
      // Each entry's key is "part:R" / "part:L" or just "part" (singletons).
      const candidates = Object.entries(partGroups).flatMap(([key, obj]) => {
        const items: { key: string; obj: THREE.Object3D }[] = [];
        obj.traverse((o) => items.push({ key, obj: o }));
        return items;
      });
      const meshes = candidates.map((c) => c.obj);
      const hits = raycaster.intersectObjects(meshes, false);
      if (hits.length === 0) return;
      const hitObj = hits[0].object;
      const hit = candidates.find((c) => c.obj === hitObj);
      if (hit) {
        const [partKey, sideKey] = hit.key.split(":") as [PartId, "R" | "L" | undefined];
        selectedPartRef.current = partKey;
        setSelectedPart(partKey);
        // Don't override "both" mode when the user clicks: they meant to
        // edit symmetrically. For R/L modes, snap to whichever side they
        // clicked so the gizmo lands on it.
        if (sideKey && sideRef.current !== "both") {
          sideRef.current = sideKey;
          setSide(sideKey);
        }
      }
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);

    let raf = 0;
    let lastT = performance.now();
    const tick = () => {
      const nowT = performance.now();
      const dt = Math.min((nowT - lastT) / 1000, 0.05);
      lastT = nowT;

      // Drive the optional "found" celebration animation. Mirrors the same
      // motion the LetterCharacter uses in-game so what you see here is
      // what the kid sees on pickup.
      const built = sceneRef.current?.built;
      if (built) {
        if (celebrationTRef.current >= 0) {
          // Full celebration always wins over the wave loop. The arms swing
          // using the letter's own wave parameters so the celebration
          // honours the personality the author tuned for this letter.
          celebrationTRef.current += dt;
          const c = celebrationTRef.current;
          const k = Math.min(c / 1.6, 1);
          const jump = Math.sin(k * Math.PI) * 1.4;
          built.root.position.y = built.baseY + jump;
          built.inner.rotation.y = k * Math.PI * 2;
          const cfg = partsRef.current?.wave ?? DEFAULT_WAVE;
          const phase = c * cfg.frequency * Math.PI * 2;
          const v = wavePatternValue(cfg.pattern, phase);
          built.armPivotR.rotation.z = v * cfg.amplitude + cfg.offset;
          if (built.armPivotL) built.armPivotL.rotation.z = -(v * cfg.amplitude) - cfg.offset;
          const s = 1 + 0.15 * Math.sin(k * Math.PI * 2);
          built.inner.scale.setScalar(s);
          if (k >= 1) {
            // End of celebration — restore the authored rest pose so any
            // arm rotation the user set on the gizmo isn't wiped.
            celebrationTRef.current = -1;
            built.root.position.y = built.baseY;
            built.inner.rotation.y = 0;
            built.inner.scale.setScalar(1);
            const armR = partsRef.current?.arm.R.rot;
            const armL = partsRef.current?.arm.L.rot;
            if (armR) built.armPivotR.rotation.set(armR.x, armR.y, armR.z);
            if (armL && built.armPivotL) built.armPivotL.rotation.set(armL.x, armL.y, armL.z);
          }
        } else if (isWavingRef.current) {
          // Continuous wave with the *current letter's* shape parameters.
          // partsRef is updated whenever the letter or its parts change.
          const cfg = partsRef.current?.wave ?? DEFAULT_WAVE;
          wavePhaseRef.current += dt;
          // Phase units: radians. frequency Hz × 2π × dt would be the
          // delta, but we accumulate in seconds and multiply on read so
          // changing the frequency mid-wave doesn't cause a phase jump.
          const phase = wavePhaseRef.current * cfg.frequency * Math.PI * 2;
          const v = wavePatternValue(cfg.pattern, phase);
          built.root.position.y = built.baseY;
          built.inner.rotation.y = 0;
          built.inner.scale.setScalar(1);
          built.armPivotR.rotation.z = v * cfg.amplitude + cfg.offset;
          if (built.armPivotL) built.armPivotL.rotation.z = -(v * cfg.amplitude) - cfg.offset;
        } else {
          // Hold rest pose. Restore the *authored* arm rotations (whatever
          // the user set via the gizmo / number inputs) instead of forcing
          // them to zero — otherwise stopping a wave erases the user's
          // tweaks. The same logic runs at celebration end below.
          built.root.position.y = built.baseY;
          built.inner.rotation.y = 0;
          built.inner.scale.setScalar(1);
          const armR = partsRef.current?.arm.R.rot;
          const armL = partsRef.current?.arm.L.rot;
          if (armR) built.armPivotR.rotation.set(armR.x, armR.y, armR.z);
          if (armL && built.armPivotL) built.armPivotL.rotation.set(armL.x, armL.y, armL.z);
        }
      }

      orbit.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const obs = new ResizeObserver(onResize);
    obs.observe(container);

    sceneRef.current = {
      renderer,
      scene,
      camera,
      orbit,
      transform,
      raycaster,
      pointer,
      built: null,
      dispose: () => {
        cancelAnimationFrame(raf);
        renderer.domElement.removeEventListener("pointerdown", onPointerDown);
        obs.disconnect();
        orbit.dispose();
        transform.dispose();
        renderer.dispose();
        if (renderer.domElement.parentElement) {
          renderer.domElement.parentElement.removeChild(renderer.domElement);
        }
      },
    };

    return () => {
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, []);

  // Rebuild the letter mesh whenever parts/letter change.
  useEffect(() => {
    if (!font || !parts || !sceneRef.current) return;
    const sr = sceneRef.current;
    if (sr.built) {
      sr.scene.remove(sr.built.root);
      sr.built.dispose();
    }
    const built = buildEditableLetter(font, letter, parts);
    sr.scene.add(built.root);
    sr.built = built;
    celebrationTRef.current = -1;
    const target = lookupPartGroup(built.partGroups, selectedPartRef.current, sideRef.current);
    if (target) sr.transform.attach(target);
    else sr.transform.detach();
  }, [font, parts, letter]);

  // Re-attach transform when the user switches selected part or side.
  useEffect(() => {
    selectedPartRef.current = selectedPart;
    sideRef.current = side;
    const sr = sceneRef.current;
    if (!sr) return;
    const target = lookupPartGroup(sr.built?.partGroups ?? {}, selectedPart, side);
    if (target) sr.transform.attach(target);
  }, [selectedPart, side]);

  useEffect(() => {
    gizmoModeRef.current = gizmoMode;
    sceneRef.current?.transform.setMode(gizmoMode);
  }, [gizmoMode]);

  // Push parts into refs so the transform handler always sees the latest.
  // Drag-time updates DO NOT push to history — only the drag-end event
  // (handled in the TransformControls listener) does. This keeps each drag
  // as a single undoable step.
  useEffect(() => {
    partsRef.current = parts;
    onPartChangeRef.current = (next) => {
      setParts(next);
      setOverrides((prev) => {
        const merged = { ...prev, [letter]: next };
        saveOverrides(merged);
        return merged;
      });
    };
  }, [parts, letter]);

  const pushHistory = (L: string, value: EditableParts) => {
    setHistory((h) => {
      const cur = h[L] ?? { stack: [], index: -1 };
      // Drop any redo entries — a new edit forks the timeline.
      const trimmed = cur.stack.slice(0, cur.index + 1);
      // Coalesce: don't push an entry identical to the current one.
      const last = trimmed[trimmed.length - 1];
      if (last && JSON.stringify(last) === JSON.stringify(value)) return h;
      const stack = [...trimmed, value];
      // Cap depth so history can't grow unbounded.
      const MAX = 80;
      const overflow = Math.max(0, stack.length - MAX);
      return {
        ...h,
        [L]: { stack: stack.slice(overflow), index: stack.length - 1 - overflow },
      };
    });
  };
  // Expose latest pushHistory through a ref so the init-once TransformControls
  // listener can call the current implementation.
  useEffect(() => {
    pushHistoryRef.current = pushHistory;
  });

  // Seed history when a letter is first loaded so the procedural defaults
  // are themselves an undoable step. Without this, the first edit would
  // produce a 1-entry stack and undo would be impossible.
  useEffect(() => {
    if (!parts) return;
    setHistory((h) => {
      if (h[letter]) return h;
      return { ...h, [letter]: { stack: [parts], index: 0 } };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts, letter]);

  const undo = () => {
    setHistory((h) => {
      const cur = h[letter];
      if (!cur || cur.index <= 0) return h;
      const next = { stack: cur.stack, index: cur.index - 1 };
      const value = cur.stack[next.index];
      setParts(value);
      setOverrides((prev) => {
        const merged = { ...prev, [letter]: value };
        saveOverrides(merged);
        return merged;
      });
      return { ...h, [letter]: next };
    });
  };

  const redo = () => {
    setHistory((h) => {
      const cur = h[letter];
      if (!cur || cur.index >= cur.stack.length - 1) return h;
      const next = { stack: cur.stack, index: cur.index + 1 };
      const value = cur.stack[next.index];
      setParts(value);
      setOverrides((prev) => {
        const merged = { ...prev, [letter]: value };
        saveOverrides(merged);
        return merged;
      });
      return { ...h, [letter]: next };
    });
  };

  const canUndo = (history[letter]?.index ?? 0) > 0;
  const canRedo = (history[letter]?.index ?? 0) < ((history[letter]?.stack.length ?? 0) - 1);

  // Keyboard shortcuts: Cmd/Ctrl+Z = undo, Shift+Cmd/Ctrl+Z (or Cmd/Ctrl+Y) = redo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cmd = e.metaKey || e.ctrlKey;
      if (!cmd) return;
      if (e.key === "z" || e.key === "Z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (e.key === "y" || e.key === "Y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [letter]);

  const writeTransform = (mutate: (t: Transform) => Transform) => {
    if (!parts) return;
    const id = selectedPart;
    const s = side;
    const cur = getTransform(parts, id, s);
    const newT = mutate(cur);
    let next: EditableParts;
    if (id === "smile") {
      next = { ...parts, smile: newT };
    } else if (s === "L") {
      next = { ...parts, [id]: { R: parts[id].R, L: newT } };
    } else if (s === "R") {
      next = { ...parts, [id]: { R: newT, L: parts[id].L } };
    } else {
      // both — keep symmetry by writing R explicitly and mirroring to L.
      next = { ...parts, [id]: { R: newT, L: mirrorT(newT) } };
    }
    setParts(next);
    setOverrides((prev) => {
      const merged = { ...prev, [letter]: next };
      saveOverrides(merged);
      return merged;
    });
    pushHistory(letter, next);
  };

  const onPosInput = (axis: "x" | "y" | "z", value: number) => {
    writeTransform((t) => ({ ...t, pos: { ...t.pos, [axis]: value } }));
  };
  const onRotInput = (axis: "x" | "y" | "z", value: number) => {
    writeTransform((t) => ({ ...t, rot: { ...t.rot, [axis]: value } }));
  };

  const updateWave = (patch: Partial<WaveConfig>) => {
    if (!parts) return;
    const next = { ...parts, wave: { ...parts.wave, ...patch } };
    setParts(next);
    setOverrides((prev) => {
      const merged = { ...prev, [letter]: next };
      saveOverrides(merged);
      return merged;
    });
    pushHistory(letter, next);
  };

  // Bulk helper: apply the current letter's wave config to every other
  // letter that has an override (and creates overrides for the others
  // by inheriting their procedural defaults). Saves a lot of clicking
  // when the user has dialled in a wave they like.
  const copyWaveToAllLetters = (wave: WaveConfig) => {
    if (!font) return;
    showToast("ok", "✓ Wave applied to all 52 letters (upper + lower)");
    setOverrides((prev) => {
      const merged: Record<string, EditableParts> = { ...prev };
      // Apply to BOTH cases so authors don't have to flip the toggle and
      // re-click. Uppercase and lowercase have independent overrides but
      // typically share wave personality.
      for (const L of ALPHABET) {
        for (const ch of [L, L.toLowerCase()]) {
          const existing = merged[ch];
          if (existing) {
            merged[ch] = { ...existing, wave: { ...wave } };
          } else {
            const probe = buildEditableLetter(font, ch, defaultParts(1.4, 1.6));
            const def = defaultParts(probe.size.width, probe.size.height);
            probe.dispose();
            merged[ch] = { ...def, wave: { ...wave } };
          }
        }
      }
      saveOverrides(merged);
      const currentNext = merged[letter];
      if (currentNext) {
        setParts(currentNext);
        pushHistory(letter, currentNext);
      }
      return merged;
    });
  };

  // Toggle visibility of a part (or a side of a part). The change is
  // tracked in parts.hidden, so undo/redo and persistence already work.
  const togglePartHidden = () => {
    if (!parts) return;
    const id = selectedPart;
    const keys: string[] = id === "smile"
      ? ["smile"]
      : side === "both"
        ? [`${id}:R`, `${id}:L`]
        : [`${id}:${side}`];
    const wasHidden = keys.every((k) => parts.hidden?.[k]);
    const next: EditableParts = {
      ...parts,
      hidden: { ...parts.hidden },
    };
    for (const k of keys) {
      if (wasHidden) delete next.hidden[k];
      else next.hidden[k] = true;
    }
    setParts(next);
    setOverrides((prev) => {
      const merged = { ...prev, [letter]: next };
      saveOverrides(merged);
      return merged;
    });
    pushHistory(letter, next);
    showToast("ok", wasHidden ? `✓ Restored ${keys.join(", ")}` : `🗑 Hidden ${keys.join(", ")}`);
  };

  const onMouthShapeChange = (shape: MouthShape) => {
    if (!parts) return;
    const next = { ...parts, mouthShape: shape };
    setParts(next);
    setOverrides((prev) => {
      const merged = { ...prev, [letter]: next };
      saveOverrides(merged);
      return merged;
    });
    pushHistory(letter, next);
  };

  const onMirrorRtoL = () => {
    if (!parts || selectedPart === "smile") return;
    const pair = parts[selectedPart];
    const next = { ...parts, [selectedPart]: { R: pair.R, L: mirrorT(pair.R) } };
    setParts(next);
    setOverrides((prev) => {
      const merged = { ...prev, [letter]: next };
      saveOverrides(merged);
      return merged;
    });
    pushHistory(letter, next);
  };
  const onMirrorLtoR = () => {
    if (!parts || selectedPart === "smile") return;
    const pair = parts[selectedPart];
    const next = { ...parts, [selectedPart]: { R: mirrorT(pair.L), L: pair.L } };
    setParts(next);
    setOverrides((prev) => {
      const merged = { ...prev, [letter]: next };
      saveOverrides(merged);
      return merged;
    });
    pushHistory(letter, next);
  };

  const onResetLetter = () => {
    if (!font) return;
    const probe = buildEditableLetter(font, letter, defaultParts(1.4, 1.6));
    const def = defaultParts(probe.size.width, probe.size.height);
    probe.dispose();
    setParts(def);
    setOverrides((prev) => {
      const merged = { ...prev };
      delete merged[letter];
      saveOverrides(merged);
      return merged;
    });
    pushHistory(letter, def);
  };

  // Camera snap presets — orthogonal-style framings centred on the letter.
  const snapCamera = (preset: "front" | "back" | "left" | "right" | "top" | "perspective") => {
    const sr = sceneRef.current;
    if (!sr) return;
    const dist = 5;
    const center = new THREE.Vector3(0, 0.9, 0);
    let pos: THREE.Vector3;
    switch (preset) {
      case "front":       pos = new THREE.Vector3(0, 0.9, dist); break;
      case "back":        pos = new THREE.Vector3(0, 0.9, -dist); break;
      case "left":        pos = new THREE.Vector3(-dist, 0.9, 0); break;
      case "right":       pos = new THREE.Vector3(dist, 0.9, 0); break;
      case "top":         pos = new THREE.Vector3(0, dist, 0.001); break;
      case "perspective": pos = new THREE.Vector3(2.5, 1.8, 5); break;
    }
    sr.camera.position.copy(pos);
    sr.orbit.target.copy(center);
    sr.camera.lookAt(center);
    sr.orbit.update();
  };

  const triggerFound = () => {
    celebrationTRef.current = 0;
    // Cancel the standalone wave loop so the celebration's own arm pass
    // is the only thing animating the arms.
    isWavingRef.current = false;
    setIsWaving(false);
    void import("../audio/sfx").then(({ playChime }) => playChime());
  };

  const toggleWave = () => {
    const next = !isWavingRef.current;
    isWavingRef.current = next;
    setIsWaving(next);
    if (next) {
      // Reset the phase so a fresh start always begins at zero arm rotation
      // (avoids a jolt when un-pausing from a random angle).
      wavePhaseRef.current = 0;
      // If a celebration was running we let the wave take over.
      celebrationTRef.current = -1;
    }
  };

  // Copy a JSON blob to the clipboard. Shared between "export this letter"
  // and "export all" so the success / failure toast text stays consistent.
  const copyJson = async (json: string, label: string) => {
    try {
      await navigator.clipboard.writeText(json);
      const sizeKb = (json.length / 1024).toFixed(1);
      showToast("ok", `✓ Copied ${label} (${sizeKb} KB) to clipboard`);
    } catch {
      // eslint-disable-next-line no-console
      console.log(`Editor overrides (${label}):\n` + json);
      showToast("err", "⚠ Clipboard blocked — check the browser console for the JSON");
    }
  };

  const onExportAll = async () => {
    const json = JSON.stringify(overrides, null, 2);
    const count = Object.keys(overrides).length;
    if (count === 0) {
      showToast("err", "No edited letters to export");
      return;
    }
    await copyJson(json, `${count} letter${count === 1 ? "" : "s"}`);
  };

  const onExportCurrent = async () => {
    if (!parts) return;
    // Wrap as the same shape "export all" produces ({ "A": {...} }) so the
    // user can paste it straight into the larger overrides JSON without
    // restructuring.
    const json = JSON.stringify({ [letter]: parts }, null, 2);
    await copyJson(json, `letter ${letter}`);
  };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "#eaf6ff",
        display: "grid",
        gridTemplateColumns: "1fr 320px",
        gridTemplateRows: "auto 1fr",
        gridTemplateAreas: `"top top" "viewport panel"`,
      }}
    >
      <header
        style={{
          gridArea: "top",
          padding: "12px 16px",
          background: "white",
          borderBottom: "2px solid #d8e6f0",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 22, color: "#3a2a14" }}>Letter Editor</h1>
        <select
          value={letter}
          onChange={(e) => setLetter(e.target.value)}
          style={{
            padding: "8px 10px",
            fontSize: 18,
            fontWeight: 800,
            border: "2px solid #d8e6f0",
            borderRadius: 10,
          }}
        >
          {ALPHABET.map((L) => {
            const ch = lowercase ? L.toLowerCase() : L;
            return (
              <option key={ch} value={ch}>{ch}{overrides[ch] ? " *" : ""}</option>
            );
          })}
        </select>
        <button
          type="button"
          onClick={() => setLetter((l) => (l === l.toLowerCase() && l !== l.toUpperCase() ? l.toUpperCase() : l.toLowerCase()))}
          title="Toggle uppercase / lowercase"
          style={tab(lowercase)}
        >
          {lowercase ? "abc" : "ABC"}
        </button>
        <div style={{ display: "flex", borderRadius: 10, overflow: "hidden", border: "2px solid #d8e6f0" }}>
          <button onClick={() => setGizmoMode("translate")} style={tab(gizmoMode === "translate")} title="Move (W)">↔ Move</button>
          <button onClick={() => setGizmoMode("rotate")} style={tab(gizmoMode === "rotate")} title="Rotate (E)">⟳ Rotate</button>
        </div>
        <div style={{ display: "flex", borderRadius: 10, overflow: "hidden", border: "2px solid #d8e6f0" }}>
          <button onClick={() => snapCamera("front")} style={tab(false)} title="Front view">Front</button>
          <button onClick={() => snapCamera("back")} style={tab(false)} title="Back view">Back</button>
          <button onClick={() => snapCamera("left")} style={tab(false)} title="Left view">Left</button>
          <button onClick={() => snapCamera("right")} style={tab(false)} title="Right view">Right</button>
          <button onClick={() => snapCamera("top")} style={tab(false)} title="Top view">Top</button>
          <button onClick={() => snapCamera("perspective")} style={tab(false)} title="Perspective view">3/4</button>
        </div>
        <span style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={undo} disabled={!canUndo} style={btn(canUndo ? "#a8e2ff" : "#e0e0e0", "#3a2a14")} title="Undo (⌘Z)">↶ Undo</button>
          <button onClick={redo} disabled={!canRedo} style={btn(canRedo ? "#a8e2ff" : "#e0e0e0", "#3a2a14")} title="Redo (⌘⇧Z)">↷ Redo</button>
        </div>
        <button onClick={triggerFound} style={btn("#9bdc4a", "white")}>🎉 Found!</button>
        <button onClick={toggleWave} style={btn(isWaving ? "#ff8c4a" : "#b886ff", "white")}>
          {isWaving ? "⏸ Pause wave" : "👋 Wave"}
        </button>
        <button onClick={onResetLetter} style={btn("#ffd56b", "#3a2a14")}>Reset {letter}</button>
        <button onClick={onExportCurrent} style={btn("#a8e2ff", "#3a2a14")} title={`Copy only letter ${letter}'s overrides`}>📋 Export {letter}</button>
        <button onClick={onExportAll} style={btn("#46c2cb", "white")} title={`Copy all ${Object.keys(overrides).length} edited letters`}>📋 Export all</button>
        <button onClick={() => goToMenu()} style={btn("#ff8c4a", "white")}>◀ Home</button>
      </header>

      <div
        ref={containerRef}
        style={{ gridArea: "viewport", position: "relative", overflow: "hidden" }}
      >
        <div
          style={{
            position: "absolute",
            bottom: 12,
            left: 12,
            background: "rgba(255,255,255,0.92)",
            padding: "8px 12px",
            borderRadius: 10,
            fontSize: 13,
            color: "#3a2a14",
            lineHeight: 1.5,
            pointerEvents: "none",
          }}
        >
          <strong>Camera:</strong> drag to orbit · right-drag to pan · wheel to zoom<br />
          <strong>Move part:</strong> click a part, then drag the coloured arrows
        </div>
      </div>

      <aside
        style={{
          gridArea: "panel",
          background: "white",
          borderLeft: "2px solid #d8e6f0",
          padding: 16,
          overflow: "auto",
          color: "#3a2a14",
        }}
      >
        <h3 style={{ margin: "0 0 6px 0" }}>Parts</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 16 }}>
          {PART_IDS.map((id) => (
            <button
              key={id}
              onClick={() => setSelectedPart(id)}
              style={{
                appearance: "none",
                border: selectedPart === id ? "3px solid #46c2cb" : "2px solid #d8e6f0",
                background: selectedPart === id ? "#e3f7f8" : "white",
                color: "#3a2a14",
                borderRadius: 10,
                padding: "8px 6px",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              {PART_LABELS[id]}{SYMMETRIC[id] ? " ⇄" : ""}
            </button>
          ))}
        </div>

        {parts && (
          <>
            {SYMMETRIC[selectedPart] && (
              <>
                <h3 style={{ margin: "0 0 6px 0" }}>Side</h3>
                <div style={{ display: "flex", borderRadius: 10, overflow: "hidden", border: "2px solid #d8e6f0", marginBottom: 8 }}>
                  <button onClick={() => setSide("R")} style={tab(side === "R")} title="Edit right side only">R</button>
                  <button onClick={() => setSide("L")} style={tab(side === "L")} title="Edit left side only">L</button>
                  <button onClick={() => setSide("both")} style={tab(side === "both")} title="Edit both sides — symmetric mirror">⇄ Both</button>
                </div>
                <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                  <button onClick={onMirrorRtoL} style={miniBtn} title="Copy right side onto left">R → L</button>
                  <button onClick={onMirrorLtoR} style={miniBtn} title="Copy left side onto right">L → R</button>
                </div>
              </>
            )}

            {(() => {
              const id = selectedPart;
              const keys: string[] = id === "smile"
                ? ["smile"]
                : side === "both"
                  ? [`${id}:R`, `${id}:L`]
                  : [`${id}:${side}`];
              const allHidden = keys.every((k) => parts.hidden?.[k]);
              const someHidden = keys.some((k) => parts.hidden?.[k]) && !allHidden;
              const label = allHidden
                ? "👁 Restore"
                : someHidden
                  ? "👁 Restore both sides"
                  : `🗑 Hide ${id === "smile" ? "mouth" : (side === "both" ? "both " + id + "s" : `${side} ${id}`)}`;
              return (
                <button
                  type="button"
                  onClick={togglePartHidden}
                  style={{
                    width: "100%",
                    appearance: "none",
                    border: "2px solid #d8e6f0",
                    background: allHidden ? "#fff7d6" : "white",
                    color: "#3a2a14",
                    borderRadius: 10,
                    padding: "8px 12px",
                    fontSize: 13,
                    fontWeight: 800,
                    cursor: "pointer",
                    marginBottom: 14,
                  }}
                >
                  {label}
                </button>
              );
            })()}

            {selectedPart === "smile" && (
              <>
                <h3 style={{ margin: "0 0 6px 0" }}>Mouth shape</h3>
                <select
                  value={parts.mouthShape}
                  onChange={(e) => onMouthShapeChange(e.target.value as MouthShape)}
                  style={{ width: "100%", padding: 6, fontSize: 13, fontWeight: 700, border: "1px solid #d8e6f0", borderRadius: 6, marginBottom: 14 }}
                >
                  {(Object.keys(MOUTH_LABEL) as MouthShape[]).map((s) => (
                    <option key={s} value={s}>{MOUTH_LABEL[s]}</option>
                  ))}
                </select>
              </>
            )}

            <h3 style={{ margin: "0 0 6px 0" }}>
              {PART_LABELS[selectedPart]} position
              {SYMMETRIC[selectedPart] && side !== "both" && (
                <span style={{ fontSize: 11, opacity: 0.6, marginLeft: 6, fontWeight: 500 }}>{side} only</span>
              )}
            </h3>
            <p style={{ marginTop: 0, fontSize: 11, opacity: 0.7 }}>
              {(selectedPart === "pupil" || selectedPart === "shine") && "Coordinates are relative to the eye. "}
              {SYMMETRIC[selectedPart] && side === "both" && "Editing both sides — changes mirror across X."}
            </p>
            {(() => {
              const t = getTransform(parts, selectedPart, side);
              return (
                <>
                  <NumberRow label="X" value={t.pos.x} onChange={(v) => onPosInput("x", v)} />
                  <NumberRow label="Y" value={t.pos.y} onChange={(v) => onPosInput("y", v)} />
                  <NumberRow label="Z" value={t.pos.z} onChange={(v) => onPosInput("z", v)} />

                  <h3 style={{ margin: "16px 0 6px 0" }}>{PART_LABELS[selectedPart]} rotation (°)</h3>
                  <NumberRow label="X" value={radToDeg(t.rot.x)} onChange={(v) => onRotInput("x", degToRad(v))} step={5} min={-360} max={360} />
                  <NumberRow label="Y" value={radToDeg(t.rot.y)} onChange={(v) => onRotInput("y", degToRad(v))} step={5} min={-360} max={360} />
                  <NumberRow label="Z" value={radToDeg(t.rot.z)} onChange={(v) => onRotInput("z", degToRad(v))} step={5} min={-360} max={360} />
                </>
              );
            })()}

            <h3 style={{ margin: "16px 0 6px 0" }}>Sizes</h3>
            <NumberRow label="Eye r" value={parts.eyeRadius} onChange={(v) => setParts((p) => p && persistAndReturn({ ...p, eyeRadius: v }, letter, setOverrides))} step={0.005} />
            <NumberRow label="Pupil r" value={parts.pupilRadius} onChange={(v) => setParts((p) => p && persistAndReturn({ ...p, pupilRadius: v }, letter, setOverrides))} step={0.005} />
            <NumberRow label="Shine r" value={parts.shineRadius} onChange={(v) => setParts((p) => p && persistAndReturn({ ...p, shineRadius: v }, letter, setOverrides))} step={0.005} />
            <NumberRow label="Smile r" value={parts.smileRadius} onChange={(v) => setParts((p) => p && persistAndReturn({ ...p, smileRadius: v }, letter, setOverrides))} step={0.005} />
            <NumberRow label="Cheek r" value={parts.cheekRadius} onChange={(v) => setParts((p) => p && persistAndReturn({ ...p, cheekRadius: v }, letter, setOverrides))} step={0.005} />
            <NumberRow label="Foot r" value={parts.footRadius} onChange={(v) => setParts((p) => p && persistAndReturn({ ...p, footRadius: v }, letter, setOverrides))} step={0.005} />
          </>
        )}

        {parts && (
          <>
            <h3 style={{ margin: "20px 0 6px 0", display: "flex", alignItems: "center", gap: 8 }}>
              Wave animation
              <span style={{ fontSize: 11, opacity: 0.6, fontWeight: 500 }}>
                for {letter} · {isWaving ? "playing" : "paused"}
              </span>
            </h3>
            <p style={{ marginTop: 0, fontSize: 11, opacity: 0.7 }}>
              Each letter has its own wave personality. Pattern, amplitude,
              frequency, and resting offset preview live and persist with this
              letter's overrides.
            </p>
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 700, display: "block", marginBottom: 4 }}>Pattern</label>
              <select
                value={parts.wave.pattern}
                onChange={(e) => updateWave({ pattern: e.target.value as WavePattern })}
                style={{
                  width: "100%",
                  padding: 6,
                  fontSize: 13,
                  fontWeight: 700,
                  border: "1px solid #d8e6f0",
                  borderRadius: 6,
                }}
              >
                {(Object.keys(WAVE_PATTERN_LABEL) as WavePattern[]).map((p) => (
                  <option key={p} value={p}>{WAVE_PATTERN_LABEL[p]}</option>
                ))}
              </select>
            </div>
            <NumberRow
              label="Amp °"
              value={radToDeg(parts.wave.amplitude)}
              onChange={(v) => updateWave({ amplitude: degToRad(v) })}
              step={1}
              min={0}
              max={180}
            />
            <NumberRow
              label="Freq Hz"
              value={parts.wave.frequency}
              onChange={(v) => updateWave({ frequency: v })}
              step={0.1}
              min={0.1}
              max={10}
            />
            <NumberRow
              label="Rest °"
              value={radToDeg(parts.wave.offset)}
              onChange={(v) => updateWave({ offset: degToRad(v) })}
              step={1}
              min={-90}
              max={90}
            />
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <button
                type="button"
                onClick={() => updateWave(DEFAULT_WAVE)}
                style={{ ...btn("#ffd56b", "#3a2a14"), flex: 1, boxShadow: "0 3px 0 rgba(0,0,0,0.12)" }}
              >
                Reset wave
              </button>
              <button
                type="button"
                onClick={() => copyWaveToAllLetters(parts.wave)}
                style={{ ...btn("#a8e2ff", "#3a2a14"), flex: 1, boxShadow: "0 3px 0 rgba(0,0,0,0.12)" }}
                title="Apply this letter's wave to every other letter"
              >
                Apply to all
              </button>
            </div>
          </>
        )}

        <p style={{ marginTop: 24, fontSize: 11, opacity: 0.6 }}>
          Edits save automatically per-letter to localStorage. "Export" copies the
          full overrides JSON to your clipboard so you can apply the changes
          to <code>src/engine/letters.ts</code>.
        </p>
      </aside>

      {toast && (
        <div
          role="status"
          style={{
            position: "absolute",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            background: toast.kind === "ok" ? "#3a2a14" : "#a13b1b",
            color: "white",
            padding: "12px 22px",
            borderRadius: 14,
            fontSize: 14,
            fontWeight: 800,
            boxShadow: "0 8px 24px rgba(0,0,0,0.25), 0 4px 0 rgba(0,0,0,0.15)",
            pointerEvents: "none",
            zIndex: 100,
            animation: "letra-toast-in 0.2s ease-out",
          }}
        >
          {toast.text}
        </div>
      )}
      <style>{`
        @keyframes letra-toast-in {
          from { transform: translate(-50%, 8px); opacity: 0; }
          to   { transform: translate(-50%, 0);   opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function persistAndReturn(p: EditableParts, letter: string, setOverrides: (fn: (prev: Record<string, EditableParts>) => Record<string, EditableParts>) => void) {
  setOverrides((prev) => {
    const merged = { ...prev, [letter]: p };
    saveOverrides(merged);
    return merged;
  });
  return p;
}

function NumberRow({
  label,
  value,
  onChange,
  step = 0.01,
  min = -3,
  max = 3,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "44px 1fr 64px", gap: 6, alignItems: "center", marginBottom: 6 }}>
      <label style={{ fontWeight: 700, fontSize: 13 }}>{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <input
        type="number"
        value={Number(value.toFixed(3))}
        step={step}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isNaN(v)) onChange(v);
        }}
        style={{ width: "100%", padding: 4, fontSize: 12, border: "1px solid #d8e6f0", borderRadius: 6 }}
      />
    </div>
  );
}

// The Three.js scene stores rotations as radians (Object3D.rotation.x/y/z),
// but degrees are friendlier to author with — and they round to whole numbers.
// We convert at the UI boundary only.
function radToDeg(r: number): number {
  return (r * 180) / Math.PI;
}
function degToRad(d: number): number {
  return (d * Math.PI) / 180;
}

const miniBtn: React.CSSProperties = {
  flex: 1,
  appearance: "none",
  border: "2px solid #d8e6f0",
  background: "white",
  color: "#3a2a14",
  borderRadius: 8,
  padding: "6px 4px",
  fontSize: 12,
  fontWeight: 800,
  cursor: "pointer",
};

function tab(active: boolean): React.CSSProperties {
  return {
    appearance: "none",
    border: "none",
    background: active ? "#3a2a14" : "white",
    color: active ? "white" : "#3a2a14",
    padding: "8px 12px",
    fontSize: 13,
    fontWeight: 800,
    cursor: "pointer",
  };
}

function btn(bg: string, fg: string): React.CSSProperties {
  return {
    appearance: "none",
    border: "3px solid white",
    background: bg,
    color: fg,
    borderRadius: 12,
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 800,
    cursor: "pointer",
    boxShadow: "0 4px 0 rgba(0,0,0,0.12)",
  };
}
