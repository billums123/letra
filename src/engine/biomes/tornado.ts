import * as THREE from "three";

// A waterspout standing on the ocean, and the way to Saturn.
//
// It works the way the volcano works, because that is the mechanic
// the kid already knows: a landmark you can see from across the map,
// that you drive into on purpose, that winds up and then throws you
// somewhere. The volcano rumbles and erupts; this one hauls you off
// the water and spits you at another planet.
//
// The funnel is two counter-rotating shells with a helix baked into
// their vertex colours. Spinning a shell whose pattern is a spiral is
// what reads as a vortex — a plain cone, however well shaded, just
// reads as a cone standing still.

export type Tornado = {
  group: THREE.Group;
  // Winds up as the avatar gets close and again while it is hauling
  // them in. 0 idle, 1 full fury.
  setFury: (fury: number) => void;
  tick: (dt: number, t: number) => void;
  // Where the mouth of it is, for the spiral to be centred on.
  readonly height: number;
};

const CLOUD_DARK = new THREE.Color(0x4c5560);
const CLOUD = new THREE.Color(0x8f98a4);
const SPRAY = new THREE.Color(0xdfe9f2);

// Radius at a height fraction u (0 at the water, 1 at the cloud).
// Wide at the top where it meets the storm, pinched in the middle,
// flaring again at the bottom where it tears up the sea.
function funnelRadius(u: number): number {
  return 1.7 + 7.4 * Math.pow(u, 2.8) + 2.3 * Math.pow(1 - u, 4);
}

export function buildTornado(opts: { height?: number }): Tornado {
  const height = opts.height ?? 46;
  const group = new THREE.Group();
  group.frustumCulled = false;

  const shellMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });

  // Two shells, turning opposite ways at different speeds. One alone
  // reads as a spinning traffic cone; two give the parallax that says
  // there is air moving inside it.
  // Both wind and turn the SAME way, at different rates. Counter-
  // rotating them crossed the two helices into a fishnet, which is a
  // lattice, not a vortex; shearing one against the other reads as air
  // moving at different speeds at different depths, which is what it
  // actually is.
  const shells = [1, 0.78].map((scale, i) => {
    const mesh = new THREE.Mesh(makeFunnelGeometry(height, scale, i), shellMat);
    group.add(mesh);
    return { mesh, spin: i === 0 ? 2.4 : 3.9 };
  });

  // The storm it hangs from. A lumpy mass of overlapping spheres, not
  // one squashed one — a single ellipsoid up there reads as a lid on
  // a lamp, and the funnel underneath it as the stem.
  const capMat = new THREE.MeshStandardMaterial({
    color: 0x5b6572,
    roughness: 1,
    flatShading: true,
  });
  const cap = new THREE.Group();
  cap.position.y = height + 1;
  const lumps = 11;
  for (let i = 0; i < lumps; i++) {
    const a = (i / lumps) * Math.PI * 2 + (i % 3) * 0.4;
    const spread = i === 0 ? 0 : 5 + (i % 4) * 3.2;
    const r = i === 0 ? 9.5 : 4.6 + (i % 5) * 1.5;
    const lump = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 9), capMat);
    lump.position.set(Math.cos(a) * spread, ((i % 3) - 1) * 1.7, Math.sin(a) * spread);
    lump.scale.y = 0.62;
    cap.add(lump);
  }
  group.add(cap);

  // Torn-up water at the foot of it.
  const sprayMat = new THREE.MeshBasicMaterial({
    color: 0xe8f2fa,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const spray = new THREE.Mesh(new THREE.RingGeometry(2.2, 11, 40), sprayMat);
  spray.rotation.x = -Math.PI / 2;
  spray.position.y = 0.14;
  group.add(spray);

  // Debris caught in the wall of it: chips of water going round.
  const debrisMat = new THREE.MeshBasicMaterial({ color: 0xcfe2f0, fog: false });
  const debrisGeo = new THREE.TetrahedronGeometry(0.26);
  const debris = Array.from({ length: 16 }, (_, i) => {
    const mesh = new THREE.Mesh(debrisGeo, debrisMat);
    group.add(mesh);
    return {
      mesh,
      u: (i / 16) * 0.75,
      angle: i * 1.9,
      rate: 2.2 + (i % 5) * 0.35,
      climb: 0.1 + (i % 4) * 0.035,
    };
  });

  let fury = 0;
  let clock = 0;

  return {
    group,
    height,
    setFury(next) {
      fury = Math.min(1, Math.max(0, next));
    },
    tick(dt) {
      clock += dt;
      const speed = 1 + fury * 2.4;
      for (const s of shells) s.mesh.rotation.y += dt * s.spin * speed;
      spray.rotation.z -= dt * 1.6 * speed;
      spray.scale.setScalar(1 + fury * 0.35 + Math.sin(clock * 3) * 0.03);
      sprayMat.opacity = 0.42 + fury * 0.4;
      cap.rotation.y += dt * 0.28 * speed;
      // A hard lean at full fury, so it looks like it is pulling.
      group.rotation.z = Math.sin(clock * 0.7) * 0.02 + fury * 0.03;
      for (const d of debris) {
        d.u += dt * d.climb * speed;
        if (d.u > 0.8) d.u -= 0.8;
        d.angle += dt * d.rate * speed;
        const r = funnelRadius(d.u) * 1.02;
        d.mesh.position.set(
          Math.cos(d.angle) * r,
          d.u * height,
          Math.sin(d.angle) * r
        );
        d.mesh.rotation.set(clock * 2 + d.angle, clock * 3, 0);
      }
    },
  };
}

// One shell of the funnel. The helix in the vertex colours is what
// turns rotation into a vortex; the alpha keeps it a thing made of air
// rather than a solid cone, and fades it out at the very bottom so it
// meets the sea without an edge.
function makeFunnelGeometry(height: number, scale: number, seed: number): THREE.BufferGeometry {
  const SEG = 30;
  const RINGS = 34;
  const geo = new THREE.CylinderGeometry(1, 1, height, SEG, RINGS, true);
  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 4);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const u = Math.min(1, Math.max(0, y / height + 0.5));
    const r = funnelRadius(u) * scale;
    const theta = Math.atan2(z, x);
    pos.setXYZ(i, Math.cos(theta) * r, u * height, Math.sin(theta) * r);
    // The helix: a band pattern that winds as it climbs. Sharpened
    // rather than sinusoidal — a soft gradient washes out to flat grey
    // at this size, and then rotating it does nothing at all.
    const wave = 0.5 + 0.5 * Math.sin(theta * 3 + u * 34 + seed * 2.1);
    const helix = Math.pow(wave, 1.8);
    c.copy(CLOUD_DARK).lerp(CLOUD, helix);
    // Whiter down at the water, where it is picking up spray.
    if (u < 0.3) c.lerp(SPRAY, ((0.3 - u) / 0.3) * 0.8);
    cols[i * 4] = c.r;
    cols[i * 4 + 1] = c.g;
    cols[i * 4 + 2] = c.b;
    // Thin at the very bottom so there is no rim where it meets the
    // sea, and thinning again at the top into the cloud.
    const bottom = Math.min(1, u / 0.06);
    const top = Math.min(1, (1 - u) / 0.18);
    cols[i * 4 + 3] = (0.34 + 0.55 * helix) * bottom * top;
  }
  pos.needsUpdate = true;
  geo.setAttribute("color", new THREE.BufferAttribute(cols, 4));
  return geo;
}
