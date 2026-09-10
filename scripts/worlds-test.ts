import { readFileSync } from "node:fs";
import * as THREE from "three";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import {
  orientToSurface,
  pickPlanetSpawn,
  plantLetter,
  type KeepOut,
} from "../src/engine/letterField";
import { LEG_SIZES, legSlice } from "../src/games/alphabetLegs";
import { SPOT_ANGLE, SPOT_DIRS } from "../src/engine/biomes/sunLayout";
import {
  SATURN_AXIS,
  SATURN_CENTER,
  SATURN_RADIUS,
  SATURN_SPOT_ANGLE,
  SATURN_SPOT_DIRS,
} from "../src/engine/biomes/saturnLayout";
import {
  JUPITER_CENTER,
  JUPITER_RADIUS,
  JUPITER_SPOT_ANGLE,
  JUPITER_SPOT_DIRS,
} from "../src/engine/biomes/jupiterLayout";

// Putting letters on a sphere.
//
// The rule that matters most is the one a kid would find the hard way: a
// letter inside a portal is a letter you cannot pick up, because touching
// it sends you home. So the placement is checked against every real
// world's real portal layout rather than a made-up sphere, and it is
// checked in the fallback path too — the one that runs when the random
// pass has been starved and is exactly where a "just put it anywhere"
// bug would hide.

const SUN_CENTER = new THREE.Vector3(30, 55, -300);
const SUN_RADIUS = 28;

const WORLDS = [
  {
    name: "sun",
    center: SUN_CENTER,
    radius: SUN_RADIUS,
    keepOut: SPOT_DIRS.map((dir) => ({ dir, angular: SPOT_ANGLE * 1.35 })) as KeepOut[],
  },
  {
    name: "Saturn",
    center: SATURN_CENTER,
    radius: SATURN_RADIUS,
    keepOut: SATURN_SPOT_DIRS.map((dir) => ({
      dir,
      angular: SATURN_SPOT_ANGLE * 1.35,
    })) as KeepOut[],
  },
  {
    name: "Jupiter",
    center: JUPITER_CENTER,
    radius: JUPITER_RADIUS,
    keepOut: JUPITER_SPOT_DIRS.map((dir) => ({
      dir,
      angular: JUPITER_SPOT_ANGLE * 1.35,
    })) as KeepOut[],
  },
];

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

// Deterministic PRNG so a failure is reproducible.
function rngFrom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x9e3779b9) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const inAnyCone = (dir: THREE.Vector3, cones: readonly KeepOut[]) =>
  cones.some((c) => dir.angleTo(c.dir) < c.angular);

// 1. A whole session's worth of letters, on every world, and not one of
//    them inside a portal.
{
  let worst = Infinity;
  let planted = 0;
  for (const w of WORLDS) {
    const rng = rngFrom(1234);
    for (let round = 0; round < 120; round++) {
      // Wherever the kid happens to be standing.
      const at = new THREE.Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1)
        .normalize()
        .multiplyScalar(w.radius)
        .add(w.center);
      const taken: KeepOut[] = [];
      for (let i = 0; i < 6; i++) {
        const dir = pickPlanetSpawn({
          radius: w.radius,
          center: w.center,
          keepOut: w.keepOut,
          taken,
          around: at,
          minArc: 7,
          maxArc: 24,
          rng,
        });
        planted++;
        for (const c of w.keepOut) worst = Math.min(worst, dir.angleTo(c.dir) - c.angular);
        taken.push({ dir, angular: 2.2 / w.radius });
      }
    }
  }
  check("no letter lands in a portal", worst > 0,
    `${planted} placed, closest cleared its portal by ${worst.toFixed(4)} rad`);
}

// 2. Letters land the distance away they were asked for, measured along
//    the ground rather than through the planet.
{
  const w = WORLDS[0];
  const rng = rngFrom(99);
  const at = new THREE.Vector3(0, 1, 0).multiplyScalar(w.radius).add(w.center);
  let minSeen = Infinity;
  let maxSeen = 0;
  for (let i = 0; i < 400; i++) {
    const dir = pickPlanetSpawn({
      radius: w.radius,
      center: w.center,
      keepOut: w.keepOut,
      taken: [],
      around: at,
      minArc: 7,
      maxArc: 20,
      rng,
    });
    const arc = dir.angleTo(new THREE.Vector3(0, 1, 0)) * w.radius;
    minSeen = Math.min(minSeen, arc);
    maxSeen = Math.max(maxSeen, arc);
  }
  check("letters land inside the range they were asked for",
    minSeen > 6.9 && maxSeen < 20.1,
    `${minSeen.toFixed(2)}..${maxSeen.toFixed(2)} units of arc, asked for 7..20`);
}

// 3. Two letters never land on top of each other.
{
  const w = WORLDS[1];
  const rng = rngFrom(7);
  const at = new THREE.Vector3(0, 1, 0).multiplyScalar(w.radius).add(w.center);
  let closest = Infinity;
  for (let round = 0; round < 60; round++) {
    const taken: KeepOut[] = [];
    const dirs: THREE.Vector3[] = [];
    for (let i = 0; i < 6; i++) {
      const dir = pickPlanetSpawn({
        radius: w.radius,
        center: w.center,
        keepOut: w.keepOut,
        taken,
        around: at,
        minArc: 6,
        maxArc: 22,
        rng,
      });
      dirs.push(dir);
      taken.push({ dir, angular: 2.2 / w.radius });
    }
    for (let i = 0; i < dirs.length; i++) {
      for (let j = i + 1; j < dirs.length; j++) {
        closest = Math.min(closest, dirs[i].angleTo(dirs[j]) * w.radius);
      }
    }
  }
  // Collection radius is 1.6-1.7 units, so anything past ~2.2 means two
  // letters can never be picked up from one standing spot.
  check("letters keep out of each other's collection radius", closest > 2.1,
    `closest pair ${closest.toFixed(2)} units apart`);
}

// 4. Starve the random pass — every letter already placed, no room left —
//    and the deterministic fallback must still refuse to use a portal.
{
  const w = WORLDS[0];
  const rng = rngFrom(3);
  const at = new THREE.Vector3(0, 1, 0).multiplyScalar(w.radius).add(w.center);
  // One enormous "taken" cone covering the whole band. The random pass
  // cannot succeed; the sweep has to give up spacing, not safety.
  const taken: KeepOut[] = [{ dir: new THREE.Vector3(0, 1, 0), angular: Math.PI }];
  let clear = true;
  for (let i = 0; i < 40; i++) {
    const dir = pickPlanetSpawn({
      radius: w.radius,
      center: w.center,
      keepOut: w.keepOut,
      taken,
      around: at,
      minArc: 7,
      maxArc: 20,
      rng,
    });
    if (inAnyCone(dir, w.keepOut)) clear = false;
  }
  check("the fallback gives up spacing before it gives up safety", clear);
}

// 5. A planted letter stands on the surface, and its own idea of "up" is
//    the way out of the planet. That is what makes the idle bob, the
//    celebrate jump and the whole dance choreography work unchanged on a
//    sphere — they all move along local +Y.
{
  const json = JSON.parse(
    readFileSync("public/fonts/helvetiker_bold.typeface.json", "utf8"),
  );
  const font = new FontLoader().parse(json);
  const scene = new THREE.Scene();
  const host = {
    scene,
    addActor() {},
    removeActor() {},
    terrainHeight: null,
    isWalkable: null,
    obstacles: [],
  };
  const w = WORLDS[1];
  const spec = { id: w.name, center: w.center, radius: w.radius, hover: 0.35 };
  const surface = { kind: "planet" as const, id: w.name, spec };
  const dir = SATURN_AXIS.clone();
  const letter = plantLetter(host, font, surface, { kind: "planet", dir }, {
    letter: "A",
    lowercase: false,
  });
  scene.updateMatrixWorld(true);

  const feet = letter.character.group.getWorldPosition(new THREE.Vector3());
  const height = feet.distanceTo(w.center) - w.radius;
  check("a letter stands on the surface", Math.abs(height - 0.05) < 1e-6,
    `${height.toFixed(4)} units proud of the shell`);

  const outward = feet.clone().sub(w.center).normalize();
  check("the letter is over the spot it was planted on",
    outward.distanceTo(dir) < 1e-6);

  // Local +Y through the letter's own matrix.
  const localUp = new THREE.Vector3(0, 1, 0)
    .applyQuaternion(letter.character.group.getWorldQuaternion(new THREE.Quaternion()));
  check("its up is the way out of the planet", localUp.angleTo(dir) < 1e-6,
    `${((localUp.angleTo(dir) * 180) / Math.PI).toFixed(4)}° off`);

  // A bob of half a unit must lift it half a unit off the ground, in the
  // direction the ground says is up.
  letter.character.group.position.y += 0.5;
  scene.updateMatrixWorld(true);
  const lifted = letter.character.group.getWorldPosition(new THREE.Vector3());
  check("bobbing lifts it off the surface, not sideways",
    Math.abs(lifted.distanceTo(w.center) - w.radius - 0.55) < 1e-6);
  letter.character.group.position.y -= 0.5;

  // Distance is measured along the ground. Stand a known arc away and the
  // answer has to be that arc, not the chord through the planet.
  const arc = 12;
  const east = new THREE.Vector3(0, 1, 0).cross(dir).normalize();
  const a = arc / w.radius;
  const standing = new THREE.Vector3()
    .addScaledVector(dir, Math.cos(a))
    .addScaledVector(east, Math.sin(a))
    .normalize()
    .multiplyScalar(w.radius + 0.35)
    .add(w.center);
  check("distance is measured along the ground", Math.abs(letter.distanceTo(standing) - arc) < 1e-4,
    `${letter.distanceTo(standing).toFixed(4)} vs ${arc} units of arc`);
  // Why it has to be the arc and not the straight line: the avatar
  // hovers above the surface and the letter sits on it, so at the
  // range that decides a pickup the chord is measurably longer than
  // the ground distance. Using it would quietly shrink the collection
  // radius by that much, on every planet, forever.
  const near = 1.6 / w.radius;
  const closeBy = new THREE.Vector3()
    .addScaledVector(dir, Math.cos(near))
    .addScaledVector(east, Math.sin(near))
    .normalize()
    .multiplyScalar(w.radius + 0.35)
    .add(w.center);
  const chord = closeBy.distanceTo(feet);
  check("and not the straight line, which the hover makes longer",
    letter.distanceTo(closeBy) < chord - 0.02,
    `ground ${letter.distanceTo(closeBy).toFixed(3)} vs chord ${chord.toFixed(3)}`);

  // localOf is what the dance uses to work out which way the kid is.
  // The frame's roll about the surface normal is arbitrary, so the
  // invariant is the decomposition, not particular axes: how far up
  // and how far along the ground.
  const local = letter.localOf(standing);
  const up = (w.radius + 0.35) * Math.cos(a);
  const along = (w.radius + 0.35) * Math.sin(a);
  check("a world point maps into the letter's own frame",
    Math.abs(local.y - up) < 1e-3 && Math.abs(Math.hypot(local.x, local.z) - along) < 1e-3,
    `up ${local.y.toFixed(3)} (want ${up.toFixed(3)}), along ${Math.hypot(local.x, local.z).toFixed(3)} (want ${along.toFixed(3)})`);

  letter.remove();
  check("removing a letter takes it out of the scene", scene.children.length === 0,
    `${scene.children.length} left`);
}

// 6. Standing a prop up on a surface.
{
  const w = WORLDS[2];
  const obj = new THREE.Object3D();
  const at = new THREE.Vector3(0.3, -0.5, 0.8)
    .normalize()
    .multiplyScalar(w.radius)
    .add(w.center);
  const spec = { id: w.name, center: w.center, radius: w.radius };
  orientToSurface(obj, { kind: "planet", id: w.name, spec }, at);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(obj.quaternion);
  const outward = at.clone().sub(w.center).normalize();
  check("a prop's up points out of the planet", up.angleTo(outward) < 1e-6);

  const flat = new THREE.Object3D();
  orientToSurface(flat, { kind: "flat" }, at);
  check("and is left alone on flat ground", flat.quaternion.equals(new THREE.Quaternion()));
}

// 7. The alphabet is dealt out whole, and the finale comes home.
//
// Legs alternate sea / planet / sea, because the only way off a planet is
// the pool home. An odd number of legs is therefore the thing that keeps
// the dance party in the ocean.
{
  let dealt = 0;
  const dealtPer: number[] = [];
  for (let leg = 0; leg < LEG_SIZES.length; leg++) {
    const { from, to } = legSlice(leg, dealt, 26);
    dealtPer.push(to - from);
    dealt = to;
  }
  check("the legs deal out the whole alphabet", dealt === 26, `${dealtPer.join("+")} = ${dealt}`);
  check("and no leg is longer than a four-year-old's patience",
    dealtPer.every((n) => n > 0 && n <= 7), dealtPer.join(", "));
  check("an odd number of legs, so the finale lands back in the sea",
    LEG_SIZES.length % 2 === 1, `${LEG_SIZES.length} legs`);
  // One past the end must not deal a sixth leg's worth of nothing.
  const past = legSlice(LEG_SIZES.length, 26, 26);
  check("dealing past Z deals nothing", past.from === past.to);
}

console.log(failures === 0 ? "\nall good" : `\n${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
