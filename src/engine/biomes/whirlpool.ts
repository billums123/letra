import * as THREE from "three";

// A whirlpool roaming the ocean, and the way down to the sea floor.
//
// Deliberately NOT built like the waterspout. The first version was a
// cone with a helix in its vertex colours — which is exactly what the
// waterspout is, pointed the other way, and from any distance the two
// read as the same object. Worse, a cone standing in water has a rim
// above the surface, and that rim showed as a hard-edged silhouette
// against the sky.
//
// This one has no cone at all. The sea itself bends into a dish (the
// ocean biome bends the water's height field with `eddyDepression`
// below, so the hole is real), and what sits on it is a skin of foam
// with spiral arms, turning. Nothing reaches above the waterline, so
// there is nothing to clip against anything. Where the waterspout is
// a tall grey column under a storm, this is a wide blue dish with a
// black hole in it.

export type Whirlpool = {
  group: THREE.Group;
  // 0 idle, 1 while it has hold of something.
  setFury: (fury: number) => void;
  tick: (dt: number, t: number) => void;
  readonly depth: number;
};

// The dent it makes in the sea. Exported so the biome bends the water
// with exactly the same curve the foam skin is built on — if the two
// drifted apart, the skin would float above the water or sink into it.
export const EDDY_RADIUS = 14;
export const EDDY_DEPTH = 3;
export function eddyDepression(d: number): number {
  if (d >= EDDY_RADIUS) return 0;
  const k = 1 - d / EDDY_RADIUS;
  // Smoothstep: flat where it meets the open sea, so the water's
  // facets do not crease along the rim.
  return -EDDY_DEPTH * k * k * (3 - 2 * k);
}

const FOAM = new THREE.Color(0xf0fbff);
const SHALLOW = new THREE.Color(0x8fd8ea);
const DEEP = new THREE.Color(0x0f4a6b);

export function buildWhirlpool(opts: { throat?: number } = {}): Whirlpool {
  const throatDrop = opts.throat ?? 9;
  const group = new THREE.Group();
  group.frustumCulled = false;

  // ── The turning surface ──────────────────────────────────────────
  // Two skins of foam lying on the dish, turning at different rates.
  // Spiral arms in the vertex colours are the whole effect: rotate a
  // disc whose pattern is a spiral and the water is going round.
  const skinMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  // `lift` has to clear the wave crest. The wave field runs to about
  // 0.22 either way, so a skin sitting a few hundredths above the
  // dish gets poked through by every passing swell — which shows as
  // hard-edged dark patches tearing across the vortex, and is what a
  // whirlpool looked like from close up.
  const skins = [
    { arms: 2, twist: 0.62, lift: 0.3, spin: -0.85, alpha: 1 },
    { arms: 3, twist: 0.95, lift: 0.42, spin: -1.5, alpha: 0.72 },
  ].map((spec) => {
    const mesh = new THREE.Mesh(
      makeSkinGeometry(spec.arms, spec.twist, spec.lift, spec.alpha),
      skinMat
    );
    group.add(mesh);
    return { mesh, spin: spec.spin };
  });

  // ── The hole ─────────────────────────────────────────────────────
  // A dark shaft dropping away under the middle of the dish. Closed
  // at the bottom so there is something to see rather than sky.
  const throatMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    fog: false,
  });
  // Narrower than the hole in the foam skin, and its rim tucked
  // BELOW the bottom of the dish. The first version was a touch wider
  // and sat four tenths of a unit proud of the water, which from a
  // low angle showed as a hard black card lying on the sea — the one
  // remaining bit of scrim on an otherwise clean vortex.
  const throat = new THREE.Mesh(
    makeThroatGeometry(1.02, 0.42, throatDrop),
    throatMat
  );
  throat.position.y = -EDDY_DEPTH - throatDrop / 2 - 0.35;
  group.add(throat);
  const throatFloor = new THREE.Mesh(
    new THREE.CircleGeometry(0.46, 18),
    new THREE.MeshBasicMaterial({ color: 0x020a10, fog: false })
  );
  throatFloor.rotation.x = -Math.PI / 2;
  throatFloor.position.y = -EDDY_DEPTH - throatDrop - 0.3;
  group.add(throatFloor);

  // ── Wake ─────────────────────────────────────────────────────────
  // Wave rings running outward, the same as the waterspout's — which
  // is fine, because rings on water are rings on water.
  const RIPPLE_COUNT = 4;
  const RIPPLE_PERIOD = 2.6;
  const rippleGeo = new THREE.RingGeometry(0.9, 1, 48);
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
    // Above the wave crest, same reason as the skins.
    mesh.position.y = 0.3;
    mesh.frustumCulled = false;
    group.add(mesh);
    return { mesh, phase: i / RIPPLE_COUNT };
  });

  // Spray going round the wall of it, riding the dish rather than
  // orbiting in mid-air.
  const fleckMat = new THREE.MeshBasicMaterial({ color: 0xf6fdff, fog: false });
  const fleckGeo = new THREE.TetrahedronGeometry(0.2);
  const flecks = Array.from({ length: 20 }, (_, i) => {
    const mesh = new THREE.Mesh(fleckGeo, fleckMat);
    group.add(mesh);
    return { mesh, r: 3 + (i % 6) * 1.7, angle: i * 1.9, rate: 1.5 + (i % 4) * 0.45 };
  });

  let fury = 0;
  let clock = 0;

  return {
    group,
    depth: EDDY_DEPTH,
    setFury(next) {
      fury = Math.min(1, Math.max(0, next));
    },
    tick(dt) {
      clock += dt;
      const speed = 1 + fury * 2.4;
      for (const s of skins) s.mesh.rotation.y += dt * s.spin * speed;
      // The hole widens and deepens its spin when it has something.
      throat.scale.setScalar(1 + fury * 0.25);
      throat.rotation.y += dt * -2.2 * speed;
      for (const r of ripples) {
        const k = (clock / RIPPLE_PERIOD + r.phase) % 1;
        const spread = EDDY_RADIUS + k * (11 + fury * 4);
        r.mesh.scale.set(spread, spread, 1);
        (r.mesh.material as THREE.MeshBasicMaterial).opacity =
          (0.3 + fury * 0.28) * Math.min(1, k / 0.12) * Math.pow(1 - k, 1.5);
      }
      for (const f of flecks) {
        f.angle += dt * f.rate * speed;
        f.mesh.position.set(
          Math.cos(f.angle) * f.r,
          eddyDepression(f.r) + 0.4 + Math.sin(clock * 4 + f.angle) * 0.07,
          Math.sin(f.angle) * f.r
        );
        f.mesh.rotation.set(clock * 2, f.angle, 0);
      }
    },
  };
}

// The shaft under the middle. Dark at the top where it meets the
// water and blacker as it drops, so looking into it reads as depth
// rather than as a hole punched in the scene.
function makeThroatGeometry(top: number, bottom: number, drop: number): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(top, bottom, drop, 28, 8, true);
  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const near = new THREE.Color(0x11455f);
  const far = new THREE.Color(0x01080e);
  for (let i = 0; i < pos.count; i++) {
    const down = Math.min(1, Math.max(0, 0.5 - pos.getY(i) / drop));
    c.copy(near).lerp(far, Math.pow(down, 0.55));
    cols[i * 3] = c.r;
    cols[i * 3 + 1] = c.g;
    cols[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  return geo;
}

// One skin of foam lying on the dish. Its vertices sit on exactly the
// curve the sea is bent to, plus a hair, and its colours are spiral
// arms — pale foam where an arm is, clear water between, and the
// water going darker as it drops toward the hole.
function makeSkinGeometry(
  arms: number,
  twist: number,
  lift: number,
  alpha: number
): THREE.BufferGeometry {
  const geo = new THREE.RingGeometry(1.1, EDDY_RADIUS, 96, 26);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 4);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    pos.setY(i, eddyDepression(r) + lift);
    const theta = Math.atan2(z, x);
    // Arms that wind tighter toward the middle, which is what a
    // vortex does and a cone does not.
    const wind = Math.sin(theta * arms - Math.pow(EDDY_RADIUS / Math.max(1.1, r), 1.1) * 6 * twist);
    const arm = Math.pow(0.5 + 0.5 * wind, 2.2);
    // Deeper water toward the hole, foam on the arms.
    const depth01 = Math.min(1, Math.max(0, 1 - r / EDDY_RADIUS));
    c.copy(SHALLOW).lerp(DEEP, Math.pow(depth01, 0.8));
    c.lerp(FOAM, arm * 0.85);
    // Gone at the outer rim so it blends into open sea, and thickest
    // where the arms are.
    const rim = Math.min(1, (EDDY_RADIUS - r) / 3.5);
    const inner = Math.min(1, (r - 1.1) / 1.2);
    cols[i * 4] = c.r;
    cols[i * 4 + 1] = c.g;
    cols[i * 4 + 2] = c.b;
    cols[i * 4 + 3] = (0.24 + 0.68 * arm) * rim * inner * alpha;
  }
  pos.needsUpdate = true;
  geo.setAttribute("color", new THREE.BufferAttribute(cols, 4));
  return geo;
}
