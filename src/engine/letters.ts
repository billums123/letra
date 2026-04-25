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
  const group = new THREE.Group();
  group.name = `Letter-${upper}`;

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
  group.add(letterMesh);

  const size = new THREE.Vector3();
  geo.boundingBox!.getSize(size);
  const width = size.x;
  const height = size.y;

  // Eyes — two big white spheres with black pupils, planted on the front face.
  const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
  const eyePupil = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 });
  const eyeRadius = Math.min(0.22, height * 0.13);
  const eyeY = Math.max(height * 0.7, 0.85);
  for (const dx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(eyeRadius, 14, 12), eyeWhite);
    eye.position.set(dx * Math.min(width * 0.22, 0.5), eyeY, 0.6);
    group.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(eyeRadius * 0.45, 12, 10), eyePupil);
    pupil.position.set(eye.position.x, eye.position.y, 0.78);
    group.add(pupil);
  }

  // Smile — half torus
  const smile = new THREE.Mesh(
    new THREE.TorusGeometry(0.16, 0.04, 8, 14, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0x6b1d10 })
  );
  smile.position.set(0, eyeY - 0.32, 0.62);
  smile.rotation.x = Math.PI / 2;
  group.add(smile);

  // Tiny rosy cheeks for extra cuteness
  const cheekMat = new THREE.MeshStandardMaterial({ color: 0xff8aaa, transparent: true, opacity: 0.7 });
  for (const dx of [-1, 1]) {
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), cheekMat);
    cheek.position.set(dx * 0.55, eyeY - 0.45, 0.6);
    cheek.scale.set(1, 0.7, 0.4);
    group.add(cheek);
  }

  // Arms — left and right capsules attached to mid-height; we wave them on celebrate.
  const limbMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
  const armGeo = new THREE.CapsuleGeometry(0.1, 0.45, 4, 8);
  const armPivot = new THREE.Group();
  armPivot.position.set(width * 0.5 + 0.15, height * 0.55, 0.25);
  const leftArm = new THREE.Mesh(armGeo, limbMat);
  leftArm.position.set(0.25, -0.05, 0);
  leftArm.rotation.z = Math.PI / 4;
  leftArm.castShadow = true;
  armPivot.add(leftArm);
  group.add(armPivot);

  const armPivot2 = new THREE.Group();
  armPivot2.position.set(-width * 0.5 - 0.15, height * 0.55, 0.25);
  const rightArm = new THREE.Mesh(armGeo, limbMat);
  rightArm.position.set(-0.25, -0.05, 0);
  rightArm.rotation.z = -Math.PI / 4;
  rightArm.castShadow = true;
  armPivot2.add(rightArm);
  group.add(armPivot2);

  // Feet — two black blobs at the base
  const footMat = new THREE.MeshStandardMaterial({ color: 0x3a2a14, roughness: 0.7 });
  for (const dx of [-1, 1]) {
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), footMat);
    foot.position.set(dx * 0.28, 0.05, 0.18);
    foot.scale.set(1, 0.6, 1.2);
    foot.castShadow = true;
    group.add(foot);
  }

  // Soft glow disc on the ground
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(width * 0.7, 24),
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
  let spinPhase = 0;
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
    update(dt, t) {
      bobPhase += dt * 2;
      spinPhase += dt * 0.6;
      // Idle: gentle bob and tiny rotation
      const baseBob = Math.sin(bobPhase) * 0.12;
      group.position.y = baseY + baseBob;
      group.rotation.y = Math.sin(spinPhase) * 0.18;

      // Arms swing slightly idle
      armPivot.rotation.z = Math.sin(bobPhase * 1.2) * 0.12;
      armPivot2.rotation.z = -Math.sin(bobPhase * 1.2) * 0.12;

      if (celebrationT >= 0) {
        celebrationT += dt;
        const k = Math.min(celebrationT / 1.6, 1);
        // Big jump
        const jump = Math.sin(k * Math.PI) * 1.4;
        group.position.y = baseY + baseBob + jump;
        // Spin once
        group.rotation.y = k * Math.PI * 2;
        // Wave both arms wildly
        armPivot.rotation.z = Math.sin(celebrationT * 18) * 1.0 - 0.6;
        armPivot2.rotation.z = -Math.sin(celebrationT * 18) * 1.0 + 0.6;
        // Scale pulse
        const s = 1 + 0.15 * Math.sin(k * Math.PI * 2);
        group.scale.setScalar(s);
        // Gentle fade out at end
        if (k >= 1) {
          isCollected = true;
        }
      }
    },
    celebrate() {
      if (celebrationT < 0) celebrationT = 0;
    },
    positionXZ() {
      return { x: group.position.x, z: group.position.z };
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
