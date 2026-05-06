import * as THREE from "three";
import { Font, FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import {
  type EditableParts,
  type Transform,
  DEFAULT_WAVE,
  makeMouth,
  wavePatternValue,
} from "./letterShapes";
import letterFixtures from "./letterFixtures.json";

// Authored per-letter overrides exported from the in-app editor. Keys
// are the case-preserved glyph ("A", "a", …). The bundled JSON is the
// production source of truth, but the in-app letter editor saves
// in-progress edits to localStorage at LETTER_OVERRIDES_KEY. We merge
// localStorage on top of the bundle on EVERY build so live edits show
// up in every preview (LetterTest, game letters, q-tail editor, etc.)
// without rebuilding. Once the user is happy, "Export all" in the
// editor produces a JSON blob to paste into letterFixtures.json so
// production picks them up.
const BUNDLED_LETTER_OVERRIDES = letterFixtures as Record<string, EditableParts>;
const LETTER_OVERRIDES_KEY = "letra:editor:overrides:v2";

// One-shot migration: an out-of-spec capital "A" snuck into some
// users' localStorage (eyes pulled way out, smile drifted). Drop the
// stale A entry so the bundled glyph wins on next load. Keyed by a
// version flag so we don't keep clobbering A if the user later
// re-authors it on purpose.
(function scrubBrokenLetterAFromOverrides() {
  if (typeof localStorage === "undefined") return;
  const FLAG = "letra:scrubA:v1";
  try {
    if (localStorage.getItem(FLAG)) return;
    const raw = localStorage.getItem(LETTER_OVERRIDES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed && typeof parsed === "object" && "A" in parsed) {
        delete parsed.A;
        localStorage.setItem(LETTER_OVERRIDES_KEY, JSON.stringify(parsed));
      }
    }
    localStorage.setItem(FLAG, "1");
  } catch {
    /* non-fatal */
  }
})();

function getLetterOverrides(): Record<string, EditableParts> {
  if (typeof localStorage === "undefined") return BUNDLED_LETTER_OVERRIDES;
  try {
    const raw = localStorage.getItem(LETTER_OVERRIDES_KEY);
    if (!raw) return BUNDLED_LETTER_OVERRIDES;
    const local = JSON.parse(raw) as Record<string, EditableParts>;
    // Per-glyph localStorage wins. We don't deep-merge — an authored
    // glyph in localStorage replaces the bundled one entirely so the
    // editor's "Reset" semantics line up with what gets shipped.
    return { ...BUNDLED_LETTER_OVERRIDES, ...local };
  } catch {
    return BUNDLED_LETTER_OVERRIDES;
  }
}

// ── Lowercase-q tail config ─────────────────────────────────────────
// The font's lowercase q renders without a foot/curl, so we glue an
// extruded bezier ribbon onto the descender's bottom. These four
// constants drive that shape and are exposed so the q-tail editor
// (src/ui/QTailEditor.tsx) can tune them live with sliders.
//   thick:     ribbon thickness (~stem width)
//   reach:     how far right the tail extends
//   rise:      how high the tip rises above the descender's bottom
//   alignment: horizontal anchor multiplier — left-edge sits
//              `thick * alignment` inside the stem's right edge
//              (larger pulls the tail further left into the stem).
export type QTailConfig = {
  thick: number;
  reach: number;
  rise: number;
  alignment: number;
  // Z-axis rotation in radians applied around the tail's left edge
  // (the join with the descender). Positive values lift the tip up;
  // negative values drop it. Small angles only — large rotations
  // would slice the tail's thickness into the stem.
  rotation: number;
};

const DEFAULT_Q_TAIL_CONFIG: QTailConfig = {
  thick: 0.25,
  reach: 0.55,
  rise: 0.1,
  alignment: 1.45,
  rotation: -0.06,
};

const Q_TAIL_KEY = "letra:qTailConfig";

function loadQTailConfig(): QTailConfig {
  if (typeof localStorage === "undefined") return { ...DEFAULT_Q_TAIL_CONFIG };
  try {
    const raw = localStorage.getItem(Q_TAIL_KEY);
    if (!raw) return { ...DEFAULT_Q_TAIL_CONFIG };
    const parsed = JSON.parse(raw);
    return {
      thick: typeof parsed.thick === "number" ? parsed.thick : DEFAULT_Q_TAIL_CONFIG.thick,
      reach: typeof parsed.reach === "number" ? parsed.reach : DEFAULT_Q_TAIL_CONFIG.reach,
      rise: typeof parsed.rise === "number" ? parsed.rise : DEFAULT_Q_TAIL_CONFIG.rise,
      alignment:
        typeof parsed.alignment === "number" ? parsed.alignment : DEFAULT_Q_TAIL_CONFIG.alignment,
      rotation:
        typeof parsed.rotation === "number" ? parsed.rotation : DEFAULT_Q_TAIL_CONFIG.rotation,
    };
  } catch {
    return { ...DEFAULT_Q_TAIL_CONFIG };
  }
}

// Mutable so the editor can poke values in without forcing every
// caller to read the latest object — the next buildLetterCharacter
// for "q" will pick up the new numbers.
export const qTailConfig: QTailConfig = loadQTailConfig();

export function setQTailConfig(next: Partial<QTailConfig>) {
  Object.assign(qTailConfig, next);
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(Q_TAIL_KEY, JSON.stringify(qTailConfig));
    } catch {
      /* non-fatal */
    }
  }
}

export function resetQTailConfig() {
  Object.assign(qTailConfig, DEFAULT_Q_TAIL_CONFIG);
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(Q_TAIL_KEY);
    } catch {
      /* non-fatal */
    }
  }
}

export function getDefaultQTailConfig(): QTailConfig {
  return { ...DEFAULT_Q_TAIL_CONFIG };
}

// Cute, walking-around letter characters. Each letter is an extruded glyph from
// helvetiker_bold, with googly eyes, little arms, feet, and a smile. The
// characters bob and gently spin idle so they feel alive.

const FONT_URL = "/fonts/helvetiker_bold.typeface.json";

let cachedFont: Font | null = null;
let pending: Promise<Font> | null = null;

export function loadFont(): Promise<Font> {
  if (cachedFont) return Promise.resolve(cachedFont);
  if (pending) return pending;
  pending = new Promise((resolve, reject) => {
    new FontLoader().load(
      FONT_URL,
      (font) => {
        cachedFont = font;
        resolve(font);
      },
      undefined,
      reject
    );
  });
  return pending;
}

// Bright kid-friendly palette. Each letter picks one based on its index so the
// alphabet has visual variety without anything jarring.
const PALETTE = [
  0xff5e7e, 0xffa64d, 0xffd83b, 0x9bdc4a, 0x46c2cb, 0x6f9bff, 0xb886ff,
  0xff7ab8, 0xff8a3d, 0xfff06a, 0x7ddc5a, 0x4ec7e6, 0x8aa6ff, 0xd09bff,
];

export function colorFor(letter: string): THREE.Color {
  const idx = letter.toUpperCase().charCodeAt(0) - 65;
  return new THREE.Color(PALETTE[((idx % PALETTE.length) + PALETTE.length) % PALETTE.length]);
}

const tmpBox = new THREE.Box3();

// Helvetiker's uppercase "I" is a plain vertical bar that's
// indistinguishable from a lowercase "l". We swap in a 3-piece serif
// glyph (stem + top + bottom horizontal bars) so kids reading the
// alphabet can't mistake it for an "l". Both build paths (procedural
// and override-driven) call this so the override authors can position
// features against the same shape they see in-game.
export type LetterShape = {
  // Object the caller adds to its inner group. Already centred so
  // baseline sits at y=0 and horizontal centre at x=0.
  object: THREE.Object3D;
  width: number;
  height: number;
  dispose: () => void;
};

export function makeLetterShape(font: Font, display: string, mat: THREE.Material): LetterShape {
  if (display === "I") return makeSerifI(mat);
  // Lowercase i renders with the dot crowding the stem in the stock
  // font; build it from scratch so the tittle has an explicit gap.
  if (display === "i") return makeChunkyLowerI(mat);
  // Lowercase j keeps the stock glyph (so the descender hook still
  // looks like the font's other glyphs) but we translate the
  // separate "tittle" shape up before extruding so the gap is
  // visibly wider. font.generateShapes() returns the j as multiple
  // Shape objects — the smaller, topmost one is the dot.
  if (display === "j") {
    return makeLowercaseJ(font, mat);
  }

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
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // Lowercase q: glue a swooping tail onto the descender so it reads
  // distinct from lowercase p. The shape parameters live in
  // qTailConfig (mutable, localStorage-backed) so the q-tail editor
  // can tune them live.
  if (display === "q") {
    const group = new THREE.Group();
    group.add(mesh);
    const cfg = qTailConfig;
    const tailShape = new THREE.Shape();
    tailShape.moveTo(0, 0);
    tailShape.bezierCurveTo(cfg.reach * 0.35, 0, cfg.reach * 0.7, cfg.rise * 0.4, cfg.reach, cfg.rise);
    tailShape.lineTo(cfg.reach, cfg.rise + cfg.thick);
    tailShape.bezierCurveTo(
      cfg.reach * 0.7,
      cfg.rise * 0.4 + cfg.thick,
      cfg.reach * 0.35,
      cfg.thick,
      0,
      cfg.thick,
    );
    tailShape.closePath();

    const tailGeo = new THREE.ExtrudeGeometry(tailShape, {
      depth: 0.55,
      curveSegments: 8,
      bevelEnabled: true,
      bevelThickness: 0.07,
      bevelSize: 0.05,
      bevelSegments: 3,
    });
    const tailMesh = new THREE.Mesh(tailGeo, mat);
    tailMesh.castShadow = true;
    tailMesh.receiveShadow = true;
    tailMesh.position.set(size.x / 2 - cfg.thick * cfg.alignment, 0, 0);
    // Rotate around the tail's left edge (its local origin) so the
    // join with the descender stays put while the tip swings.
    tailMesh.rotation.z = cfg.rotation;
    group.add(tailMesh);

    return {
      object: group,
      width: size.x + cfg.reach,
      height: size.y,
      dispose: () => {
        geo.dispose();
        tailGeo.dispose();
      },
    };
  }

  return {
    object: mesh,
    width: size.x,
    height: size.y,
    dispose: () => geo.dispose(),
  };
}

function makeSerifI(mat: THREE.Material): LetterShape {
  // Proportions tuned to read like a Roman serif uppercase I at the same
  // visual height as TextGeometry-rendered glyphs in this font (≈1.6).
  const STEM_W = 0.32;
  const STEM_H = 1.4;
  const SERIF_W = 0.85;
  const SERIF_H = 0.16;
  const DEPTH = 0.55;
  const totalH = STEM_H + SERIF_H * 2;
  const totalW = SERIF_W;

  const group = new THREE.Group();
  const stemGeo = new THREE.BoxGeometry(STEM_W, STEM_H, DEPTH);
  const stem = new THREE.Mesh(stemGeo, mat);
  stem.position.y = SERIF_H + STEM_H / 2;
  stem.castShadow = true;
  stem.receiveShadow = true;
  group.add(stem);

  const serifGeo = new THREE.BoxGeometry(SERIF_W, SERIF_H, DEPTH);
  const topSerif = new THREE.Mesh(serifGeo, mat);
  topSerif.position.y = totalH - SERIF_H / 2;
  topSerif.castShadow = true;
  topSerif.receiveShadow = true;
  group.add(topSerif);
  const botSerif = new THREE.Mesh(serifGeo, mat);
  botSerif.position.y = SERIF_H / 2;
  botSerif.castShadow = true;
  botSerif.receiveShadow = true;
  group.add(botSerif);

  return {
    object: group,
    width: totalW,
    height: totalH,
    dispose: () => {
      stemGeo.dispose();
      serifGeo.dispose();
    },
  };
}

// Chunky lowercase i — stem + tittle (the dot) with an explicit gap
// between them. The font's stock i renders these touching, which reads
// like a single fused glyph at game scale.
function makeChunkyLowerI(mat: THREE.Material): LetterShape {
  const STEM_W = 0.36;
  const STEM_H = 1.0;
  const DOT_W = 0.36;
  const DOT_H = 0.34;
  const GAP = 0.26;
  const DEPTH = 0.55;
  const totalH = STEM_H + GAP + DOT_H;
  const totalW = Math.max(STEM_W, DOT_W);

  const group = new THREE.Group();

  const stemGeo = new THREE.BoxGeometry(STEM_W, STEM_H, DEPTH);
  const stem = new THREE.Mesh(stemGeo, mat);
  stem.position.y = STEM_H / 2;
  stem.castShadow = true;
  stem.receiveShadow = true;
  group.add(stem);

  const dotGeo = new THREE.BoxGeometry(DOT_W, DOT_H, DEPTH);
  const dot = new THREE.Mesh(dotGeo, mat);
  dot.position.y = STEM_H + GAP + DOT_H / 2;
  dot.castShadow = true;
  dot.receiveShadow = true;
  group.add(dot);

  return {
    object: group,
    width: totalW,
    height: totalH,
    dispose: () => {
      stemGeo.dispose();
      dotGeo.dispose();
    },
  };
}

// Lowercase j: keep the font's own glyph (so the stem + descender
// hook match every other letter's curves) but lift the tittle so the
// dot has a visible gap above the stem. The font supplies "j" as
// TWO Shape objects — a stem-with-hook and a small isolated dot. We
// identify the dot by picking the shape with the highest centroid,
// translate ITS path points upward, then extrude both shapes
// together with the same bevel params as the other letters.
function makeLowercaseJ(font: Font, mat: THREE.Material): LetterShape {
  const SIZE = 1.6;
  const EXTRA_GAP = 0.22;
  const shapes = font.generateShapes("j", SIZE);

  // Pick the shape with the highest mean Y — that's the tittle.
  let topShape: THREE.Shape | null = null;
  let topMeanY = -Infinity;
  for (const s of shapes) {
    const pts = s.getPoints(8);
    if (pts.length === 0) continue;
    let sum = 0;
    for (const p of pts) sum += p.y;
    const mean = sum / pts.length;
    if (mean > topMeanY) {
      topMeanY = mean;
      topShape = s;
    }
  }

  // Build the final shape list with the dot lifted.
  const finalShapes = shapes.map((s) =>
    s === topShape ? translateShapeY(s, EXTRA_GAP) : s,
  );

  const geo = new THREE.ExtrudeGeometry(finalShapes, {
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
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return {
    object: mesh,
    width: size.x,
    height: size.y,
    dispose: () => geo.dispose(),
  };
}

// Build a new Shape whose path points (and hole points) are
// translated upward by `dy`. The original Shape's curves are
// approximated by straight segments via getPoints() — fine for a
// small dot that's nearly circular, since the bevel softens any
// segmentation artefacts at the kid-facing scale.
function translateShapeY(shape: THREE.Shape, dy: number): THREE.Shape {
  const out = new THREE.Shape();
  const pts = shape.getPoints(12);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i === 0) out.moveTo(p.x, p.y + dy);
    else out.lineTo(p.x, p.y + dy);
  }
  for (const hole of shape.holes) {
    const newHole = new THREE.Path();
    const hpts = hole.getPoints(12);
    for (let i = 0; i < hpts.length; i++) {
      const p = hpts[i];
      if (i === 0) newHole.moveTo(p.x, p.y + dy);
      else newHole.lineTo(p.x, p.y + dy);
    }
    out.holes.push(newHole);
  }
  return out;
}

export type LetterCharacter = {
  // Update the resting Y the idle bob is centered on. Use this when
  // teleporting a letter to a new ground height (e.g. dance-party
  // ring on a deformed terrain) so the new position sticks instead of
  // snapping back to the old baseY.
  setBaseY: (y: number) => void;
  group: THREE.Group;
  letter: string;
  isCollected: boolean;
  // Animate idle state. Pass-through dt so caller can scale.
  update: (dt: number, t: number) => void;
  // Trigger the celebration burst once it's been picked up.
  celebrate: () => void;
  // Distance check helper used by game modes for proximity collection.
  positionXZ: () => { x: number; z: number };
  // Aim the letter's face at a world position (typically the camera). Only
  // affects the outer Y-axis pivot — the inner animation group keeps its
  // own bob/spin animation separate so they never fight.
  faceTowards: (x: number, z: number) => void;
  // Tell the letter how far away the player is so it can react: a soft
  // glow boost as the kid approaches, plus a one-shot greeting wave the
  // first time they cross into noticing range. Re-arms once the player
  // walks back outside the wider reset radius.
  setPlayerProximity: (distance: number) => void;
};

// Proximity reaction tuning. Distances are in world units.
//   NEAR/FAR drive the smooth glow boost — full at NEAR, none past FAR.
//   NOTICE_ENTER fires the one-shot greeting (rising edge only).
//   NOTICE_RESET re-arms the greeting once the player walks back out.
//   GREET_DURATION_S controls how long the wave + small hop runs.
const PROX_NEAR = 2.5;
const PROX_FAR = 6.5;
const NOTICE_ENTER = 4.0;
const NOTICE_RESET = 6.0;
const GREET_DURATION_S = 0.7;

type ProximityState = {
  // Smoothed 0..1: 1 = right next to letter, 0 = past PROX_FAR.
  smooth: number;
  // 0 = idle, in (0, 1] = greeting playing (advances at 1/duration per second).
  greetT: number;
  // Once a greeting completes the letter sits quiet until the player
  // walks back outside NOTICE_RESET — keeps it from spamming the wave
  // every time the kid wiggles around the threshold.
  greetLocked: boolean;
  // Latest distance pushed in by the game; -1 = never set yet.
  lastDistance: number;
};

function makeProximityState(): ProximityState {
  return { smooth: 0, greetT: 0, greetLocked: false, lastDistance: -1 };
}

// Advance the smoothing + greeting state machine. Call once per frame
// per letter from update(). Distance < 0 means "not driven this frame";
// in that case we treat it as far so the letter relaxes back to idle.
function tickProximityState(state: ProximityState, dt: number) {
  const dist = state.lastDistance < 0 ? Infinity : state.lastDistance;

  // Smoothed glow proximity. Linear ramp from FAR→NEAR, then a soft
  // exponential blend so we don't snap on/off as the kid walks past.
  const target = Math.max(0, Math.min(1, 1 - (dist - PROX_NEAR) / (PROX_FAR - PROX_NEAR)));
  const k = Math.min(1, dt * 5);
  state.smooth += (target - state.smooth) * k;

  // Greeting state machine.
  if (state.greetT > 0) {
    state.greetT += dt / GREET_DURATION_S;
    if (state.greetT >= 1) {
      state.greetT = 0;
      state.greetLocked = true;
    }
  } else if (state.greetLocked) {
    if (dist > NOTICE_RESET) state.greetLocked = false;
  } else if (dist < NOTICE_ENTER) {
    state.greetT = 0.0001;
  }
}

// Extra Y-offset for the greeting hop. Single sin lobe across the
// greeting's lifetime so the letter pops up and settles back down.
function greetHop(state: ProximityState): number {
  if (state.greetT <= 0) return 0;
  return Math.sin(state.greetT * Math.PI) * 0.35;
}

// Extra arm-swing for the greeting. A few quick oscillations enveloped
// by a sin lobe so the wave fades in and out smoothly.
function greetArmSwing(state: ProximityState): number {
  if (state.greetT <= 0) return 0;
  const env = Math.sin(state.greetT * Math.PI);
  return Math.sin(state.greetT * Math.PI * 6) * env * 0.9;
}

export type LetterOptions = {
  letter: string;
  // Some letters look better lowercase (cursive p / d / b shapes); games
  // pass uppercase by default but can opt in to lowercase variants.
  lowercase?: boolean;
  // Ground height at the spawn (x, z). Used as the base for the idle
  // bob so letters in a moon crater sit at the crater floor instead of
  // floating at world Y=0. Defaults to 0 for biomes with flat terrain.
  baseY?: number;
};

export function buildLetterCharacter(font: Font, opts: LetterOptions): LetterCharacter {
  const upper = opts.letter.toUpperCase();
  const display = opts.lowercase ? opts.letter.toLowerCase() : upper;
  const color = colorFor(upper);

  // If the editor has authored an override for this exact glyph, render
  // from that. We key by the displayed character so 'A' and 'a' have
  // independent layouts — uppercase forms ship today; lowercase will
  // get its own fixtures later.
  const override = getLetterOverrides()[display];
  if (override) {
    return buildFromOverride(font, display, upper, override, color, opts.baseY ?? 0);
  }

  // Outer group: world position + Y-axis billboard.
  // Inner group: every cosmetic mesh + idle/celebration animation.
  // Splitting the two means we can rotate the body for celebration spin
  // while the parent keeps the face aimed at the camera.
  const group = new THREE.Group();
  const inner = new THREE.Group();
  group.name = `Letter-${upper}`;
  group.add(inner);

  const letterMat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.55,
    metalness: 0.05,
    emissive: color.clone().multiplyScalar(0.08),
  });

  const shape = makeLetterShape(font, display, letterMat);
  inner.add(shape.object);
  const width = shape.width;
  const height = shape.height;
  // Glyph half-width — used to keep every feature inside the letter
  // silhouette. We don't enforce an artificial floor here (that pushed
  // features off narrow letters like I and L). Instead, eye/cheek/foot
  // sizes scale down with the glyph.
  const half = Math.max(0.18, width * 0.5 - 0.06);
  const depthFront = 0.55 / 2 + 0.08; // half the extrude depth + a hair
  // Eye sphere sized so two eyes plus a 30% gap fit within the glyph width.
  // This way an "I" gets tiny eyes that fit; "M" gets generous ones.
  const eyeRadius = Math.min(0.2, half * 0.4, height * 0.13);
  // Eyes ride high — about 75% of the way up the glyph, but always at least
  // an eye-radius below the top so they don't pop above the letter.
  const eyeY = Math.min(Math.max(height * 0.74, 0.85), height - eyeRadius * 1.4);
  // Spread that fits inside the glyph: two eyes + tiny gap.
  const eyeOffset = Math.max(eyeRadius * 1.1, Math.min(half - eyeRadius * 1.05, half * 0.6));

  // Eyes — white sclera, dark pupil, plus a tiny "shine" highlight that
  // really sells the googly cartoon vibe.
  const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 });
  const eyePupil = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 });
  const eyeShine = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const dx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(eyeRadius, 16, 12), eyeWhite);
    eye.position.set(dx * eyeOffset, eyeY, depthFront + eyeRadius * 0.4);
    inner.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(eyeRadius * 0.55, 12, 10), eyePupil);
    pupil.position.set(eye.position.x, eye.position.y, eye.position.z + eyeRadius * 0.5);
    inner.add(pupil);
    const shine = new THREE.Mesh(new THREE.SphereGeometry(eyeRadius * 0.18, 8, 6), eyeShine);
    shine.position.set(eye.position.x - eyeRadius * 0.25, eye.position.y + eyeRadius * 0.3, eye.position.z + eyeRadius * 0.7);
    inner.add(shine);
  }

  // Smile — half torus on the front face, sized to letter width.
  const smileRadius = Math.min(0.16, half * 0.5);
  const smileY = Math.max(eyeY - eyeRadius * 2.4, height * 0.36);
  const smile = new THREE.Mesh(
    new THREE.TorusGeometry(smileRadius, Math.max(0.03, smileRadius * 0.22), 8, 16, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0x6b1d10 })
  );
  smile.position.set(0, smileY, depthFront + 0.03);
  smile.rotation.x = Math.PI / 2;
  inner.add(smile);

  // Rosy cheeks — flanking the smile within the glyph silhouette.
  const cheekMat = new THREE.MeshStandardMaterial({ color: 0xff8aaa, transparent: true, opacity: 0.75 });
  const cheekRadius = Math.min(0.1, half * 0.18);
  const cheekOffset = Math.min(half - cheekRadius, eyeOffset + cheekRadius * 1.2);
  for (const dx of [-1, 1]) {
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(cheekRadius, 10, 8), cheekMat);
    cheek.position.set(dx * cheekOffset, smileY + cheekRadius * 0.4, depthFront);
    cheek.scale.set(1, 0.7, 0.4);
    inner.add(cheek);
  }

  // Arms — pivots just outside the letter so a wave reads from any angle.
  // Position scales to letter width so M/W get arms that really stretch
  // out while I/L stay tucked.
  const limbMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
  const armGeo = new THREE.CapsuleGeometry(0.1, 0.45, 4, 8);
  const armX = Math.max(half + 0.18, 0.36);
  const armY = Math.min(height * 0.55, height - 0.4);
  const armPivotR = new THREE.Group();
  armPivotR.position.set(armX, armY, 0);
  const armR = new THREE.Mesh(armGeo, limbMat);
  armR.position.set(0.25, -0.05, 0);
  armR.rotation.z = Math.PI / 4;
  armR.castShadow = true;
  armPivotR.add(armR);
  inner.add(armPivotR);

  const armPivotL = new THREE.Group();
  armPivotL.position.set(-armX, armY, 0);
  const armL = new THREE.Mesh(armGeo, limbMat);
  armL.position.set(-0.25, -0.05, 0);
  armL.rotation.z = -Math.PI / 4;
  armL.castShadow = true;
  armPivotL.add(armL);
  inner.add(armPivotL);

  // Feet — two black blobs centred under the glyph. We anchor them to the
  // letter centre rather than to "half" so they don't get pushed too far
  // apart on wide letters; for narrow letters they tuck in close.
  const footMat = new THREE.MeshStandardMaterial({ color: 0x3a2a14, roughness: 0.7 });
  const footOffset = Math.max(0.18, Math.min(half * 0.4, 0.32));
  for (const dx of [-1, 1]) {
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), footMat);
    foot.position.set(dx * footOffset, 0.05, 0.2);
    foot.scale.set(1, 0.6, 1.2);
    foot.castShadow = true;
    inner.add(foot);
  }

  // Soft glow disc on the ground — sized to the letter footprint.
  // Lives on the OUTER group (not the bobbing inner one) so the
  // glow stays planted on the ground while the letter idle-bobs
  // and celebrates above it.
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(Math.max(width * 0.7, 0.9), 24),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.02;
  group.add(glow);

  // Animation state
  let bobPhase = Math.random() * Math.PI * 2;
  let swayPhase = Math.random() * Math.PI * 2;
  let celebrationT = -1;
  let baseY = opts.baseY ?? 0;
  let isCollected = false;
  const proximity = makeProximityState();
  // Capture the glow's authored radius / opacity so the proximity boost
  // is applied as a multiplier each frame rather than accumulating.
  const glowMat = glow.material as THREE.MeshBasicMaterial;
  const glowBaseOpacity = glowMat.opacity;
  const glowBaseScale = glow.scale.x;

  const character: LetterCharacter = {
    group,
    letter: upper,
    setBaseY(y) {
      baseY = y;
    },
    get isCollected() {
      return isCollected;
    },
    set isCollected(_v) {
      // setter exists so consumers can write but we treat collect via celebrate()
    },
    update(dt, _t) {
      bobPhase += dt * 2;
      swayPhase += dt * 1.4;
      tickProximityState(proximity, dt);
      // Idle: gentle bob (height) and a small Z-axis sway. We deliberately
      // don't touch group.rotation.y here — that's owned by faceTowards()
      // for camera billboarding. A tiny rotation.z gives the "alive" feel
      // without fighting the parent's yaw.
      // Bob upward only — Math.abs keeps the lower half of the sine wave
      // out of the equation so feet never sink through the ground.
      const baseBob = Math.abs(Math.sin(bobPhase)) * 0.12;
      group.position.y = baseY + baseBob;
      inner.rotation.z = Math.sin(swayPhase) * 0.05;
      inner.rotation.y = 0; // reset celebration spin between frames

      // Arms swing slightly idle
      armPivotR.rotation.z = Math.sin(bobPhase * 1.2) * 0.12;
      armPivotL.rotation.z = -Math.sin(bobPhase * 1.2) * 0.12;

      // Proximity glow — keep this even during celebration since the
      // ground glow lives on the outer group anyway.
      const glowK = proximity.smooth;
      glowMat.opacity = glowBaseOpacity * (1 + 0.6 * glowK);
      const glowScale = glowBaseScale * (1 + 0.18 * glowK);
      glow.scale.set(glowScale, glowScale, 1);

      if (celebrationT >= 0) {
        celebrationT += dt;
        const k = Math.min(celebrationT / 1.6, 1);
        // Big jump
        const jump = Math.sin(k * Math.PI) * 1.4;
        group.position.y = baseY + baseBob + jump;
        // Spin around the inner axis so the parent stays facing the camera.
        inner.rotation.y = k * Math.PI * 2;
        // Wave both arms wildly
        armPivotR.rotation.z = Math.sin(celebrationT * 18) * 1.0 - 0.6;
        armPivotL.rotation.z = -Math.sin(celebrationT * 18) * 1.0 + 0.6;
        // Scale pulse
        const s = 1 + 0.15 * Math.sin(k * Math.PI * 2);
        inner.scale.setScalar(s);
        if (k >= 1) {
          isCollected = true;
        }
      } else {
        inner.scale.setScalar(1);
        // Greeting overlay — only applied when not celebrating, so the
        // big payoff animation never has to compete with a tiny wave.
        const hop = greetHop(proximity);
        if (hop > 0) {
          group.position.y = baseY + baseBob + hop;
          const wave = greetArmSwing(proximity);
          // Right arm waves a touch more than the left so it reads as a
          // friendly hello rather than two identical robot arms.
          armPivotR.rotation.z = Math.sin(bobPhase * 1.2) * 0.12 + wave;
          armPivotL.rotation.z = -Math.sin(bobPhase * 1.2) * 0.12 - wave * 0.4;
        }
      }
    },
    celebrate() {
      if (celebrationT < 0) celebrationT = 0;
    },
    positionXZ() {
      return { x: group.position.x, z: group.position.z };
    },
    faceTowards(x, z) {
      const dx = x - group.position.x;
      const dz = z - group.position.z;
      // Letters are built with their face on local +Z. atan2(dx, dz) yields
      // the yaw that aligns +Z with (dx, dz).
      group.rotation.y = Math.atan2(dx, dz);
    },
    setPlayerProximity(distance) {
      proximity.lastDistance = distance;
    },
  };

  // Cleanup helper attached to group userData for caller convenience
  group.userData.dispose = () => {
    shape.dispose();
    letterMat.dispose();
    eyeWhite.dispose();
    eyePupil.dispose();
    smile.geometry.dispose();
    (smile.material as THREE.Material).dispose();
    armGeo.dispose();
    limbMat.dispose();
    cheekMat.dispose();
    footMat.dispose();
    glow.geometry.dispose();
    (glow.material as THREE.Material).dispose();
  };

  return character;
}

// Used by consumers to test whether a player has reached a letter.
export function distanceXZ(a: { x: number; z: number }, b: { x: number; z: number }) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

// Avoid linter warnings about unused box helper.
void tmpBox;

// ─── Override-driven builder ────────────────────────────────────────────
// Renders a letter using authored EditableParts data instead of computing
// everything procedurally. Animation behaviour mirrors the procedural
// path (idle bob, sway, celebration jump+spin+pulse) but the celebration
// arm pass uses the authored wave config so each letter's personality
// shows through during pickup. Hidden parts are skipped, including
// pupil/shine when their parent eye is hidden.
function buildFromOverride(
  font: Font,
  display: string,
  upperKey: string,
  parts: EditableParts,
  color: THREE.Color,
  baseY: number
): LetterCharacter {
  const group = new THREE.Group();
  const inner = new THREE.Group();
  group.name = `Letter-${upperKey}`;
  group.add(inner);

  const isHidden = (key: string) => !!parts.hidden?.[key];
  // Treat zero / negative authored radii as hidden too — that's how the
  // editor's slider effectively "removes" a part on some letters.
  const isVisibleSize = (r: number) => r > 0.005;

  const letterMat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.55,
    metalness: 0.05,
    emissive: color.clone().multiplyScalar(0.08),
  });
  const shape = makeLetterShape(font, display, letterMat);
  inner.add(shape.object);

  const setRot = (obj: THREE.Object3D, r: { x: number; y: number; z: number }) =>
    obj.rotation.set(r.x, r.y, r.z);

  // Eyes — both sides explicitly. Pupil/shine are eye-children, so a
  // hidden pupil means "no pupil mesh inside this eye" but the eye still
  // shows. A hidden eye drops the whole sub-tree.
  const buildEye = (eyeT: Transform, pupilT: Transform, shineT: Transform, sideKey: "R" | "L") => {
    if (isHidden(`eye:${sideKey}`)) return;
    const eyeGroup = new THREE.Group();
    eyeGroup.position.set(eyeT.pos.x, eyeT.pos.y, eyeT.pos.z);
    setRot(eyeGroup, eyeT.rot);
    if (isVisibleSize(parts.eyeRadius)) {
      const sclera = new THREE.Mesh(
        new THREE.SphereGeometry(parts.eyeRadius, 16, 12),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 })
      );
      eyeGroup.add(sclera);
    }
    if (!isHidden(`pupil:${sideKey}`) && isVisibleSize(parts.pupilRadius)) {
      const pupil = new THREE.Mesh(
        new THREE.SphereGeometry(parts.pupilRadius, 12, 10),
        new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 })
      );
      pupil.position.set(pupilT.pos.x, pupilT.pos.y, pupilT.pos.z);
      setRot(pupil, pupilT.rot);
      eyeGroup.add(pupil);
    }
    if (!isHidden(`shine:${sideKey}`) && isVisibleSize(parts.shineRadius)) {
      const shine = new THREE.Mesh(
        new THREE.SphereGeometry(parts.shineRadius, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      );
      shine.position.set(shineT.pos.x, shineT.pos.y, shineT.pos.z);
      setRot(shine, shineT.rot);
      eyeGroup.add(shine);
    }
    inner.add(eyeGroup);
  };
  buildEye(parts.eye.R, parts.pupil.R, parts.shine.R, "R");
  buildEye(parts.eye.L, parts.pupil.L, parts.shine.L, "L");

  // Mouth
  if (!isHidden("smile") && isVisibleSize(parts.smileRadius)) {
    const mouthMat = new THREE.MeshStandardMaterial({ color: 0x6b1d10 });
    const mouthGroup = makeMouth(parts.mouthShape, parts.smileRadius, mouthMat);
    mouthGroup.position.set(parts.smile.pos.x, parts.smile.pos.y, parts.smile.pos.z);
    setRot(mouthGroup, parts.smile.rot);
    inner.add(mouthGroup);
  }

  // Cheeks
  if (isVisibleSize(parts.cheekRadius)) {
    const cheekMat = new THREE.MeshStandardMaterial({ color: 0xff8aaa, transparent: true, opacity: 0.75 });
    const cheekGeo = new THREE.SphereGeometry(parts.cheekRadius, 10, 8);
    if (!isHidden("cheek:R")) {
      const cheekR = new THREE.Mesh(cheekGeo, cheekMat);
      cheekR.position.set(parts.cheek.R.pos.x, parts.cheek.R.pos.y, parts.cheek.R.pos.z);
      setRot(cheekR, parts.cheek.R.rot);
      cheekR.scale.set(1, 0.7, 0.4);
      inner.add(cheekR);
    }
    if (!isHidden("cheek:L")) {
      const cheekL = new THREE.Mesh(cheekGeo, cheekMat);
      cheekL.position.set(parts.cheek.L.pos.x, parts.cheek.L.pos.y, parts.cheek.L.pos.z);
      setRot(cheekL, parts.cheek.L.rot);
      cheekL.scale.set(1, 0.7, 0.4);
      inner.add(cheekL);
    }
  }

  // Arms — pivots are always created so the animation code can write to
  // them without null checks; we only suppress adding them to the scene
  // when hidden. Authored rest rotation is captured for restoring after
  // celebrations / waves.
  const limbMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
  const armGeo = new THREE.CapsuleGeometry(0.1, 0.45, 4, 8);
  const armPivotR = new THREE.Group();
  armPivotR.position.set(parts.arm.R.pos.x, parts.arm.R.pos.y, parts.arm.R.pos.z);
  setRot(armPivotR, parts.arm.R.rot);
  const armR = new THREE.Mesh(armGeo, limbMat);
  armR.position.set(0.25, -0.05, 0);
  armR.rotation.z = Math.PI / 4;
  armR.castShadow = true;
  armPivotR.add(armR);
  if (!isHidden("arm:R")) inner.add(armPivotR);
  const armPivotL = new THREE.Group();
  armPivotL.position.set(parts.arm.L.pos.x, parts.arm.L.pos.y, parts.arm.L.pos.z);
  setRot(armPivotL, parts.arm.L.rot);
  const armL = new THREE.Mesh(armGeo, limbMat);
  armL.position.set(-0.25, -0.05, 0);
  armL.rotation.z = -Math.PI / 4;
  armL.castShadow = true;
  armPivotL.add(armL);
  if (!isHidden("arm:L")) inner.add(armPivotL);

  // Capture the authored rest rotations once so the idle / post-celebrate
  // restore is independent of any later overwrites.
  const armRestR = { ...parts.arm.R.rot };
  const armRestL = { ...parts.arm.L.rot };

  // Feet
  if (isVisibleSize(parts.footRadius)) {
    const footMat = new THREE.MeshStandardMaterial({ color: 0x3a2a14, roughness: 0.7 });
    const footGeo = new THREE.SphereGeometry(parts.footRadius, 10, 8);
    if (!isHidden("foot:R")) {
      const footR = new THREE.Mesh(footGeo, footMat);
      footR.position.set(parts.foot.R.pos.x, parts.foot.R.pos.y, parts.foot.R.pos.z);
      setRot(footR, parts.foot.R.rot);
      footR.scale.set(1, 0.6, 1.2);
      footR.castShadow = true;
      inner.add(footR);
    }
    if (!isHidden("foot:L")) {
      const footL = new THREE.Mesh(footGeo, footMat);
      footL.position.set(parts.foot.L.pos.x, parts.foot.L.pos.y, parts.foot.L.pos.z);
      setRot(footL, parts.foot.L.rot);
      footL.scale.set(1, 0.6, 1.2);
      footL.castShadow = true;
      inner.add(footL);
    }
  }

  // Soft glow disc on the ground. Uses the glyph's actual width so it
  // hugs the letter even when the user shrunk other features. Sits
  // on the OUTER group (root) so the glow stays planted on the
  // ground while the letter's inner sub-group idle-bobs above it.
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(Math.max(shape.width * 0.7, 0.9), 24),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.02;
  group.add(glow);

  // Animation state
  let bobPhase = Math.random() * Math.PI * 2;
  let swayPhase = Math.random() * Math.PI * 2;
  let celebrationT = -1;
  let isCollected = false;
  let mutableBaseY = baseY;
  const wave = parts.wave ?? DEFAULT_WAVE;
  const proximity = makeProximityState();
  const glowMat = glow.material as THREE.MeshBasicMaterial;
  const glowBaseOpacity = glowMat.opacity;
  const glowBaseScale = glow.scale.x;

  const character: LetterCharacter = {
    group,
    letter: upperKey,
    get isCollected() { return isCollected; },
    set isCollected(_v) {},
    setBaseY(y) {
      mutableBaseY = y;
    },
    update(dt, _t) {
      bobPhase += dt * 2;
      swayPhase += dt * 1.4;
      tickProximityState(proximity, dt);
      // Bob upward only — Math.abs keeps the lower half of the sine wave
      // out of the equation so feet never sink through the ground.
      const baseBob = Math.abs(Math.sin(bobPhase)) * 0.12;
      group.position.y = mutableBaseY + baseBob;
      inner.rotation.z = Math.sin(swayPhase) * 0.05;
      inner.rotation.y = 0;

      // Idle arms: oscillate around the AUTHORED rest rotation rather
      // than zero, so a letter posed with arms-akimbo or arms-up still
      // reads correctly when it's just standing there.
      const idleSwing = Math.sin(bobPhase * 1.2) * 0.12;
      armPivotR.rotation.set(armRestR.x, armRestR.y, armRestR.z + idleSwing);
      armPivotL.rotation.set(armRestL.x, armRestL.y, armRestL.z - idleSwing);

      const glowK = proximity.smooth;
      glowMat.opacity = glowBaseOpacity * (1 + 0.6 * glowK);
      const glowScale = glowBaseScale * (1 + 0.18 * glowK);
      glow.scale.set(glowScale, glowScale, 1);

      if (celebrationT >= 0) {
        celebrationT += dt;
        const k = Math.min(celebrationT / 1.6, 1);
        const jump = Math.sin(k * Math.PI) * 1.4;
        group.position.y = mutableBaseY + baseBob + jump;
        inner.rotation.y = k * Math.PI * 2;
        // Wave both arms using THIS letter's authored wave config —
        // the same motion the editor's preview shows.
        const phase = celebrationT * wave.frequency * Math.PI * 2;
        const v = wavePatternValue(wave.pattern, phase);
        armPivotR.rotation.z = v * wave.amplitude + wave.offset;
        armPivotL.rotation.z = -(v * wave.amplitude) - wave.offset;
        const s = 1 + 0.15 * Math.sin(k * Math.PI * 2);
        inner.scale.setScalar(s);
        if (k >= 1) {
          isCollected = true;
        }
      } else {
        inner.scale.setScalar(1);
        // Greeting overlay — adds a small hop and an extra arm wave on
        // top of the authored rest pose, only when not celebrating.
        const hop = greetHop(proximity);
        if (hop > 0) {
          group.position.y = mutableBaseY + baseBob + hop;
          const extra = greetArmSwing(proximity);
          armPivotR.rotation.set(armRestR.x, armRestR.y, armRestR.z + idleSwing + extra);
          armPivotL.rotation.set(armRestL.x, armRestL.y, armRestL.z - idleSwing - extra * 0.4);
        }
      }
    },
    celebrate() {
      if (celebrationT < 0) celebrationT = 0;
    },
    positionXZ() {
      return { x: group.position.x, z: group.position.z };
    },
    faceTowards(x, z) {
      const dx = x - group.position.x;
      const dz = z - group.position.z;
      group.rotation.y = Math.atan2(dx, dz);
    },
    setPlayerProximity(distance) {
      proximity.lastDistance = distance;
    },
  };

  group.userData.dispose = () => {
    shape.dispose();
    letterMat.dispose();
    armGeo.dispose();
    limbMat.dispose();
  };

  return character;
}
