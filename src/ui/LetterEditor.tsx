import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Font, FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { ALPHABET } from "../audio/types";
import { colorFor, loadFont } from "../engine/letters";
import { useGameStore } from "../state/store";

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

type Vec3 = { x: number; y: number; z: number };
type Transform = { pos: Vec3; rot: Vec3 };
type EditableParts = {
  // Right side only — left is mirrored when `mirror` is true.
  eye: Transform;
  pupil: Transform; // pos relative to eye
  shine: Transform; // pos relative to eye
  smile: Transform;
  cheek: Transform;
  arm: Transform;
  foot: Transform;
  // Sizes (single value)
  eyeRadius: number;
  pupilRadius: number;
  shineRadius: number;
  smileRadius: number;
  cheekRadius: number;
  footRadius: number;
};

const ZERO_ROT: Vec3 = { x: 0, y: 0, z: 0 };
const ARM_REST_ROT: Vec3 = { x: 0, y: 0, z: 0 }; // pivot has no inherent rotation
const SMILE_REST_ROT: Vec3 = { x: Math.PI / 2, y: 0, z: 0 };

type PartId = keyof Omit<EditableParts, "eyeRadius" | "pupilRadius" | "shineRadius" | "smileRadius" | "cheekRadius" | "footRadius">;
const PART_IDS: PartId[] = ["eye", "pupil", "shine", "smile", "cheek", "arm", "foot"];
const PART_LABELS: Record<PartId, string> = {
  eye: "Eye (white)",
  pupil: "Pupil (offset from eye)",
  shine: "Shine (offset from eye)",
  smile: "Smile",
  cheek: "Cheek",
  arm: "Arm pivot",
  foot: "Foot",
};
const SYMMETRIC: Record<PartId, boolean> = {
  eye: true, pupil: true, shine: true, smile: false, cheek: true, arm: true, foot: true,
};

const STORAGE_KEY = "letra:editor:overrides:v1";

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
  return {
    eye: { pos: { x: eyeOffset, y: eyeY, z: depthFront + eyeRadius * 0.4 }, rot: { ...ZERO_ROT } },
    pupil: { pos: { x: 0, y: 0, z: eyeRadius * 0.5 }, rot: { ...ZERO_ROT } },
    shine: { pos: { x: -eyeRadius * 0.25, y: eyeRadius * 0.3, z: eyeRadius * 0.7 }, rot: { ...ZERO_ROT } },
    smile: { pos: { x: 0, y: smileY, z: depthFront + 0.03 }, rot: { ...SMILE_REST_ROT } },
    cheek: { pos: { x: cheekOffset, y: smileY + cheekRadius * 0.4, z: depthFront }, rot: { ...ZERO_ROT } },
    arm: { pos: { x: armX, y: armY, z: 0 }, rot: { ...ARM_REST_ROT } },
    foot: { pos: { x: footOffset, y: 0.05, z: 0.2 }, rot: { ...ZERO_ROT } },
    eyeRadius,
    pupilRadius: eyeRadius * 0.55,
    shineRadius: eyeRadius * 0.18,
    smileRadius,
    cheekRadius,
    footRadius: 0.16,
  };
}

// Migrate older saved overrides (positions only, no rotation) into the new
// Transform shape so users don't lose work after the schema change.
function migrate(p: EditableParts | null): EditableParts | null {
  if (!p) return p;
  const fix = (t: unknown, restRot: Vec3 = ZERO_ROT): Transform => {
    if (t && typeof t === "object" && "pos" in (t as Record<string, unknown>)) return t as Transform;
    if (t && typeof t === "object" && "x" in (t as Record<string, unknown>)) {
      return { pos: t as Vec3, rot: { ...restRot } };
    }
    return { pos: { x: 0, y: 0, z: 0 }, rot: { ...restRot } };
  };
  return {
    ...p,
    eye: fix(p.eye as unknown),
    pupil: fix(p.pupil as unknown),
    shine: fix(p.shine as unknown),
    smile: fix(p.smile as unknown, SMILE_REST_ROT),
    cheek: fix(p.cheek as unknown),
    arm: fix(p.arm as unknown, ARM_REST_ROT),
    foot: fix(p.foot as unknown),
  };
}

function loadOverrides(): Record<string, EditableParts> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
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
  // Selectable handles for the editor's transform gizmo
  partGroups: Record<string, THREE.Object3D>;
  // Arm pivots (so the celebration animation can wave them)
  armPivotR: THREE.Group;
  armPivotL: THREE.Group | null;
  baseY: number;
  size: { width: number; height: number };
  dispose: () => void;
};

function buildEditableLetter(
  font: Font,
  letter: string,
  parts: EditableParts,
  mirror: boolean
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

  // Eyes (right + mirrored left). Each eye is its own group containing
  // sclera + pupil + shine so they move together. Pupil/shine are children
  // of the eye, so their positions are local to it.
  const makeEye = (mirrorSide: boolean) => {
    const sign = mirrorSide ? -1 : 1;
    const eyeGroup = new THREE.Group();
    eyeGroup.position.set(sign * parts.eye.pos.x, parts.eye.pos.y, parts.eye.pos.z);
    setRot(eyeGroup, parts.eye.rot);
    const sclera = new THREE.Mesh(
      new THREE.SphereGeometry(parts.eyeRadius, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 })
    );
    eyeGroup.add(sclera);
    const pupil = new THREE.Mesh(
      new THREE.SphereGeometry(parts.pupilRadius, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 })
    );
    pupil.position.set(sign * parts.pupil.pos.x, parts.pupil.pos.y, parts.pupil.pos.z);
    setRot(pupil, parts.pupil.rot);
    eyeGroup.add(pupil);
    const shine = new THREE.Mesh(
      new THREE.SphereGeometry(parts.shineRadius, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    shine.position.set(sign * parts.shine.pos.x, parts.shine.pos.y, parts.shine.pos.z);
    setRot(shine, parts.shine.rot);
    eyeGroup.add(shine);
    return eyeGroup;
  };
  const eyeR = makeEye(false);
  inner.add(eyeR);
  partGroups.eye = eyeR;
  if (mirror) {
    const eyeL = makeEye(true);
    inner.add(eyeL);
  }

  // Smile
  const smile = new THREE.Mesh(
    new THREE.TorusGeometry(parts.smileRadius, Math.max(0.03, parts.smileRadius * 0.22), 8, 16, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0x6b1d10 })
  );
  smile.position.set(parts.smile.pos.x, parts.smile.pos.y, parts.smile.pos.z);
  setRot(smile, parts.smile.rot);
  inner.add(smile);
  partGroups.smile = smile;

  // Cheeks
  const cheekMat = new THREE.MeshStandardMaterial({ color: 0xff8aaa, transparent: true, opacity: 0.75 });
  const cheekR = new THREE.Mesh(new THREE.SphereGeometry(parts.cheekRadius, 10, 8), cheekMat);
  cheekR.position.set(parts.cheek.pos.x, parts.cheek.pos.y, parts.cheek.pos.z);
  setRot(cheekR, parts.cheek.rot);
  cheekR.scale.set(1, 0.7, 0.4);
  inner.add(cheekR);
  partGroups.cheek = cheekR;
  if (mirror) {
    const cheekL = cheekR.clone();
    cheekL.position.x *= -1;
    inner.add(cheekL);
  }

  // Arms
  const limbMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
  const armGeo = new THREE.CapsuleGeometry(0.1, 0.45, 4, 8);
  const armPivotR = new THREE.Group();
  armPivotR.position.set(parts.arm.pos.x, parts.arm.pos.y, parts.arm.pos.z);
  setRot(armPivotR, parts.arm.rot);
  const armR = new THREE.Mesh(armGeo, limbMat);
  armR.position.set(0.25, -0.05, 0);
  armR.rotation.z = Math.PI / 4;
  armPivotR.add(armR);
  inner.add(armPivotR);
  partGroups.arm = armPivotR;
  let armPivotL: THREE.Group | null = null;
  if (mirror) {
    armPivotL = new THREE.Group();
    armPivotL.position.set(-parts.arm.pos.x, parts.arm.pos.y, parts.arm.pos.z);
    setRot(armPivotL, parts.arm.rot);
    const armL = new THREE.Mesh(armGeo, limbMat);
    armL.position.set(-0.25, -0.05, 0);
    armL.rotation.z = -Math.PI / 4;
    armPivotL.add(armL);
    inner.add(armPivotL);
  }

  // Feet
  const footMat = new THREE.MeshStandardMaterial({ color: 0x3a2a14, roughness: 0.7 });
  const footR = new THREE.Mesh(new THREE.SphereGeometry(parts.footRadius, 10, 8), footMat);
  footR.position.set(parts.foot.pos.x, parts.foot.pos.y, parts.foot.pos.z);
  setRot(footR, parts.foot.rot);
  footR.scale.set(1, 0.6, 1.2);
  inner.add(footR);
  partGroups.foot = footR;
  if (mirror) {
    const footL = footR.clone();
    footL.position.x *= -1;
    inner.add(footL);
  }

  // pupil and shine are surfaced as the eye group's children — selecting them
  // means selecting their child within the eye.
  partGroups.pupil = (partGroups.eye.children[1] ?? partGroups.eye) as THREE.Object3D;
  partGroups.shine = (partGroups.eye.children[2] ?? partGroups.eye) as THREE.Object3D;

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
  const [letter, setLetter] = useState<string>("A");
  const [mirror, setMirror] = useState(true);
  const [selectedPart, setSelectedPart] = useState<PartId>("eye");
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
  const mirrorRef = useRef(mirror);
  const selectedPartRef = useRef<PartId>(selectedPart);
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
      const probe = buildEditableLetter(font, letter, defaultParts(1.4, 1.6), false);
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
    transform.addEventListener("objectChange", () => {
      const obj = transform.object;
      if (!obj || !partsRef.current || !onPartChangeRef.current) return;
      const id = selectedPartRef.current;
      const next = { ...partsRef.current };
      const cur = next[id];
      // For symmetric parts the right side stores positive X so mirrors
      // mirror correctly; pupil/shine are local to the eye so their X can
      // be negative or positive.
      const isLocal = id === "pupil" || id === "shine";
      const newPos: Vec3 = isLocal
        ? { x: obj.position.x, y: obj.position.y, z: obj.position.z }
        : { x: Math.abs(obj.position.x), y: obj.position.y, z: obj.position.z };
      const newRot: Vec3 = { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z };
      next[id] = { pos: newPos, rot: newRot };
      void cur;
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
      const candidates = Object.entries(partGroups).flatMap(([id, obj]) => {
        // Walk descendants and tag each with its part id for hit testing.
        const items: { id: PartId; obj: THREE.Object3D }[] = [];
        obj.traverse((o) => items.push({ id: id as PartId, obj: o }));
        return items;
      });
      const meshes = candidates.map((c) => c.obj);
      const hits = raycaster.intersectObjects(meshes, false);
      if (hits.length === 0) return;
      const hitObj = hits[0].object;
      const hit = candidates.find((c) => c.obj === hitObj);
      if (hit) {
        selectedPartRef.current = hit.id;
        setSelectedPart(hit.id);
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
          celebrationTRef.current += dt;
          const c = celebrationTRef.current;
          const k = Math.min(c / 1.6, 1);
          const jump = Math.sin(k * Math.PI) * 1.4;
          built.root.position.y = built.baseY + jump;
          built.inner.rotation.y = k * Math.PI * 2;
          built.armPivotR.rotation.z = Math.sin(c * 18) * 1.0 - 0.6;
          if (built.armPivotL) built.armPivotL.rotation.z = -Math.sin(c * 18) * 1.0 + 0.6;
          const s = 1 + 0.15 * Math.sin(k * Math.PI * 2);
          built.inner.scale.setScalar(s);
          if (k >= 1) {
            // End of celebration — restore.
            celebrationTRef.current = -1;
            built.root.position.y = built.baseY;
            built.inner.rotation.y = 0;
            built.inner.scale.setScalar(1);
            built.armPivotR.rotation.set(0, 0, 0);
            if (built.armPivotL) built.armPivotL.rotation.set(0, 0, 0);
          }
        } else {
          // Hold rest pose so the part the user is editing stays put.
          built.root.position.y = built.baseY;
          built.inner.rotation.y = 0;
          built.inner.scale.setScalar(1);
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

  // Rebuild the letter mesh whenever parts/letter/mirror change.
  useEffect(() => {
    if (!font || !parts || !sceneRef.current) return;
    const sr = sceneRef.current;
    if (sr.built) {
      sr.scene.remove(sr.built.root);
      sr.built.dispose();
    }
    const built = buildEditableLetter(font, letter, parts, mirror);
    sr.scene.add(built.root);
    sr.built = built;
    // Cancel any in-flight celebration when geometry rebuilds.
    celebrationTRef.current = -1;
    // Update the transform target if the selected part exists.
    const target = built.partGroups[selectedPartRef.current];
    if (target) sr.transform.attach(target);
    else sr.transform.detach();
  }, [font, parts, letter, mirror]);

  // Re-attach transform when the user switches selected part or mode.
  useEffect(() => {
    selectedPartRef.current = selectedPart;
    const sr = sceneRef.current;
    if (!sr) return;
    const target = sr.built?.partGroups[selectedPart];
    if (target) sr.transform.attach(target);
  }, [selectedPart]);

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

  useEffect(() => {
    mirrorRef.current = mirror;
  }, [mirror]);

  const onPosInput = (axis: "x" | "y" | "z", value: number) => {
    if (!parts) return;
    const id = selectedPart;
    const cur = parts[id];
    const next: EditableParts = { ...parts, [id]: { ...cur, pos: { ...cur.pos, [axis]: value } } };
    setParts(next);
    setOverrides((prev) => {
      const merged = { ...prev, [letter]: next };
      saveOverrides(merged);
      return merged;
    });
    pushHistory(letter, next);
  };

  const onRotInput = (axis: "x" | "y" | "z", value: number) => {
    if (!parts) return;
    const id = selectedPart;
    const cur = parts[id];
    const next: EditableParts = { ...parts, [id]: { ...cur, rot: { ...cur.rot, [axis]: value } } };
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
    const probe = buildEditableLetter(font, letter, defaultParts(1.4, 1.6), false);
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
    void import("../audio/sfx").then(({ playChime }) => playChime());
  };

  const onExport = async () => {
    const json = JSON.stringify(overrides, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      alert("Editor overrides copied to clipboard.");
    } catch {
      // Fallback: dump to console
      // eslint-disable-next-line no-console
      console.log("Editor overrides:\n" + json);
      alert("Could not access clipboard — check the browser console for the JSON.");
    }
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
          {ALPHABET.map((L) => (
            <option key={L} value={L}>{L}{overrides[L] ? " *" : ""}</option>
          ))}
        </select>
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
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 700, color: "#3a2a14" }}>
          <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />
          Mirror
        </label>
        <span style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={undo} disabled={!canUndo} style={btn(canUndo ? "#a8e2ff" : "#e0e0e0", "#3a2a14")} title="Undo (⌘Z)">↶ Undo</button>
          <button onClick={redo} disabled={!canRedo} style={btn(canRedo ? "#a8e2ff" : "#e0e0e0", "#3a2a14")} title="Redo (⌘⇧Z)">↷ Redo</button>
        </div>
        <button onClick={triggerFound} style={btn("#9bdc4a", "white")}>🎉 Found!</button>
        <button onClick={onResetLetter} style={btn("#ffd56b", "#3a2a14")}>Reset {letter}</button>
        <button onClick={onExport} style={btn("#46c2cb", "white")}>📋 Export</button>
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
            <h3 style={{ margin: "0 0 6px 0" }}>{PART_LABELS[selectedPart]} position</h3>
            <p style={{ marginTop: 0, fontSize: 11, opacity: 0.7 }}>
              {SYMMETRIC[selectedPart]
                ? "Right side. Mirror toggle controls the left."
                : "Single instance."}
              {(selectedPart === "pupil" || selectedPart === "shine") && " Coordinates are relative to the eye."}
            </p>
            <NumberRow label="X" value={parts[selectedPart].pos.x} onChange={(v) => onPosInput("x", v)} />
            <NumberRow label="Y" value={parts[selectedPart].pos.y} onChange={(v) => onPosInput("y", v)} />
            <NumberRow label="Z" value={parts[selectedPart].pos.z} onChange={(v) => onPosInput("z", v)} />

            <h3 style={{ margin: "16px 0 6px 0" }}>{PART_LABELS[selectedPart]} rotation (rad)</h3>
            <NumberRow label="X" value={parts[selectedPart].rot.x} onChange={(v) => onRotInput("x", v)} step={Math.PI / 36} min={-Math.PI * 2} max={Math.PI * 2} />
            <NumberRow label="Y" value={parts[selectedPart].rot.y} onChange={(v) => onRotInput("y", v)} step={Math.PI / 36} min={-Math.PI * 2} max={Math.PI * 2} />
            <NumberRow label="Z" value={parts[selectedPart].rot.z} onChange={(v) => onRotInput("z", v)} step={Math.PI / 36} min={-Math.PI * 2} max={Math.PI * 2} />

            <h3 style={{ margin: "16px 0 6px 0" }}>Sizes</h3>
            <NumberRow label="Eye r" value={parts.eyeRadius} onChange={(v) => setParts((p) => p && persistAndReturn({ ...p, eyeRadius: v }, letter, setOverrides))} step={0.005} />
            <NumberRow label="Pupil r" value={parts.pupilRadius} onChange={(v) => setParts((p) => p && persistAndReturn({ ...p, pupilRadius: v }, letter, setOverrides))} step={0.005} />
            <NumberRow label="Shine r" value={parts.shineRadius} onChange={(v) => setParts((p) => p && persistAndReturn({ ...p, shineRadius: v }, letter, setOverrides))} step={0.005} />
            <NumberRow label="Smile r" value={parts.smileRadius} onChange={(v) => setParts((p) => p && persistAndReturn({ ...p, smileRadius: v }, letter, setOverrides))} step={0.005} />
            <NumberRow label="Cheek r" value={parts.cheekRadius} onChange={(v) => setParts((p) => p && persistAndReturn({ ...p, cheekRadius: v }, letter, setOverrides))} step={0.005} />
            <NumberRow label="Foot r" value={parts.footRadius} onChange={(v) => setParts((p) => p && persistAndReturn({ ...p, footRadius: v }, letter, setOverrides))} step={0.005} />
          </>
        )}

        <p style={{ marginTop: 24, fontSize: 11, opacity: 0.6 }}>
          Edits save automatically per-letter to localStorage. "Export" copies the
          full overrides JSON to your clipboard so you can apply the changes
          to <code>src/engine/letters.ts</code>.
        </p>
      </aside>
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
