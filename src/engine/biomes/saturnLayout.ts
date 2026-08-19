import * as THREE from "three";

// Where Saturn is, how it is tilted, and where its portals sit. Kept
// apart from the mesh building in saturn.ts so the layout can be
// checked on its own (see scripts/planet-test.ts) without a DOM to
// draw into.

// Far enough round the sky from the sun that the two are never in the
// same shot, and inside the camera's far plane from both the ocean
// and the sun.
export const SATURN_CENTER = new THREE.Vector3(-250, 90, 210);
export const SATURN_RADIUS = 34;

// Saturn's own pole — which is deliberately NOT the point every
// arrival lands on. Landing 50 degrees off it means the kid touches
// down well away from the equator and the rings cut across the sky at
// an angle instead of lying flat on the horizon, which is the whole
// reason to go.
export const SATURN_AXIS = new THREE.Vector3(0.5, 0.64, -0.58).normalize();

// The rings, as multiples of the planet's radius.
export const RING_INNER = 1.36;
export const RING_OUTER = 2.35;

export const SATURN_SPOT_ANGLE = 0.22;
export const SATURN_SPOT_TRIGGER = SATURN_SPOT_ANGLE * 0.75;
export const SATURN_BEAM_HEIGHT = 20;

// Portal positions, as unit directions from Saturn's centre. Same
// rules as the sun's: the first is ahead of the arrival view so the
// way home is already on the horizon at touchdown, far enough out to
// be a real drive; the rest were relaxed apart until the worst gap
// anywhere on the planet was 63 degrees, against beacons that stay in
// sight to 84.
export const SATURN_SPOT_DIRS: readonly THREE.Vector3[] = [
  new THREE.Vector3(0.148, 0.524, -0.839).normalize(),
  new THREE.Vector3(-0.852, 0.499, 0.158).normalize(),
  new THREE.Vector3(-0.001, -0.847, -0.531).normalize(),
  new THREE.Vector3(0.859, 0.35, 0.375).normalize(),
  new THREE.Vector3(-0.154, -0.526, 0.837).normalize(),
];
