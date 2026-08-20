import * as THREE from "three";
import type { PlanetSpec } from "../planet";
import { mulberry32, freshSeed } from "../world";
import { buildPortals, makeRadialTexture } from "./planetPortals";
import { makeLimbShader } from "./limbDarkening";
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
  // The way home. Shared with every other world you can be set down
  // on — see planetPortals.ts — with the rim and scorch colours the
  // only thing a star does differently.
  const portals = buildPortals({
    radius,
    dirs: SPOT_DIRS,
    angle: SPOT_ANGLE,
    trigger: SPOT_TRIGGER,
    beamHeight: BEAM_HEIGHT,
    rim: 0xfff8e2,
    scorch: 0x8c2f08,
  });
  group.add(portals.group);

  // ── Light ────────────────────────────────────────────────────────
  // Standing on a star, the light comes from under your feet. decay 0
  // because the avatar is a full radius from the centre and physical
  // falloff over that distance leaves nothing; this is a fill light
  // standing in for "the ground is on fire", not a physical source.
  const glow = new THREE.PointLight(0xffc27a, 0, radius * 2.4, 0);
  group.add(glow);

  // The unlit colour of the surface, which the shader multiplies the
  // darkening into. It is rewritten a slice at a time as the star
  // boils, rather than being fixed the way the gas giants' bands are.
  const heatTint = new Float32Array(vertCount * 3);
  const heatColor = new THREE.Color();
  const limb = makeLimbShader({
    geo: bodyGeo,
    center,
    radius,
    base: heatTint,
    // The floor is deliberately high: with the avatar standing barely
    // a third of a unit off the surface, the view direction goes
    // tangential within a couple of units, and any stronger falloff
    // turns the ground under its feet into mud a step away.
    floor: 0.74,
    gain: 0.26,
    maxIdle: 0.34,
    refresh: (from, to, t) => {
      for (let v = from; v < to; v++) {
        const heat = Math.min(
          1,
          Math.max(0, vertBase[v] + 0.16 * Math.sin(t * 0.4 + vertPhase[v]))
        );
        if (heat < 0.5) heatColor.copy(COOL).lerp(MID, heat * 2);
        else heatColor.copy(MID).lerp(HOT, (heat - 0.5) * 2);
        heatTint[v * 3] = heatColor.r;
        heatTint[v * 3 + 1] = heatColor.g;
        heatTint[v * 3 + 2] = heatColor.b;
      }
    },
  });

  let armed = false;
  let insidePortal = false;
  let opacity = 0;

  const spec: PlanetSpec = {
    center,
    radius,
    hover,
    onWalk: (dir) => {
      const at = portals.inside(dir);
      if (at && armed && !insidePortal) world.onEnterSpot?.(at);
      insidePortal = at !== null;
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
      portals.setOpacity(opacity);
      glow.intensity = opacity * 2.6;
      group.visible = opacity > 0.01;
    },
    armExits(next) {
      armed = next;
      if (!next) insidePortal = false;
    },
    flashPortal(dir) {
      portals.flash(dir);
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

      // Granulation and limb darkening. Unlike the gas giants this
      // surface moves whether or not anyone does, so it also gets a
      // ceiling on how long it may sit still — but it boils slowly
      // enough that a third of a second between passes is invisible.
      // See limbDarkening.ts.
      limb.tick(viewer, dt, t);

      for (const f of flares) {
        // Breathe along the surface normal only, so the feet stay put
        // and the arc rises and settles like something alive.
        const s = 1 + Math.sin(t * f.rate + f.phase) * 0.06;
        f.mesh.scale.setScalar(s);
      }

      portals.tick(dt, t, viewer);
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

