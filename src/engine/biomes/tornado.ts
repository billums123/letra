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
  // Which way it is travelling, so the column can lean into it. The
  // lean is most of what says "this thing is moving" from a distance.
  setDrift: (vx: number, vz: number) => void;
  tick: (dt: number, t: number) => void;
  // Melt the storm cloud away when the eye is about to end up inside
  // it. Pass the camera position; the funnel works out the rest.
  setViewer: (x: number, y: number, z: number) => void;
  // Where the mouth of it is, for the spiral to be centred on.
  readonly height: number;
};

const CLOUD_DARK = new THREE.Color(0x4c5560);
const CLOUD = new THREE.Color(0x8f98a4);
const SPRAY = new THREE.Color(0xdfe9f2);

// Radius at a height fraction u (0 at the water, 1 at the cloud).
//
// A funnel, which is to say: narrow at the ground and opening steadily
// all the way to the storm. An earlier version pinched in the middle
// and flared hard at both ends, which is the shape of a wine glass —
// it read as a trumpet standing on the sea. The only bulge that
// belongs is the debris cloud in the bottom tenth, where it is tearing
// up the water, and the slight neck just above it.
function funnelRadius(u: number): number {
  return 0.85 + 9.6 * Math.pow(u, 1.4) + 1.7 * Math.pow(1 - u, 9);
}

// The dent it pulls in the sea under it.
//
// Shared, because the ocean has to bend its own height field by
// exactly this much — a funnel drawn standing in a dip on flat water
// is a funnel standing on flat water with a picture of a dip on it.
// The boat rides the same field, so it tips down the slope as it gets
// close, which is most of what says the thing is pulling.
export const SPOUT_DIP_RADIUS = 8;
export const SPOUT_DIP_DEPTH = 1.35;
export function spoutDepression(d: number): number {
  if (d >= SPOUT_DIP_RADIUS) return 0;
  const u = d / SPOUT_DIP_RADIUS;
  const k = 1 - u;
  const bowl = -SPOUT_DIP_DEPTH * k * k * (3 - 2 * k);
  // Water piling up in a ring outside the throat. Suction reads as
  // much from what heaps up around the outside as from the hole in
  // the middle; the k factor takes it back to nothing at the rim so
  // the dent joins the open sea without a step.
  const lip = SPOUT_DIP_DEPTH * 0.9 * k * Math.exp(-Math.pow((u - 0.7) / 0.18, 2));
  return bowl + lip;
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
  // The column tilts; the spray does not. A ring of foam is lying on
  // the sea, and tipping it with the funnel lifts one side of it clear
  // of the water.
  const column = new THREE.Group();
  group.add(column);

  const shells = [1, 0.78].map((scale, i) => {
    const mesh = new THREE.Mesh(makeFunnelGeometry(height, scale, i), shellMat);
    column.add(mesh);
    return { mesh, spin: i === 0 ? 2.4 : 3.9 };
  });

  // The storm it hangs from. A lumpy mass of overlapping spheres, not
  // one squashed one — a single ellipsoid up there reads as a lid on
  // a lamp, and the funnel underneath it as the stem.
  // Transparent so it can get out of the way. The ride up ends with
  // the eye inside this thing — a stack of opaque spheres seen from
  // within is a set of hard-edged slabs cutting across the funnel,
  // which reads as the tornado being clipped off by something. Being
  // swallowed by cloud should look like cloud closing over you, so it
  // fades as the camera arrives instead.
  const capMat = new THREE.MeshStandardMaterial({
    color: 0x5b6572,
    roughness: 1,
    flatShading: true,
    transparent: true,
    depthWrite: false,
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
  column.add(cap);

  // Torn-up water at the foot of it: a small bright disc of froth
  // where it actually touches, and wave rings running out from it.
  //
  // The rings are the bit that reads. One big white annulus was a
  // painted circle the funnel happened to be standing in; thin rings
  // that start tight, widen and fade look like water being pushed
  // away from something, which is what is happening.
  const sprayMat = new THREE.MeshBasicMaterial({
    color: 0xe8f2fa,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const sprayGeo = new THREE.RingGeometry(0.9, 3.1, 32, 3);
  {
    // Laid into the dip, not across the top of it. RingGeometry is in
    // the XY plane and the mesh is tipped flat afterwards, so the
    // height it wants goes in Z.
    const pos = sprayGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getY(i));
      pos.setZ(i, -(spoutDepression(r) + 0.14));
    }
    sprayGeo.computeVertexNormals();
  }
  const spray = new THREE.Mesh(sprayGeo, sprayMat);
  spray.rotation.x = -Math.PI / 2;
  group.add(spray);

  const RIPPLE_COUNT = 4;
  const RIPPLE_PERIOD = 2.3;
  const rippleMat = new THREE.MeshBasicMaterial({
    color: 0xf2f9ff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  // Unit ring, scaled up as it travels — one geometry for all of them.
  const rippleGeo = new THREE.RingGeometry(0.86, 1, 44);
  const ripples = Array.from({ length: RIPPLE_COUNT }, (_, i) => {
    const mesh = new THREE.Mesh(rippleGeo, rippleMat.clone());
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.1;
    mesh.frustumCulled = false;
    group.add(mesh);
    return { mesh, phase: i / RIPPLE_COUNT };
  });

  // Debris caught in the wall of it: chips of water going round.
  const debrisMat = new THREE.MeshBasicMaterial({ color: 0xcfe2f0, fog: false });
  const debrisGeo = new THREE.TetrahedronGeometry(0.26);
  const debris = Array.from({ length: 16 }, (_, i) => {
    const mesh = new THREE.Mesh(debrisGeo, debrisMat);
    column.add(mesh);
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
  let leanX = 0;
  let leanZ = 0;
  let capFade = 1;
  // Measured against the cloud's own spread: the lumps reach about
  // this far from its middle, so inside 15 the eye is among them.
  const CAP_GONE = 15;
  const CAP_CLEAR = 30;
  const capAt = new THREE.Vector3();

  return {
    group,
    height,
    setFury(next) {
      fury = Math.min(1, Math.max(0, next));
    },
    setViewer(x, y, z) {
      cap.getWorldPosition(capAt);
      const d = Math.hypot(x - capAt.x, y - capAt.y, z - capAt.z);
      const want = Math.min(1, Math.max(0, (d - CAP_GONE) / (CAP_CLEAR - CAP_GONE)));
      // Eased rather than snapped, so a fast climb doesn't blink it.
      capFade += (want - capFade) * 0.12;
      capMat.opacity = capFade;
      cap.visible = capFade > 0.02;
    },
    setDrift(vx, vz) {
      const len = Math.hypot(vx, vz);
      if (len < 1e-4) {
        leanX = 0;
        leanZ = 0;
        return;
      }
      leanX = vx / len;
      leanZ = vz / len;
    },
    tick(dt) {
      clock += dt;
      const speed = 1 + fury * 2.4;
      for (const s of shells) s.mesh.rotation.y += dt * s.spin * speed;
      spray.rotation.z -= dt * 1.6 * speed;
      // Wave rings, each on the same journey a beat apart: tight and
      // bright at the foot, wide and gone by the time they are out.
      for (const r of ripples) {
        const k = (clock / RIPPLE_PERIOD + r.phase) % 1;
        const spread = 2.2 + k * (11 + fury * 5);
        r.mesh.scale.set(spread, spread, 1);
        // A ring is thin enough to take a single height, so it can
        // just ride the dip's profile at the radius it has reached and
        // climb out of it as it goes.
        r.mesh.position.y = spoutDepression(spread) + 0.1;
        // Thins as it widens, so it stays a wave and not a hoop.
        (r.mesh.material as THREE.MeshBasicMaterial).opacity =
          (0.34 + fury * 0.3) * Math.min(1, k / 0.12) * Math.pow(1 - k, 1.5);
      }
      spray.scale.setScalar(1 + fury * 0.3 + Math.sin(clock * 3) * 0.04);
      sprayMat.opacity = 0.34 + fury * 0.36;
      cap.rotation.y += dt * 0.28 * speed;
      // Leans the way it is going, with the top leading — a funnel
      // gets dragged along by the storm above it. Rotating about +Z
      // tips the top toward -X and about +X tips it toward -Z, hence
      // the signs.
      const lean = 0.17;
      const sway = Math.sin(clock * 0.7) * 0.02;
      column.rotation.z += (-lean * leanX + sway - column.rotation.z) * Math.min(1, dt * 2.5);
      column.rotation.x += (-lean * leanZ - column.rotation.x) * Math.min(1, dt * 2.5);
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
