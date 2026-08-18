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

  tick(dt: number): void {
    this.spec.onWalk?.(this.dir, dt);
  }
}
