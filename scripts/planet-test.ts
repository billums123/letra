import * as THREE from "three";
import { PlanetWalker, type PlanetSpec } from "../src/engine/planet";
import { SPOT_DIRS, SPOT_ANGLE, BEAM_HEIGHT } from "../src/engine/biomes/sunLayout";
import {
  SATURN_SPOT_DIRS,
  SATURN_SPOT_ANGLE,
  SATURN_SPOT_TRIGGER,
  SATURN_BEAM_HEIGHT,
  SATURN_RADIUS,
  SATURN_AXIS,
  SATURN_CENTER,
} from "../src/engine/biomes/saturnLayout";

const R = 28;
const HOVER = 0.35;
const CENTER = new THREE.Vector3(30, 55, -300);
const spec = (obstacles?: PlanetSpec["obstacles"]): PlanetSpec => ({
  center: CENTER,
  radius: R,
  hover: HOVER,
  obstacles,
});

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

// 1. Touchdown sits exactly on the surface, frame is orthonormal, and
//    at the north pole the tangent axes line up with world axes.
{
  const w = new PlanetWalker(spec(), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1));
  const p = w.point(new THREE.Vector3());
  check("lands on the surface", Math.abs(p.distanceTo(CENTER) - (R + HOVER)) < 1e-9,
    `r=${p.distanceTo(CENTER).toFixed(6)}`);
  check("north-pole frame matches world axes",
    w.east.distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-9 &&
    w.south.distanceTo(new THREE.Vector3(0, 0, 1)) < 1e-9,
    `east=${fmt(w.east)} south=${fmt(w.south)}`);
}

// 2. The camera offset read through the tangent frame is identical to
//    the flat game's arithmetic when standing on the north pole — this
//    is what makes the fly-to-walk handover invisible.
{
  const w = new PlanetWalker(spec(), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1));
  const offset = new THREE.Vector3(0, 7, 9);
  const cam = w.cameraPoint(new THREE.Vector3(), offset);
  const flat = w.point(new THREE.Vector3()).add(offset);
  check("camera matches the flat formula at the pole", cam.distanceTo(flat) < 1e-9,
    `${fmt(cam)} vs ${fmt(flat)}`);
}

// 3. Screen-up (flat -Z) walks AWAY from the camera.
{
  const w = new PlanetWalker(spec(), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1));
  const before = w.dir.clone();
  const southBefore = w.south.clone();
  w.step(0, -1);
  const moved = w.dir.clone().sub(before);
  check("pushing up moves away from the camera", moved.dot(southBefore) < 0,
    `moved·south=${moved.dot(southBefore).toFixed(4)}`);
  check("one unit of input is one unit of arc",
    Math.abs(before.angleTo(w.dir) * R - 1) < 1e-6,
    `arc=${(before.angleTo(w.dir) * R).toFixed(6)}`);
}

// 4. Walk the full circumference in small steps: you come back to
//    exactly where you started, facing the same way.
{
  const w = new PlanetWalker(spec(), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1));
  const start = w.dir.clone();
  const startSouth = w.south.clone();
  const STEPS = 20000;
  const per = (2 * Math.PI * R) / STEPS;
  for (let i = 0; i < STEPS; i++) w.step(0, -per);
  check("a full lap returns to the start", start.angleTo(w.dir) * R < 1e-3,
    `off by ${(start.angleTo(w.dir) * R).toExponential(2)} units`);
  check("a full lap keeps the heading", startSouth.angleTo(w.south) < 1e-4,
    `off by ${startSouth.angleTo(w.south).toExponential(2)} rad`);
  check("frame stays orthonormal after 20k steps",
    Math.abs(w.dir.length() - 1) < 1e-9 &&
    Math.abs(w.south.length() - 1) < 1e-9 &&
    Math.abs(w.east.length() - 1) < 1e-9 &&
    Math.abs(w.dir.dot(w.south)) < 1e-9 &&
    Math.abs(w.dir.dot(w.east)) < 1e-9 &&
    Math.abs(w.south.dot(w.east)) < 1e-9);
}

// 5. A long random wander never leaves the surface.
{
  const w = new PlanetWalker(spec(), new THREE.Vector3(0, 1, 0));
  let worst = 0;
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  const p = new THREE.Vector3();
  // 60fps for five minutes at full speed.
  for (let i = 0; i < 18000; i++) {
    w.step(rnd() * 0.12, rnd() * 0.12);
    w.point(p);
    worst = Math.max(worst, Math.abs(p.distanceTo(CENTER) - (R + HOVER)));
  }
  check("5 minutes of wandering stays on the surface", worst < 1e-6, `worst drift ${worst.toExponential(2)}`);
}

// 6. Orientation puts the avatar's feet on the ground and its nose
//    along its own yaw, anywhere on the sphere.
{
  const w = new PlanetWalker(spec(), new THREE.Vector3(0, 1, 0));
  for (let i = 0; i < 500; i++) w.step(0.1, -0.13);
  const q = w.orientation(new THREE.Quaternion(), 0.7);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const nose = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  check("local up is the surface normal", up.distanceTo(w.dir) < 1e-6, `up=${fmt(up)} dir=${fmt(w.dir)}`);
  check("nose stays tangent to the surface", Math.abs(nose.dot(w.dir)) < 1e-6);
  const expected = w.south.clone().multiplyScalar(Math.cos(0.7)).addScaledVector(w.east, Math.sin(0.7));
  check("yaw 0.7 turns the nose 0.7 within the tangent plane", nose.distanceTo(expected) < 1e-6);
}

// 7. Obstacles push you out and keep you out.
{
  const centre = new THREE.Vector3(0, 1, 0.06).normalize();
  const w = new PlanetWalker(spec([{ dir: centre, angular: 0.2 }]), new THREE.Vector3(0, 1, 0));
  let minAngle = Infinity;
  for (let i = 0; i < 400; i++) {
    w.step(0, 0.15); // walk straight at it
    minAngle = Math.min(minAngle, w.dir.angleTo(centre));
  }
  check("an obstacle is never entered", minAngle >= 0.2 - 1e-6, `closest ${minAngle.toFixed(6)} rad`);
}

// 8. Every point on the star can see a way home. A beacon `BEAM_HEIGHT`
//    tall, viewed from a camera 7 units up, clears the horizon at
//    acos(R/(R+h)) for each — so the spots have to be laid out with no
//    gap wider than that between them. Checked over a dense sampling
//    rather than by eye, because a gap here strands a four-year-old on
//    a featureless orange sphere.
{
  const CAM_H = 7;
  const seeFromCam = Math.acos(R / (R + CAM_H));
  const seeToBeaconTop = Math.acos(R / (R + BEAM_HEIGHT - 0.6));
  const reach = seeFromCam + seeToBeaconTop;
  let worst = 0;
  let worstAt = new THREE.Vector3();
  const N = 4000;
  const probe = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    // Fibonacci sphere — even coverage without clustering at the poles.
    const y = 1 - (2 * i + 1) / N;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * Math.PI * (3 - Math.sqrt(5));
    probe.set(Math.cos(th) * r, y, Math.sin(th) * r);
    let nearest = Infinity;
    for (const d of SPOT_DIRS) nearest = Math.min(nearest, probe.angleTo(d));
    if (nearest > worst) {
      worst = nearest;
      worstAt = probe.clone();
    }
  }
  // With margin: a beacon whose last pixel is technically over the
  // horizon is no use to anyone.
  check("a beacon is in sight from everywhere on the star", worst < reach * 0.85,
    `worst gap ${deg(worst)}° at ${fmt(worstAt)}, beacons reach ${deg(reach)}°`);
  // The arrival beacon has to be in shot on touchdown, but not so
  // close that the kid trips over the way home before they have seen
  // where they are.
  const pole = new THREE.Vector3(0, 1, 0);
  const arrival = pole.angleTo(SPOT_DIRS[0]);
  check("the arrival view has a beacon in it", arrival < reach * 0.85,
    `${deg(arrival)}° from the landing pole, beacons reach ${deg(reach)}°`);
  check("the arrival beacon is a real drive away",
    (arrival - SPOT_ANGLE * 0.75) * R > 20,
    `${((arrival - SPOT_ANGLE * 0.75) * R).toFixed(1)} units of arc to its rim`);
  check("no two sunspots overlap",
    SPOT_DIRS.every((a, i) => SPOT_DIRS.every((b, j) => i === j || a.angleTo(b) > SPOT_ANGLE * 2)));
}

// 9. Saturn's portals get the same treatment as the sun's — the
//    layout is the only thing standing between a kid and a featureless
//    planet with no way off it.
{
  const R = SATURN_RADIUS;
  const reach =
    Math.acos(R / (R + 7)) + Math.acos(R / (R + SATURN_BEAM_HEIGHT - 0.6));
  let worst = 0;
  const N = 4000;
  const probe = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const y = 1 - (2 * i + 1) / N;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * Math.PI * (3 - Math.sqrt(5));
    probe.set(Math.cos(th) * r, y, Math.sin(th) * r);
    let nearest = Infinity;
    for (const d of SATURN_SPOT_DIRS) nearest = Math.min(nearest, probe.angleTo(d));
    worst = Math.max(worst, nearest);
  }
  check("a beacon is in sight from everywhere on Saturn", worst < reach * 0.85,
    `worst gap ${deg(worst)}°, beacons reach ${deg(reach)}°`);
  const pole = new THREE.Vector3(0, 1, 0);
  const arrival = pole.angleTo(SATURN_SPOT_DIRS[0]);
  check("Saturn's arrival view has a beacon in it", arrival < reach * 0.85,
    `${deg(arrival)}° from the landing pole`);
  check("Saturn's arrival beacon is a real drive away",
    (arrival - SATURN_SPOT_TRIGGER) * R > 20,
    `${((arrival - SATURN_SPOT_TRIGGER) * R).toFixed(1)} units of arc to its rim`);
  check("no two Saturn portals overlap",
    SATURN_SPOT_DIRS.every((a, i) =>
      SATURN_SPOT_DIRS.every((b, j) => i === j || a.angleTo(b) > SATURN_SPOT_ANGLE * 2)));
  // The rings are the reason to go, and they are only a view if the
  // landing spot is well off Saturn's own pole. On the pole they lie
  // flat on the horizon all the way round, which is the dullest
  // arrangement available.
  const offAxis = pole.angleTo(SATURN_AXIS);
  check("you land well off Saturn's pole, so the rings cross the sky",
    offAxis > 0.6 && offAxis < 1.2, `${deg(offAxis)}° off the ring axis`);
  // Everything has to be inside the camera's far plane from
  // everywhere else, or a world vanishes when you look back at it.
  const FAR = 900;
  const ocean = new THREE.Vector3(0, 0, 0);
  const sun = new THREE.Vector3(30, 55, -300);
  const legs: Array<[string, number]> = [
    ["ocean → Saturn", ocean.distanceTo(SATURN_CENTER) + R],
    ["sun → Saturn", sun.distanceTo(SATURN_CENTER) + R],
    ["Saturn → ocean", SATURN_CENTER.distanceTo(ocean) + 92],
  ];
  check("every world is inside the camera's far plane from every other",
    legs.every(([, d]) => d < FAR),
    legs.map(([n, d]) => `${n} ${d.toFixed(0)}`).join(", ") + ` (far ${FAR})`);
}

function deg(rad: number) {
  return (rad * 180 / Math.PI).toFixed(1);
}

function fmt(v: THREE.Vector3) {
  return `(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})`;
}

console.log(failures === 0 ? "\nall good" : `\n${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
