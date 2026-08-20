import * as THREE from "three";

// Where Jupiter is, how it is tilted, and where its portals and its
// storm sit. Kept apart from the mesh building in jupiter.ts so the
// layout can be checked on its own (see scripts/planet-test.ts)
// without a DOM to draw into.

// Off in its own quarter of the sky, 405 units out: far enough round
// from both the sun and Saturn that no two of them are ever in the
// same shot, and near enough that its outermost moon is still inside
// the camera's far plane when viewed from the star — which is the
// binding constraint on how far away it can sit, and which the
// layout test proves rather than assumes.
export const JUPITER_CENTER = new THREE.Vector3(223, 170, 292);

// The whole point of Jupiter. The sun is 28 across and Saturn is 34;
// this is the one where the horizon is genuinely far away, a drive to
// the next portal is a proper expedition, and standing on it feels
// like standing on something enormous.
export const JUPITER_RADIUS = 52;

// Tilted 56 degrees off the spot every arrival lands on, for the same
// reason Saturn is: land on a banded planet's own pole and the bands
// lie flat on the horizon all the way round, which is the dullest
// arrangement available. Off-axis, they arc across the sky.
export const JUPITER_AXIS = new THREE.Vector3(0.359, 0.558, 0.748).normalize();

export const JUPITER_SPOT_ANGLE = 0.18;
export const JUPITER_SPOT_TRIGGER = JUPITER_SPOT_ANGLE * 0.75;
// Taller than the other two worlds' beacons, because it has further
// to carry: on a 52-unit ball the horizon is 28 degrees of arc away.
export const JUPITER_BEAM_HEIGHT = 30;

// Portal positions, as unit directions from Jupiter's centre.
//
// Six rather than the five the smaller worlds use, arranged as the
// vertices of an octahedron — the arrangement that minimises the
// worst gap for six points on a sphere, at 54.7 degrees. On a planet
// this size five would have meant stretches of a minute or more with
// nothing on the horizon.
//
// The set is turned so that the first one sits 58 degrees out along
// the arrival view's bearing: every trip lands on the north pole
// looking down -Z, so its beacon is already ahead of the kid at
// touchdown and the way home needs no explaining. It is a real drive
// away — about 45 units of arc to its rim — rather than underfoot.
//
// The remaining five are the same octahedron rolled 25 degrees about
// that first direction, which keeps every pairwise angle at a right
// angle while breaking up the "everything is in one plane" look the
// unrolled version had.
export const JUPITER_SPOT_DIRS: readonly THREE.Vector3[] = [
  new THREE.Vector3(0, 0.5299, -0.848).normalize(),
  new THREE.Vector3(0.9063, -0.3583, -0.2239).normalize(),
  new THREE.Vector3(-0.9063, 0.3583, 0.2239).normalize(),
  new THREE.Vector3(0.4226, 0.7685, 0.4802).normalize(),
  new THREE.Vector3(-0.4226, -0.7685, -0.4802).normalize(),
  new THREE.Vector3(0, -0.5299, 0.848).normalize(),
];

// The Great Red Spot: a storm wider than the whole ocean world, sat
// in the cloud tops where you can drive into it.
//
// Dead ahead on the arrival bearing and 18 degrees out, so the kid
// lands looking straight at it and it runs away from them over the
// horizon.
//
// That 18 is smaller than it looks like it should be, and the reason
// is the camera rather than the planet. The eye does not sit on the
// avatar: it trails nine units behind and seven above, which tips its
// own sub-point 8.6 degrees back the way you came and brings the
// horizon that much nearer everything in front of you. A first pass
// put the storm 31 degrees out — comfortably over a horizon measured
// from the avatar's feet, and entirely behind the limb of the planet
// once measured from where the picture is actually taken from. The
// layout test now measures from the camera.
export const GRS_DIR = new THREE.Vector3(0, 0.9511, -0.309).normalize();
// Half-extents as angles at the centre: wide along the belt it sits
// in, and squatter across it, the way the real one is.
export const GRS_HALF_WIDTH = 0.28;
export const GRS_HALF_HEIGHT = 0.2;

// How fast it rides its belt, in radians per second about Jupiter's
// axis. Storms on a gas giant do not sit still — they are carried
// along the band they are in, and the bands either side of them run
// the other way.
//
// This works out at about 1.2 units a second, against the boat's
// seven. Slow enough that it is a landmark you drive to rather than
// something you chase, and quick enough that a kid who sits still
// long enough will watch it come round to them. A full lap of the
// belt takes about four and a half minutes.
export const GRS_DRIFT = 0.0235;

// The camera, as the layout test needs to know it: the planet walker
// puts the eye this far above and behind the avatar, and the avatar
// itself hovers a little clear of the surface. Everything about what
// is and isn't in shot on arrival follows from these three numbers.
export const CAM_UP = 7;
export const CAM_BACK = 9;
export const HOVER = 0.35;

// The smaller white ovals that trail along the belts either side of
// it. Same storm geometry, a tenth of the size.
export const WHITE_OVALS: ReadonlyArray<{
  dir: THREE.Vector3;
  halfWidth: number;
  halfHeight: number;
  drift: number;
}> = [
  { dir: new THREE.Vector3(0.11, 0.62, -0.78).normalize(), halfWidth: 0.1, halfHeight: 0.06, drift: -0.031 },
  { dir: new THREE.Vector3(-0.36, 0.2, -0.91).normalize(), halfWidth: 0.075, halfHeight: 0.05, drift: 0.044 },
  { dir: new THREE.Vector3(0.72, 0.06, 0.69).normalize(), halfWidth: 0.09, halfHeight: 0.055, drift: -0.019 },
];

// Lightning. Jupiter has it, in the storms, and it is the one thing
// that makes a planet with no night side feel like it has weather
// rather than a paint job. Seconds between strikes per storm, picked
// uniformly in this range; the big one gets the short end of it.
//
// Tuned down from a first pass at a third of these gaps, which
// measured 27 strikes in 30 seconds — near enough one a second, and
// since a roll of thunder runs two and a half seconds they simply
// piled on top of each other into continuous rumble.
export const STRIKE_GAP = { min: 8, max: 22 };
// How long a strike lasts, and how far the sound carries. Gone by 95
// matters more than it looks: the whole planet is only 104 units
// across, so a range much wider than this makes every storm audible
// from everywhere and there is no such thing as a distant one.
export const STRIKE_SECONDS = 0.42;
export const THUNDER_FULL = 20;
export const THUNDER_GONE = 95;
// Sound is slow. Two hundred units a second is nothing like physical,
// but it puts a beat of a second or so between a distant flash and
// its rumble, which is the bit worth having.
export const THUNDER_SPEED = 200;
// The shortest gap between two rumbles you actually hear. A roll runs
// two and a half seconds, so without this they stack into one
// continuous noise however far apart the strikes themselves are —
// which is what the first two passes at the strike rate kept
// rediscovering. Strikes you don't hear still flash; you just don't
// get a clap for every one, which is also true of a real sky.
export const THUNDER_MIN_GAP = 2.8;

// The four big moons, as orbits around Jupiter's own axis. Radii are
// multiples of the planet's; periods are seconds for a full lap.
// Nothing about them is to scale — they are here so that the sky over
// Jupiter has things moving in it, which is what makes standing on a
// gas giant feel different from standing on a star.
export const MOONS: ReadonlyArray<{
  name: string;
  orbit: number;
  radius: number;
  period: number;
  incline: number;
  phase: number;
  warm: number;
  cool: number;
}> = [
  { name: "Io", orbit: 1.85, radius: 2.4, period: 15, incline: 0.14, phase: 0.0, warm: 0xf6dc72, cool: 0xc4692f },
  { name: "Europa", orbit: 2.35, radius: 2.1, period: 23, incline: -0.24, phase: 1.9, warm: 0xf4f6fb, cool: 0xa8b8c8 },
  { name: "Ganymede", orbit: 2.95, radius: 3.2, period: 33, incline: 0.34, phase: 3.4, warm: 0xcbbba4, cool: 0x6f6357 },
  { name: "Callisto", orbit: 3.4, radius: 3.0, period: 46, incline: -0.1, phase: 5.1, warm: 0x8b7a68, cool: 0x413a34 },
];
