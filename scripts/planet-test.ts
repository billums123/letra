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
import {
  JUPITER_SPOT_DIRS,
  JUPITER_SPOT_ANGLE,
  JUPITER_SPOT_TRIGGER,
  JUPITER_BEAM_HEIGHT,
  JUPITER_RADIUS,
  JUPITER_AXIS,
  JUPITER_CENTER,
  GRS_DIR,
  GRS_HALF_WIDTH,
  GRS_HALF_HEIGHT,
  GRS_DRIFT,
  CAM_UP,
  CAM_BACK,
  HOVER as J_HOVER,
  MOONS,
} from "../src/engine/biomes/jupiterLayout";

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
}

// 10. Jupiter. Same coverage rules as the other two, on a planet half
//     again as wide — which is exactly why it gets six portals rather
//     than five. Six points on a sphere can be spaced so nothing is
//     more than 54.7 degrees from one; five cannot do better than 63,
//     and 63 degrees of arc on a 52-unit ball is a very long time to
//     be driving with nothing on the horizon.
{
  const R = JUPITER_RADIUS;
  const reach =
    Math.acos(R / (R + 7)) + Math.acos(R / (R + JUPITER_BEAM_HEIGHT - 0.6));
  let worst = 0;
  const N = 4000;
  const probe = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const y = 1 - (2 * i + 1) / N;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * Math.PI * (3 - Math.sqrt(5));
    probe.set(Math.cos(th) * r, y, Math.sin(th) * r);
    let nearest = Infinity;
    for (const d of JUPITER_SPOT_DIRS) nearest = Math.min(nearest, probe.angleTo(d));
    worst = Math.max(worst, nearest);
  }
  check("a beacon is in sight from everywhere on Jupiter", worst < reach * 0.85,
    `worst gap ${deg(worst)}°, beacons reach ${deg(reach)}°`);
  const pole = new THREE.Vector3(0, 1, 0);
  const arrival = pole.angleTo(JUPITER_SPOT_DIRS[0]);
  check("Jupiter's arrival view has a beacon in it", arrival < reach * 0.85,
    `${deg(arrival)}° from the landing pole`);
  check("Jupiter's arrival beacon is a real drive away",
    (arrival - JUPITER_SPOT_TRIGGER) * R > 20,
    `${((arrival - JUPITER_SPOT_TRIGGER) * R).toFixed(1)} units of arc to its rim`);
  check("no two Jupiter portals overlap",
    JUPITER_SPOT_DIRS.every((a, i) =>
      JUPITER_SPOT_DIRS.every((b, j) => i === j || a.angleTo(b) > JUPITER_SPOT_ANGLE * 2)));
  // Jupiter is bigger than Saturn, which is the entire pitch. If that
  // ever stops being true the world has lost its reason to exist.
  check("Jupiter is the biggest thing you can stand on",
    JUPITER_RADIUS > SATURN_RADIUS && JUPITER_RADIUS > 28,
    `Jupiter ${JUPITER_RADIUS}, Saturn ${SATURN_RADIUS}, sun 28`);
  // Bands are only a view if the landing spot is well off the axis
  // they are drawn around — on the pole they ring the horizon evenly
  // and the planet reads as a plain ball.
  const offAxis = pole.angleTo(JUPITER_AXIS);
  check("you land well off Jupiter's pole, so the bands cross the sky",
    offAxis > 0.6 && offAxis < 1.2, `${deg(offAxis)}° off the band axis`);
  // The Great Red Spot has to be in shot when the kid touches down —
  // it is the thing that says which planet this is — without sitting
  // on top of the way home.
  // Measured from the camera, not from the avatar's feet. The eye
  // trails CAM_BACK behind and CAM_UP above, which tips its own
  // sub-point back the way you came — so the horizon in front of you
  // is nearer than a measurement taken at the avatar says it is. A
  // storm that passes the naive test can still be entirely behind the
  // limb of the planet in the actual picture, which is precisely what
  // the first placement turned out to be.
  const camR = Math.hypot(R + J_HOVER + CAM_UP, CAM_BACK);
  const camTilt = Math.atan2(CAM_BACK, R + J_HOVER + CAM_UP);
  // Arrivals face -Z, so the camera trails toward +Z.
  const camSub = new THREE.Vector3(0, Math.cos(camTilt), Math.sin(camTilt));
  const horizon = Math.acos(R / camR);

  // The storm rides its belt, so where it is depends on when you
  // arrive. What can be guaranteed is the belt: it has to pass close
  // enough to the landing spot that a kid who stands still, or drives
  // a little way, meets it. Walk the ring it travels and find its
  // closest approach to the arrival camera.
  const beltAngle = Math.acos(Math.min(1, Math.abs(GRS_DIR.dot(JUPITER_AXIS))));
  let closest = Infinity;
  let closestBearing = 0;
  {
    const q = new THREE.Quaternion();
    const probe = new THREE.Vector3();
    for (let i = 0; i < 720; i++) {
      q.setFromAxisAngle(JUPITER_AXIS, (i / 720) * Math.PI * 2);
      probe.copy(GRS_DIR).applyQuaternion(q);
      const a = camSub.angleTo(probe);
      if (a < closest) {
        closest = a;
        closestBearing = Math.atan2(probe.x, -probe.z);
      }
    }
  }
  // The short axis is the one that might be pointing at the viewer,
  // so it is the honest bound on how much of the storm is in view.
  const nearEdge = closest - GRS_HALF_HEIGHT;
  check("the Great Red Spot's belt comes into the arrival view",
    nearEdge < horizon * 0.6,
    `closest approach ${deg(closest)}° from the camera, near edge ${deg(nearEdge)}°, horizon ${deg(horizon)}°`);
  // And when it does, it is in front of the camera rather than off to
  // the side of it.
  const HALF_FOV = 43 * Math.PI / 180;
  check("and passes in front of you, not off your shoulder",
    Math.abs(closestBearing) < HALF_FOV,
    `${deg(Math.abs(closestBearing))}° off the arrival bearing at its closest`);
  // A belt that runs too near a pole would smear the storm over it and
  // wrap it round itself.
  check("the Great Red Spot's belt stays clear of both poles",
    beltAngle - GRS_HALF_WIDTH > 0.35 && beltAngle + GRS_HALF_WIDTH < Math.PI - 0.35,
    `belt sits ${deg(beltAngle)}° off the axis, storm reaches ${deg(GRS_HALF_WIDTH)}°`);
  // Catchable. A landmark that outruns the boat is not a landmark, it
  // is a tease — and the boat does 7.
  const beltSpeed = Math.abs(GRS_DRIFT) * R * Math.sin(beltAngle);
  check("the Great Red Spot drifts slower than you drive",
    beltSpeed < 7 * 0.4,
    `${beltSpeed.toFixed(2)} units/s against the boat's 7, a lap every ${(2 * Math.PI / Math.abs(GRS_DRIFT) / 60).toFixed(1)} min`);
  // Note: the storm now drifts over portals, which is fine and left
  // untested here — the pool sits above it and writes depth first, so
  // the way home is drawn on top of the weather rather than under it.
  // Moons have to clear the cloud tops they orbit, or one spends half
  // its lap buried in the planet.
  check("every moon clears the planet it goes round",
    MOONS.every((m) => (m.orbit - 1) * R > m.radius + 6),
    MOONS.map((m) => `${m.name} ${((m.orbit - 1) * R - m.radius).toFixed(0)}`).join(", "));
}

// 11. Everything has to be inside the camera's far plane from
//     everywhere else, or a world vanishes when you look back at it.
{
  const FAR = 900;
  const ocean = new THREE.Vector3(0, 0, 0);
  const sun = new THREE.Vector3(30, 55, -300);
  // The ocean is a flat disc seen as a globe from off-world; 92 is
  // the radius of the shell that stands in for it.
  const OCEAN_R = 92;
  const OUTER_ORBIT = MOONS.reduce((a, m) => Math.max(a, m.orbit), 0);
  const worlds: Array<[string, THREE.Vector3, number]> = [
    ["ocean", ocean, OCEAN_R],
    ["sun", sun, 28],
    ["Saturn", SATURN_CENTER, SATURN_RADIUS],
    // Reach out to the widest moon, not just the cloud tops: an orbit
    // that pokes through the far plane drops a moon out of the sky
    // for half its lap.
    ["Jupiter", JUPITER_CENTER, JUPITER_RADIUS * OUTER_ORBIT + 3],
  ];
  const legs: Array<[string, number]> = [];
  for (const [an, ap] of worlds) {
    for (const [bn, bp, br] of worlds) {
      if (an === bn) continue;
      legs.push([`${an} → ${bn}`, ap.distanceTo(bp) + br]);
    }
  }
  const worstLeg = legs.reduce((a, b) => (a[1] > b[1] ? a : b));
  check("every world is inside the camera's far plane from every other",
    legs.every(([, d]) => d < FAR),
    `worst is ${worstLeg[0]} at ${worstLeg[1].toFixed(0)} (far ${FAR})`);
  // Each world is meant to be its own destination in its own quarter
  // of the sky. Two of them on the same bearing from home would read
  // as one thing with a moon, and the second would be a surprise
  // nobody ever went looking for.
  const bearings: Array<[string, THREE.Vector3]> = [
    ["sun", sun.clone().normalize()],
    ["Saturn", SATURN_CENTER.clone().normalize()],
    ["Jupiter", JUPITER_CENTER.clone().normalize()],
  ];
  const pairs: Array<[string, number]> = [];
  for (let i = 0; i < bearings.length; i++) {
    for (let j = i + 1; j < bearings.length; j++) {
      pairs.push([
        `${bearings[i][0]}/${bearings[j][0]}`,
        bearings[i][1].angleTo(bearings[j][1]),
      ]);
    }
  }
  check("no two worlds share a bearing from home",
    pairs.every(([, a]) => a > 0.7),
    pairs.map(([n, a]) => `${n} ${deg(a)}°`).join(", "));
}

function deg(rad: number) {
  return (rad * 180 / Math.PI).toFixed(1);
}

function fmt(v: THREE.Vector3) {
  return `(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})`;
}

console.log(failures === 0 ? "\nall good" : `\n${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
