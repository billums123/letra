import * as THREE from "three";

// A sphere the avatar can walk all the way around.
//
// The flat game's whole pipeline — input, avatar animation, camera —
// assumes a ground plane, and teaching every part of it about spheres
// would be a rewrite. So instead a PlanetWalker keeps an orthonormal
// tangent frame at the avatar's feet and treats the flat world's axes
// as that frame's axes: flat +X is `east`, flat +Z is `south` (the
// direction the camera sits in), flat +Y is straight up out of the
// sphere.
//
// The avatar still moves itself in flat coordinates exactly as it
// always has. Each frame we read back the delta it applied, walk the
// contact point along the matching great circle, and parallel-
// transport the frame with it. Controls, turn-to-face, camera framing
// and the idle bob all behave precisely as they do on the meadow —
// the ground just curves away, and keep walking and you come back to
// where you started.

export type PlanetObstacle = {
  // Unit direction from the planet centre to the obstacle's centre.
  dir: THREE.Vector3;
  // Its radius measured as an angle at the planet centre, so it stays
  // correct however big the planet is.
  angular: number;
  onBump?: () => void;
};

export type PlanetSpec = {
  center: THREE.Vector3;
  radius: number;
  // Clearance between the surface and the avatar's origin.
  hover?: number;
  obstacles?: PlanetObstacle[];
  // Fired every frame with the avatar's current surface direction, so
  // the biome that owns the planet can react to where the kid is
  // standing (walking into a sunspot, etc).
  onWalk?: (dir: THREE.Vector3, dt: number) => void;
};

const tmpAxis = new THREE.Vector3();
const tmpDelta = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpMat = new THREE.Matrix4();
const tmpHeading = new THREE.Vector3();

// Any tangent direction at `dir`, biased toward `prefer` when that is
// not parallel to the surface normal.
function tangentFrom(dir: THREE.Vector3, prefer: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  out.copy(prefer).addScaledVector(dir, -prefer.dot(dir));
  if (out.lengthSq() < 1e-6) {
    // `prefer` was straight up or down — any perpendicular will do.
    out.set(1, 0, 0).addScaledVector(dir, -dir.x);
    if (out.lengthSq() < 1e-6) out.set(0, 0, 1).addScaledVector(dir, -dir.z);
  }
  return out.normalize();
}

export type PlanetHop = {
  // How far around the sphere to travel, in radians of arc.
  arc: number;
  // How high above the surface at the top, in world units.
  peak: number;
  duration: number;
  // Tangent direction to fly along. Defaults to whichever way the
  // avatar is currently pointing.
  heading?: THREE.Vector3;
  onLand?: () => void;
};

export class PlanetWalker {
  readonly spec: PlanetSpec;
  readonly radius: number;
  readonly hover: number;
  // Unit vector from the planet centre to the point under the avatar.
  readonly dir = new THREE.Vector3(0, 1, 0);
  // Tangent frame. `south` is flat +Z (toward the camera), `east` is
  // flat +X. Right-handed: east × up = south.
  readonly south = new THREE.Vector3(0, 0, 1);
  readonly east = new THREE.Vector3(1, 0, 0);

  // Airborne state. A hop is a rotation of the whole tangent frame
  // about a fixed axis — the same operation walking does, just run
  // from a clock instead of from the joystick — plus a parabola of
  // height on top. Doing it that way means the avatar comes down
  // facing sensibly and the camera never has to be told anything
  // special: it is still reading the same frame it always was.
  private hop: {
    t: number;
    duration: number;
    arc: number;
    peak: number;
    axis: THREE.Vector3;
    turned: number;
    flips: number;
    onLand?: () => void;
  } | null = null;
  private hopLift = 0;

  get airborne(): boolean {
    return this.hop !== null;
  }

  // Height above the surface right now — the engine adds this to the
  // avatar's own bob.
  get lift(): number {
    return this.hopLift;
  }

  // Tumble angle, for the engine to compose onto the avatar.
  get spin(): number {
    const h = this.hop;
    return h ? Math.PI * 2 * h.flips * (h.t / h.duration) : 0;
  }

  constructor(spec: PlanetSpec, landDir: THREE.Vector3, faceHint?: THREE.Vector3) {
    this.spec = spec;
    this.radius = spec.radius;
    this.hover = spec.hover ?? 0;
    this.dir.copy(landDir).normalize();
    // `faceHint` is the direction we want the kid to be looking when
    // they touch down — the camera then sits opposite it, i.e. along
    // `south`.
    const hint = faceHint ?? new THREE.Vector3(0, 0, -1);
    tangentFrom(this.dir, hint, this.south).negate();
    this.east.copy(this.dir).cross(this.south).normalize();
  }

  // Surface point under the avatar, plus `lift` (the avatar's own bob).
  point(out: THREE.Vector3, lift = 0): THREE.Vector3 {
    return out
      .copy(this.spec.center)
      .addScaledVector(this.dir, this.radius + this.hover + lift);
  }

  // Walk a flat-frame displacement. dx is along flat +X, dz along +Z.
  step(dx: number, dz: number): void {
    tmpDelta.set(0, 0, 0).addScaledVector(this.east, dx).addScaledVector(this.south, dz);
    const arc = tmpDelta.length();
    if (arc > 1e-7) {
      tmpDelta.multiplyScalar(1 / arc);
      // Rotating about (up × heading) by the subtended angle carries
      // the contact point along the great circle in the heading
      // direction; applying the same rotation to the frame is exactly
      // parallel transport, so the camera stays put behind the kid.
      tmpAxis.copy(this.dir).cross(tmpDelta);
      if (tmpAxis.lengthSq() > 1e-10) {
        tmpQuat.setFromAxisAngle(tmpAxis.normalize(), arc / this.radius);
        this.dir.applyQuaternion(tmpQuat);
        this.south.applyQuaternion(tmpQuat);
        this.east.applyQuaternion(tmpQuat);
      }
    }
    this.resolveObstacles();
    // Floating-point error accumulates over thousands of small
    // rotations, so re-orthonormalise. Cheap, and once a second is
    // plenty — but it costs so little that every frame is simpler to
    // reason about than a counter.
    this.dir.normalize();
    this.south.addScaledVector(this.dir, -this.south.dot(this.dir)).normalize();
    this.east.copy(this.dir).cross(this.south).normalize();
  }

  private resolveObstacles(): void {
    const list = this.spec.obstacles;
    if (!list) return;
    for (const o of list) {
      const angle = this.dir.angleTo(o.dir);
      if (angle >= o.angular || angle < 1e-5) continue;
      // Push the contact point back out along the great circle that
      // runs from the obstacle's centre through the avatar.
      tmpAxis.copy(o.dir).cross(this.dir);
      if (tmpAxis.lengthSq() < 1e-10) continue;
      tmpQuat.setFromAxisAngle(tmpAxis.normalize(), o.angular - angle);
      this.dir.applyQuaternion(tmpQuat);
      this.south.applyQuaternion(tmpQuat);
      this.east.applyQuaternion(tmpQuat);
      o.onBump?.();
    }
  }

  // Orientation for the avatar: local +Y out of the sphere, local +X
  // and +Z along the tangent frame, then the avatar's own yaw on top.
  orientation(out: THREE.Quaternion, yaw: number): THREE.Quaternion {
    tmpMat.makeBasis(this.east, this.dir, this.south);
    out.setFromRotationMatrix(tmpMat);
    tmpQuat.setFromAxisAngle(this.dir, yaw);
    return out.premultiply(tmpQuat);
  }

  // Where the follow camera wants to be, given the flat-world offset
  // it uses on the ground. Mapping the offset through the tangent
  // frame means the framing is identical to the flat game's — at the
  // north pole of a planet it is literally the same arithmetic.
  cameraPoint(out: THREE.Vector3, offset: THREE.Vector3, lift = 0): THREE.Vector3 {
    this.point(out, lift);
    return out
      .addScaledVector(this.east, offset.x)
      .addScaledVector(this.dir, offset.y)
      .addScaledVector(this.south, offset.z);
  }

  // Throw the avatar off the surface along a great circle. Ignored if
  // one is already in the air.
  launch(opts: PlanetHop): void {
    if (this.hop) return;
    const heading = tmpHeading.copy(opts.heading ?? this.south).multiplyScalar(
      opts.heading ? 1 : -1
    );
    // Project onto the tangent plane in case the caller handed us
    // something that is not quite tangent.
    heading.addScaledVector(this.dir, -heading.dot(this.dir));
    if (heading.lengthSq() < 1e-8) heading.copy(this.south).negate();
    heading.normalize();
    const axis = this.dir.clone().cross(heading);
    if (axis.lengthSq() < 1e-10) return;
    axis.normalize();
    this.hop = {
      t: 0,
      duration: opts.duration,
      arc: opts.arc,
      peak: opts.peak,
      axis,
      turned: 0,
      flips: Math.max(1, Math.round(opts.duration * 1.4)),
      onLand: opts.onLand,
    };
  }

  // One frame. `dx`/`dz` are the flat-frame displacement the avatar
  // moved itself by; they are ignored while airborne, because you do
  // not get to steer in mid-air.
  advance(dt: number, dx: number, dz: number): void {
    const h = this.hop;
    if (h) {
      h.t = Math.min(h.duration, h.t + dt);
      const k = h.t / h.duration;
      // Rotate the frame by however much of the arc is still owed,
      // which keeps the whole thing a pure rotation no matter how the
      // frame times land.
      const want = h.arc * k;
      const turn = want - h.turned;
      h.turned = want;
      if (Math.abs(turn) > 1e-9) {
        tmpQuat.setFromAxisAngle(h.axis, turn);
        this.dir.applyQuaternion(tmpQuat);
        this.south.applyQuaternion(tmpQuat);
        this.east.applyQuaternion(tmpQuat);
      }
      this.hopLift = h.peak * 4 * k * (1 - k);
      if (k >= 1) {
        this.hop = null;
        this.hopLift = 0;
        h.onLand?.();
        this.spec.onWalk?.(this.dir, dt);
      }
      return;
    }
    this.step(dx, dz);
    this.spec.onWalk?.(this.dir, dt);
  }
}
