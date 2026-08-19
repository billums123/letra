import * as THREE from "three";
import type { PlanetSpec } from "../planet";
import { mulberry32, freshSeed } from "../world";
import { buildPortals, makeRadialTexture } from "./planetPortals";
import {
  SATURN_AXIS,
  SATURN_BEAM_HEIGHT,
  SATURN_SPOT_ANGLE,
  SATURN_SPOT_DIRS,
  SATURN_SPOT_TRIGGER,
  RING_INNER,
  RING_OUTER,
} from "./saturnLayout";

// Saturn: the second place the ocean can throw you, and the first one
// with a view.
//
// Same bones as the sun — a sphere the avatar walks with the tangent
// frame in planet.ts, portals home from planetPortals.ts, one fade
// driven by the biome's altitude curve. What it has instead of plasma
// is weather and rings.
//
// The rings are the whole point of coming, so the planet is tilted
// relative to the spot every arrival lands on. Standing on the pole of
// a ringed planet puts the rings flat on the horizon in every
// direction, which is the least interesting arrangement there is;
// landing fifty degrees off it puts them across the sky at an angle,
// arcing overhead and cutting behind the planet at both ends.

export type SaturnWorld = {
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

// Cloud tops, from the deep belts up to the bright zones.
// A wider range than the real planet has. Saturn's belts are famously
// subtle, and subtle over a 34-unit ball seen from eleven units away
// is no belts at all.
const BELT_DARK = new THREE.Color(0x7d5628);
const BELT = new THREE.Color(0xc08e46);
const ZONE = new THREE.Color(0xecd193);
const ZONE_BRIGHT = new THREE.Color(0xfcf2d8);
const POLAR = new THREE.Color(0xd8dce8);

// The rings.
const RING_PALE = new THREE.Color(0xe6d8b4);
const RING_WARM = new THREE.Color(0xc9a978);

function cellNoise(x: number, y: number, z: number, k: number): number {
  return (
    Math.sin(x * k) * Math.sin(y * k * 1.31 + 1.7) * Math.sin(z * k * 0.87 + 4.1) +
    0.5 * Math.sin(x * k * 2.13 + 2.4) * Math.sin(z * k * 1.77 + 0.6)
  );
}

export function buildSaturnWorld(opts: {
  center: THREE.Vector3;
  radius: number;
  hover?: number;
}): SaturnWorld {
  const { center, radius } = opts;
  const hover = opts.hover ?? 0.35;
  const rand = mulberry32(freshSeed());
  const group = new THREE.Group();
  group.position.copy(center);
  group.frustumCulled = false;

  const fading: Array<{ opacity: number }> = [];

  // ── Cloud tops ───────────────────────────────────────────────────
  // Colour is per vertex and sampled from the vertex's own position,
  // so shading is continuous across every edge rather than a mosaic of
  // triangles; the silhouette stays round either way.
  //
  // Self-lit, like the star. A gas giant lit by the scene's sun would
  // have a night side, and a four-year-old who walks onto it is then
  // standing in the dark on a planet they cannot see.
  const bodyGeo = new THREE.IcosahedronGeometry(radius, 20);
  const bodyPos = bodyGeo.attributes.position;
  const vertCount = bodyPos.count;
  const colors = new Float32Array(vertCount * 3);
  bodyGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const baseTint = new Float32Array(vertCount * 3);
  const spin = rand() * 12;
  const tint = new THREE.Color();
  for (let v = 0; v < vertCount; v++) {
    const x = bodyPos.getX(v);
    const y = bodyPos.getY(v);
    const z = bodyPos.getZ(v);
    // Latitude on Saturn's own axis, not the world's.
    const lat = (x * SATURN_AXIS.x + y * SATURN_AXIS.y + z * SATURN_AXIS.z) / radius;
    // Belts are ruler-straight on a globe and never are on a planet,
    // so the latitude gets nudged before it is banded.
    const wob = cellNoise(x + spin, y, z, 0.1) * 0.055;
    const l = lat + wob;
    const band = Math.min(
      1,
      Math.max(0, 0.5 + 0.36 * Math.sin(l * 16.5) + 0.22 * Math.sin(l * 6.4 + 1.1))
    );
    if (band < 0.34) tint.copy(BELT_DARK).lerp(BELT, band / 0.34);
    else if (band < 0.67) tint.copy(BELT).lerp(ZONE, (band - 0.34) / 0.33);
    else tint.copy(ZONE).lerp(ZONE_BRIGHT, (band - 0.67) / 0.33);
    // Both caps go pale and cold.
    const polar = Math.abs(lat);
    if (polar > 0.76) tint.lerp(POLAR, Math.min(0.8, (polar - 0.76) / 0.24));
    baseTint[v * 3] = tint.r;
    baseTint[v * 3 + 1] = tint.g;
    baseTint[v * 3 + 2] = tint.b;
  }
  const bodyMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    fog: false,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.frustumCulled = false;
  // Drawn before the rings, so its depth is down when they are tested
  // and the half of the ring behind the planet is correctly hidden.
  body.renderOrder = -1;
  group.add(body);
  fading.push(bodyMat);

  // ── Rings ────────────────────────────────────────────────────────
  const ringGeo = new THREE.RingGeometry(
    radius * RING_INNER,
    radius * RING_OUTER,
    128,
    30
  );
  {
    const pos = ringGeo.attributes.position;
    const cols = new Float32Array(pos.count * 4);
    const c = new THREE.Color();
    const inner = radius * RING_INNER;
    const outer = radius * RING_OUTER;
    for (let i = 0; i < pos.count; i++) {
      // RingGeometry lies in the XY plane.
      const r = Math.hypot(pos.getX(i), pos.getY(i));
      const u = Math.min(1, Math.max(0, (r - inner) / (outer - inner)));
      // Fine ringlets, a broad density falloff outward, and the
      // Cassini division cut through the middle of it.
      const ringlets = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(u * 52));
      const cassini = Math.exp(-Math.pow((u - 0.56) / 0.042, 2));
      // Soft at both edges, or the rings end on a hard circle.
      const edge = Math.min(1, u / 0.06) * Math.min(1, (1 - u) / 0.12);
      const density = ringlets * (1 - 0.92 * cassini) * edge * (1 - 0.25 * u);
      c.copy(RING_WARM).lerp(RING_PALE, Math.min(1, ringlets * 1.1));
      cols[i * 4] = c.r;
      cols[i * 4 + 1] = c.g;
      cols[i * 4 + 2] = c.b;
      cols[i * 4 + 3] = Math.min(1, density * 0.95);
    }
    ringGeo.setAttribute("color", new THREE.BufferAttribute(cols, 4));
  }
  const ringMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    // Never writes depth: it is a flat disc, so it cannot overlap
    // itself, and the planet in front of it has already been drawn.
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const rings = new THREE.Mesh(ringGeo, ringMat);
  // A RingGeometry's normal is +Z; turning that onto the axis puts the
  // rings around the equator.
  rings.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), SATURN_AXIS);
  rings.frustumCulled = false;
  rings.renderOrder = 2;
  group.add(rings);
  fading.push(ringMat);

  // ── Haze ─────────────────────────────────────────────────────────
  // A gas giant has no edge, so the limb gets a breath of atmosphere.
  // Like the sun's corona it is a sprite the width of the planet, and
  // like the sun's it has to be gone before touchdown or it is a sheet
  // across the whole sky.
  const hazeMat = new THREE.SpriteMaterial({
    map: makeRadialTexture([
      [0, "rgba(228,214,180,0.5)"],
      [0.42, "rgba(206,196,175,0.22)"],
      [1, "rgba(180,180,190,0)"],
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
    dirs: SATURN_SPOT_DIRS,
    angle: SATURN_SPOT_ANGLE,
    trigger: SATURN_SPOT_TRIGGER,
    beamHeight: SATURN_BEAM_HEIGHT,
    // Cold here, not molten: the pool freezes a pale rim into the
    // cloud tops instead of boiling a hot one.
    rim: 0xf2f6ff,
    scorch: 0x7d6a4c,
  });
  group.add(portals.group);

  // Standing on cloud tops, the light is the planet glowing under you
  // — dimmer and far colder than a star, but enough that the avatar
  // is not a silhouette. decay 0 because the avatar is a full radius
  // from the centre and physical falloff over that leaves nothing.
  const glow = new THREE.PointLight(0xe8e0cc, 0, radius * 2.4, 0);
  group.add(glow);

  let armed = false;
  let insidePortal = false;
  let opacity = 0;
  let colorClock = 0;
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

  const world: SaturnWorld = {
    group,
    center,
    radius,
    spec,
    setOpacity(k) {
      opacity = Math.min(1, Math.max(0, k));
      for (const m of fading) m.opacity = opacity;
      ringMat.opacity = opacity;
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
      const viewDist = viewer ? viewer.distanceTo(center) : radius * 12;
      const near = Math.min(1, Math.max(0, (viewDist - radius * 1.4) / (radius * 2.2)));
      hazeMat.opacity = opacity * 0.8 * near;
      haze.visible = near > 0.01;

      // Limb darkening against the viewer, at ~12Hz. Without it a
      // self-lit sphere reads as flat paper; with it the ground under
      // your feet is the brightest thing in shot and falls off toward
      // the horizon. The bands themselves are baked, so this is the
      // only per-frame colour work.
      colorClock += dt;
      if (colorClock > 0.08) {
        colorClock = 0;
        const vx = viewer ? viewer.x - center.x : 0;
        const vy = viewer ? viewer.y - center.y : radius * 12;
        const vz = viewer ? viewer.z - center.z : 0;
        for (let v = 0; v < vertCount; v++) {
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
          const facing = (cx * dx + cy * dy + cz * dz) / radius;
          const lit = 0.74 + 0.26 * Math.sqrt(Math.max(0, facing));
          vertColor.setRGB(baseTint[v * 3], baseTint[v * 3 + 1], baseTint[v * 3 + 2]);
          colors[v * 3] = vertColor.r * lit;
          colors[v * 3 + 1] = vertColor.g * lit;
          colors[v * 3 + 2] = vertColor.b * lit;
        }
        bodyGeo.attributes.color.needsUpdate = true;
      }

      portals.tick(dt, t, viewer);
    },
  };
  world.setOpacity(0);
  return world;
}
