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
  GRS_DRIFT,
  STRIKE_GAP,
  STRIKE_SECONDS,
  THUNDER_FULL,
  THUNDER_GONE,
  THUNDER_SPEED,
  THUNDER_MIN_GAP,
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
  // A storm just cracked, and the sound has finished crossing to the
  // listener. Volume is already distance-weighted; 0 means don't
  // bother. The biome owns the audio, this world only says when.
  onThunder?: (volume: number) => void;
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

// Curdled cloud in a storm's own polar coordinates.
//
// Every coefficient here is chosen so the pattern closes on itself.
// The caller passes r = 2*phi + something(s), so a term sin(k*r) only
// comes back round after a full turn when 2k is a whole number — and
// a term in phi only when its own coefficient is. Get one of them
// wrong and the storm has a hard radial notch where the last ring
// meets the first, which is exactly what 2.7 and 5.3 gave it.
function curl(r: number, phi: number): number {
  return (
    0.55 * Math.sin(r + 2.6 * Math.sin(phi * 2 + r * 0.5)) +
    0.28 * Math.sin(r * 2.5 - phi * 3 + 1.9) +
    0.17 * Math.sin(r * 5.5 + phi * 7 + 0.6)
  );
}

function cellNoise(x: number, y: number, z: number, k: number): number {
  return (
    Math.sin(x * k) * Math.sin(y * k * 1.31 + 1.7) * Math.sin(z * k * 0.87 + 4.1) +
    0.5 * Math.sin(x * k * 2.13 + 2.4) * Math.sin(z * k * 1.77 + 0.6)
  );
}

// The tangent frame a storm's oval is laid out in: u along its long
// axis, v across it. Shared, because a strike has to be placed inside
// the same oval the mesh was built from.
function stormFrame(dir: THREE.Vector3, along: THREE.Vector3) {
  const u = along.clone().addScaledVector(dir, -along.dot(dir));
  if (u.lengthSq() < 1e-6) u.set(1, 0, 0).addScaledVector(dir, -dir.x);
  u.normalize();
  const v = new THREE.Vector3().crossVectors(dir, u).normalize();
  return { u, v };
}

// A point on the oval, in the storm's own un-drifted frame. `s` is 0
// at the eye and 1 at the rim, `phi` goes round it.
function stormPoint(
  dir: THREE.Vector3,
  u: THREE.Vector3,
  v: THREE.Vector3,
  halfWidth: number,
  halfHeight: number,
  s: number,
  phi: number,
  out: THREE.Vector3
): THREE.Vector3 {
  // Polar form of the ellipse: how far out the rim is on this bearing,
  // as an angle at the planet's centre.
  const rim = 1 / Math.hypot(Math.cos(phi) / halfWidth, Math.sin(phi) / halfHeight);
  const th = s * rim;
  const st = Math.sin(th);
  const ct = Math.cos(th);
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  return out.set(
    dir.x * ct + (u.x * cp + v.x * sp) * st,
    dir.y * ct + (u.y * cp + v.y * sp) * st,
    dir.z * ct + (u.z * cp + v.z * sp) * st
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

  const { u, v } = stormFrame(dir, opts.along);

  const verts: number[] = [];
  const cols: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Color();

  const p = new THREE.Vector3();
  const push = (s: number, phi: number) => {
    stormPoint(dir, u, v, halfWidth, halfHeight, s, phi, p);
    verts.push(p.x * radius, p.y * radius, p.z * radius);
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

  // ── Storms ───────────────────────────────────────────────────────
  // The Great Red Spot, three quarters the width of the whole ocean
  // world, and the little white ovals that run along the belts either
  // side of it.
  //
  // None of them sit still. Each rides the band it is in, drifting
  // round Jupiter's axis, and neighbouring bands run opposite ways —
  // which is both what the real planet does and what turns the
  // surface from a painted ball into weather. Each also turns about
  // its own eye as it goes.
  //
  // All of that is two quaternions a frame: the spiral and the swirl
  // are baked into the vertex colours, so nothing here touches a
  // vertex once it is built. That is the only reason a storm this
  // size can afford to move at all.
  type Storm = {
    mesh: THREE.Mesh;
    dir: THREE.Vector3;
    u: THREE.Vector3;
    v: THREE.Vector3;
    halfWidth: number;
    halfHeight: number;
    drift: number;
    spin: number;
    // Seconds until it next cracks.
    nextStrike: number;
    gap: { min: number; max: number };
    // How bright a strike from this one is, and how far it carries.
    power: number;
  };
  const storms: Storm[] = [];
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
    // Its own mesh, so its resolution has nothing to do with the
    // planet's. The cloud tops are stuck with faces 2.5 units across;
    // this is eight thousand vertices over thirty units, and it is
    // where all the fine detail on Jupiter can afford to live.
    rings: 46,
    segs: 176,
    shade: (s, phi, out) => {
      // A log spiral: the arms tighten as they wind toward the eye,
      // which is the difference between a storm and a pinwheel. An
      // earlier version ran them straight out from the middle and
      // looked like a painted target.
      const wound = phi * 2 + Math.log(Math.max(0.06, s)) * 3.4;
      // Broken into filaments at three scales, and sheared harder
      // toward the rim, where the storm is tearing against the belts
      // running past it on either side.
      const shear = 0.35 + 1.6 * s;
      const t = curl(wound, phi) + 0.42 * shear * curl(wound * 2 + 4, phi * 2);
      const arms = 0.5 + 0.5 * Math.tanh(t * 1.5);
      // A dark eye, a long deep body, and only a thin pale collar at
      // the very rim where it stirs up the cloud around it.
      if (s < 0.12) out.copy(GRS_MID).lerp(GRS_CORE, 1 - s / 0.12);
      else if (s < 0.7) out.copy(GRS_CORE).lerp(GRS_MID, (s - 0.12) / 0.58);
      else if (s < 0.9) out.copy(GRS_MID).lerp(GRS_EDGE, (s - 0.7) / 0.2);
      else out.copy(GRS_EDGE).lerp(GRS_COLLAR, (s - 0.9) / 0.1);
      // The arms brighten and darken the body but leave the eye alone,
      // so the middle stays a solid, readable disc. Squared, because
      // every one of the 176 segments meets at the centre vertex — any
      // colour that still varies with phi down there turns the eye
      // into a tiny cog.
      const near = Math.min(1, s / 0.2);
      const strength = near * near * 0.46;
      out.multiplyScalar(1 - strength + strength * 2 * arms);
      // The eyewall: a thin bright ring right around the middle. It is
      // the one hard edge in the whole thing, and it is what makes the
      // eye read as a hole rather than a dark patch.
      const eyewall = Math.exp(-Math.pow((s - 0.155) / 0.04, 2));
      if (eyewall > 0.01) out.lerp(GRS_EDGE, eyewall * 0.62);
      // Ragged at the rim rather than cut on a clean ellipse — a storm
      // shredding into the belt it sits in has no outline.
      const ragged = 0.5 + 0.5 * Math.sin(phi * 17 + t * 2.2);
      const fadeFrom = 0.78 + 0.12 * ragged;
      return s < fadeFrom ? 1 : Math.max(0, 1 - (s - fadeFrom) / (1 - fadeFrom));
    },
  });
  {
    const mesh = new THREE.Mesh(grsGeo, stormMat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    group.add(mesh);
    const { u, v } = stormFrame(GRS_DIR, grsAlong);
    storms.push({
      mesh,
      dir: GRS_DIR.clone(),
      u,
      v,
      halfWidth: GRS_HALF_WIDTH,
      halfHeight: GRS_HALF_HEIGHT,
      drift: GRS_DRIFT,
      spin: 0.055,
      nextStrike: 1.2,
      // The big one gets the short end of the gap and the loudest
      // strikes: it is the storm you go and stand in.
      gap: { min: STRIKE_GAP.min, max: STRIKE_GAP.min + (STRIKE_GAP.max - STRIKE_GAP.min) * 0.45 },
      power: 1,
    });
  }

  // The little white ovals that run along the belts. Same geometry, a
  // tenth of the size, drifting at their own rates — two of them
  // against the Spot, one with it.
  for (const oval of WHITE_OVALS) {
    const along = new THREE.Vector3().crossVectors(JUPITER_AXIS, oval.dir).normalize();
    const geo = buildStorm({
      radius: radius + 0.04,
      dir: oval.dir,
      along,
      halfWidth: oval.halfWidth,
      halfHeight: oval.halfHeight,
      rings: 16,
      segs: 72,
      shade: (s, phi, out) => {
        // The same machinery, wound the other way and kept pale: these
        // are the cold high cloud between the belts, not holes in it.
        const wound = phi * 2 - Math.log(Math.max(0.06, s)) * 2.8;
        const t = curl(wound, phi) * 0.8;
        const arms = 0.5 + 0.5 * Math.tanh(t * 1.3);
        const near = Math.min(1, s / 0.25);
        out.copy(ZONE_BRIGHT).lerp(
          ZONE,
          s * 0.6 * (0.35 + 0.65 * (1 - arms) * near * near)
        );
        const eyewall = Math.exp(-Math.pow((s - 0.22) / 0.07, 2));
        if (eyewall > 0.01) out.lerp(ZONE_BRIGHT, eyewall * 0.5);
        const ragged = 0.5 + 0.5 * Math.sin(phi * 13 + t * 2);
        const fadeFrom = 0.6 + 0.14 * ragged;
        return s < fadeFrom ? 0.92 : Math.max(0, 0.92 * (1 - (s - fadeFrom) / (1 - fadeFrom)));
      },
    });
    const mesh = new THREE.Mesh(geo, stormMat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    group.add(mesh);
    const { u, v } = stormFrame(oval.dir, along);
    storms.push({
      mesh,
      dir: oval.dir.clone(),
      u,
      v,
      halfWidth: oval.halfWidth,
      halfHeight: oval.halfHeight,
      drift: oval.drift,
      // Small storms turn faster, the way small things do.
      spin: 0.11,
      nextStrike: 0.6 + rand() * 8,
      gap: STRIKE_GAP,
      // Quiet enough that one on the far side of the planet falls
      // under the audible floor entirely — they are scenery, and the
      // Spot is the one you are meant to hear.
      power: 0.34,
    });
  }

  // ── Lightning ────────────────────────────────────────────────────
  // A strike is two sprites in the same place: a small hard core and a
  // wide soft bloom, both additive, both flickering on the same
  // envelope. Sprites rather than a drawn bolt because a storm in the
  // cloud tops is only ever seen from above or nearly edge-on, and
  // from either angle what you see is the cloud lighting up, not the
  // bolt inside it.
  //
  // Four sets, reused. Two storms cracking at once is common; five is
  // not, and the fifth would be lost in the other four anyway.
  const FLASHES = 4;
  const flashes = Array.from({ length: FLASHES }, () => {
    const core = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeRadialTexture([
          [0, "rgba(255,255,255,1)"],
          [0.3, "rgba(214,234,255,0.85)"],
          [1, "rgba(150,190,255,0)"],
        ]),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      })
    );
    const bloom = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeRadialTexture([
          [0, "rgba(226,240,255,0.55)"],
          [0.45, "rgba(180,214,255,0.2)"],
          [1, "rgba(140,180,255,0)"],
        ]),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      })
    );
    core.scale.setScalar(3.4);
    bloom.scale.setScalar(15);
    core.visible = false;
    bloom.visible = false;
    core.renderOrder = 3;
    bloom.renderOrder = 3;
    group.add(core);
    group.add(bloom);
    return { core, bloom, t: -1, power: 1 };
  });
  // Rumbles crossing the sky, waiting to arrive, and when the last
  // one landed.
  const rumbles: Array<{ at: number; volume: number }> = [];
  let lastRumble = -99;

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
  const driftQuat = new THREE.Quaternion();
  const spinQuat = new THREE.Quaternion();
  const strikeAt = new THREE.Vector3();
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
      const wasVisible = group.visible;
      group.visible = opacity > 0.01;
      // Leaving. Put the weather away rather than letting it wait:
      // a half-finished flash would be sitting there on the next
      // visit, and a rumble still crossing the sky would arrive as a
      // clap of thunder some minutes later on a different planet.
      if (wasVisible && !group.visible) {
        for (const f of flashes) {
          f.t = -1;
          f.core.visible = false;
          f.bloom.visible = false;
        }
        rumbles.length = 0;
      }
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

      // Storms: drift along the belt, turn about the eye, and every so
      // often crack.
      //
      // `clock` only runs while the world is visible — the tick bails
      // above otherwise — so the weather is paused whenever nobody is
      // there to see it. That is what keeps the first arrival framed
      // the way it was designed, with the Spot dead ahead, while
      // still letting it be somewhere different every visit after.
      //
      // Order matters. The self-spin is expressed in the storm's own
      // starting frame, so it has to be applied first and the drift
      // laid over the top; the other way round would spin each storm
      // about an axis it has already left behind.
      for (const st of storms) {
        driftQuat.setFromAxisAngle(JUPITER_AXIS, st.drift * clock);
        spinQuat.setFromAxisAngle(st.dir, st.spin * clock);
        st.mesh.quaternion.copy(driftQuat).multiply(spinQuat);

        st.nextStrike -= dt;
        if (st.nextStrike > 0) continue;
        st.nextStrike = st.gap.min + rand() * (st.gap.max - st.gap.min);
        const flash = flashes.find((f) => f.t < 0);
        // All four already lit: skip this one rather than cutting
        // another storm's strike short.
        if (!flash) continue;
        // Somewhere inside the oval, biased off the eye — the middle
        // of a storm is the calm bit.
        stormPoint(
          st.dir,
          st.u,
          st.v,
          st.halfWidth,
          st.halfHeight,
          0.25 + rand() * 0.55,
          rand() * Math.PI * 2,
          strikeAt
        );
        // Into the drifted frame, and a little clear of the cloud so
        // the bloom is not half-buried in the surface.
        strikeAt.applyQuaternion(driftQuat).multiplyScalar(radius + 1.2);
        flash.core.position.copy(strikeAt);
        flash.bloom.position.copy(strikeAt);
        flash.t = 0;
        flash.power = st.power;
        // Thunder, once the sound has crossed to wherever the kid is.
        if (viewer) {
          strikeAt.add(center);
          const d = viewer.distanceTo(strikeAt);
          const vol =
            st.power *
            Math.min(1, Math.max(0, 1 - (d - THUNDER_FULL) / (THUNDER_GONE - THUNDER_FULL)));
          if (vol > 0.02) rumbles.push({ at: clock + d / THUNDER_SPEED, volume: vol });
        }
      }

      // Flashes, on a flicker rather than a fade: real lightning
      // stutters, and a single smooth ramp reads as a lamp coming on.
      for (const f of flashes) {
        if (f.t < 0) continue;
        f.t += dt;
        const k = f.t / STRIKE_SECONDS;
        if (k >= 1) {
          f.t = -1;
          f.core.visible = false;
          f.bloom.visible = false;
          continue;
        }
        const stutter = Math.max(0, Math.sin(k * Math.PI * 5.5)) * (1 - k) * (1 - k);
        const lit = opacity * f.power * stutter;
        f.core.material.opacity = Math.min(1, lit * 2.4);
        f.bloom.material.opacity = lit;
        f.core.visible = lit > 0.01;
        f.bloom.visible = lit > 0.01;
      }

      // Rumbles arriving. Walked backwards so a splice can't skip one.
      // One that lands on top of the last is dropped rather than
      // queued: late thunder is worse than no thunder.
      for (let i = rumbles.length - 1; i >= 0; i--) {
        if (rumbles[i].at > clock) continue;
        if (clock - lastRumble >= THUNDER_MIN_GAP) {
          lastRumble = clock;
          world.onThunder?.(rumbles[i].volume);
        }
        rumbles.splice(i, 1);
      }

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
