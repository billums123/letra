import * as THREE from "three";
import type { PlanetSpec } from "../planet";
import { mulberry32, freshSeed } from "../world";
import { SPOT_ANGLE, SPOT_TRIGGER, BEAM_HEIGHT, SPOT_DIRS } from "./sunLayout";

// The sun, built as somewhere you can actually stand.
//
// It doubles as the ocean biome's distant space prop — the same
// object that rises over the horizon on a mega launch is the one the
// avatar lands on, so there is never a swap or a second sun. Every
// material fades together via setOpacity(), which the biome drives
// from the avatar's altitude.
//
// Everything lives in one group centred on the sun, and surface
// features are placed by unit direction rather than xyz, which keeps
// them honest when the radius gets tuned.

export type SunWorld = {
  group: THREE.Group;
  center: THREE.Vector3;
  radius: number;
  // Pass to engine.launchToPlanet(). Walking surface sits `hover`
  // above the visible shell.
  spec: PlanetSpec;
  // 0 = invisible (down at sea level), 1 = full space.
  setOpacity: (k: number) => void;
  // `viewer` is a world-space point to shade toward and to turn the
  // portal light-shafts against — the avatar stands in for the camera,
  // which trails it by a fixed offset.
  tick: (dt: number, t: number, viewer?: THREE.Vector3) => void;
  // Set by the biome: fired once when the avatar drives into a portal.
  onEnterSpot?: (dir: THREE.Vector3) => void;
  // Suppresses portal triggers — the biome arms them a beat after
  // touchdown so a landing right beside one doesn't bounce the kid
  // straight home again.
  armExits: (armed: boolean) => void;
  // Flare the portal at `dir`. Called the moment the avatar drives
  // into one: it vanishes, and something has to show that it went
  // somewhere rather than simply stopped existing.
  flashPortal: (dir: THREE.Vector3) => void;
};

// Surface palette, coolest to hottest. Deliberately a narrow range:
// an earlier version ran all the way to near-white and the star came
// out looking like a blotchy cheese ball. Molten metal barely changes
// hue — it changes brightness — so the ramp stays inside orange.
const COOL = new THREE.Color(0xd8410a);
const MID = new THREE.Color(0xff8b1e);
const HOT = new THREE.Color(0xffc25c);

// Plasma arcs. Bright where they leave the surface, deepening as they
// climb — the opposite reads as glowing wire. Three stops rather than
// two: interpolating straight from cream to red passes through pink,
// and a pink prominence looks like a bent drinking straw.
const FLARE_FOOT = new THREE.Color(0xfff2c8);
const FLARE_MID = new THREE.Color(0xff9a20);
const FLARE_TIP = new THREE.Color(0xd93409);

// The portal pool: ocean seen through a hole in a star.
const POOL_DEEP = new THREE.Color(0x0a3a68);
const POOL_MID = new THREE.Color(0x1f86bd);
const POOL_BRIGHT = new THREE.Color(0x7fe0ee);

// Cheap smooth 3D noise. Real granulation cells are big soft blobs,
// so the value a point gets has to vary smoothly with WHERE it is —
// sampling per face with an independent seed gives a checkerboard,
// which is exactly what a star does not look like.
function cellNoise(x: number, y: number, z: number, k: number): number {
  return (
    Math.sin(x * k) * Math.sin(y * k * 1.31 + 1.7) * Math.sin(z * k * 0.87 + 4.1) +
    0.5 * Math.sin(x * k * 2.13 + 2.4) * Math.sin(z * k * 1.77 + 0.6)
  );
}

export function buildSunWorld(opts: {
  center: THREE.Vector3;
  radius: number;
  hover?: number;
}): SunWorld {
  const { center, radius } = opts;
  const hover = opts.hover ?? 0.35;
  const rand = mulberry32(freshSeed());
  const group = new THREE.Group();
  group.position.copy(center);
  // Never culled: the camera is often 300 units away looking at a
  // 28-unit ball, and the bounding-sphere test on the animated body
  // is not worth the risk of a pop.
  group.frustumCulled = false;

  const fading: Array<{ opacity: number }> = [];

  // ── Body ─────────────────────────────────────────────────────────
  // Icosahedron rather than a UV sphere: its triangles are near enough
  // equal all over, so nothing pinches at the poles.
  //
  // `detail` splits every edge into detail+1, so the face count is
  // 20 * (detail+1)^2 — NOT 4^detail. Detail 20 is 8.8k faces.
  //
  // Colour is per VERTEX and sampled from the vertex's own position,
  // not per face from its centroid. The geometry is non-indexed, so
  // the three copies of a shared corner all sample the same point and
  // come out the same colour — which makes the shading continuous
  // across every edge. Per-face was a visible mosaic of triangles; the
  // silhouette is round either way.
  const bodyGeo = new THREE.IcosahedronGeometry(radius, 20);
  const bodyPos = bodyGeo.attributes.position;
  const vertCount = bodyPos.count;
  const colors = new Float32Array(vertCount * 3);
  bodyGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const vertBase = new Float32Array(vertCount);
  const vertPhase = new Float32Array(vertCount);
  const spin = rand() * 10;
  for (let v = 0; v < vertCount; v++) {
    const x = bodyPos.getX(v);
    const y = bodyPos.getY(v);
    const z = bodyPos.getZ(v);
    const big = cellNoise(x + spin, y, z, 0.19);
    const fine = cellNoise(x + spin, y, z, 0.55);
    const grain = cellNoise(x + spin, y, z, 1.25);
    vertBase[v] = Math.min(1, Math.max(0, 0.5 + big * 0.36 + fine * 0.12 + grain * 0.05));
    vertPhase[v] = big * 3.4 + fine * 1.1;
  }
  const bodyMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    fog: false,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.frustumCulled = false;
  group.add(body);
  fading.push(bodyMat);
  const vertColor = new THREE.Color();

  // ── Corona ───────────────────────────────────────────────────────
  // A gradient sprite; a sphere cannot fade out at its own edge, and
  // dimming one just gives a duller flat disc.
  const glowTex = makeRadialTexture([
    [0, "rgba(255,232,178,0.95)"],
    [0.2, "rgba(255,176,80,0.55)"],
    [0.45, "rgba(255,116,32,0.2)"],
    [1, "rgba(255,96,20,0)"],
  ]);
  const haloMat = new THREE.SpriteMaterial({
    map: glowTex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const halo = new THREE.Sprite(haloMat);
  halo.scale.setScalar(radius * 3.2);
  group.add(halo);

  // ── Flares ───────────────────────────────────────────────────────
  // Loops of plasma that leave the surface and come back down. Built
  // as tapered tubes along a curve whose ends are BURIED below the
  // shell — an earlier version used torus arcs, whose flat cut ends
  // hung visibly in space off the limb and made the whole thing read
  // as a bent plastic handle.
  const flareMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    fog: false,
  });
  fading.push(flareMat);
  const flares: Array<{ mesh: THREE.Mesh; rate: number; phase: number }> = [];
  const FLARE_COUNT = 5;
  for (let i = 0; i < FLARE_COUNT; i++) {
    // Anchored well away from the north pole, which every arrival
    // lands on, and spread around the equator.
    const lat = -0.55 + rand() * 1.1;
    const lon = (i / FLARE_COUNT) * Math.PI * 2 + rand() * 0.6;
    // Feet closer together and the arc taller than it is wide, so it
    // stands up off the star. Wide and low reads as a handle lying on
    // the surface.
    const span = 0.26 + rand() * 0.14;
    const footA = dirAt(lat, lon - span / 2);
    const footB = dirAt(lat + (rand() - 0.5) * 0.2, lon + span / 2);
    const mesh = new THREE.Mesh(
      makeFlareGeometry(radius, footA, footB, radius * (0.3 + rand() * 0.18)),
      flareMat
    );
    mesh.frustumCulled = false;
    group.add(mesh);
    flares.push({ mesh, rate: 0.4 + rand() * 0.45, phase: rand() * Math.PI * 2 });
  }

  // ── Portals ──────────────────────────────────────────────────────
  // Pools of ocean set into the plasma, ringed with white-hot rock
  // where the two meet, each under a soft shaft of cool light that
  // clears the horizon from a long way off. Drive into one and the
  // sun drops the kid back into the sea.
  const poolMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    fog: false,
  });
  const rimMat = new THREE.MeshBasicMaterial({
    color: 0xfff8e2,
    transparent: true,
    opacity: 0,
    fog: false,
    side: THREE.DoubleSide,
  });
  const scorchMat = new THREE.MeshBasicMaterial({
    color: 0x8c2f08,
    transparent: true,
    opacity: 0,
    fog: false,
    side: THREE.DoubleSide,
  });
  fading.push(poolMat, rimMat, scorchMat);

  // One shaft texture and one plane, shared: soft-edged in both axes
  // so the column has no silhouette to give it away as a cone. The
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
  const poolR = radius * Math.sin(SPOT_TRIGGER);
  const shaftGeo = new THREE.PlaneGeometry(poolR * 1.7, BEAM_HEIGHT);
  // A soft shaft alone is legible up close and a smudge from across
  // the star. The point of light at its tip is the bit that actually
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

  const poolGeo = makePoolGeometry(radius + 0.06, SPOT_TRIGGER);
  // Thin and white-hot: this is plasma boiling where it meets the
  // water, not the lip of a bath.
  const rimGeo = new THREE.SphereGeometry(
    radius + 0.13,
    48,
    3,
    0,
    Math.PI * 2,
    SPOT_TRIGGER - SPOT_ANGLE * 0.01,
    SPOT_ANGLE * 0.085
  );
  const scorchGeo = new THREE.SphereGeometry(
    radius + 0.03,
    48,
    4,
    0,
    Math.PI * 2,
    SPOT_TRIGGER + SPOT_ANGLE * 0.08,
    SPOT_ANGLE * 0.22
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
  for (const dir of SPOT_DIRS) {
    const pool = new THREE.Mesh(poolGeo, poolMat);
    const rim = new THREE.Mesh(rimGeo, rimMat);
    const scorch = new THREE.Mesh(scorchGeo, scorchMat);
    for (const m of [pool, rim, scorch]) m.frustumCulled = false;
    const shaft = new THREE.Mesh(shaftGeo, shaftMat);
    shaft.position.y = radius + BEAM_HEIGHT / 2 - 1.2;
    shaft.frustumCulled = false;
    const spark = new THREE.Sprite(sparkMat);
    spark.position.y = radius + BEAM_HEIGHT - 2.4;
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

  // ── Light ────────────────────────────────────────────────────────
  // Standing on a star, the light comes from under your feet. decay 0
  // because the avatar is a full radius from the centre and physical
  // falloff over that distance leaves nothing; this is a fill light
  // standing in for "the ground is on fire", not a physical source.
  const glow = new THREE.PointLight(0xffc27a, 0, radius * 2.4, 0);
  group.add(glow);

  let armed = false;
  let insidePortal = false;
  let opacity = 0;
  let colorClock = 0;

  const spec: PlanetSpec = {
    center,
    radius,
    hover,
    onWalk: (dir) => {
      let hit = false;
      for (const p of portals) {
        if (dir.angleTo(p.dir) < SPOT_TRIGGER) {
          hit = true;
          if (armed && !insidePortal) world.onEnterSpot?.(p.dir);
          break;
        }
      }
      insidePortal = hit;
    },
  };

  const world: SunWorld = {
    group,
    center,
    radius,
    spec,
    setOpacity(k) {
      opacity = Math.min(1, Math.max(0, k));
      for (const m of fading) m.opacity = opacity;
      flareMat.opacity = opacity * 0.95;
      rimMat.opacity = opacity;
      shaftMat.opacity = opacity * 0.85;
      sparkMat.opacity = opacity;
      glow.intensity = opacity * 2.6;
      group.visible = opacity > 0.01;
    },
    armExits(next) {
      armed = next;
      if (!next) insidePortal = false;
    },
    flashPortal(dir) {
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
      if (!group.visible) return;
      // The corona is a sprite three suns wide. Seen from a long way
      // off that is the glow; seen from the surface it is a brown
      // sheet across the whole sky. So it fades out as the viewer
      // closes in, and is gone well before touchdown.
      const viewDist = viewer ? viewer.distanceTo(center) : radius * 12;
      const near = Math.min(1, Math.max(0, (viewDist - radius * 1.5) / (radius * 2.5)));
      haloMat.opacity = opacity * 0.9 * near;
      halo.visible = near > 0.01;
      halo.scale.setScalar(radius * (3.2 + Math.sin(t * 0.7) * 0.1));

      // Granulation, plus limb darkening against the viewer. Rewriting
      // 26k vertex colours every frame is wasted work on a surface
      // that boils this slowly, so it runs at ~12Hz and the eye cannot
      // tell. The darkening is what stops a self-lit sphere reading as
      // flat paper: the ground under your feet is the brightest thing
      // in shot and it falls off toward the horizon.
      colorClock += dt;
      if (colorClock > 0.08) {
        colorClock = 0;
        const vx = viewer ? viewer.x - center.x : 0;
        const vy = viewer ? viewer.y - center.y : radius * 12;
        const vz = viewer ? viewer.z - center.z : 0;
        for (let v = 0; v < vertCount; v++) {
          const heat = Math.min(
            1,
            Math.max(0, vertBase[v] + 0.16 * Math.sin(t * 0.4 + vertPhase[v]))
          );
          if (heat < 0.5) vertColor.copy(COOL).lerp(MID, heat * 2);
          else vertColor.copy(MID).lerp(HOT, (heat - 0.5) * 2);
          const cx = bodyPos.getX(v);
          const cy = bodyPos.getY(v);
          const cz = bodyPos.getZ(v);
          let dx = vx - cx;
          let dy = vy - cy;
          let dz = vz - cz;
          const dl = Math.hypot(dx, dy, dz) || 1;
          dx /= dl;
          dy /= dl;
          dz /= dl;
          // Limb darkening. The floor is deliberately high: with the
          // avatar standing barely a third of a unit off the surface,
          // the view direction goes tangential within a couple of
          // units, and any stronger falloff turns the ground under
          // its feet into mud a step away.
          const facing = (cx * dx + cy * dy + cz * dz) / radius;
          const lit = 0.74 + 0.26 * Math.sqrt(Math.max(0, facing));
          colors[v * 3] = vertColor.r * lit;
          colors[v * 3 + 1] = vertColor.g * lit;
          colors[v * 3 + 2] = vertColor.b * lit;
        }
        bodyGeo.attributes.color.needsUpdate = true;
      }

      for (const f of flares) {
        // Breathe along the surface normal only, so the feet stay put
        // and the arc rises and settles like something alive.
        const s = 1 + Math.sin(t * f.rate + f.phase) * 0.06;
        f.mesh.scale.setScalar(s);
      }

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
  world.setOpacity(0);
  return world;
}

// A unit direction from latitude (-1..1 as a sine) and longitude.
function dirAt(latSin: number, lon: number): THREE.Vector3 {
  const y = Math.max(-0.95, Math.min(0.95, latSin));
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  return new THREE.Vector3(Math.cos(lon) * r, y, Math.sin(lon) * r).normalize();
}

// One plasma arc: a tube that leaves the surface at footA, loops to
// `height` above it, and comes back down at footB. Both ends sink
// below the shell so there is no cut face to see, and the tube tapers
// toward the apex so it reads as flame rather than pipe. Vertices
// carry a foot-to-tip colour ramp.
function makeFlareGeometry(
  radius: number,
  footA: THREE.Vector3,
  footB: THREE.Vector3,
  height: number
): THREE.BufferGeometry {
  const mid = footA.clone().add(footB).normalize();
  const shoulderA = footA.clone().lerp(mid, 0.4).normalize();
  const shoulderB = footB.clone().lerp(mid, 0.4).normalize();
  const curve = new THREE.CatmullRomCurve3(
    [
      footA.clone().multiplyScalar(radius * 0.88),
      shoulderA.multiplyScalar(radius + height * 0.62),
      mid.clone().multiplyScalar(radius + height),
      shoulderB.multiplyScalar(radius + height * 0.62),
      footB.clone().multiplyScalar(radius * 0.88),
    ],
    false,
    "catmullrom",
    0.45
  );
  const TUBULAR = 44;
  const RADIAL = 8;
  const baseTube = height * 0.16;
  const geo = new THREE.TubeGeometry(curve, TUBULAR, baseTube, RADIAL, false);
  // TubeGeometry lays vertices out as (TUBULAR+1) rings of (RADIAL+1),
  // and its normals point straight out from the curve — so scaling a
  // vertex along its own normal is exactly a change of tube radius.
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const cols = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const u = Math.floor(i / (RADIAL + 1)) / TUBULAR;
    const taper = 0.45 + 0.55 * (1 - Math.sin(Math.PI * u));
    const px = pos.getX(i) + nrm.getX(i) * baseTube * (taper - 1);
    const py = pos.getY(i) + nrm.getY(i) * baseTube * (taper - 1);
    const pz = pos.getZ(i) + nrm.getZ(i) * baseTube * (taper - 1);
    pos.setXYZ(i, px, py, pz);
    const up = Math.sin(Math.PI * u);
    if (up < 0.5) c.copy(FLARE_FOOT).lerp(FLARE_MID, up * 2);
    else c.copy(FLARE_MID).lerp(FLARE_TIP, (up - 0.5) * 2);
    // Self-lit geometry has no form at all, so bake some: the side of
    // the tube facing away from the star reads brighter than the side
    // tucked underneath it.
    const pl = Math.hypot(px, py, pz) || 1;
    const facing =
      (nrm.getX(i) * px + nrm.getY(i) * py + nrm.getZ(i) * pz) / pl;
    const shade = 0.66 + 0.34 * (facing * 0.5 + 0.5);
    cols[i * 3] = c.r * shade;
    cols[i * 3 + 1] = c.g * shade;
    cols[i * 3 + 2] = c.b * shade;
  }
  pos.needsUpdate = true;
  geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  return geo;
}

// The pool of ocean inside a portal: a spherical cap whose vertices
// carry a spiral so that slowly turning the mesh reads as a whirlpool.
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
    // Two arms rather than three, wound tighter and with more
    // contrast, so the whirl actually reads when the mesh turns.
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

function makeRadialTexture(stops: Array<[number, string]>): THREE.CanvasTexture {
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
