import * as THREE from "three";
import { Font, FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";

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

export type LetterCharacter = {
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
};

export type LetterOptions = {
  letter: string;
  // Some letters look better lowercase (cursive p / d / b shapes); games
  // pass uppercase by default but can opt in to lowercase variants.
  lowercase?: boolean;
};

export function buildLetterCharacter(font: Font, opts: LetterOptions): LetterCharacter {
  const upper = opts.letter.toUpperCase();
  const display = opts.lowercase ? opts.letter.toLowerCase() : upper;
  const color = colorFor(upper);
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
  // Center horizontally and put feet on the ground.
  const bb = geo.boundingBox!;
  const cx = (bb.min.x + bb.max.x) / 2;
  geo.translate(-cx, -bb.min.y, 0);
  // Recompute for our consumer logic
  geo.computeBoundingBox();

  const letterMesh = new THREE.Mesh(geo, letterMat);
  letterMesh.castShadow = true;
  letterMesh.receiveShadow = true;
  inner.add(letterMesh);

  const size = new THREE.Vector3();
  geo.boundingBox!.getSize(size);
  const width = size.x;
  const height = size.y;
  // Half-width clamped to a comfortable range — narrow letters (I, L) get
  // facial features brought in; wide letters (M, W) get them spread out
  // but never beyond the glyph itself. The 0.42 floor keeps tiny letters
  // from looking cross-eyed.
  const half = Math.max(0.42, Math.min(width * 0.5 - 0.18, 0.95));
  const depthFront = 0.55 / 2 + 0.07; // half the extrude depth + a hair
  // Eye Y aligned with the upper third of the glyph for taller letters; on
  // short ones (a) we clamp so the eyes don't ride above the letter.
  const eyeY = Math.min(Math.max(height * 0.72, 0.95), height - 0.15);
  const eyeRadius = Math.min(0.2, height * 0.13);

  // Eyes — two white spheres with black pupils on the front face. Pupils sit
  // forward of the eye so they read as 3D from any camera angle.
  const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
  const eyePupil = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 });
  const eyeOffset = Math.min(half * 0.55, 0.35);
  for (const dx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(eyeRadius, 14, 12), eyeWhite);
    eye.position.set(dx * eyeOffset, eyeY, depthFront + eyeRadius * 0.4);
    inner.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(eyeRadius * 0.45, 12, 10), eyePupil);
    pupil.position.set(eye.position.x, eye.position.y, eye.position.z + eyeRadius * 0.55);
    inner.add(pupil);
  }

  // Smile — half torus, placed below the eyes within the letter's body.
  const smileY = Math.max(eyeY - 0.36, height * 0.42);
  const smile = new THREE.Mesh(
    new THREE.TorusGeometry(Math.min(0.18, half * 0.32), 0.04, 8, 14, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0x6b1d10 })
  );
  smile.position.set(0, smileY, depthFront + 0.02);
  smile.rotation.x = Math.PI / 2;
  inner.add(smile);

  // Rosy cheeks — flanking the smile, scaled to letter width.
  const cheekMat = new THREE.MeshStandardMaterial({ color: 0xff8aaa, transparent: true, opacity: 0.7 });
  const cheekOffset = Math.min(half * 0.85, 0.55);
  for (const dx of [-1, 1]) {
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), cheekMat);
    cheek.position.set(dx * cheekOffset, smileY + 0.04, depthFront);
    cheek.scale.set(1, 0.7, 0.4);
    inner.add(cheek);
  }

  // Arms — pivots sit just outside the letter so a wave reads cleanly from
  // any camera angle. Position scales to letter width so M/W get arms that
  // really stretch out, while I/L stay tucked.
  const limbMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
  const armGeo = new THREE.CapsuleGeometry(0.1, 0.45, 4, 8);
  const armPivotR = new THREE.Group();
  armPivotR.position.set(half + 0.15, height * 0.55, 0);
  const armR = new THREE.Mesh(armGeo, limbMat);
  armR.position.set(0.25, -0.05, 0);
  armR.rotation.z = Math.PI / 4;
  armR.castShadow = true;
  armPivotR.add(armR);
  inner.add(armPivotR);

  const armPivotL = new THREE.Group();
  armPivotL.position.set(-half - 0.15, height * 0.55, 0);
  const armL = new THREE.Mesh(armGeo, limbMat);
  armL.position.set(-0.25, -0.05, 0);
  armL.rotation.z = -Math.PI / 4;
  armL.castShadow = true;
  armPivotL.add(armL);
  inner.add(armPivotL);

  // Feet — two black blobs centred under the glyph (not under the bounding
  // box edges, so feet don't poke out from under W or M).
  const footMat = new THREE.MeshStandardMaterial({ color: 0x3a2a14, roughness: 0.7 });
  const footOffset = Math.min(half * 0.45, 0.32);
  for (const dx of [-1, 1]) {
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), footMat);
    foot.position.set(dx * footOffset, 0.05, 0.18);
    foot.scale.set(1, 0.6, 1.2);
    foot.castShadow = true;
    inner.add(foot);
  }

  // Soft glow disc on the ground — sized to the letter footprint.
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
  inner.add(glow);

  // Animation state
  let bobPhase = Math.random() * Math.PI * 2;
  let swayPhase = Math.random() * Math.PI * 2;
  let celebrationT = -1;
  const baseY = 0;
  let isCollected = false;

  const character: LetterCharacter = {
    group,
    letter: upper,
    get isCollected() {
      return isCollected;
    },
    set isCollected(_v) {
      // setter exists so consumers can write but we treat collect via celebrate()
    },
    update(dt, _t) {
      bobPhase += dt * 2;
      swayPhase += dt * 1.4;
      // Idle: gentle bob (height) and a small Z-axis sway. We deliberately
      // don't touch group.rotation.y here — that's owned by faceTowards()
      // for camera billboarding. A tiny rotation.z gives the "alive" feel
      // without fighting the parent's yaw.
      const baseBob = Math.sin(bobPhase) * 0.12;
      group.position.y = baseY + baseBob;
      inner.rotation.z = Math.sin(swayPhase) * 0.05;
      inner.rotation.y = 0; // reset celebration spin between frames

      // Arms swing slightly idle
      armPivotR.rotation.z = Math.sin(bobPhase * 1.2) * 0.12;
      armPivotL.rotation.z = -Math.sin(bobPhase * 1.2) * 0.12;

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
  };

  // Cleanup helper attached to group userData for caller convenience
  group.userData.dispose = () => {
    geo.dispose();
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
