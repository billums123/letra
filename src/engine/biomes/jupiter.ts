import * as THREE from "three";
import type { PlanetSpec } from "../planet";
import { mulberry32, freshSeed } from "../world";
import { buildPortals, makeRadialTexture } from "./planetPortals";
import {
  JUPITER_AXIS,
  JUPITER_BEAM_HEIGHT,
  JUPITER_SPOT_ANGLE,
  JUPITER_SPOT_DIRS,
  JUPITER_SPOT_TRIGGER,
  GRS_DIR,
  GRS_HALF_WIDTH,
  GRS_HALF_HEIGHT,
  WHITE_OVALS,
  MOONS,
} from "./jupiterLayout";

// Jupiter: the third place the ocean can throw you, and the big one.
//
// Same bones as the sun and Saturn — a sphere the avatar walks with
// the tangent frame in planet.ts, portals home from planetPortals.ts,
// one fade driven by the biome's altitude curve. What makes it its own
// world is scale and weather.
//
// Saturn is 34 units across and has rings; this is 52 and has a storm
// you can drive into, banded cloud tops with turbulence in them, and
// four moons going round. Standing on it, the horizon is 28 degrees of
// arc away instead of 20, so you genuinely cannot see the next portal
// from the last one and there is something to cross.

export type JupiterWorld = {
  group: THREE.Group;
  center: THREE.Vector3;
  radius: number;
  spec: PlanetSpec;
  setOpacity: (k: number) => void;
  tick: (dt: number, t: number, viewer?: THREE.Vector3) => void;
  onEnterSpot?: (dir: THREE.Vector3) => void;
  armExits: (armed: boolean) => void;
  flashPortal: (dir: THREE.Vector3) => void;
};

// Cloud tops. Higher contrast and more of them than Saturn's, which
// is both true of the real planet and the reason a kid can tell the
// two apart from the far side of the solar system.
const BELT_DEEP = new THREE.Color(0x6f3a1c);
const BELT = new THREE.Color(0xc2762f);
const ZONE = new THREE.Color(0xefcf9c);
const ZONE_BRIGHT = new THREE.Color(0xfdf3e2);
const POLAR = new THREE.Color(0x9d9aa4);

// The Great Red Spot, centre outward. Deliberately weighted toward
// the deep end: an earlier ramp reached the pale colours by a third
// of the way out, so the storm you were standing in the middle of was
// a wash of salmon with a red dot underneath the boat.
const GRS_CORE = new THREE.Color(0x8e2413);
const GRS_MID = new THREE.Color(0xb83c1e);
const GRS_EDGE = new THREE.Color(0xd9713f);
const GRS_COLLAR = new THREE.Color(0xf3d9b8);

function cellNoise(x: number, y: number, z: number, k: number): number {
  return (
    Math.sin(x * k) * Math.sin(y * k * 1.31 + 1.7) * Math.sin(z * k * 0.87 + 4.1) +
    0.5 * Math.sin(x * k * 2.13 + 2.4) * Math.sin(z * k * 1.77 + 0.6)
  );
}

// An oval patch of a sphere, as a cap around `dir` whose extent is an
// ellipse in the tangent plane — wide along `along`, squat across it.
//
// Built as proper rings rather than a triangle fan: a fan has no
// interior vertices, so the spiral colouring inside a storm would have
// nowhere to live. Colour is RGBA per vertex, so the patch can fade
// out at its own rim instead of ending on a hard edge.
function buildStorm(opts: {
  radius: number;
  dir: THREE.Vector3;
  along: THREE.Vector3;
  halfWidth: number;
  halfHeight: number;
  // Called per vertex with (s, phi) — s is 0 at the eye and 1 at the
  // rim, phi is the angle round it. Returns colour and alpha.
  shade: (s: number, phi: number, out: THREE.Color) => number;
  rings?: number;
  segs?: number;
}): THREE.BufferGeometry {
  const { radius, dir, halfWidth, halfHeight, shade } = opts;
  const rings = opts.rings ?? 18;
  const segs = opts.segs ?? 64;

  // Tangent frame: u along the storm's long axis, v across it.
  const u = opts.along.clone().addScaledVector(dir, -opts.along.dot(dir));
  if (u.lengthSq() < 1e-6) u.set(1, 0, 0).addScaledVector(dir, -dir.x);
  u.normalize();
  const v = new THREE.Vector3().crossVectors(dir, u).normalize();

  const verts: number[] = [];
  const cols: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Color();

  const push = (s: number, phi: number) => {
    // Polar form of the ellipse: how far out the rim is on this
    // bearing, as an angle at the planet's centre.
    const rim = 1 / Math.hypot(Math.cos(phi) / halfWidth, Math.sin(phi) / halfHeight);
    const th = s * rim;
    const st = Math.sin(th);
    const x = dir.x * Math.cos(th) + (u.x * Math.cos(phi) + v.x * Math.sin(phi)) * st;
    const y = dir.y * Math.cos(th) + (u.y * Math.cos(phi) + v.y * Math.sin(phi)) * st;
    const z = dir.z * Math.cos(th) + (u.z * Math.cos(phi) + v.z * Math.sin(phi)) * st;
    verts.push(x * radius, y * radius, z * radius);
    const a = shade(s, phi, c);
    cols.push(c.r, c.g, c.b, a);
  };

  // The eye, then a ring per step out.
  push(0, 0);
  for (let r = 1; r <= rings; r++) {
    const s = r / rings;
    for (let k = 0; k < segs; k++) push(s, (k / segs) * Math.PI * 2);
  }
  // First ring fans off the eye.
  for (let k = 0; k < segs; k++) idx.push(0, 1 + k, 1 + ((k + 1) % segs));
  // Everything after is quads.
  for (let r = 1; r < rings; r++) {
    const a = 1 + (r - 1) * segs;
    const b = 1 + r * segs;
    for (let k = 0; k < segs; k++) {
      const k2 = (k + 1) % segs;
      idx.push(a + k, b + k, b + k2, a + k, b + k2, a + k2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 4));
  geo.setIndex(idx);
  return geo;
}

export function buildJupiterWorld(opts: {
  center: THREE.Vector3;
  radius: number;
  hover?: number;
}): JupiterWorld {
  const { center, radius } = opts;
  const hover = opts.hover ?? 0.35;
  const rand = mulberry32(freshSeed());
  const group = new THREE.Group();
  group.position.copy(center);
  group.frustumCulled = false;

  const fading: Array<{ opacity: number }> = [];

  // ── Cloud tops ───────────────────────────────────────────────────
  // Per-vertex colour sampled from the vertex's own position, so
  // shading runs continuously across every edge instead of breaking
  // into a mosaic of flat triangles.
  //
  // Self-lit, like the star and like Saturn. A gas giant lit by the
  // scene's sun has a night side, and a four-year-old who walks onto
  // the night side is standing in the dark on a planet they cannot
  // see.
  const bodyGeo = new THREE.IcosahedronGeometry(radius, 24);
  const bodyPos = bodyGeo.attributes.position;
  const vertCount = bodyPos.count;
  const colors = new Float32Array(vertCount * 3);
  bodyGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const baseTint = new Float32Array(vertCount * 3);
  const spin = rand() * 12;
  const tint = new THREE.Color();
  // A longitude to go with the latitude, so the fine cloud detail can
  // be stretched along the belts instead of being isotropic blobs.
  // Jovian cloud is streaky at every scale; blobs read as porridge.
  const east = new THREE.Vector3(1, 0, 0)
    .addScaledVector(JUPITER_AXIS, -JUPITER_AXIS.x)
    .normalize();
  const north = new THREE.Vector3().crossVectors(JUPITER_AXIS, east).normalize();
  for (let i = 0; i < vertCount; i++) {
    const x = bodyPos.getX(i);
    const y = bodyPos.getY(i);
    const z = bodyPos.getZ(i);
    // Latitude on Jupiter's own axis, not the world's.
    const lat = (x * JUPITER_AXIS.x + y * JUPITER_AXIS.y + z * JUPITER_AXIS.z) / radius;
    const lon = Math.atan2(
      (x * north.x + y * north.y + z * north.z) / radius,
      (x * east.x + y * east.y + z * east.z) / radius
    );
    // Two scales of wobble before the latitude is banded: a broad one
    // that makes the belts wander, and a finer one that frays their
    // edges into festoons. Ruler-straight bands read as a beach ball.
    const wob =
      cellNoise(x + spin, y, z, 0.062) * 0.028 + cellNoise(z, x + spin, y, 0.17) * 0.012;
    const l = lat + wob;
    // Filaments: the belts drawn again at twice the frequency and
    // sheared by longitude, which is what gives the ground underfoot
    // something to look at.
    //
    // This is not decoration. The camera sits seven units above a
    // 52-unit ball, so the bottom half of the screen is about ten
    // degrees of arc — less than one belt wide. Bands alone are
    // correct from orbit and leave the surface you are standing on a
    // single flat wash of cream, which is exactly what the first pass
    // did.
    //
    // The frequencies are capped by the mesh, not by taste. Colour
    // lives on vertices, and at detail 24 the faces are about 2.2
    // units across, so anything with a wavelength under ~4.5 units
    // aliases into mush — a first attempt at 150 was past that line
    // and rendered as nothing at all. 72 puts a filament every 5.5
    // units, which is about five across the visible ground.
    const streak =
      0.13 * Math.sin(l * 41 + lon * 2.6) + 0.07 * Math.sin(l * 27 - lon * 1.7 + 1.3);
    // Slow eddies at the scale the ground underfoot is actually seen
    // at — twenty units or so across. They are what stop the surface
    // you are standing on from being a flat wash, and they are as
    // fine as it can usefully get: colour lives on vertices, and at
    // detail 24 the faces are 2.5 units across, so nothing with a
    // wavelength under about 10 units survives being sampled by them.
    // A first attempt at four times this frequency rendered as
    // literally nothing.
    const eddies = cellNoise(x + spin, y, z, 0.14) * 0.1;
    // Roughly ten band pairs from pole to pole, which is about what
    // the real planet has.
    let band =
      0.5 + 0.34 * Math.sin(l * 30) + 0.2 * Math.sin(l * 13 + 0.7) + streak + eddies;
    // Belts and zones have edges. A plain sum of sines spends most of
    // its time in the middle of the range, which is the mid-tan the
    // whole planet first came out as; pushing it toward the ends gives
    // narrow dark belts against broad bright zones, which is what
    // actually reads as Jupiter from a distance. Not too far, though —
    // past about 2.5 the edges get hard enough to show the triangles
    // they are drawn on, and the bands acquire visible stair-steps.
    band = 0.5 + 0.5 * Math.tanh((band - 0.5) * 2.4);
    band = Math.min(1, Math.max(0, band));
    if (band < 0.3) tint.copy(BELT_DEEP).lerp(BELT, band / 0.3);
    else if (band < 0.62) tint.copy(BELT).lerp(ZONE, (band - 0.3) / 0.32);
    else tint.copy(ZONE).lerp(ZONE_BRIGHT, (band - 0.62) / 0.38);
    // Both caps go cold and hazy, the way Jupiter's do.
    const polar = Math.abs(lat);
    if (polar > 0.78) tint.lerp(POLAR, Math.min(0.75, (polar - 0.78) / 0.22));
    baseTint[i * 3] = tint.r;
    baseTint[i * 3 + 1] = tint.g;
    baseTint[i * 3 + 2] = tint.b;
  }
  const bodyMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    fog: false,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.frustumCulled = false;
  // Drawn before the storms and the moons, so its depth is down when
  // they are tested and the far side of an orbit is properly hidden.
  body.renderOrder = -1;
  group.add(body);
  fading.push(bodyMat);

  // ── The Great Red Spot ───────────────────────────────────────────
  // A storm three quarters the width of the whole ocean world, laid
  // into the cloud tops just above the surface, spinning slowly about
  // its own eye. The spiral is baked into the vertex colours, so
  // turning it is one quaternion a frame rather than any per-vertex
  // work — which is the only reason it can afford to move at all.
  const stormMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });
  fading.push(stormMat);
  // Long axis along the belt it sits in, i.e. across Jupiter's axis.
  const grsAlong = new THREE.Vector3().crossVectors(JUPITER_AXIS, GRS_DIR).normalize();
  const grsGeo = buildStorm({
    radius: radius + 0.05,
    dir: GRS_DIR,
    along: grsAlong,
    halfWidth: GRS_HALF_WIDTH,
    halfHeight: GRS_HALF_HEIGHT,
    rings: 22,
    segs: 80,
    shade: (s, phi, out) => {
      // Two arms wound into a spiral: the angle they sit at shifts
      // with distance from the eye, which is what makes the thing read
      // as turning rather than as a painted target. Two rather than
      // three, and sharpened toward bright ridges with wide dark
      // troughs between, because from anywhere on the surface the
      // storm is seen nearly edge-on and only bold shapes survive the
      // foreshortening.
      const wound = Math.sin(phi * 2 - s * 9 + Math.sin(phi * 2) * 0.5);
      const swirl = 0.5 + 0.5 * Math.sign(wound) * Math.pow(Math.abs(wound), 0.65);
      // A dark eye, a long deep body, and only a thin pale collar at
      // the very rim where it stirs up the cloud around it.
      if (s < 0.12) out.copy(GRS_MID).lerp(GRS_CORE, 1 - s / 0.12);
      else if (s < 0.7) out.copy(GRS_CORE).lerp(GRS_MID, (s - 0.12) / 0.58);
      else if (s < 0.9) out.copy(GRS_MID).lerp(GRS_EDGE, (s - 0.7) / 0.2);
      else out.copy(GRS_EDGE).lerp(GRS_COLLAR, (s - 0.9) / 0.1);
      // The arms brighten and darken the body but leave the eye alone,
      // so the middle stays a solid, readable disc.
      const strength = Math.min(1, s / 0.18) * 0.42;
      out.multiplyScalar(1 - strength + strength * 2 * swirl);
      // Solid through the middle, gone by the rim — no hard edge.
      return s < 0.84 ? 1 : Math.max(0, 1 - (s - 0.84) / 0.16);
    },
  });
  const grs = new THREE.Mesh(grsGeo, stormMat);
  grs.frustumCulled = false;
  grs.renderOrder = 1;
  group.add(grs);

  // The little white ovals that trail along the belts. Same geometry,
  // a tenth of the size, and they hold still.
  for (const oval of WHITE_OVALS) {
    const along = new THREE.Vector3().crossVectors(JUPITER_AXIS, oval.dir).normalize();
    const geo = buildStorm({
      radius: radius + 0.04,
      dir: oval.dir,
      along,
      halfWidth: oval.halfWidth,
      halfHeight: oval.halfHeight,
      rings: 8,
      segs: 40,
      shade: (s, phi, out) => {
        const swirl = 0.5 + 0.5 * Math.sin(phi * 2 - s * 7);
        out.copy(ZONE_BRIGHT).lerp(ZONE, s * 0.55 * (0.5 + 0.5 * swirl));
        return s < 0.66 ? 0.92 : Math.max(0, 0.92 * (1 - (s - 0.66) / 0.34));
      },
    });
    const mesh = new THREE.Mesh(geo, stormMat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    group.add(mesh);
  }

  // ── Moons ────────────────────────────────────────────────────────
  // Four of them, going round at four different speeds. They are the
  // reason the sky over Jupiter is never the same twice, and the
  // reason it reads as a place with a system around it rather than a
  // ball with a texture on.
  const moonMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    fog: false,
  });
  fading.push(moonMat);
  // Orbits are circles about Jupiter's own axis, tilted a little each.
  const orbitU = new THREE.Vector3(1, 0, 0)
    .addScaledVector(JUPITER_AXIS, -JUPITER_AXIS.x)
    .normalize();
  const orbitV = new THREE.Vector3().crossVectors(JUPITER_AXIS, orbitU).normalize();
  const moons = MOONS.map((m) => {
    const geo = new THREE.IcosahedronGeometry(m.radius, 3);
    const mp = geo.attributes.position;
    const mc = new Float32Array(mp.count * 3);
    const warm = new THREE.Color(m.warm);
    const cool = new THREE.Color(m.cool);
    const c = new THREE.Color();
    const seed = rand() * 20;
    for (let i = 0; i < mp.count; i++) {
      const x = mp.getX(i);
      const y = mp.getY(i);
      const z = mp.getZ(i);
      // Blotches rather than bands: these are rock and ice, not gas.
      const n = 0.5 + 0.5 * cellNoise(x + seed, y, z, 1.5 / m.radius);
      c.copy(cool).lerp(warm, Math.min(1, Math.max(0, n)));
      mc[i * 3] = c.r;
      mc[i * 3 + 1] = c.g;
      mc[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(mc, 3));
    const mesh = new THREE.Mesh(geo, moonMat);
    mesh.frustumCulled = false;
    group.add(mesh);
    return { mesh, spec: m };
  });

  // ── Haze ─────────────────────────────────────────────────────────
  // A gas giant has no edge, so the limb gets a breath of atmosphere.
  // Like the star's corona it has to be gone before touchdown, or from
  // the surface it is a sheet across the whole sky.
  const hazeMat = new THREE.SpriteMaterial({
    map: makeRadialTexture([
      [0, "rgba(238,206,166,0.5)"],
      [0.42, "rgba(206,166,136,0.22)"],
      [1, "rgba(150,140,150,0)"],
    ]),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const haze = new THREE.Sprite(hazeMat);
  haze.scale.setScalar(radius * 2.9);
  group.add(haze);

  // ── Portals ──────────────────────────────────────────────────────
  const portals = buildPortals({
    radius,
    dirs: JUPITER_SPOT_DIRS,
    angle: JUPITER_SPOT_ANGLE,
    trigger: JUPITER_SPOT_TRIGGER,
    beamHeight: JUPITER_BEAM_HEIGHT,
    // Warm and pale where the pool meets the cloud, with a rust ring
    // outside it — the belts it is cut into are browner than Saturn's.
    rim: 0xffeccd,
    scorch: 0x6b4327,
  });
  group.add(portals.group);

  // The light is the planet glowing under your feet. decay 0 because
  // the avatar is a full radius out from the centre and physical
  // falloff over 52 units leaves nothing at all.
  const glow = new THREE.PointLight(0xf0dcc0, 0, radius * 2.4, 0);
  group.add(glow);

  let armed = false;
  let insidePortal = false;
  let opacity = 0;
  let colorClock = 0;
  let clock = 0;
  const avatarDir = new THREE.Vector3(0, 1, 0);
  const vertColor = new THREE.Color();

  const spec: PlanetSpec = {
    center,
    radius,
    hover,
    onWalk: (dir) => {
      avatarDir.copy(dir);
      const at = portals.inside(dir);
      if (at && armed && !insidePortal) world.onEnterSpot?.(at);
      insidePortal = at !== null;
    },
  };

  const world: JupiterWorld = {
    group,
    center,
    radius,
    spec,
    setOpacity(k) {
      opacity = Math.min(1, Math.max(0, k));
      for (const m of fading) m.opacity = opacity;
      portals.setOpacity(opacity);
      glow.intensity = opacity * 1.5;
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
      clock += dt;
      const viewDist = viewer ? viewer.distanceTo(center) : radius * 12;
      const near = Math.min(1, Math.max(0, (viewDist - radius * 1.4) / (radius * 2.2)));
      hazeMat.opacity = opacity * 0.8 * near;
      haze.visible = near > 0.01;

      // The storm turns. Slow enough that it is weather rather than a
      // spinning logo — one lap every couple of minutes.
      grs.quaternion.setFromAxisAngle(GRS_DIR, clock * 0.055);

      // Moons, each on its own tilted circle about Jupiter's axis.
      for (const { mesh, spec: m } of moons) {
        const a = m.phase + (clock / m.period) * Math.PI * 2;
        const r = radius * m.orbit;
        mesh.position
          .copy(orbitU)
          .multiplyScalar(Math.cos(a) * r)
          .addScaledVector(orbitV, Math.sin(a) * r)
          // The tilt, so the four of them do not all track the same
          // line across the sky.
          .addScaledVector(JUPITER_AXIS, Math.sin(a + m.phase) * r * m.incline);
      }

      // Limb darkening against the viewer, at ~12Hz. Without it a
      // self-lit sphere reads as flat paper; with it the ground under
      // your feet is the brightest thing in shot and falls away toward
      // the horizon. The bands themselves are baked, so this is the
      // only per-vertex work that happens per frame.
      colorClock += dt;
      if (colorClock > 0.08) {
        colorClock = 0;
        const vx = viewer ? viewer.x - center.x : 0;
        const vy = viewer ? viewer.y - center.y : radius * 12;
        const vz = viewer ? viewer.z - center.z : 0;
        for (let i = 0; i < vertCount; i++) {
          const cx = bodyPos.getX(i);
          const cy = bodyPos.getY(i);
          const cz = bodyPos.getZ(i);
          let dx = vx - cx;
          let dy = vy - cy;
          let dz = vz - cz;
          const dl = Math.hypot(dx, dy, dz) || 1;
          dx /= dl;
          dy /= dl;
          dz /= dl;
          const facing = (cx * dx + cy * dy + cz * dz) / radius;
          const lit = 0.72 + 0.28 * Math.sqrt(Math.max(0, facing));
          vertColor.setRGB(baseTint[i * 3], baseTint[i * 3 + 1], baseTint[i * 3 + 2]);
          colors[i * 3] = vertColor.r * lit;
          colors[i * 3 + 1] = vertColor.g * lit;
          colors[i * 3 + 2] = vertColor.b * lit;
        }
        bodyGeo.attributes.color.needsUpdate = true;
      }

      portals.tick(dt, t, viewer);
    },
  };
  world.setOpacity(0);
  return world;
}
