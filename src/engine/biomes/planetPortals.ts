import * as THREE from "three";

// The way home, on any world you can be set down on.
//
// A portal is a pool of ocean set into the surface, ringed hot where
// the two meet, under a soft shaft of light with a pulsing star at its
// tip. The shaft is what clears the horizon from a long way off, so
// there is always somewhere to drive toward; the pool is drawn at
// exactly the radius that triggers it, so what sends the kid home is
// the thing they can see.
//
// Written once and shared, because the second world wanted precisely
// the same thing and the first world's version was a hundred and fifty
// lines of it.

export type PortalSet = {
  group: THREE.Group;
  // 0 = invisible, 1 = fully there. Driven by the biome's altitude fade.
  setOpacity: (k: number) => void;
  tick: (dt: number, t: number, viewer?: THREE.Vector3) => void;
  // The portal the given surface direction is standing in, or null.
  inside: (dir: THREE.Vector3) => THREE.Vector3 | null;
  // Flare the portal nearest `dir` — something just went through it.
  flash: (dir: THREE.Vector3) => void;
};

// The pool: ocean seen through a hole in another world.
const POOL_DEEP = new THREE.Color(0x0a3a68);
const POOL_MID = new THREE.Color(0x1f86bd);
const POOL_BRIGHT = new THREE.Color(0x7fe0ee);

export function buildPortals(opts: {
  radius: number;
  dirs: readonly THREE.Vector3[];
  // Full extent of the portal's dressing, as an angle at the centre.
  angle: number;
  // The bit you fall through, and the radius the pool is drawn at.
  trigger: number;
  beamHeight: number;
  // Where the pool boils against the surface, and the scorched ring
  // outside it. Both are world-specific: white-hot on a star, cold
  // and pale on a gas giant.
  rim: number;
  scorch: number;
}): PortalSet {
  const { radius, dirs, angle, trigger, beamHeight } = opts;
  const group = new THREE.Group();
  const fading: Array<{ opacity: number }> = [];

  const poolMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    fog: false,
  });
  const rimMat = new THREE.MeshBasicMaterial({
    color: opts.rim,
    transparent: true,
    opacity: 0,
    fog: false,
    side: THREE.DoubleSide,
  });
  const scorchMat = new THREE.MeshBasicMaterial({
    color: opts.scorch,
    transparent: true,
    opacity: 0,
    fog: false,
    side: THREE.DoubleSide,
  });
  fading.push(poolMat, scorchMat);

  // One shaft texture and one plane, shared: soft-edged in both axes
  // so the column has no silhouette to give it away as a cone. An
  // earlier version was an open cylinder, which from the surface read
  // as a solid white party hat with a grey lid.
  const shaftTex = makeShaftTexture();
  shaftTex.colorSpace = THREE.SRGBColorSpace;
  const shaftMat = new THREE.MeshBasicMaterial({
    map: shaftTex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    side: THREE.DoubleSide,
  });
  // A soft shaft alone is legible up close and a smudge from across
  // the world. The point of light at its tip is the bit that actually
  // carries: it is crisp, it pulses, and it is the first thing to
  // clear the horizon.
  const sparkMat = new THREE.SpriteMaterial({
    map: makeRadialTexture([
      [0, "rgba(238,252,255,1)"],
      [0.18, "rgba(168,226,255,0.72)"],
      [1, "rgba(120,196,255,0)"],
    ]),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });

  const poolR = radius * Math.sin(trigger);
  const shaftGeo = new THREE.PlaneGeometry(poolR * 1.7, beamHeight);
  const poolGeo = makePoolGeometry(radius + 0.06, trigger);
  // Thin and hot: this is the surface boiling where it meets the
  // water, not the lip of a bath.
  const rimGeo = new THREE.SphereGeometry(
    radius + 0.13,
    48,
    3,
    0,
    Math.PI * 2,
    trigger - angle * 0.01,
    angle * 0.085
  );
  const scorchGeo = new THREE.SphereGeometry(
    radius + 0.03,
    48,
    4,
    0,
    Math.PI * 2,
    trigger + angle * 0.08,
    angle * 0.22
  );

  const portals: Array<{
    dir: THREE.Vector3;
    pivot: THREE.Group;
    pool: THREE.Mesh;
    shaft: THREE.Mesh;
    spark: THREE.Sprite;
    flash: number;
  }> = [];
  const localViewer = new THREE.Vector3();
  for (const dir of dirs) {
    const pool = new THREE.Mesh(poolGeo, poolMat);
    const rim = new THREE.Mesh(rimGeo, rimMat);
    const scorch = new THREE.Mesh(scorchGeo, scorchMat);
    for (const m of [pool, rim, scorch]) m.frustumCulled = false;
    const shaft = new THREE.Mesh(shaftGeo, shaftMat);
    shaft.position.y = radius + beamHeight / 2 - 1.2;
    shaft.frustumCulled = false;
    const spark = new THREE.Sprite(sparkMat);
    spark.position.y = radius + beamHeight - 2.4;
    spark.scale.setScalar(poolR * 1.2);
    spark.frustumCulled = false;
    const pivot = new THREE.Group();
    // Everything is modelled around +Y, so one rotation stands the
    // whole portal up on its own patch of the sphere.
    pivot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    pivot.add(pool, rim, scorch, shaft, spark);
    group.add(pivot);
    portals.push({ dir, pivot, pool, shaft, spark, flash: 0 });
  }

  let opacity = 0;

  return {
    group,
    setOpacity(k) {
      opacity = Math.min(1, Math.max(0, k));
      for (const m of fading) m.opacity = opacity;
      rimMat.opacity = opacity;
      shaftMat.opacity = opacity * 0.85;
      sparkMat.opacity = opacity;
    },
    inside(dir) {
      for (const p of portals) if (dir.angleTo(p.dir) < trigger) return p.dir;
      return null;
    },
    flash(dir) {
      let best: (typeof portals)[number] | null = null;
      let bestAngle = Infinity;
      for (const p of portals) {
        const a = dir.angleTo(p.dir);
        if (a < bestAngle) {
          bestAngle = a;
          best = p;
        }
      }
      if (best) best.flash = 1;
    },
    tick(dt, t, viewer) {
      const sparkPulse = 1 + Math.sin(t * 2.1) * 0.16;
      for (const p of portals) {
        // The whirl speeds up sharply for the moment something goes
        // through it, then settles back.
        if (p.flash > 0) p.flash = Math.max(0, p.flash - dt * 1.7);
        const burst = p.flash * p.flash;
        p.pool.rotation.y += dt * (0.35 + burst * 5);
        p.spark.scale.setScalar(poolR * 1.2 * (sparkPulse + burst * 1.9));
        // The shaft is one flat plane. Spinning it about the portal's
        // own up-axis to face the viewer is what keeps it reading as a
        // volume of light from every angle, at the cost of one matrix
        // inverse per portal per frame.
        if (viewer) {
          localViewer.copy(viewer);
          p.pivot.worldToLocal(localViewer);
          p.shaft.rotation.y = Math.atan2(localViewer.x, localViewer.z);
        }
      }
    },
  };
}

// The pool inside a portal: a spherical cap whose vertices carry a
// spiral, so slowly turning the mesh reads as a whirlpool.
function makePoolGeometry(r: number, capAngle: number): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(r, 44, 14, 0, Math.PI * 2, 0, capAngle);
  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // How far out from the middle of the pool, 0..1.
    const out = Math.min(1, Math.acos(Math.max(-1, Math.min(1, y / r))) / capAngle);
    const ang = Math.atan2(z, x);
    // Two arms, wound tight, with enough contrast that the whirl
    // actually reads when the mesh turns.
    const swirl = Math.sin(ang * 2 + out * 9.5);
    const v = Math.min(1, Math.max(0, 0.26 + out * 0.42 + swirl * 0.32));
    if (v < 0.5) c.copy(POOL_DEEP).lerp(POOL_MID, v * 2);
    else c.copy(POOL_MID).lerp(POOL_BRIGHT, (v - 0.5) * 2);
    cols[i * 3] = c.r;
    cols[i * 3 + 1] = c.g;
    cols[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  return geo;
}

export function makeRadialTexture(stops: Array<[number, string]>): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [at, color] of stops) grd.addColorStop(at, color);
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// A soft-edged shaft of light: bright at the bottom, gone at the top,
// and feathered on both sides so the plane it lives on never shows.
function makeShaftTexture(): THREE.CanvasTexture {
  const W = 64;
  const H = 192;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    // Three flips the image, so row 0 ends up at the TOP of the plane
    // — which is the top of the shaft, where the light has to be gone.
    const up = y / (H - 1);
    const vertical = Math.pow(up, 2.0);
    for (let x = 0; x < W; x++) {
      const across = 1 - Math.abs(((x + 0.5) / W) * 2 - 1);
      const a = Math.pow(across, 2.2) * vertical;
      const o = (y * W + x) * 4;
      img.data[o] = 205;
      img.data[o + 1] = 238;
      img.data[o + 2] = 255;
      img.data[o + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}
