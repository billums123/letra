import * as THREE from "three";

// Where the sun's landmarks sit, kept apart from the mesh building in
// sun.ts so the layout can be checked on its own (see
// scripts/planet-test.ts) without a DOM to draw into.

// Portal size, as an angle at the sun's centre — sized so a kid
// driving in a straight line can hardly miss one.
export const SPOT_ANGLE = 0.22;

// The bit you actually fall through. The pool of ocean is drawn at
// exactly this radius, so what triggers the ride home is the thing
// the kid can see, not an invisible circle around it.
export const SPOT_TRIGGER = SPOT_ANGLE * 0.75;

// How tall the beacon over each portal stands, in world units. On a
// 28-unit star this keeps a beacon in sight from about 90 degrees of
// arc away, which is what the layout below is checked against.
export const BEAM_HEIGHT = 20;

// Sunspot positions, as unit directions from the sun's centre.
//
// The first is deliberately ahead of the arrival view — every trip
// lands on the north pole looking down -Z, so its beacon is already on
// the horizon when the kid touches down and the way home needs no
// explaining. It sits 62 degrees of arc out rather than right there —
// about 26 units to its rim, so getting to it is a proper drive
// across a star rather than the two-second hop a closer one gave.
//
// The other four were relaxed apart from it and from each other until
// the worst gap anywhere on the star came down to 64 degrees of arc.
// The coverage check in scripts/planet-test.ts is the only honest way
// to know a four-year-old can't end up stranded on a featureless
// orange ball.
export const SPOT_DIRS: readonly THREE.Vector3[] = [
  new THREE.Vector3(0.12, 0.47, -0.875).normalize(),
  new THREE.Vector3(-0.859, 0.495, 0.133).normalize(),
  new THREE.Vector3(0.072, -0.872, -0.484).normalize(),
  new THREE.Vector3(0.833, 0.407, 0.375).normalize(),
  new THREE.Vector3(-0.171, -0.503, 0.847).normalize(),
];

// ── Plasma vents ─────────────────────────────────────────────────────
// Holes in the surface that blow every so often, and fling the avatar
// clear over the horizon if it is standing on one when they do.

// Vent radius, as an angle at the sun's centre. Small — you have to
// actually drive onto it, which is the point.
export const GEYSER_ANGLE = 0.075;

// Where they sit. Relaxed apart from each other, from the portals and
// from the north pole, with one deliberate exception: the first is
// only 17 degrees from the pole and on the side the kid faces when
// they arrive, so the very first thing they find after landing is a
// vent going off. The layout is checked in scripts/planet-test.ts —
// a vent overlapping a portal would launch the kid at the same moment
// the sun tried to send them home.
export const GEYSER_DIRS: readonly THREE.Vector3[] = [
  new THREE.Vector3(0.05, 0.956, -0.29).normalize(),
  new THREE.Vector3(-0.069, 0.362, 0.929).normalize(),
  new THREE.Vector3(-0.625, -0.738, 0.254).normalize(),
  new THREE.Vector3(0.909, -0.199, -0.366).normalize(),
  new THREE.Vector3(-0.908, -0.177, -0.379).normalize(),
  new THREE.Vector3(-0.121, -0.304, -0.945).normalize(),
  new THREE.Vector3(0.643, -0.619, 0.451).normalize(),
];
