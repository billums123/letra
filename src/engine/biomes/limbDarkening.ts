import * as THREE from "three";

// Limb darkening, for the worlds that light themselves.
//
// The star and the two gas giants are drawn with MeshBasicMaterial —
// they have to be, or the half of them facing away from the scene's
// sun would be a night side, and a four-year-old who walks onto it is
// standing in the dark on a planet they cannot see. An unlit sphere
// reads as flat paper, so each vertex is shaded by how squarely it
// faces the viewer instead: brightest under your feet, falling away
// toward the horizon.
//
// It is also, measured, the most expensive thing any of those worlds
// does. A hundred thousand vertices between them, and all three used
// to recompute every 0.08 seconds — on the same frame, because they
// share a clock. Against a 2ms baseline that put a 5-8ms spike into
// every fifth frame, which is what "the frame rate jumps when you're
// on Jupiter" was.
//
// Two things fix it, and they compose:
//
//   - Nothing recomputes unless the viewer's *bearing* from the
//     world's centre has actually moved, because that bearing is the
//     only thing the shading depends on. Standing still costs
//     nothing. From Jupiter, the sun's bearing drifts at about a
//     hundredth of a radian a second, so it recomputes roughly once a
//     second instead of twelve times.
//   - A pass is spread over several frames, a slice at a time, and
//     only the slice that changed is sent to the GPU. Same total
//     work; no spike.
//
// A pass in progress uses the bearing it started with, so the whole
// sphere is shaded from one viewpoint rather than smeared across a
// moving one. Consecutive passes are less than a degree apart, so the
// join between an updated slice and a stale one is invisible.

export type LimbShader = {
  // Call once a frame with wherever the eye is, and the world clock.
  // Does nothing if nothing has moved enough to matter.
  tick: (viewer: THREE.Vector3 | undefined, dt: number, t: number) => void;
};

export function makeLimbShader(opts: {
  geo: THREE.BufferGeometry;
  center: THREE.Vector3;
  radius: number;
  // The unlit colour of each vertex, three floats per vertex in the
  // same order as the positions.
  base: Float32Array;
  // lit = floor + gain * sqrt(facing), where facing is 1 straight at
  // the viewer and 0 at the limb.
  floor: number;
  gain: number;
  // How many frames a full pass is spread across.
  slices?: number;
  // For a surface whose own colour moves — the star's granulation
  // boils whether or not anyone walks anywhere. Called with the slice
  // about to be shaded, to bring that stretch of `base` up to date.
  refresh?: (from: number, to: number, t: number) => void;
  // The longest a world may go without a pass when the viewer has not
  // moved. Only worth setting alongside `refresh`; without one, a
  // still viewer over a still surface has nothing to recompute.
  maxIdle?: number;
}): LimbShader {
  const { geo, center, radius, base, floor, gain, refresh } = opts;
  const slices = opts.slices ?? 6;
  const maxIdle = opts.maxIdle ?? Infinity;
  const pos = geo.attributes.position;
  const attr = geo.attributes.color as THREE.BufferAttribute;
  const colors = attr.array as Float32Array;
  const count = pos.count;
  const per = Math.ceil(count / slices);

  // The bearing the pass currently being drawn was shaded from, and
  // the one in progress. Under a degree of change is not worth
  // redrawing a hundred thousand vertices for.
  const MOVED = 0.015;
  const shadeFrom = new THREE.Vector3(0, 1, 0);
  const passDir = new THREE.Vector3(0, 1, 0);
  const now = new THREE.Vector3();
  let slice = slices;
  let everShaded = false;
  let idle = 0;

  const shadeSlice = (from: number, to: number) => {
    // The viewer, in the world's own frame.
    const vx = passDir.x;
    const vy = passDir.y;
    const vz = passDir.z;
    for (let i = from; i < to; i++) {
      const cx = pos.getX(i);
      const cy = pos.getY(i);
      const cz = pos.getZ(i);
      let dx = vx - cx;
      let dy = vy - cy;
      let dz = vz - cz;
      const dl = Math.hypot(dx, dy, dz) || 1;
      dx /= dl;
      dy /= dl;
      dz /= dl;
      const facing = (cx * dx + cy * dy + cz * dz) / radius;
      const lit = floor + gain * Math.sqrt(Math.max(0, facing));
      colors[i * 3] = base[i * 3] * lit;
      colors[i * 3 + 1] = base[i * 3 + 1] * lit;
      colors[i * 3 + 2] = base[i * 3 + 2] * lit;
    }
  };

  return {
    tick(viewer, dt, t) {
      idle += dt;
      // Where the eye is relative to the centre. No viewer means the
      // default overhead bearing the world was built with.
      if (viewer) now.copy(viewer).sub(center);
      else now.set(0, radius * 12, 0);

      if (slice >= slices) {
        // Idle. Start a pass only if the view has actually moved, or
        // if this is a surface that changes on its own and has waited
        // long enough.
        if (everShaded && now.angleTo(shadeFrom) < MOVED && idle < maxIdle) return;
        shadeFrom.copy(now);
        passDir.copy(now);
        slice = 0;
        idle = 0;
        if (!everShaded) {
          refresh?.(0, count, t);
          // The first one runs whole. Until it does the sphere is
          // black, and it happens while the world is still fading in
          // from nothing, so nobody sees the cost.
          shadeSlice(0, count);
          attr.needsUpdate = true;
          everShaded = true;
          slice = slices;
          return;
        }
      }

      const from = slice * per;
      const to = Math.min(count, from + per);
      refresh?.(from, to, t);
      shadeSlice(from, to);
      // Only the slice that changed goes to the GPU. Uploading the
      // whole 450KB buffer for a sixth of it was half the spike.
      attr.addUpdateRange(from * 3, (to - from) * 3);
      attr.needsUpdate = true;
      slice++;
    },
  };
}
