import * as THREE from "three";
import {
  buildLetterCharacter,
  distanceXZ,
  type LetterCharacter,
  type LetterSharedAssets,
  type loadFont,
} from "./letters";
import { pickClearSpawn, type Obstacle } from "./world";
import type { Surface } from "./surface";

// Planting letters on whatever the kid is standing on.
//
// Every game mode used to do the same four things by hand — pick a
// clear (x, z), sample the terrain for a y, drop the character there,
// and measure the kid's distance across the ground. All four assume a
// ground plane, and half the places a kid can now be are spheres.
//
// A planted letter is the same letter either way. On flat ground it is
// exactly what it always was. On a sphere it sits inside a pivot that
// stands the local tangent plane up on the surface, and the character
// goes on behaving as though it were on flat ground inside it: its
// local +Y is straight up out of the planet, its local x/z are metres
// east and south along the surface. That is what lets the idle bob,
// the celebrate jump, and the whole dance-party choreography run
// unchanged on a star.

type Font = Awaited<ReturnType<typeof loadFont>>;

// Somewhere a letter can stand.
export type Spot =
  | { kind: "flat"; x: number; z: number }
  // A unit direction from the sphere's centre.
  | { kind: "planet"; dir: THREE.Vector3 };

// Just enough of the engine to plant something in it. Structural so a
// test can plant letters without building a renderer.
export type FieldHost = {
  scene: THREE.Scene;
  addActor: (actor: { update: (dt: number, t: number) => void }) => void;
  removeActor: (actor: { update: (dt: number, t: number) => void }) => void;
  terrainHeight: ((x: number, z: number) => number) | null;
  isWalkable: ((x: number, z: number) => boolean) | null;
  obstacles: Obstacle[];
};

export type FieldLetter = {
  // Uppercase glyph, whatever case is being displayed.
  letter: string;
  character: LetterCharacter;
  // Where the character rests in its own frame. On flat ground that is
  // its world position; on a sphere it is (0, radius, 0) inside the
  // pivot, and x/z offsets from it are tangential metres. Dance
  // choreography reads this instead of assuming a ground plane.
  home: { x: number; y: number; z: number };
  // Ground distance from a world-space point, in world units: across
  // the floor on flat ground, along the surface on a sphere.
  distanceTo: (from: THREE.Vector3) => number;
  // Turn to look at a world-space point — always the camera.
  faceCamera: (cameraWorld: THREE.Vector3) => void;
  // World-space position of the letter's feet.
  worldPos: (out?: THREE.Vector3) => THREE.Vector3;
  // A world point expressed in this letter's own frame. On flat ground
  // that is the point unchanged; on a sphere it is metres east/south
  // along the surface and metres up out of it. Choreography that needs
  // to know which way something else is — the dance hop, which steps
  // toward the kid — asks in these terms and works on both.
  localOf: (world: THREE.Vector3, out?: THREE.Vector3) => THREE.Vector3;
  // Re-plant somewhere else on the same surface (the dance ring).
  moveTo: (spot: Spot) => void;
  // Take it out of the scene and free its geometry.
  remove: () => void;
};

// Letters sit a hair proud of the shell so their ground glow doesn't
// fight the surface it is lying on.
const SURFACE_LIFT = 0.05;

const UP = new THREE.Vector3(0, 1, 0);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

export function plantLetter(
  host: FieldHost,
  font: Font,
  surface: Surface,
  spot: Spot,
  opts: { letter: string; lowercase: boolean; shared?: LetterSharedAssets },
): FieldLetter {
  if (surface.kind === "flat" || spot.kind === "flat") {
    return plantOnGround(host, font, spot as Extract<Spot, { kind: "flat" }>, opts);
  }
  return plantOnPlanet(host, font, surface.spec, spot, opts);
}

function plantOnGround(
  host: FieldHost,
  font: Font,
  spot: Extract<Spot, { kind: "flat" }>,
  opts: { letter: string; lowercase: boolean; shared?: LetterSharedAssets },
): FieldLetter {
  const baseY = host.terrainHeight?.(spot.x, spot.z) ?? 0;
  const character = buildLetterCharacter(font, {
    letter: opts.letter,
    lowercase: opts.lowercase,
    baseY,
    shared: opts.shared,
  });
  const g = character.group;
  g.position.set(spot.x, baseY, spot.z);
  host.scene.add(g);
  host.addActor(character);
  const home = { x: spot.x, y: baseY, z: spot.z };
  return {
    letter: character.letter,
    character,
    home,
    distanceTo: (from) => distanceXZ(from, character.positionXZ()),
    faceCamera: (cam) => character.faceTowards(cam.x, cam.z),
    worldPos: (out = new THREE.Vector3()) => out.copy(g.position),
    localOf: (world, out = new THREE.Vector3()) => out.copy(world),
    moveTo(next) {
      if (next.kind !== "flat") return;
      const y = host.terrainHeight?.(next.x, next.z) ?? 0;
      character.setBaseY(y);
      g.position.set(next.x, y, next.z);
      home.x = next.x;
      home.y = y;
      home.z = next.z;
    },
    remove() {
      host.removeActor(character);
      host.scene.remove(g);
      (g.userData.dispose as (() => void) | undefined)?.();
    },
  };
}

function plantOnPlanet(
  host: FieldHost,
  font: Font,
  spec: { center: THREE.Vector3; radius: number },
  spot: Extract<Spot, { kind: "planet" }>,
  opts: { letter: string; lowercase: boolean; shared?: LetterSharedAssets },
): FieldLetter {
  const baseY = spec.radius + SURFACE_LIFT;
  const character = buildLetterCharacter(font, {
    letter: opts.letter,
    lowercase: opts.lowercase,
    baseY,
    shared: opts.shared,
  });
  // The pivot carries the surface frame; the character lives inside it
  // at the same height above local zero that it would have above flat
  // ground, so everything it does to its own transform still means
  // what it meant on the meadow.
  const pivot = new THREE.Group();
  pivot.position.copy(spec.center);
  const dir = spot.dir.clone().normalize();
  pivot.quaternion.setFromUnitVectors(UP, dir);
  character.group.position.set(0, baseY, 0);
  pivot.add(character.group);
  host.scene.add(pivot);
  host.addActor(character);

  // Cached rather than going through worldToLocal: the pivot never
  // moves under its own steam, and this runs once per letter per
  // frame for every letter on the world.
  const invPivot = pivot.quaternion.clone().invert();
  const home = { x: 0, y: baseY, z: 0 };

  return {
    letter: character.letter,
    character,
    home,
    distanceTo(from) {
      // Along the surface, not through it. Using the straight line
      // would quietly shrink the collection radius by however far the
      // avatar hovers, and the arc is the distance the kid actually
      // drove.
      tmpA.copy(from).sub(spec.center).normalize();
      return tmpA.angleTo(dir) * spec.radius;
    },
    faceCamera(cam) {
      tmpB.copy(cam).sub(spec.center).applyQuaternion(invPivot);
      character.faceTowards(tmpB.x, tmpB.z);
    },
    worldPos: (out = new THREE.Vector3()) =>
      out.copy(spec.center).addScaledVector(dir, baseY),
    localOf: (world, out = new THREE.Vector3()) =>
      out.copy(world).sub(spec.center).applyQuaternion(invPivot),
    moveTo(next) {
      if (next.kind !== "planet") return;
      dir.copy(next.dir).normalize();
      pivot.quaternion.setFromUnitVectors(UP, dir);
      invPivot.copy(pivot.quaternion).invert();
      character.setBaseY(baseY);
      character.group.position.set(0, baseY, 0);
    },
    remove() {
      host.removeActor(character);
      pivot.remove(character.group);
      host.scene.remove(pivot);
      (character.group.userData.dispose as (() => void) | undefined)?.();
    },
  };
}

// ── Choosing where to put one ───────────────────────────────────────

// A patch of a sphere that is not ground you may leave a letter on.
export type KeepOut = { dir: THREE.Vector3; angular: number };

export type PlanetSpawnOptions = {
  radius: number;
  // Portals, and anything else that would either swallow a letter or
  // swallow the kid who came for it.
  keepOut: readonly KeepOut[];
  // Letters already planted, as cones, so two never land on top of
  // each other.
  taken: KeepOut[];
  // The point to scatter around — the kid, usually.
  around: THREE.Vector3;
  center: THREE.Vector3;
  // How far a letter may be from `around`, measured along the surface.
  minArc: number;
  maxArc: number;
  rng: () => number;
};

// Pick a spot on a sphere, at a chosen range from the kid, that is not
// inside a portal and not on top of another letter.
//
// The range is sampled directly rather than by rejection: pick the
// angle out from `around`, then the bearing around it. A sphere is
// small enough that rejection sampling for distance would spend most
// of its attempts on the far side.
export function pickPlanetSpawn(opts: PlanetSpawnOptions): THREE.Vector3 {
  const { radius, keepOut, taken, center, minArc, maxArc, rng } = opts;
  const from = tmpA.copy(opts.around).sub(center).normalize().clone();
  // Two axes perpendicular to `from`, to swing the bearing around.
  const east = perpendicular(from);
  const north = from.clone().cross(east).normalize();
  const minA = Math.min(minArc / radius, Math.PI * 0.9);
  const maxA = Math.min(Math.max(maxArc / radius, minA + 0.02), Math.PI * 0.95);

  const at = (a: number, bearing: number) =>
    new THREE.Vector3()
      .addScaledVector(from, Math.cos(a))
      .addScaledVector(east, Math.sin(a) * Math.cos(bearing))
      .addScaledVector(north, Math.sin(a) * Math.sin(bearing))
      .normalize();

  const blocked = (dir: THREE.Vector3, cones: readonly KeepOut[]) => {
    for (const c of cones) if (dir.angleTo(c.dir) < c.angular) return true;
    return false;
  };

  for (let attempt = 0; attempt < 200; attempt++) {
    const dir = at(minA + rng() * (maxA - minA), rng() * Math.PI * 2);
    if (blocked(dir, keepOut)) continue;
    if (blocked(dir, taken)) continue;
    return dir;
  }
  // Deterministic sweep. Spacing between letters is a nicety; being
  // outside a portal is not, so the fallback gives up the first and
  // never the second.
  for (let pass = 0; pass < 2; pass++) {
    for (let ri = 0; ri < 10; ri++) {
      const a = minA + (ri / 9) * (maxA - minA);
      for (let bi = 0; bi < 24; bi++) {
        const dir = at(a, (bi / 24) * Math.PI * 2);
        if (blocked(dir, keepOut)) continue;
        if (pass === 0 && blocked(dir, taken)) continue;
        return dir;
      }
    }
  }
  // Every direction at every range is inside a portal, which would
  // mean a world made entirely of exits. Put it on the far side and
  // let the sweep above be the thing that gets fixed.
  return from.clone().negate();
}

// Stand a world-space prop up on the surface under `at`: its local +Y
// ends up pointing out of the ground, so anything that thinks in terms
// of "up" — a confetti burst's gravity, a creature's walk — carries on
// meaning it. A no-op on flat ground, where +Y already is up.
export function orientToSurface(
  obj: THREE.Object3D,
  surface: Surface,
  at: THREE.Vector3,
): void {
  if (surface.kind === "flat") return;
  tmpA.copy(at).sub(surface.spec.center).normalize();
  obj.quaternion.setFromUnitVectors(UP, tmpA);
}

// Any unit vector at right angles to `v`.
function perpendicular(v: THREE.Vector3): THREE.Vector3 {
  const out = new THREE.Vector3(0, 1, 0).cross(v);
  if (out.lengthSq() < 1e-6) out.set(1, 0, 0).cross(v);
  return out.normalize();
}

// The flat-world equivalent, so a game can ask for a spot without
// branching on which kind of world it is standing on.
export function pickSpot(
  host: FieldHost,
  surface: Surface,
  opts: {
    taken: { x: number; z: number; radius: number }[];
    planetTaken: KeepOut[];
    keepOut: readonly KeepOut[];
    around: THREE.Vector3;
    // How far out to scatter, in world units. The two surfaces measure
    // it from different places and deliberately so: the flat world is
    // a disc with the interesting things near the middle, so range is
    // from the origin there; a sphere has no middle, so it is measured
    // from the kid.
    minRange: number;
    maxRange: number;
    selfRadius?: number;
    rng: () => number;
  },
): Spot {
  if (surface.kind === "flat") {
    const p = pickClearSpawn(
      host.obstacles,
      opts.taken,
      { minRadius: opts.minRange, maxRadius: opts.maxRange },
      opts.selfRadius ?? 1,
      opts.rng,
      host.isWalkable,
    );
    opts.taken.push({ x: p.x, z: p.z, radius: opts.selfRadius ?? 1 });
    return { kind: "flat", x: p.x, z: p.z };
  }
  const dir = pickPlanetSpawn({
    radius: surface.spec.radius,
    center: surface.spec.center,
    keepOut: opts.keepOut,
    taken: opts.planetTaken,
    around: opts.around,
    minArc: opts.minRange,
    maxArc: opts.maxRange,
    rng: opts.rng,
  });
  // Keep-out cone for the next letter: the same metres of clearance a
  // flat-world letter gets, expressed as an angle on this sphere.
  opts.planetTaken.push({
    dir,
    angular: ((opts.selfRadius ?? 1) + 1.2) / surface.spec.radius,
  });
  return { kind: "planet", dir };
}
