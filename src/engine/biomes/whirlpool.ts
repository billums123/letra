import * as THREE from "three";

// A whirlpool roaming the ocean, and the way down to the sea floor.
//
// The mirror of the waterspout: same idea, opposite direction. That is
// deliberate — a kid who has learned that you drive into the spinning
// thing and it takes you somewhere gets to use that knowledge twice,
// and the two are told apart at a glance because one goes up into a
// storm cloud and the other goes down into a hole in the sea.
//
// It is built as a funnel of water sunk into the surface: rings of
// spinning sea stepping down into a dark throat, with foam rings
// racing round the rim.

export type Whirlpool = {
  group: THREE.Group;
  // 0 idle, 1 while it has hold of something.
  setFury: (fury: number) => void;
  setDrift: (vx: number, vz: number) => void;
  tick: (dt: number, t: number) => void;
  readonly depth: number;
};

const WATER_PALE = new THREE.Color(0x8fd4e6);
const WATER_MID = new THREE.Color(0x2f86b4);
const WATER_DEEP = new THREE.Color(0x0a2f4e);
const THROAT = new THREE.Color(0x04121f);

// Radius of the bowl at a depth fraction u (0 at the rim, 1 at the
// throat). Wide and shallow at the top, dropping away to a narrow
// dark hole — the shape water actually makes going down a drain.
function bowlRadius(u: number): number {
  return 0.9 + 10.5 * Math.pow(1 - u, 1.7);
}

export function buildWhirlpool(opts: { depth?: number } = {}): Whirlpool {
  const depth = opts.depth ?? 9;
  const group = new THREE.Group();
  group.frustumCulled = false;

  const bowlMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });

  // Two nested bowls turning at different rates, so the surface of it
  // shears the way water in a vortex does.
  const bowls = [1, 0.72].map((scale, i) => {
    const mesh = new THREE.Mesh(makeBowlGeometry(depth, scale, i), bowlMat);
    group.add(mesh);
    return { mesh, spin: i === 0 ? -1.9 : -3.1 };
  });

  // Foam racing round the rim, and rings running outward from it — the
  // same trick as the waterspout's wake, which is what makes either of
  // them look like it is actually in the water.
  const rimMat = new THREE.MeshBasicMaterial({
    color: 0xeaf7ff,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const rim = new THREE.Mesh(new THREE.RingGeometry(9.4, 11.6, 44), rimMat);
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.16;
  group.add(rim);

  const RIPPLE_COUNT = 4;
  const RIPPLE_PERIOD = 2.6;
  const rippleGeo = new THREE.RingGeometry(0.88, 1, 44);
  const ripples = Array.from({ length: RIPPLE_COUNT }, (_, i) => {
    const mesh = new THREE.Mesh(
      rippleGeo,
      new THREE.MeshBasicMaterial({
        color: 0xdff2ff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.12;
    mesh.frustumCulled = false;
    group.add(mesh);
    return { mesh, phase: i / RIPPLE_COUNT };
  });

  // Spray flicked off the rim, going round with it.
  const fleckMat = new THREE.MeshBasicMaterial({ color: 0xf2fbff, fog: false });
  const fleckGeo = new THREE.TetrahedronGeometry(0.22);
  const flecks = Array.from({ length: 18 }, (_, i) => {
    const mesh = new THREE.Mesh(fleckGeo, fleckMat);
    group.add(mesh);
    return { mesh, u: (i / 18) * 0.9, angle: i * 2.1, rate: 1.6 + (i % 5) * 0.3 };
  });

  let fury = 0;
  let clock = 0;
  let leanX = 0;
  let leanZ = 0;

  return {
    group,
    depth,
    setFury(next) {
      fury = Math.min(1, Math.max(0, next));
    },
    setDrift(vx, vz) {
      const len = Math.hypot(vx, vz);
      leanX = len < 1e-4 ? 0 : vx / len;
      leanZ = len < 1e-4 ? 0 : vz / len;
    },
    tick(dt) {
      clock += dt;
      const speed = 1 + fury * 2.2;
      for (const b of bowls) b.mesh.rotation.y += dt * b.spin * speed;
      rim.rotation.z += dt * 1.4 * speed;
      rimMat.opacity = 0.45 + fury * 0.35;
      // A vortex being dragged along tips its throat back the way it
      // came, so the whole bowl leans out of its own direction.
      const lean = 0.1;
      group.rotation.z += (lean * leanX - group.rotation.z) * Math.min(1, dt * 2.5);
      group.rotation.x += (lean * leanZ - group.rotation.x) * Math.min(1, dt * 2.5);
      for (const r of ripples) {
        const k = (clock / RIPPLE_PERIOD + r.phase) % 1;
        const spread = 11 + k * (10 + fury * 4);
        r.mesh.scale.set(spread, spread, 1);
        (r.mesh.material as THREE.MeshBasicMaterial).opacity =
          (0.3 + fury * 0.28) * Math.min(1, k / 0.12) * Math.pow(1 - k, 1.5);
      }
      for (const f of flecks) {
        f.angle += dt * f.rate * speed * 1.8;
        const r = bowlRadius(f.u) * 1.02;
        f.mesh.position.set(
          Math.cos(f.angle) * r,
          -f.u * depth + Math.sin(clock * 3 + f.angle) * 0.12,
          Math.sin(f.angle) * r
        );
        f.mesh.rotation.set(clock * 2, f.angle, 0);
      }
    },
  };
}

// One bowl of the vortex: rings of water stepping down to a dark
// throat, with a spiral in the vertex colours so that turning it reads
// as water going round rather than as a cone sitting still.
function makeBowlGeometry(depth: number, scale: number, seed: number): THREE.BufferGeometry {
  const SEG = 40;
  const RINGS = 26;
  const geo = new THREE.CylinderGeometry(1, 1, depth, SEG, RINGS, true);
  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 4);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // 0 at the rim, 1 down in the throat.
    const u = Math.min(1, Math.max(0, 0.5 - y / depth));
    const r = bowlRadius(u) * scale;
    const theta = Math.atan2(z, x);
    pos.setXYZ(i, Math.cos(theta) * r, -u * depth, Math.sin(theta) * r);
    const wave = 0.5 + 0.5 * Math.sin(theta * 3 - u * 24 + seed * 2.4);
    const helix = Math.pow(wave, 1.7);
    // Pale and foamy at the rim, through open water, to black.
    if (u < 0.45) c.copy(WATER_PALE).lerp(WATER_MID, u / 0.45);
    else if (u < 0.8) c.copy(WATER_MID).lerp(WATER_DEEP, (u - 0.45) / 0.35);
    else c.copy(WATER_DEEP).lerp(THROAT, (u - 0.8) / 0.2);
    c.multiplyScalar(0.72 + helix * 0.5);
    cols[i * 4] = c.r;
    cols[i * 4 + 1] = c.g;
    cols[i * 4 + 2] = c.b;
    // Solid down the throat, thinning at the rim so it blends into
    // the sea instead of ending on a hard circle.
    const rimFade = Math.min(1, u / 0.1);
    cols[i * 4 + 3] = (0.55 + 0.45 * helix) * rimFade;
  }
  pos.needsUpdate = true;
  geo.setAttribute("color", new THREE.BufferAttribute(cols, 4));
  return geo;
}
